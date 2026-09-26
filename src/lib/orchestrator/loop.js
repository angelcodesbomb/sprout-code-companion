/**
 * Orchestrator Loop
 */

import { callGroqWithTools, getModel } from "./groq.js";
import { createOrchestratorTools, findTool } from "./tools.js";
import { assertToolResult } from "./validate.js";
import { createRunContext, serializeContext } from "./context.js";
import { buildOrchestratorSystemPrompt } from "./prompt.js";
import { runMonitorReview, runSecurityReview } from "./agents/reviewAgent.js";

const MAX_STEPS = 14; // trimmed: no review tool steps in count any more

const CODEGEN_TOOLS = new Set(["ui_agent_generate", "api_agent_generate", "db_agent_design_schema"]);
// REVIEW_TOOLS removed — review is now automatic middleware, not orchestrator tools

// How many non-system messages to keep in the sliding window.
// System message is always kept. This caps context to ~4000 tokens of history.
const MAX_HISTORY_MESSAGES = 8;

function isQwenStyleModel() {
  const m = getModel().toLowerCase();
  return m.startsWith("qwen/") || m.startsWith("qwen");
}

/**
 * Security gate — runs automatically after every codegen step.
 * Calls the Review Agent directly (Qwen, ~300 tokens) — no orchestrator turn wasted.
 * Returns { pass, flags, note }.
 */
async function securityGate(artifact) {
  if (!artifact?.files?.length) return { pass: true };
  try {
    return await runSecurityReview(artifact);
  } catch (err) {
    console.warn(`[orchestrator/loop] securityGate error — passing through: ${err.message}`);
    return { pass: true };
  }
}

/**
 * Monitor gate — runs automatically after every codegen step.
 * Calls the Review Agent directly (Qwen, ~300 tokens) — no orchestrator turn wasted.
 * Returns { pass, feedback, checks }.
 */
async function monitorGate(artifact) {
  if (!artifact?.files?.length) return { pass: true };
  try {
    return await runMonitorReview(artifact);
  } catch (err) {
    console.warn(`[orchestrator/loop] monitorGate error — passing through: ${err.message}`);
    return { pass: true };
  }
}

/**
 * Strip file content from a tool result before storing in message history.
 * File content can be thousands of tokens — the model doesn't need it after the step.
 * The orchestrator only needs to see: ok, artifactId, summary, paths.
 */
function compressToolResult(result, toolName) {
  if (!result?.output) return result;

  const out = result.output;

  // Codegen tools: strip the file content arrays, keep only metadata
  if (CODEGEN_TOOLS.has(toolName) && out.artifact) {
    return {
      ...result,
      output: {
        artifactId: out.artifactId,
        summary:    out.artifact?.summary ?? "",
        paths:      out.artifact?.paths   ?? [],
        agent:      out.artifact?.agent   ?? "",
      },
    };
  }

  // github_read_repo: strip samplePaths which can be large
  if (toolName === "github_read_repo" && out.samplePaths) {
    const { samplePaths: _, ...rest } = out;
    return { ...result, output: rest };
  }

  return result;
}

/**
 * Trim the non-system messages to MAX_HISTORY_MESSAGES (sliding window).
 * Always keeps: [system, original_user_goal, ...last N messages]
 *
 * IMPORTANT: after slicing, the first message in the window must NOT be
 * role:"tool" without a preceding role:"assistant" that contains tool_calls.
 * Groq's Harmony tokenizer attributes a tool-result message to the tool
 * name found in the preceding assistant turn. If that assistant turn was
 * sliced away, Harmony throws "Tools should have a name!" — a misleading
 * error whose real cause is the broken message chain.
 *
 * Fix: after slicing, advance past any leading role:"tool" orphans so the
 * window always starts on a valid message boundary (assistant or user).
 */
function trimMessages(messages) {
  if (messages.length <= MAX_HISTORY_MESSAGES + 2) return messages;
  const system   = messages[0];
  const userGoal = messages[1];
  const rest     = messages.slice(2);
  let   trimmed  = rest.slice(-MAX_HISTORY_MESSAGES);

  // Drop leading orphaned tool messages — they have no preceding tool_call.
  while (trimmed.length > 0 && trimmed[0].role === "tool") {
    trimmed = trimmed.slice(1);
  }

  return [system, userGoal, ...trimmed];
}

