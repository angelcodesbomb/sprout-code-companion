/**
 * Security Agent test suite
 * =========================
 * Covers all 8 required test cases without an external test framework.
 *
 * Run: node scripts/test-security-agent.mjs
 *
 * Mocking strategy: callGroqRaw ultimately calls globalThis.fetch.
 * We replace globalThis.fetch before each Layer-2-relevant test and restore
 * it afterward. This works because Node 18+ has a built-in fetch that is
 * globally assignable, and callGroqRaw reads GROQ_API_KEY at call time.
 */

import { runSecurityAgent } from "../src/lib/orchestrator/agents/securityAgent.js";

// ─── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const REAL_FETCH = globalThis.fetch;

/** Print PASS / FAIL and tally. */
function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.log(`  FAIL  ${label}${detail ? `\n        → ${detail}` : ""}`);
    failed++;
  }
}

/** Replace globalThis.fetch with a stub that returns a canned Groq response. */
function mockFetch(responseBody) {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => responseBody,
    text: async () => JSON.stringify(responseBody),
  });
}

/** Restore the real fetch (or a no-op if there wasn't one). */
function restoreFetch() {
  globalThis.fetch = REAL_FETCH ?? undefined;
}

/** Build a fake Groq response wrapping a text string. */
function groqResponse(text) {
  return {
    choices: [{ message: { content: text, role: "assistant" } }],
  };
}

/** Ensure GROQ_API_KEY is set so callGroqRaw doesn't throw early. */
process.env.GROQ_API_KEY = process.env.GROQ_API_KEY ?? "test-key-placeholder";

// ─── Section header helper ────────────────────────────────────────────────────

function section(title) {
  console.log(`\n── ${title}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST CASE 1
// Each Layer 1 rule fires on a minimal positive example with correct
// line number and severity.
// ─────────────────────────────────────────────────────────────────────────────

section("Test 1 — Layer 1 rules fire on positive examples");

// We mock fetch to return [] for all Layer 2 calls in this section
// (any files that clear Layer 1 will hit Layer 2 — return empty)
mockFetch(groqResponse("[]"));

const L1_POSITIVE_CASES = [
  {
    rule: "hardcoded-secret",
    severity: "critical",
    content: `const x = 1;\nconst apiKey = "abcdefghijklmnopqrstuvwxyz1234";\nconst y = 2;`,
    targetLine: 2,
  },
  {
    rule: "openai-groq-key-literal",
    severity: "critical",
    content: `const key = "sk-" + "abcdefghijklmnopqrstuvwxyz1234567890ab";`,
    // The pattern is /sk-[a-zA-Z0-9]{32,}/ — needs to be on one token
    // Rewrite as a real-looking literal:
    content: `const key = "sk-abcdefghijklmnopqrstuvwxyz1234567890ab";`,
    targetLine: 1,
  },
  {
    rule: "eval-usage",
    severity: "critical",
    content: `// line 1\nconst result = eval("2+2");\n// line 3`,
    targetLine: 2,
  },
  {
    rule: "new-function-usage",
    severity: "critical",
    content: `const fn = new Function("return 1");`,
    targetLine: 1,
  },
  {
    rule: "dangerously-set-inner-html",
    severity: "critical",
    // No DOMPurify anywhere in the context window
    content: `<div dangerouslySetInnerHTML={{ __html: userInput }} />`,
    targetLine: 1,
  },
  {
    rule: "dom-write-innerhtml",
    severity: "critical",
    content: `el.innerHTML = userInput;`,
    targetLine: 1,
  },
  {
    rule: "dom-write-outerhtml",
    severity: "critical",
    content: `el.outerHTML = "<b>hi</b>";`,
    targetLine: 1,
  },
  {
    rule: "document-write",
    severity: "critical",
    content: `document.write("<script>alert(1)</script>");`,
    targetLine: 1,
  },
  {
    rule: "sql-string-interpolation",
    severity: "critical",
    content: `const q = \`SELECT * FROM users WHERE id = \${userId}\`;`,
    targetLine: 1,
  },
  {
    rule: "settimeout-string",
    severity: "critical",
    content: `setTimeout("doSomething()", 100);`,
    targetLine: 1,
  },
  {
    rule: "setinterval-string",
    severity: "critical",
    content: `setInterval('tick()', 1000);`,
    targetLine: 1,
  },
  {
    rule: "server-only-import-in-client",
    severity: "high",
    content: `import { readFileSync } from "fs";`,
    targetLine: 1,
  },
  {
    rule: "auth-token-in-localstorage",
    severity: "high",
    content: `localStorage.setItem("authToken", value);`,
    targetLine: 1,
  },
  {
    rule: "prototype-pollution",
    severity: "high",
    content: `obj.__proto__.isAdmin = true;`,
    targetLine: 1,
  },
  {
    rule: "dynamic-redirect",
    severity: "medium",
    // Must NOT start with a quote after the = to match the negative lookahead
    content: `window.location.href = userRedirect;`,
    targetLine: 1,
  },
  {
    rule: "console-debug-leak",
    severity: "low",
    content: `console.log("debug:", sensitiveData);`,
    targetLine: 1,
  },
];

