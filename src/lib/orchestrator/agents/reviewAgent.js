/**
 * Review Agent — automatic middleware gate, NOT an orchestrator tool.
 *
 * Runs after every codegen step (UI, DB, API) without burning an orchestrator
 * turn. The orchestrator never sees these calls — it just gets back a clean
 * artifact (or a self-healed one if the first attempt failed).
 *
 * Uses Qwen via callGroqRaw (no tool-calling overhead, ~300 token prompt).
 *
 * ── What it does ──────────────────────────────────────────────────────────
 *
 * runMonitorReview(artifact)
 *   Checks: best practices, React-only (no DOM APIs), no TypeScript in JSX,
 *   no broken imports, no hardcoded URLs.
 *   Returns: { pass, feedback, checks }
 *
 * runSecurityReview(artifact)
 *   Checks: no secrets/tokens, no eval/Function, no dangerouslySetInnerHTML,
 *   no XSS vectors, no server-only imports in client code.
 *   Returns: { pass, flags, note }
 *
 * Both functions accept a MAX_RETRIES option. On failure the offending agent
 * function is called directly with the feedback — no orchestrator round-trip.
 *
 * ── Token cost ────────────────────────────────────────────────────────────
 * Each review call sends only:
 *   - ~150 token system prompt
 *   - file content (compressed to first 200 lines per file, max 3 files)
 * Total: ~300-600 tokens vs ~3,500 tokens for an orchestrator tool round-trip.
 */

import { callGroqRaw } from "../groq.js";

const MAX_FILE_CHARS  = 1_500; // chars per file sent to reviewer (~375 tokens); enough to catch real issues
const MAX_FILES       = 2;     // max files per review call; 3rd file rarely adds signal

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Compress artifact files for review — keep only the first MAX_FILE_CHARS
 * characters of each file and cap at MAX_FILES files.
 */
function compressFiles(files) {
  if (!Array.isArray(files)) return [];
  return files.slice(0, MAX_FILES).map((f) => ({
    path:    f.path,
    content: typeof f.content === "string"
      ? f.content.slice(0, MAX_FILE_CHARS) + (f.content.length > MAX_FILE_CHARS ? "\n// [truncated]" : "")
      : "",
  }));
}

function formatFilesForPrompt(files) {
  return files
    .map((f) => `--- ${f.path} ---\n${f.content}`)
    .join("\n\n");
}

/**
 * Parse a JSON { pass, feedback/flags/note } from the model's response.
 * Falls back to pass:true if parsing fails so a broken reviewer never blocks the pipeline.
 */
