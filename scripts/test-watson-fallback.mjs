/**
 * test-watson-fallback.mjs
 * ========================
 * Integration tests for the Watson.ai primary + Groq fallback pipeline.
 *
 * Tests cover:
 *   A. src/lib/watsonx.js unit tests (A1–A9)
 *      - isWatsonConfigured() env-var checks
 *      - IAM token exchange success / failure
 *      - callWatsonChat() success, legacy response shape, error, missing content
 *      - IAM token caching (reuse within TTL, refresh after expiry)
 *
 *   B. Route provider-selection logic — harness tests (B1–B18)
 *      Three scenarios per route: Watson OK, Watson fail→Groq, no provider
 *        B1–B3   filemap/summarize
 *        B4–B6   filemap/explain
 *        B7–B9   filemap/ask
 *        B10–B12 explain-code
 *        B13–B15 explain-block
 *        B16–B18 chunk-code
 *
 *   C. Edge cases (C1–C4)
 *
 * Usage:
 *   node scripts/test-watson-fallback.mjs
 *
 * Exits 0 on all pass, 1 on any failure.
 */

import { fileURLToPath, pathToFileURL } from "url";
import path from "path";
import assert from "assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "..");
const watsonxPath = pathToFileURL(path.join(ROOT, "src/lib/watsonx.js")).href;

// ── Colour helpers ────────────────────────────────────────────────────────────
const GREEN  = "\x1b[32m";
const RED    = "\x1b[31m";
const CYAN   = "\x1b[36m";
const RESET  = "\x1b[0m";

let passed = 0, failed = 0;
const failures = [];

function ok(name)       { passed++; console.log(`  ${GREEN}✔${RESET}  ${name}`); }
function fail(name, err){ failed++; failures.push({ name, err }); console.log(`  ${RED}✘${RESET}  ${name}\n       ${RED}${err?.message ?? err}${RESET}`); }

async function test(name, fn) {
  try { await fn(); ok(name); }
  catch (err) { fail(name, err); }
}

function section(title) { console.log(`\n${CYAN}── ${title} ──${RESET}`); }

// ── fetch mock infrastructure ─────────────────────────────────────────────────
let fetchCalls = [];
let fetchQueue = [];

function mockFetch(handler, matcher) { fetchQueue.push({ matcher, handler }); }

function makeResponse(body, status = 200) {
  const str = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => str, json: async () => JSON.parse(str) };
}

const originalFetch = global.fetch;
global.fetch = async function mockedFetch(url, opts) {
  fetchCalls.push({ url, opts });
  const idx = fetchQueue.findIndex(({ matcher }) => !matcher || matcher.test(url));
  if (idx === -1) throw new Error(`[mock] No handler for: ${url}`);
  const [{ handler }] = fetchQueue.splice(idx, 1);
  return handler(url, opts);
};

function resetFetch() { fetchCalls = []; fetchQueue = []; }

// ── env helpers ───────────────────────────────────────────────────────────────
function setWatsonEnv() {
  process.env.WATSONX_API_KEY    = "test-ibm-key";
  process.env.WATSONX_URL        = "https://us-south.ml.cloud.ibm.com";
  process.env.WATSONX_PROJECT_ID = "proj-123";
  process.env.WATSONX_MODEL_ID   = "ibm/granite-3-8b-instruct";
}
function clearWatsonEnv() {
  ["WATSONX_API_KEY","WATSONX_URL","WATSONX_PROJECT_ID","WATSONX_MODEL_ID"].forEach(k => delete process.env[k]);
}

// ── URL regex matchers ────────────────────────────────────────────────────────
const IAM_RE    = /iam\.cloud\.ibm\.com/;
const WATSON_RE = /ml\.cloud\.ibm\.com\/ml\/v1\/text\/chat/;
const GROQ_RE   = /api\.groq\.com/;

function mockIamSuccess(expiresIn = 3600) {
  mockFetch(() => makeResponse({ access_token: "bearer-tok-123", expires_in: expiresIn }), IAM_RE);
}
function mockWatsonSuccess(content = '{"ok":true}') {
  mockFetch(() => makeResponse({ choices: [{ message: { content } }] }), WATSON_RE);
}
function mockWatsonError(status = 500) {
  mockFetch(() => makeResponse("Internal error", status), WATSON_RE);
}
function mockGroqSuccess(content = '{"ok":true}') {
  mockFetch(() => makeResponse({ choices: [{ message: { content } }] }), GROQ_RE);
}

