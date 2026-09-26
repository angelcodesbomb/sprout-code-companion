/**
 * Orchestrator Loop
 */

import { callGroqWithTools, getModel } from "./groq.js";
import { createOrchestratorTools, findTool } from "./tools.js";
import { assertToolResult } from "./validate.js";
import { createRunContext, serializeContext } from "./context.js";
import { buildOrchestratorSystemPrompt } from "./prompt.js";

const MAX_STEPS = 12; // lower cap — saves tokens and avoids runaway loops

const CODEGEN_TOOLS  = new Set(["ui_agent_generate", "api_agent_generate", "db_agent_design_schema"]);
const REVIEW_TOOLS   = new Set(["monitor_review_output", "security_review_output"]);

// How many non-system messages to keep in the sliding window.
// System message is always kept. This caps context to ~4000 tokens of history.
const MAX_HISTORY_MESSAGES = 8;

function isQwenStyleModel() {
  const m = getModel().toLowerCase();
  return m.startsWith("qwen/") || m.startsWith("qwen");
}

function securityGate(decision) { void decision; return { pass: true }; }
function monitorGate(step)      { void step;     return { pass: true }; }

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
 */
function trimMessages(messages) {
  if (messages.length <= MAX_HISTORY_MESSAGES + 2) return messages;
  const system   = messages[0];
  const userGoal = messages[1];
  const rest     = messages.slice(2);
  const trimmed  = rest.slice(-MAX_HISTORY_MESSAGES);
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

    const secResult = securityGate({ toolName, toolInput });
    if (!secResult.pass) {
      return {
        steps,
        finalAnswer: `Orchestrator halted: ${secResult.reason ?? "security gate"}`,
        context: serializeContext(ctx),
      };
    }

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

    if (typeof onStepComplete === "function") onStepComplete(step);

    const monResult = monitorGate({ toolName, toolInput, result });
    if (!monResult.pass) {
      return {
        steps,
        finalAnswer: `Orchestrator halted: ${monResult.reason ?? "monitor gate"}`,
        context: serializeContext(ctx),
      };
    }

    // Compress result BEFORE pushing to message history
    const compressed = compressToolResult(result, toolName);

    if (
      REVIEW_TOOLS.has(toolName) &&
      result.ok &&
      result.output?.pass === false
    ) {
      messages.push(
        assistantToolMessage(stepNum, toolName, toolInput),
        toolResultMessage(stepNum, compressed)
      );
      messages.push({
        role:    "user",
        content: `Review failed (${toolName}). Feedback: ${result.output.feedback ?? "fix issues and regenerate."}`,
      });
      continue;
    }

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

    if (CODEGEN_TOOLS.has(toolName) && result.ok) {
      messages.push({
        role:    "user",
        content: `Codegen done (artifactId: ${result.output?.artifactId}). Call monitor_review_output then security_review_output.`,
      });
    }
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