for (const tc of L1_POSITIVE_CASES) {
  const result = await runSecurityAgent({ path: "test.js", content: tc.content });
  const flag = result.flags.find((f) => f.rule === tc.rule && f.layer === 1);
  assert(
    `rule "${tc.rule}" fires (severity=${tc.severity}, line=${tc.targetLine})`,
    flag !== undefined && flag.severity === tc.severity && flag.line === tc.targetLine,
    flag
      ? `got line=${flag.line} severity=${flag.severity}`
      : `no flag found. All flags: ${JSON.stringify(result.flags.map((f) => f.rule))}`
  );
}

restoreFetch();

// ─────────────────────────────────────────────────────────────────────────────
// TEST CASE 2
// Each Layer 1 rule does NOT fire on safe adjacent examples.
// Focus on the most important: dangerouslySetInnerHTML with DOMPurify.
// Also spot-check a few others to confirm no accidental matches.
// ─────────────────────────────────────────────────────────────────────────────

section("Test 2 — Layer 1 rules do NOT fire on safe examples");

mockFetch(groqResponse("[]"));

// 2a: dangerouslySetInnerHTML WITH DOMPurify.sanitize in the context window → no flag
{
  const content = [
    "function MyComponent({ html }) {",
    "  const clean = DOMPurify.sanitize(html);",
    "  return <div dangerouslySetInnerHTML={{ __html: clean }} />;",
    "}",
  ].join("\n");

  const result = await runSecurityAgent({ path: "component.jsx", content });
  const flag = result.flags.find((f) => f.rule === "dangerously-set-inner-html");
  assert(
    'dangerously-set-inner-html suppressed when DOMPurify.sanitize() is in context window',
    flag === undefined,
    flag ? `unexpected flag at line ${flag.line}` : ""
  );
}

// 2b: window.location assigned from a literal string — should NOT fire (negative lookahead)
{
  const content = `window.location.href = "/dashboard";`;
  const result = await runSecurityAgent({ path: "nav.js", content });
  const flag = result.flags.find((f) => f.rule === "dynamic-redirect");
  assert(
    "dynamic-redirect does not fire when rhs is a string literal",
    flag === undefined,
    flag ? `unexpected flag at line ${flag.line}` : ""
  );
}

// 2c: localStorage.setItem with a non-sensitive key — should NOT fire
{
  const content = `localStorage.setItem("theme", "dark");`;
  const result = await runSecurityAgent({ path: "prefs.js", content });
  const flag = result.flags.find((f) => f.rule === "auth-token-in-localstorage");
  assert(
    "auth-token-in-localstorage does not fire for non-sensitive localStorage key",
    flag === undefined,
    flag ? `unexpected flag at line ${flag.line}` : ""
  );
}

// 2d: dangerouslySetInnerHTML with sanitize() (not DOMPurify, but sanitize keyword) → suppressed
{
  const content = [
    "const safe = sanitize(userInput);",
    "<div dangerouslySetInnerHTML={{ __html: safe }} />",
  ].join("\n");

  const result = await runSecurityAgent({ path: "comp.jsx", content });
  const flag = result.flags.find((f) => f.rule === "dangerously-set-inner-html");
  assert(
    "dangerously-set-inner-html suppressed when sanitize() is in context window",
    flag === undefined,
    flag ? `unexpected flag at line ${flag.line}` : ""
  );
}

restoreFetch();

// ─────────────────────────────────────────────────────────────────────────────
// TEST CASE 3
// A file with a critical Layer 1 hit does NOT trigger a Layer 2 call at all.
// ─────────────────────────────────────────────────────────────────────────────

section("Test 3 — Layer 2 NOT called when Layer 1 has a critical/high flag");

let fetchCallCount = 0;
globalThis.fetch = async (...args) => {
  fetchCallCount++;
  return {
    ok: true,
    status: 200,
    json: async () => groqResponse("[]"),
    text: async () => "{}",
  };
};