// Fresh module import — busts ES module cache via query string trick on watsonx
async function freshWatson() {
  // Node caches ES modules by URL; append a unique param to force re-evaluation
  const url = `${watsonxPath}?t=${Date.now()}_${Math.random()}`;
  return import(url);
}

// ═════════════════════════════════════════════════════════════════════════════
// SECTION A — watsonx.js unit tests
// ═════════════════════════════════════════════════════════════════════════════
section("A. watsonx.js unit tests");

await test("A1. isWatsonConfigured() → false when env vars absent", async () => {
  clearWatsonEnv();
  const { isWatsonConfigured } = await freshWatson();
  assert.equal(isWatsonConfigured(), false);
});

await test("A1b. isWatsonConfigured() → true when all 3 vars present", async () => {
  setWatsonEnv();
  const { isWatsonConfigured } = await freshWatson();
  assert.equal(isWatsonConfigured(), true);
  clearWatsonEnv();
});

await test("A2. callWatsonChat() exchanges API key for IAM token then calls inference", async () => {
  setWatsonEnv();
  resetFetch();
  const { callWatsonChat, _resetTokenCache } = await freshWatson();
  _resetTokenCache();

  mockIamSuccess();
  mockWatsonSuccess('{"answer":"hello"}');

  const result = await callWatsonChat([{ role: "user", content: "hi" }]);
  assert.equal(result, '{"answer":"hello"}');

  const iamCall = fetchCalls.find(c => IAM_RE.test(c.url));
  assert.ok(iamCall, "IAM fetch was made");
  assert.ok(iamCall.opts.body.toString().includes("apikey=test-ibm-key"), "IAM body contains apikey");

  clearWatsonEnv(); resetFetch();
});

await test("A3. callWatsonChat() throws when IAM exchange fails", async () => {
  setWatsonEnv();
  resetFetch();
  const { callWatsonChat, _resetTokenCache } = await freshWatson();
  _resetTokenCache();

  mockFetch(() => makeResponse("Unauthorized", 401), IAM_RE);

  await assert.rejects(
    () => callWatsonChat([{ role: "user", content: "hi" }]),
    /IAM token exchange failed 401/
  );
  clearWatsonEnv(); resetFetch();
});

await test("A4. callWatsonChat() returns content string on success (choices shape)", async () => {
  setWatsonEnv();
  resetFetch();
  const { callWatsonChat, _resetTokenCache } = await freshWatson();
  _resetTokenCache();

  mockIamSuccess();
  mockFetch(() => makeResponse({ choices: [{ message: { content: "Result text" } }] }), WATSON_RE);

  const result = await callWatsonChat([{ role: "user", content: "test" }]);
  assert.equal(result, "Result text");
  clearWatsonEnv(); resetFetch();
});

await test("A5. callWatsonChat() handles legacy results[] response shape", async () => {
  setWatsonEnv();
  resetFetch();
  const { callWatsonChat, _resetTokenCache } = await freshWatson();
  _resetTokenCache();

  mockIamSuccess();
  mockFetch(() => makeResponse({ results: [{ generated_text: "Legacy result" }] }), WATSON_RE);

  const result = await callWatsonChat([{ role: "user", content: "test" }]);
  assert.equal(result, "Legacy result");
  clearWatsonEnv(); resetFetch();
});

await test("A6. callWatsonChat() throws on non-OK inference response", async () => {
  setWatsonEnv();
  resetFetch();
  const { callWatsonChat, _resetTokenCache } = await freshWatson();
  _resetTokenCache();

  mockIamSuccess();
  mockWatsonError(503);

  await assert.rejects(
    () => callWatsonChat([{ role: "user", content: "test" }]),
    /Inference failed 503/
  );
  clearWatsonEnv(); resetFetch();
});

await test("A7. callWatsonChat() throws when response has no content", async () => {
  setWatsonEnv();
  resetFetch();
  const { callWatsonChat, _resetTokenCache } = await freshWatson();
  _resetTokenCache();

  mockIamSuccess();
  mockFetch(() => makeResponse({ choices: [] }), WATSON_RE);

  await assert.rejects(
    () => callWatsonChat([{ role: "user", content: "test" }]),
    /Unexpected response shape/
  );
  clearWatsonEnv(); resetFetch();
});

