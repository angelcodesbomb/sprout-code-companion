/**
 * End-to-end orchestrator pipeline test (stub agents, auto-approved GitHub steps).
 *
 * Run: node scripts/test-orchestrator-pipeline.mjs
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

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
  console.warn("Could not load .env.local");
}

const { runOrchestrator } = await import("../src/lib/orchestrator/loop.js");

const fakeMap = {
  repoKey: "acme/landing@main",
  repoMeta: { owner: "acme", repo: "landing", branch: "main", fullName: "acme/landing" },
  nodesByPath: {
    "": { name: "landing", path: "", type: "dir", domain: "Review" },
    "app/page.tsx": { name: "page.tsx", path: "app/page.tsx", type: "file", domain: "UI" },
    "app/api/hello/route.ts": {
      name: "route.ts",
      path: "app/api/hello/route.ts",
      type: "file",
      domain: "API",
    },
  },
};

const goal =
  "Build a minimal production landing page: update app/page.tsx with a hero section and add GET /api/hello in app/api/hello/route.ts. " +
  "Use repo acme/landing. Simulate full pipeline with stub agents.";

console.log("\n[orchestrator-pipeline] Starting run…\n");

const result = await runOrchestrator({
  goal,
  mapSnapshot: fakeMap,
  autoApproveHuman: true,
  onToolStart: (name) => process.stdout.write(`  → ${name}\n`),
  onStepComplete: (step) => {
    const status = step.result.ok ? "ok" : "FAIL";
    console.log(`  [${step.step}] ${step.agent ?? step.toolName} (${status})`);
  },
});

console.log("\n--- Final answer ---\n");
console.log(result.finalAnswer);
console.log("\n--- Context summary ---\n");
console.log(JSON.stringify(result.context, null, 2));
console.log(`\nSteps: ${result.steps.length}`);

const toolNames = result.steps.map((s) => s.toolName);
const expected = [
  "github_propose_init_repo",
  "github_confirm_human_action",
  "map_parser_load_cache",
  "ui_agent_generate",
  "monitor_review_output",
  "security_review_output",
];

const missing = expected.filter((t) => !toolNames.includes(t));
if (missing.length) {
  console.warn("\nWarning: expected tools not invoked:", missing.join(", "));
  console.warn("Invoked:", toolNames.join(" → "));
}