const criticalContent = `const fn = eval("dangerous");`;
fetchCallCount = 0;

await runSecurityAgent({ path: "evil.js", content: criticalContent });

assert(
  "fetch (LLM) was NOT called for file with critical Layer 1 flag",
  fetchCallCount === 0,
  `fetch was called ${fetchCallCount} time(s)`
);

restoreFetch();

// ─────────────────────────────────────────────────────────────────────────────
// TEST CASE 4
// A clean file (no Layer 1 hits) triggers exactly one Layer 2 call.
// ─────────────────────────────────────────────────────────────────────────────

section("Test 4 — Layer 2 called exactly once for a clean file");

let layer2CallCount = 0;
globalThis.fetch = async () => {
  layer2CallCount++;
  return {
    ok: true,
    status: 200,
    json: async () => groqResponse("[]"),
    text: async () => "{}",
  };
};

const cleanContent = `export function add(a, b) { return a + b; }`;
layer2CallCount = 0;

await runSecurityAgent({ path: "utils.js", content: cleanContent });

assert(
  "fetch (LLM) called exactly once for a file with no Layer 1 findings",
  layer2CallCount === 1,
  `fetch was called ${layer2CallCount} time(s)`
);

restoreFetch();

// ─────────────────────────────────────────────────────────────────────────────
// TEST CASE 5
// pass is false when any critical/high flag exists.
// pass is true when only medium/low or no flags exist.
// ─────────────────────────────────────────────────────────────────────────────

section("Test 5 — pass / fail logic");

mockFetch(groqResponse("[]"));

// 5a: critical flag → pass must be false
{
  const result = await runSecurityAgent({
    path: "a.js",
    content: `eval("boom");`,
  });
  assert(
    "pass=false when critical flag present",
    result.pass === false,
    `pass=${result.pass}`
  );
}

// 5b: high flag → pass must be false
{
  const result = await runSecurityAgent({
    path: "b.js",
    content: `import { readFileSync } from "fs";`,
  });
  assert(
    "pass=false when high flag present",
    result.pass === false,
    `pass=${result.pass}`
  );
}

// 5c: only medium flag → pass must be true
{
  // dynamic-redirect (medium) is the only flag here
  const result = await runSecurityAgent({
    path: "c.js",
    content: `window.location.href = someVar;`,
  });
  const hasMedium = result.flags.some((f) => f.severity === "medium");
  assert(
    "pass=true when only medium flag present",
    result.pass === true && hasMedium,
    `pass=${result.pass}, flags=${JSON.stringify(result.flags.map((f) => f.severity))}`
  );
}

// 5d: only low flag → pass must be true
{
  // console.log → low
  // Use mockFetch to ensure Layer 2 returns []
  const result = await runSecurityAgent({
    path: "d.js",
    content: `console.log("hello");`,
  });
  const hasLow = result.flags.some((f) => f.severity === "low");
  assert(
    "pass=true when only low flag present",
    result.pass === true && hasLow,
    `pass=${result.pass}, flags=${JSON.stringify(result.flags.map((f) => f.severity))}`
  );
}

// 5e: no flags → pass must be true, severity must be null
{
  const result = await runSecurityAgent({
    path: "e.js",
    content: `export const x = 42;`,
  });
  assert(
    "pass=true and severity=null when no flags",
    result.pass === true && result.severity === null,
    `pass=${result.pass} severity=${result.severity}`
  );
}

restoreFetch();

// ─────────────────────────────────────────────────────────────────────────────
// TEST CASE 6
// Malformed / non-JSON Layer 2 response is handled without throwing,
// and does not add spurious flags.
// ─────────────────────────────────────────────────────────────────────────────

section("Test 6 — malformed Layer 2 response handled gracefully");

// Return garbage text from the LLM
mockFetch(groqResponse("Sorry, I cannot help with that. Please try again later."));

let threw = false;
let result6;
try {
  result6 = await runSecurityAgent({
    path: "clean.js",
    content: `export function greet(name) { return "Hello " + name; }`,
  });
} catch (e) {
  threw = true;
}

assert(
  "runSecurityAgent does not throw when Layer 2 returns non-JSON",
  threw === false,
  "threw an exception"
);

// The function should still return a valid result shape with no spurious flags
assert(
  "no spurious flags added from malformed Layer 2 response",
  result6 !== undefined && Array.isArray(result6.flags) && result6.flags.length === 0,
  `flags=${JSON.stringify(result6?.flags)}`
);

restoreFetch();

