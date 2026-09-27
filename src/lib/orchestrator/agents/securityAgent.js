/**
 * Security Agent
 * ==============
 * Two-layer security review for generated code artifacts.
 *
 * Layer 1 — Static regex (always runs, synchronous, 0 tokens).
 *   Scans each file line-by-line against 16 rules. Produces flags with
 *   accurate line numbers. Per-file early-exit: if any critical/high flag
 *   is found, Layer 2 is skipped for that file.
 *
 * Layer 2 — LLM review (only runs per-file when Layer 1 finds no critical/high).
 *   Scoped to 5 contextual checks that regex cannot reliably catch.
 *   Uses callGroqRaw (same client as reviewAgent.js, ~350 token budget).
 *   Failures degrade gracefully — never throws, falls back to Layer-1-only.
 *
 * Export:
 *   runSecurityAgent(files) → { pass, severity, flags, note }
 */

import { callGroqRaw } from "../groq.js";

// ─── Layer 1 rules ────────────────────────────────────────────────────────────

/**
 * @typedef {{ id: string, severity: string, pattern: RegExp, description: string,
 *             requiresAbsenceOf?: RegExp, contextLines?: number }} Layer1Rule
 */

/** @type {Layer1Rule[]} */
const LAYER_1_RULES = [
  {
    id: "hardcoded-secret",
    severity: "critical",
    pattern: /(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][a-zA-Z0-9+/]{16,}/i,
    description: "Hardcoded API key, secret, password, or token literal.",
  },
  {
    id: "openai-groq-key-literal",
    severity: "critical",
    pattern: /sk-[a-zA-Z0-9]{32,}/,
    description: "OpenAI/Groq-style API key literal found in source.",
  },
  {
    id: "eval-usage",
    severity: "critical",
    pattern: /\beval\s*\(/,
    description: "Use of eval() allows arbitrary code execution.",
  },
  {
    id: "new-function-usage",
    severity: "critical",
    pattern: /new\s+Function\s*\(/,
    description: "Use of new Function() allows arbitrary code execution.",
  },
  {
    id: "dangerously-set-inner-html",
    severity: "critical",
    pattern: /dangerouslySetInnerHTML/,
    description:
      "dangerouslySetInnerHTML used without adjacent sanitize/DOMPurify call in the same block.",
    requiresAbsenceOf: /sanitize|DOMPurify/i,
    contextLines: 5,
  },
  {
    id: "dom-write-innerhtml",
    severity: "critical",
    pattern: /\.innerHTML\s*=/,
    description: "Direct innerHTML assignment can enable XSS.",
  },
  {
    id: "dom-write-outerhtml",
    severity: "critical",
    pattern: /\.outerHTML\s*=/,
    description: "Direct outerHTML assignment can enable XSS.",
  },
  {
    id: "document-write",
    severity: "critical",
    pattern: /document\.write\s*\(/,
    description: "document.write() can enable XSS and is deprecated.",
  },
  {
    id: "sql-string-interpolation",
    severity: "critical",
    pattern: /`[^`]*(SELECT|INSERT|UPDATE|DELETE|DROP)[^`]*\$\{/i,
    description:
      "SQL keyword found in a template literal with interpolation — likely SQL injection.",
  },
  {
    id: "settimeout-string",
    severity: "critical",
    pattern: /setTimeout\s*\(\s*["'`]/,
    description: "setTimeout called with a string argument behaves like eval().",
  },
  {
    id: "setinterval-string",
    severity: "critical",
    pattern: /setInterval\s*\(\s*["'`]/,
    description: "setInterval called with a string argument behaves like eval().",
  },
  {
    id: "server-only-import-in-client",
    severity: "high",
    pattern: /from\s+['"](?:next\/server|next\/headers|fs|path|crypto)['"]/,
    description:
      "Server-only import found — verify this file is not a client component.",
  },
  {
    id: "auth-token-in-localstorage",
    severity: "high",
    pattern: /localStorage\.setItem\s*\(\s*['"][^'"]*(?:token|password|secret)/i,
    description:
      "Auth-sensitive value being written to localStorage, vulnerable to XSS exfiltration.",
  },
  {
    id: "prototype-pollution",
    severity: "high",
    pattern: /__proto__|constructor\s*\[\s*['"]prototype/,
    description: "Possible prototype pollution pattern.",
  },
  {
    id: "dynamic-redirect",
    severity: "medium",
    // Lookahead includes \s* so the engine can't match before consuming RHS whitespace.
    // Suppresses: window.location.href = "/path"  (RHS is a string literal)
    // Fires on:   window.location.href = someVar  (RHS is an identifier/expression)
    pattern: /window\.location(?:\.href)?\s*=(?!\s*['"`])/,
    description:
      "window.location assigned from a non-literal — verify the value isn't user-controlled (open redirect).",
  },
  {
    id: "console-debug-leak",
    severity: "low",
    pattern: /console\.(log|warn|error|debug)\s*\(/,
    description:
      "Debug logging left in code — check for leaked sensitive data before shipping.",
  },
];

// ─── Severity ordering ────────────────────────────────────────────────────────

const SEVERITY_ORDER = ["critical", "high", "medium", "low"];

/** @param {string[]} severities */
function highestSeverity(severities) {
  for (const s of SEVERITY_ORDER) {
    if (severities.includes(s)) return s;
  }
  return null;
}

/** @param {string} s */
function isValidSeverity(s) {
  return SEVERITY_ORDER.includes(s);
}

// ─── Layer 2 allowed rule ids ─────────────────────────────────────────────────

const LAYER_2_ALLOWED_RULES = new Set([
  "contextual-xss",
  "ssrf",
  "unsafe-json-parse",
  "permissive-cors",
  "auth-race-condition",
]);

// ─── Layer 2 system prompt ────────────────────────────────────────────────────

const LAYER_2_SYSTEM = `You are a focused security reviewer. Review the provided source file for ONLY these five issues:

1. contextual-xss: User input flowing to the DOM without visible sanitization (cannot be caught by regex).
2. ssrf: fetch() URL built from user-controlled props or query params.
3. unsafe-json-parse: JSON.parse() on untrusted/external data with no schema or shape validation afterward.
4. permissive-cors: Overly permissive CORS (Access-Control-Allow-Origin: * or reflecting Origin header unchecked) in API route files.
5. auth-race-condition: Checking isLoggedIn / user state after an await without re-checking post-await.

Do NOT flag anything a regex would already catch: secrets, eval, innerHTML, dangerouslySetInnerHTML, hardcoded tokens, server-only imports, localStorage auth writes, prototype pollution, SQL injection, document.write, etc. Those are handled separately.

Respond with ONLY a raw JSON array, no markdown code fences, no preamble, no explanation. If there are no findings, respond with an empty array: []

Each finding must be: {"rule": "<one of the 5 rule ids above>", "severity": "critical"|"high"|"medium"|"low", "line": <1-indexed number>, "snippet": "<matched line trimmed to 200 chars>", "description": "<one sentence>"}`;

// ─── Snippet helper ───────────────────────────────────────────────────────────

/** @param {string} line */
function makeSnippet(line) {
  const trimmed = line.trim();
  return trimmed.length > 200 ? trimmed.slice(0, 200) + "…" : trimmed;
}

// ─── Layer 1 scan ─────────────────────────────────────────────────────────────

/**
 * Run Layer 1 static rules against a single file's content.
 * Scans line-by-line to get accurate line numbers.
 *
 * @param {{ path: string, content: string }} file
 * @returns {Array<import('./securityAgent.js').Flag>}
 */
function runLayer1(file) {
  const lines = file.content.split("\n");
  /** @type {Map<string, Set<number>>} dedup key: "ruleId:lineNumber" */
  const seen = new Map();
  const flags = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1; // 1-indexed

    for (const rule of LAYER_1_RULES) {
      if (!rule.pattern.test(line)) continue;

      // dangerouslySetInnerHTML: check context window for sanitizer
      if (rule.requiresAbsenceOf && rule.contextLines) {
        const start = Math.max(0, i - rule.contextLines);
        const end = Math.min(lines.length - 1, i + rule.contextLines);
        const window = lines.slice(start, end + 1).join("\n");
        if (rule.requiresAbsenceOf.test(window)) {
          // sanitizer present — suppress this flag
          continue;
        }
      }

      // Dedup: same rule id + same line number in this file
      const dedupeKey = `${rule.id}:${lineNumber}`;
      if (!seen.has(rule.id)) seen.set(rule.id, new Set());
      if (seen.get(rule.id).has(lineNumber)) continue;
      seen.get(rule.id).add(lineNumber);

      flags.push({
        rule: rule.id,
        severity: rule.severity,
        file: file.path,
        line: lineNumber,
        snippet: makeSnippet(line),
        layer: 1,
        description: rule.description,
      });
    }
  }

  return flags;
}

// ─── Layer 2 LLM scan ─────────────────────────────────────────────────────────

/**
 * Run Layer 2 LLM review on a single file. Only called when Layer 1 found
 * no critical/high flags for this file.
 *
 * @param {{ path: string, content: string }} file
 * @returns {Promise<Array<import('./securityAgent.js').Flag>>}
 */
async function runLayer2(file) {
  const userMsg = `File: ${file.path}\n\n${file.content}`;

  let raw;
  try {
    raw = await callGroqRaw(
      [
        { role: "system", content: LAYER_2_SYSTEM },
        { role: "user",   content: userMsg },
      ],
      { maxTokens: 350, temperature: 0.1 }
    );
  } catch (err) {
    // LLM call failed — signal the caller to add a note
    throw new Error(`[securityAgent/layer2] LLM call failed for ${file.path}: ${err.message}`);
  }

  // Strip accidental markdown fences even though we told it not to use them
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.warn(
      `[securityAgent/layer2] Could not parse JSON for ${file.path}. Raw: ${raw.slice(0, 300)}`
    );
    return [];
  }

  if (!Array.isArray(parsed)) {
    console.warn(`[securityAgent/layer2] Expected array, got ${typeof parsed} for ${file.path}.`);
    return [];
  }

  const flags = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;

    // Drop flags with unknown rule ids — don't trust model scope creep
    if (!LAYER_2_ALLOWED_RULES.has(item.rule)) {
      console.warn(
        `[securityAgent/layer2] Dropping out-of-scope rule "${item.rule}" from model output.`
      );
      continue;
    }

    // Clamp/validate severity — default to "medium" if model returns garbage
    const severity = isValidSeverity(item.severity) ? item.severity : "medium";

    flags.push({
      rule:        item.rule,
      severity,
      file:        file.path,
      line:        typeof item.line === "number" && item.line > 0 ? Math.round(item.line) : 1,
      snippet:     typeof item.snippet === "string" ? item.snippet.slice(0, 200) : "",
      layer:       2,
      description: typeof item.description === "string" ? item.description : `${item.rule} finding.`,
    });
  }

  return flags;
}

// ─── Note builder ─────────────────────────────────────────────────────────────

/**
 * Build the human-readable summary note.
 *
 * @param {Array<{ severity: string, file: string }>} flags
 * @param {boolean} llmUnavailable
 * @returns {string}
 */
function buildNote(flags, llmUnavailable) {
  if (flags.length === 0) {
    const base = "No security findings.";
    return llmUnavailable ? `${base} (LLM layer unavailable, static checks only)` : base;
  }

  const counts = {};
  const filesSeen = new Set();
  for (const f of flags) {
    counts[f.severity] = (counts[f.severity] ?? 0) + 1;
    filesSeen.add(f.file);
  }

  const parts = SEVERITY_ORDER.filter((s) => counts[s]).map(
    (s) => `${counts[s]} ${s}`
  );

  const base = `${parts.join(", ")} finding(s) across ${filesSeen.size} file(s).`;
  return llmUnavailable ? `${base} (LLM layer unavailable, static checks only)` : base;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run a two-layer security review across one or more generated files.
 *
 * Layer 1 (static regex) always runs — free, synchronous, accurate.
 * Layer 2 (LLM, ~350 tokens) runs automatically when Layer 1 finds no
 * critical/high flags for a file. Pass enableLayer2: false to skip it.
 *
 * @param {Array<{ path: string, content: string }> | { path: string, content: string }} files
 * @param {{ enableLayer2?: boolean }} options
 * @returns {Promise<{
 *   pass: boolean,
 *   severity: "critical"|"high"|"medium"|"low"|null,
 *   flags: Array<{
 *     rule: string,
 *     severity: "critical"|"high"|"medium"|"low",
 *     file: string,
 *     line: number,
 *     snippet: string,
 *     layer: 1|2,
 *     description: string
 *   }>,
 *   note: string
 * }>}
 */
export async function runSecurityAgent(files, { enableLayer2 = true } = {}) {
  // Normalize single object → array
  const fileList = Array.isArray(files) ? files : [files];

  const allFlags = [];
  let llmUnavailable = false;

  for (const file of fileList) {
    // ── Layer 1 ──────────────────────────────────────────────────────────────
    const l1Flags = runLayer1(file);
    allFlags.push(...l1Flags);

    const hasBlockingL1 = l1Flags.some(
      (f) => f.severity === "critical" || f.severity === "high"
    );

    // ── Layer 2 (per-file early-exit if Layer 1 critical/high) ───────────────
    if (enableLayer2 && !hasBlockingL1) {
      try {
        const l2Flags = await runLayer2(file);
        allFlags.push(...l2Flags);
      } catch (err) {
        console.warn(err.message);
        llmUnavailable = true;
        // Do not throw — continue with Layer-1-only results for this file
      }
    }
  }

  // ── Aggregation ───────────────────────────────────────────────────────────
  const pass = !allFlags.some(
    (f) => f.severity === "critical" || f.severity === "high"
  );

  const severity = highestSeverity(allFlags.map((f) => f.severity));

  const note = buildNote(allFlags, llmUnavailable);

  return { pass, severity, flags: allFlags, note };
}
//s