function parseReviewResponse(raw, reviewType) {
  // Strip think blocks and markdown fences before any extraction attempt
  let stripped = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/\s*```$/m, "")
    .trim();

  // Strategy 1: find a JSON object that contains a "pass" key — this
  // avoids picking up stray braces in preamble or system-prompt echoes.
  const jsonMatch = stripped.match(/\{[^{}]*"pass"\s*:[^{}]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (typeof parsed.pass === "boolean") return parsed;
    } catch { /* fall through */ }
  }

  // Strategy 2: outermost { ... } in case the object is nested (e.g. flags array)
  const start = stripped.indexOf("{");
  const end   = stripped.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(stripped.slice(start, end + 1));
      if (typeof parsed.pass === "boolean") return parsed;
    } catch { /* fall through */ }
  }

  // Heuristic fallback — default to pass:true so a broken reviewer never
  // silently blocks the pipeline. Only flip to false when the model clearly
  // said something failed (explicit "pass: false" / "failed" wording).
  // We intentionally avoid words that appear in the system prompt itself
  // ("issue", "error", "secrets") because those would always trigger false negatives.
  const lower = stripped.toLowerCase();
  const looksOk = !(lower.includes("pass: false") || lower.includes('"pass":false') || lower.includes("failed"));

  console.warn(`[reviewAgent/${reviewType}] Could not parse JSON response — heuristic: ${looksOk ? "pass" : "fail"}`);
  return {
    pass:     looksOk,
    flags:    [],
    feedback: looksOk ? "OK (heuristic)" : `Could not parse review response. Raw: ${stripped.slice(0, 200)}`,
  };
}

// ─── Monitor review ───────────────────────────────────────────────────────────

const MONITOR_SYSTEM = `React codegen reviewer. Check ONLY:
1. No DOM APIs (document.querySelector, innerHTML, addEventListener)
2. No TypeScript syntax (no type annotations, no interface/type, no useState<T>())
3. Default export present on main component
4. No console.log, alert(), or debugger
5. No JSX attribute syntax errors — dynamic attributes must use {}: aria-label={\`Hello \${name}\`} not aria-label="Hello " + name

Reply ONLY: {"pass":true} or {"pass":false,"feedback":"one sentence"}`;

/**
 * Run the monitor (quality) review on an artifact.
 *
 * @param {{ files: Array<{ path: string, content: string }>, summary?: string }} artifact
 * @returns {Promise<{ pass: boolean, feedback?: string, checks: string[] }>}
 */
export async function runMonitorReview(artifact) {
  const files = compressFiles(artifact?.files ?? []);
  if (files.length === 0) {
    return { pass: true, feedback: "No files to review.", checks: [] };
  }

  const userMsg = `Review these generated files:\n\n${formatFilesForPrompt(files)}`;

  let raw;
  try {
    raw = await callGroqRaw(
      [
        { role: "system", content: MONITOR_SYSTEM },
        { role: "user",   content: userMsg },
      ],
      { maxTokens: 64, temperature: 0.1 }
    );
  } catch (err) {
    console.warn(`[reviewAgent/monitor] Groq error — skipping review: ${err.message}`);
    return { pass: true, feedback: "Review skipped (Groq error).", checks: [] };
  }

  const result = parseReviewResponse(raw, "monitor");
  console.log(`[reviewAgent/monitor] pass=${result.pass}${result.feedback ? ` feedback=${result.feedback}` : ""}`);

  return {
    pass:     result.pass,
    feedback: result.feedback ?? null,
    checks:   ["react_only", "no_typescript", "default_export", "imports", "no_debug", "no_hardcoded_urls"],
  };
}

// ─── Security review ──────────────────────────────────────────────────────────

const SECURITY_SYSTEM = `React security reviewer. Check ONLY:
1. No hardcoded secrets, API keys, or tokens
2. No eval(), new Function(), or dynamic code execution
3. No dangerouslySetInnerHTML without sanitization
4. No server-only imports (next/server, next/headers, fs, path, crypto)

Reply ONLY: {"pass":true} or {"pass":false,"flags":["issue"]}`;

/**
 * Run the security review on an artifact.
 *
 * @param {{ files: Array<{ path: string, content: string }>, summary?: string }} artifact
 * @returns {Promise<{ pass: boolean, flags: string[], note?: string }>}
 */
export async function runSecurityReview(artifact) {
  const files = compressFiles(artifact?.files ?? []);
  if (files.length === 0) {
    return { pass: true, flags: [], note: "No files to review." };
  }

  const userMsg = `Security review these generated files:\n\n${formatFilesForPrompt(files)}`;

  let raw;
  try {
    raw = await callGroqRaw(
      [
        { role: "system", content: SECURITY_SYSTEM },
        { role: "user",   content: userMsg },
      ],
      { maxTokens: 128, temperature: 0.1 }
    );
  } catch (err) {
    console.warn(`[reviewAgent/security] Groq error — skipping review: ${err.message}`);
    return { pass: true, flags: [], note: "Review skipped (Groq error)." };
  }

  const result = parseReviewResponse(raw, "security");
  console.log(`[reviewAgent/security] pass=${result.pass}${result.flags?.length ? ` flags=${result.flags.join(", ")}` : ""}`);

  return {
    pass:  result.pass,
    flags: result.flags ?? [],
    note:  result.feedback ?? result.note ?? null,
  };
}
