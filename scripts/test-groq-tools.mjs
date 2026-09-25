/**
 * Isolated test: groq.js tool-picking
 * =====================================
 * Calls callGroqWithTools with two fake tool definitions and two prompts,
 * and verifies the model picks the correct tool for each.
 *
 * Run:
 *   node scripts/test-groq-tools.mjs
 *
 * Requires GROQ_API_KEY in .env.local (loaded via dotenv below).
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ── Load .env.local manually (no dotenv package needed) ──────────────────────
const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dir, "../.env.local");
try {
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key && !(key in process.env)) process.env[key] = val;
  }
} catch {
  console.warn("Could not load .env.local — ensure GROQ_API_KEY is set in env.");
}

// ── Import the module under test (using the raw file path) ───────────────────
const { callGroqWithTools } = await import("../src/lib/orchestrator/groq.js");
const { DEV_TEST_TOOLS } = await import("../src/lib/orchestrator/tools.js");

const toolDefs = DEV_TEST_TOOLS;

// ── Test cases ────────────────────────────────────────────────────────────────
const testCases = [
  {
    label: "should pick 'echo'",
    messages: [
      { role: "system", content: "You are a helpful assistant. Use the tools provided." },
      { role: "user", content: "Please echo the text: hello orchestrator" },
    ],
    expectedTool: "echo",
  },
  {
    label: "should pick 'greet'",
    messages: [
      { role: "system", content: "You are a helpful assistant. Use the tools provided." },
      { role: "user", content: "Say hello to Alice for me." },
    ],
    expectedTool: "greet",
  },
];

// ── Runner ─────────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

for (const tc of testCases) {
  process.stdout.write(`  [TEST] ${tc.label} ... `);
  try {
    const result = await callGroqWithTools(tc.messages, toolDefs);

    if (result.done) {
      console.log(`FAIL — model returned done=true instead of picking a tool (content: "${result.content}")`);
      failed++;
      continue;
    }

    if (result.toolName === tc.expectedTool) {
      console.log(`PASS — picked "${result.toolName}" with input ${JSON.stringify(result.toolInput)}`);
      passed++;
    } else {
      console.log(`FAIL — expected "${tc.expectedTool}" but got "${result.toolName}" with input ${JSON.stringify(result.toolInput)}`);
      failed++;
    }
  } catch (err) {
    console.log(`ERROR — ${err.message}`);
    failed++;
  }
}

console.log(`\n  Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