export async function runOrchestrator({
  goal,
  mapSnapshot      = null,
  githubToken      = null,
  autoApproveHuman = false,
  onToolStart,
  onStepComplete,
}) {
  const ctx   = createRunContext({ goal, mapSnapshot, githubToken, autoApproveHuman });
  const tools = createOrchestratorTools(ctx);

  let messages = [
    { role: "system", content: buildOrchestratorSystemPrompt(ctx) },
    { role: "user",   content: goal },
  ];

  const steps = [];

  for (let stepNum = 1; stepNum <= MAX_STEPS; stepNum++) {
    // Refresh system prompt each step so state changes (phase, repo, map) are visible
    messages[0] = { role: "system", content: buildOrchestratorSystemPrompt(ctx) };

    // Trim history before every Groq call
    messages = trimMessages(messages);

    const decision = await callGroqWithTools(messages, tools);

    if (decision.done) {
      return { steps, finalAnswer: decision.content, context: serializeContext(ctx) };
    }

    const { toolName, toolInput } = decision;

    const tool = findTool(tools, toolName);
    if (!tool) {
      return {
        steps,
        finalAnswer: `Orchestrator error: unknown tool "${toolName}".`,
        context: serializeContext(ctx),
      };
    }

    if (typeof onToolStart === "function") onToolStart(toolName);

    const raw    = await tool.run(toolInput ?? {});
    const result = assertToolResult(raw, toolName);

    const step = {
      step:      stepNum,
      toolName,
      toolInput: toolInput ?? {},
      result,
      timestamp: new Date().toISOString(),
      agent:     toolNameToAgentLabel(toolName),
    };
    steps.push(step);

    console.log(
      `[orchestrator/loop] Step ${stepNum}: ${toolName}`,
      "→", result.ok ? "ok" : `error: ${result.error}`
    );

    // Track successful completions
    if (result.ok) {
      ctx.completedTools = ctx.completedTools ?? new Set();
      ctx.completedTools.add(toolName);
    }

    if (typeof onStepComplete === "function") onStepComplete(step);

    // ── Automatic review middleware (replaces orchestrator review tools) ──────
    // Runs after every codegen step without burning an orchestrator turn.
    // Uses Qwen directly (~300 tokens) — the orchestrator never sees this.
    if (CODEGEN_TOOLS.has(toolName) && result.ok) {
      const artifact = result.output?.artifact;

      // Monitor gate (quality check)
      const monResult = await monitorGate(artifact);
      if (!monResult.pass) {
        console.log(`[orchestrator/loop] Monitor gate FAIL — self-healing: ${monResult.feedback}`);
        // Self-heal: re-run the same codegen tool with the feedback injected,
        // without asking the orchestrator. Limit to one auto-retry.
        const retryInput = {
          ...toolInput,
          spec: `${toolInput.spec ?? ""}\n\nFix required: ${monResult.feedback}`.trim(),
        };
        const retryRaw    = await tool.run(retryInput);
        const retryResult = assertToolResult(retryRaw, toolName);
        if (retryResult.ok) {
          // Replace the artifact in ctx with the fixed version
          const fixedArtifact = retryResult.output?.artifact;
          if (fixedArtifact) {
            const idx = ctx.artifacts.findIndex((a) => a.id === result.output?.artifact?.id);
            if (idx !== -1) ctx.artifacts[idx] = fixedArtifact;
          }
          console.log(`[orchestrator/loop] Monitor self-heal succeeded.`);
          // Update the step result so SSE gets the fixed files
          step.result = retryResult;
          if (typeof onStepComplete === "function") onStepComplete(step);
        } else {
          console.warn(`[orchestrator/loop] Monitor self-heal failed — continuing anyway.`);
        }
      }

      // Security gate (security check on the final artifact)
      const finalArtifact = ctx.artifacts[ctx.artifacts.length - 1];
      const secResult = await securityGate(finalArtifact);
      if (!secResult.pass) {
        console.warn(
          `[orchestrator/loop] Security gate flags: ${(secResult.flags ?? []).join(", ")} — logged, continuing.`
        );
        // Security issues are logged and attached to the step but don't block
        // the pipeline — the orchestrator is not told about them to save tokens.
        step.securityFlags = secResult.flags;
      }
    }

    // Compress result BEFORE pushing to message history
    const compressed = compressToolResult(result, toolName);

    messages.push(
      assistantToolMessage(stepNum, toolName, toolInput),
      toolResultMessage(stepNum, compressed)
    );

    if (isQwenStyleModel()) {
      messages.splice(messages.length - 2, 2);
      messages.push(
        {
          role:    "assistant",
          content: JSON.stringify({ name: toolName, arguments: toolInput ?? {} }),
        },
        {
          role:    "user",
          content: result.ok
            ? `Result: ${JSON.stringify(compressed.output ?? {})} — continue.`
            : `Error in ${toolName}: ${result.error} — decide how to proceed.`,
        }
      );
    }
    // No CODEGEN inject message — review is handled by middleware above,
    // not by the orchestrator. This saves 2 orchestrator turns per codegen step.
  }

  return {
    steps,
    finalAnswer: `Reached max steps (${MAX_STEPS}).`,
    context: serializeContext(ctx),
  };
}

function toolNameToAgentLabel(toolName) {
  if (toolName.startsWith("github_"))       return "GitHub";
  if (toolName.startsWith("map_parser"))    return "Map Parser";
  if (toolName.startsWith("db_agent"))      return "Database";
  if (toolName.startsWith("ui_agent"))      return "UI";
  if (toolName.startsWith("api_agent"))     return "API";
  if (toolName.startsWith("monitor_"))      return "Monitor";
  if (toolName.startsWith("security_"))     return "Security";
  if (toolName.startsWith("live_preview"))  return "Live Preview";
  return "Orchestrator";
}

function assistantToolMessage(stepNum, toolName, toolInput) {
  return {
    role:    "assistant",
    content: null,
    tool_calls: [{
      id:   `call_${stepNum}`,
      type: "function",
      function: {
        name:      toolName,
        arguments: JSON.stringify(toolInput ?? {}),
      },
    }],
  };
}

function toolResultMessage(stepNum, result) {
  return {
    role:         "tool",
    tool_call_id: `call_${stepNum}`,
    content:      JSON.stringify(result),
  };
}