// ─────────────────────────────────────────────────────────────────────────────
// TEST CASE 7
// Multiple files in one call:
//   File A — has a critical Layer 1 hit (eval) → Layer 2 skipped for A.
//   File B — clean → Layer 2 runs for B and its flags appear in aggregated result.
// ─────────────────────────────────────────────────────────────────────────────

section("Test 7 — multi-file: critical file skips Layer 2, clean file still gets Layer 2");

// Track which user-message content went to the LLM to confirm only File B was sent
const layer2FilesReviewed = [];
globalThis.fetch = async (_url, options) => {
  const body = JSON.parse(options.body);
  // The user message contains "File: <path>" — extract it
  const userMsg = body.messages?.find((m) => m.role === "user")?.content ?? "";
  const match = userMsg.match(/^File:\s*(\S+)/);
  if (match) layer2FilesReviewed.push(match[1]);

  // Return one ssrf finding for File B
  const responseText = JSON.stringify([
    {
      rule: "ssrf",
      severity: "high",
      line: 3,
      snippet: "const res = await fetch(props.url);",
      description: "fetch() URL comes from user-controlled props.",
    },
  ]);
  return {
    ok: true,
    status: 200,
    json: async () => groqResponse(responseText),
    text: async () => "{}",
  };
};

const fileA = { path: "fileA.js", content: `eval("evil");` };
const fileB = {
  path: "fileB.js",
  content: [
    "export async function loadData(props) {",
    "  // fetch from user-supplied URL",
    "  const res = await fetch(props.url);",
    "  return res.json();",
    "}",
  ].join("\n"),
};

const result7 = await runSecurityAgent([fileA, fileB]);

assert(
  "Layer 2 was NOT called for fileA (critical Layer 1 hit)",
  !layer2FilesReviewed.includes("fileA.js"),
  `Layer 2 was called for: ${JSON.stringify(layer2FilesReviewed)}`
);

assert(
  "Layer 2 WAS called for fileB (clean Layer 1)",
  layer2FilesReviewed.includes("fileB.js"),
  `Layer 2 called for: ${JSON.stringify(layer2FilesReviewed)}`
);

assert(
  "fileA's eval flag appears in aggregated result (layer=1)",
  result7.flags.some((f) => f.rule === "eval-usage" && f.file === "fileA.js" && f.layer === 1),
  `flags: ${JSON.stringify(result7.flags.map((f) => ({ rule: f.rule, file: f.file, layer: f.layer })))}`
);

assert(
  "fileB's ssrf flag (from Layer 2) appears in aggregated result",
  result7.flags.some((f) => f.rule === "ssrf" && f.file === "fileB.js" && f.layer === 2),
  `flags: ${JSON.stringify(result7.flags.map((f) => ({ rule: f.rule, file: f.file, layer: f.layer })))}`
);

// pass=false because fileA has a critical flag
assert(
  "pass=false in multi-file result when one file has a critical flag",
  result7.pass === false,
  `pass=${result7.pass}`
);

restoreFetch();

// ─────────────────────────────────────────────────────────────────────────────
// TEST CASE 8
// A single line matching two different Layer 1 rules produces two distinct flags.
// ─────────────────────────────────────────────────────────────────────────────

section("Test 8 — single line matching two rules → two distinct flags");

mockFetch(groqResponse("[]"));

// This line matches both "eval-usage" and "hardcoded-secret":
//   eval(...)           → eval-usage (critical)
//   password = "..."    → hardcoded-secret (critical) — 16+ char value
const dualHitLine = `const x = eval("ok"); const password = "abcdefghijklmnopqrstuvwxyz";`;

const result8 = await runSecurityAgent({ path: "dual.js", content: dualHitLine });

const evalFlag     = result8.flags.find((f) => f.rule === "eval-usage"       && f.line === 1);
const secretFlag   = result8.flags.find((f) => f.rule === "hardcoded-secret" && f.line === 1);

assert(
  "eval-usage flag emitted for dual-hit line",
  evalFlag !== undefined,
  `flags: ${JSON.stringify(result8.flags.map((f) => f.rule))}`
);

assert(
  "hardcoded-secret flag emitted for the same dual-hit line",
  secretFlag !== undefined,
  `flags: ${JSON.stringify(result8.flags.map((f) => f.rule))}`
);

assert(
  "two distinct flags exist for the dual-hit line (not deduplicated across different rules)",
  evalFlag !== undefined && secretFlag !== undefined,
  `total flags on line 1: ${result8.flags.filter((f) => f.line === 1).length}`
);

restoreFetch();

// ─────────────────────────────────────────────────────────────────────────────
// RESULTS
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
