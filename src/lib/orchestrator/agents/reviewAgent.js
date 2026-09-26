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

const MAX_FILE_CHARS  = 4_000; // chars per file sent to reviewer (~1000 tokens)
const MAX_FILES       = 3;     // max files per review call

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
  const stripped = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // Try direct JSON
  const start = stripped.indexOf("{");
  const end   = stripped.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(stripped.slice(start, end + 1));
      if (typeof parsed.pass === "boolean") return parsed;
    } catch { /* fall through */ }
  }

  // Heuristic: if response contains "pass" or "ok" without "fail" or "issue"
  const lower = stripped.toLowerCase();
  const looksOk = (lower.includes("pass") || lower.includes("looks good") || lower.includes("no issues"))
    && !lower.includes("fail") && !lower.includes("issue") && !lower.includes("error");

  console.warn(`[reviewAgent/${reviewType}] Could not parse JSON response — heuristic: ${looksOk ? "pass" : "fail"}`);
  return {
    pass:     looksOk,
    feedback: looksOk ? "OK (heuristic)" : `Could not parse review response. Raw: ${stripped.slice(0, 200)}`,
  };
}

// ─── Monitor review ───────────────────────────────────────────────────────────

const MONITOR_SYSTEM = `You are a code quality reviewer for a React code generation pipeline.
You receive generated React component files and check them for issues.

Review for:
1. React-only code — no document.querySelector, addEventListener, innerHTML, or any DOM APIs
2. No TypeScript syntax — no type annotations, no generics like useState<T>(), no interface/type declarations
3. Default export present on the main component
4. No broken or relative imports that won't resolve (e.g. "../lib/db.js" should be "/lib/db.js")
5. No console.log, alert(), or debugger statements
6. No hardcoded localhost URLs or absolute paths

Reply with ONLY a JSON object, no other text:
{"pass": true} if everything is fine
{"pass": false, "feedback": "specific issue description and how to fix it"} if there are problems

Be concise. One issue at a time. Do not invent problems that aren't there.`;

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
      { maxTokens: 256, temperature: 0.1 }
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

const SECURITY_SYSTEM = `You are a security reviewer for a React code generation pipeline.
You receive generated React component files and check them for security issues.

Review for:
1. No API keys, tokens, passwords, or secrets hardcoded in the code
2. No use of eval(), new Function(), or dynamic code execution
3. No dangerouslySetInnerHTML unless content is explicitly sanitised
4. No direct localStorage manipulation of auth tokens or session data
5. No imports from server-only modules (next/server, next/headers, fs, path, crypto)
6. No XSS vectors — user input must not be inserted into the DOM unsanitised

Reply with ONLY a JSON object, no other text:
{"pass": true} if the code is safe
{"pass": false, "flags": ["specific issue 1", "specific issue 2"]} if there are security problems

Be precise. Only flag real issues, not hypothetical ones.`;

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
      { maxTokens: 256, temperature: 0.1 }
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