await test("A8. IAM token is reused within TTL (only 1 IAM call for 2 completions)", async () => {
  setWatsonEnv();
  resetFetch();
  const { callWatsonChat, _resetTokenCache } = await freshWatson();
  _resetTokenCache();

  mockIamSuccess(3600);
  mockWatsonSuccess("first");
  mockWatsonSuccess("second");

  await callWatsonChat([{ role: "user", content: "first" }]);
  await callWatsonChat([{ role: "user", content: "second" }]);

  const iamCalls = fetchCalls.filter(c => IAM_RE.test(c.url));
  assert.equal(iamCalls.length, 1, "IAM called exactly once");
  clearWatsonEnv(); resetFetch();
});

await test("A9. IAM token is refreshed after expiry", async () => {
  setWatsonEnv();
  resetFetch();
  const { callWatsonChat, _resetTokenCache } = await freshWatson();
  _resetTokenCache();

  const realDateNow = Date.now;

  // First call: token with 360s TTL (360-300 = 60s effective)
  mockIamSuccess(360);
  mockWatsonSuccess("first");
  await callWatsonChat([{ role: "user", content: "first" }]);

  // Advance clock 2 min past the 60s window
  const frozenNow = Date.now();
  Date.now = () => frozenNow + 2 * 60 * 1000;

  mockIamSuccess(3600);
  mockWatsonSuccess("second");
  await callWatsonChat([{ role: "user", content: "second" }]);

  Date.now = realDateNow;

  const iamCalls = fetchCalls.filter(c => IAM_RE.test(c.url));
  assert.equal(iamCalls.length, 2, "IAM called again after TTL expired");
  clearWatsonEnv(); resetFetch();
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION B — Route provider-selection logic (harness tests)
//
// Next.js path aliases can't resolve in plain Node, so we test the
// try-Watson → try-Groq → fallback decision tree through a generic
// two-provider harness that mirrors every route's logic exactly.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Mirrors the provider-selection branch in every route:
 *   1. If Watson configured → try watsonCall(); on error fall through
 *   2. If Groq key present → try groqCall(); on !ok return noProviderResult
 *   3. Neither → return noProviderResult immediately
 */
async function runHarness({ watsonOn, groqOn, watsonCall, groqCall, onWatson, onGroq, noProviderResult }) {
  if (!watsonOn && !groqOn) return noProviderResult;

  if (watsonOn) {
    try {
      const content = await watsonCall();
      return onWatson(content);
    } catch { /* fall through */ }
  }

  if (!groqOn) return noProviderResult;

  const { ok, data } = await groqCall();
  if (!ok) return noProviderResult;
  return onGroq(data);
}

// ── B1–B3  filemap/summarize ──────────────────────────────────────────────────
section("B1–B3  filemap/summarize");

const SUM_W = '{"summary":"Watson summary","domain":"API"}';
const SUM_G = '{"summary":"Groq summary","domain":"UI"}';

function makeSummarize(watsonOn, groqOn, watsonFails = false) {
  return runHarness({
    watsonOn, groqOn,
    watsonCall: async () => { if (watsonFails) throw new Error("Watson 500"); return SUM_W; },
    groqCall:   async () => ({ ok: true, data: { choices: [{ message: { content: SUM_G } }] } }),
    onWatson:   c => { const p = JSON.parse(c); return { summary: p.summary, domain: p.domain, provider: "watson" }; },
    onGroq:     d => { const p = JSON.parse(d.choices[0].message.content); return { summary: p.summary, domain: p.domain, provider: "groq" }; },
    noProviderResult: { useFallback: true, domain: "API" },
  });
}

await test("B1. summarize: Watson OK → provider='watson', returns AI summary", async () => {
  const r = await makeSummarize(true, true);
  assert.equal(r.provider, "watson");
  assert.equal(r.summary, "Watson summary");
  assert.equal(r.domain, "API");
});

await test("B2. summarize: Watson fails → Groq responds → provider='groq'", async () => {
  const r = await makeSummarize(true, true, true);
  assert.equal(r.provider, "groq");
  assert.equal(r.summary, "Groq summary");
  assert.equal(r.domain, "UI");
});

await test("B3. summarize: neither provider → useFallback=true", async () => {
  const r = await makeSummarize(false, false);
  assert.equal(r.useFallback, true);
  assert.ok(!r.provider);
});

// ── B4–B6  filemap/explain ────────────────────────────────────────────────────
section("B4–B6  filemap/explain");

const EXP_W = '{"function":"Routes HTTP requests","inputs":"Request","outputs":"JSON","process":"First parses, then returns."}';
const EXP_G = '{"function":"Groq function","inputs":"Groq inputs","outputs":"Groq outputs","process":"Groq process."}';
const EXP_FALLBACK = { function: "Unknown", inputs: "Unknown", outputs: "Unknown", process: "Unknown" };

function makeExplain(watsonOn, groqOn, watsonFails = false) {
  return runHarness({
    watsonOn, groqOn,
    watsonCall: async () => { if (watsonFails) throw new Error("Watson 503"); return EXP_W; },
    groqCall:   async () => ({ ok: true, data: { choices: [{ message: { content: EXP_G } }] } }),
    onWatson:   c => { const p = JSON.parse(c); return { workflow: p, provider: "watson" }; },
    onGroq:     d => { const p = JSON.parse(d.choices[0].message.content); return { workflow: p, provider: "groq" }; },
    noProviderResult: { useFallback: true, workflow: EXP_FALLBACK },
  });
}

await test("B4. explain: Watson OK → provider='watson', all 4 workflow fields present", async () => {
  const r = await makeExplain(true, true);
  assert.equal(r.provider, "watson");
  assert.equal(r.workflow.function, "Routes HTTP requests");
  assert.ok(r.workflow.inputs && r.workflow.outputs && r.workflow.process);
});

await test("B5. explain: Watson fails → Groq responds → provider='groq'", async () => {
  const r = await makeExplain(true, true, true);
  assert.equal(r.provider, "groq");
  assert.equal(r.workflow.function, "Groq function");
});

await test("B6. explain: neither provider → useFallback=true, static workflow", async () => {
  const r = await makeExplain(false, false);
  assert.equal(r.useFallback, true);
  assert.ok(r.workflow);
});

// ── B7–B9  filemap/ask ────────────────────────────────────────────────────────
section("B7–B9  filemap/ask");

const ASK_W = '{"answer":"Login lives in auth/login.js","targetPath":"src/auth/login.js"}';
const ASK_G = '{"answer":"Groq found it in api/auth","targetPath":"app/api/auth/login/route.js"}';

function makeAsk(watsonOn, groqOn, watsonFails = false) {
  return runHarness({
    watsonOn, groqOn,
    watsonCall: async () => { if (watsonFails) throw new Error("Watson rate limited"); return ASK_W; },
    groqCall:   async () => ({ ok: true, data: { choices: [{ message: { content: ASK_G } }] } }),
    onWatson:   c => { const p = JSON.parse(c); return { answer: p.answer, targetPath: p.targetPath, provider: "watson" }; },
    onGroq:     d => { const p = JSON.parse(d.choices[0].message.content); return { answer: p.answer, targetPath: p.targetPath, provider: "groq" }; },
    noProviderResult: { answer: "Offline answer", targetPath: null, useFallback: true },
  });
}

await test("B7. ask: Watson OK → provider='watson', answer + targetPath returned", async () => {
  const r = await makeAsk(true, true);
  assert.equal(r.provider, "watson");
  assert.ok(r.answer.includes("Login"));
  assert.equal(r.targetPath, "src/auth/login.js");
});

await test("B8. ask: Watson fails → Groq responds → provider='groq'", async () => {
  const r = await makeAsk(true, true, true);
  assert.equal(r.provider, "groq");
  assert.ok(r.answer.includes("Groq"));
});

await test("B9. ask: neither provider → offline fallback, useFallback=true", async () => {
  const r = await makeAsk(false, false);
  assert.equal(r.useFallback, true);
  assert.ok(r.answer);
  assert.equal(r.targetPath, null);
});

// ── B10–B12  explain-code ─────────────────────────────────────────────────────
section("B10–B12  explain-code");

const CODE_W = '{"blocks":[{"id":"b1","title":"Import","explanation":"Loads React","lines":[{"number":1,"html":"<b>import</b> React;"}]}]}';
const CODE_G = '{"blocks":[{"id":"b1","title":"Groq block","explanation":"Groq explanation","lines":[{"number":1,"html":"<b>const</b> x;"}]}]}';

function makeExplainCode(watsonOn, groqOn, watsonFails = false) {
  return runHarness({
    watsonOn, groqOn,
    watsonCall: async () => { if (watsonFails) throw new Error("Watson timeout"); return CODE_W; },
    groqCall:   async () => ({ ok: true, data: { choices: [{ message: { content: CODE_G } }] } }),
    onWatson:   c => { const p = JSON.parse(c); if (!p?.blocks) throw new Error("missing blocks"); return { ...p, provider: "watson" }; },
    onGroq:     d => { const p = JSON.parse(d.choices[0].message.content); if (!p?.blocks) return { error: "invalid" }; return { ...p, provider: "groq" }; },
    noProviderResult: { error: "No AI provider configured" },
  });
}

await test("B10. explain-code: Watson OK → provider='watson', blocks array returned", async () => {
  const r = await makeExplainCode(true, true);
  assert.equal(r.provider, "watson");
  assert.ok(Array.isArray(r.blocks));
  assert.equal(r.blocks[0].title, "Import");
});

await test("B11. explain-code: Watson fails → Groq responds → provider='groq'", async () => {
  const r = await makeExplainCode(true, true, true);
  assert.equal(r.provider, "groq");
  assert.ok(Array.isArray(r.blocks));
  assert.equal(r.blocks[0].title, "Groq block");
});

await test("B12. explain-code: neither provider → error object, no blocks", async () => {
  const r = await makeExplainCode(false, false);
  assert.ok(r.error);
  assert.ok(!r.blocks);
});

// ── B13–B15  explain-block ────────────────────────────────────────────────────
section("B13–B15  explain-block");

function makeExplainBlock(watsonOn, groqOn, watsonFails = false) {
  return runHarness({
    watsonOn, groqOn,
    watsonCall: async () => { if (watsonFails) throw new Error("Watson error"); return "Initialises state and subscribes to events."; },
    groqCall:   async () => ({ ok: true, data: { choices: [{ message: { content: "Groq: sets up the component." } }] } }),
    onWatson:   c => ({ explanation: c.trim(), provider: "watson" }),
    onGroq:     d => ({ explanation: d.choices[0].message.content.trim(), provider: "groq" }),
    noProviderResult: { explanation: "No AI key found. Add WATSONX_API_KEY or GROQ_API_KEY to your .env.local." },
  });
}

await test("B13. explain-block: Watson OK → provider='watson', explanation string", async () => {
  const r = await makeExplainBlock(true, true);
  assert.equal(r.provider, "watson");
  assert.ok(r.explanation.includes("Initialises"));
});

await test("B14. explain-block: Watson fails → Groq responds → provider='groq'", async () => {
  const r = await makeExplainBlock(true, true, true);
  assert.equal(r.provider, "groq");
  assert.ok(r.explanation.includes("Groq"));
});

await test("B15. explain-block: neither provider → instructive message, no error thrown", async () => {
  const r = await makeExplainBlock(false, false);
  assert.ok(r.explanation);
  assert.ok(r.explanation.includes("GROQ_API_KEY") || r.explanation.includes("No AI"));
  assert.ok(!r.provider);
});

// ── B16–B18  chunk-code ───────────────────────────────────────────────────────
section("B16–B18  chunk-code");

const CHUNK_W = '{"blocks":[{"id":"block-1","startLine":1,"endLine":3,"title":"Imports"},{"id":"block-2","startLine":4,"endLine":6,"title":"Logic"}]}';
const CHUNK_G = '{"blocks":[{"id":"block-1","startLine":1,"endLine":6,"title":"All Code"}]}';
const CHUNK_FALLBACK = { blocks: [{ id: "block-1", startLine: 1, endLine: 6, title: "Code Snippet" }] };

function makeChunk(watsonOn, groqOn, watsonFails = false) {
  return runHarness({
    watsonOn, groqOn,
    watsonCall: async () => { if (watsonFails) throw new Error("Watson unavailable"); return CHUNK_W; },
    groqCall:   async () => ({ ok: true, data: { choices: [{ message: { content: CHUNK_G } }] } }),
    onWatson:   c => { const p = JSON.parse(c); if (!p?.blocks?.length) throw new Error("missing blocks"); return { ...p, provider: "watson" }; },
    onGroq:     d => { const p = JSON.parse(d.choices[0].message.content); if (!p?.blocks?.length) return CHUNK_FALLBACK; return { ...p, provider: "groq" }; },
    noProviderResult: CHUNK_FALLBACK,
  });
}

await test("B16. chunk-code: Watson OK → provider='watson', multiple blocks", async () => {
  const r = await makeChunk(true, true);
  assert.equal(r.provider, "watson");
  assert.equal(r.blocks.length, 2);
  assert.equal(r.blocks[0].title, "Imports");
});

await test("B17. chunk-code: Watson fails → Groq responds → provider='groq'", async () => {
  const r = await makeChunk(true, true, true);
  assert.equal(r.provider, "groq");
  assert.ok(r.blocks.length > 0);
});

await test("B18. chunk-code: neither provider → single-block fallback, no error", async () => {
  const r = await makeChunk(false, false);
  assert.ok(Array.isArray(r.blocks));
  assert.equal(r.blocks.length, 1);
  assert.ok(!r.provider);
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION C — Edge cases
// ═════════════════════════════════════════════════════════════════════════════
section("C. Edge cases");

await test("C1. callWatsonChat() forwards maxTokens + temperature to API body", async () => {
  setWatsonEnv();
  resetFetch();
  const { callWatsonChat, _resetTokenCache } = await freshWatson();
  _resetTokenCache();

  mockIamSuccess();
  let capturedBody;
  mockFetch((url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return makeResponse({ choices: [{ message: { content: "ok" } }] });
  }, WATSON_RE);

  await callWatsonChat([{ role: "user", content: "x" }], { maxTokens: 99, temperature: 0.77 });
  assert.equal(capturedBody.parameters.max_new_tokens, 99);
  assert.ok(Math.abs(capturedBody.parameters.temperature - 0.77) < 0.001);
  clearWatsonEnv(); resetFetch();
});

await test("C2. callWatsonChat() sends project_id and model_id in request body", async () => {
  setWatsonEnv();
  resetFetch();
  const { callWatsonChat, _resetTokenCache } = await freshWatson();
  _resetTokenCache();

  mockIamSuccess();
  let capturedBody;
  mockFetch((url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return makeResponse({ choices: [{ message: { content: "ok" } }] });
  }, WATSON_RE);

  await callWatsonChat([{ role: "user", content: "x" }]);
  assert.equal(capturedBody.project_id, "proj-123");
  assert.equal(capturedBody.model_id, "ibm/granite-3-8b-instruct");
  clearWatsonEnv(); resetFetch();
});

await test("C3. Watson→Groq chain: both fail → noProviderResult returned", async () => {
  const r = await runHarness({
    watsonOn: true,
    groqOn:   true,
    watsonCall: async () => { throw new Error("Watson down"); },
    groqCall:   async () => ({ ok: false, data: null }),
    onWatson:   () => ({ provider: "watson" }),
    onGroq:     () => ({ provider: "groq" }),
    noProviderResult: { error: "all providers failed" },
  });
  assert.equal(r.error, "all providers failed");
});

await test("C4. isWatsonConfigured() → false when only API key set (needs all 3 vars)", async () => {
  clearWatsonEnv();
  process.env.WATSONX_API_KEY = "key-only";
  const { isWatsonConfigured } = await freshWatson();
  assert.equal(isWatsonConfigured(), false);
  delete process.env.WATSONX_API_KEY;
});

// ── Restore globals + print summary ──────────────────────────────────────────
global.fetch = originalFetch;

const total = passed + failed;
console.log(`\n${"─".repeat(60)}`);
console.log(`${CYAN}Results:${RESET}  ${GREEN}${passed} passed${RESET}  ${failed > 0 ? RED : ""}${failed} failed${RESET}  (${total} total)`);

if (failures.length > 0) {
  console.log(`\n${RED}Failed tests:${RESET}`);
  for (const { name, err } of failures) {
    console.log(`  ${RED}✘${RESET} ${name}`);
    if (err?.stack) console.log(`    ${err.stack.split("\n").slice(0, 3).join("\n    ")}`);
  }
}

process.exit(failed > 0 ? 1 : 0);
