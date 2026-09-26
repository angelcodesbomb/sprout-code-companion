/**
 * Orchestrator Loop — coordinates agent tools for production-site builds.
 */

import { callGroqWithTools, getModel } from "./groq.js";
import { createOrchestratorTools, findTool } from "./tools.js";
import { assertToolResult } from "./validate.js";
import { createRunContext, serializeContext } from "./context.js";
import { buildOrchestratorSystemPrompt } from "./prompt.js";

/** Maximum tool calls before the loop is force-stopped. */
const MAX_STEPS = 24;

const CODEGEN_TOOLS = new Set(["ui_agent_generate", "api_agent_generate"]);
const REVIEW_TOOLS = new Set(["monitor_review_output", "security_review_output"]);

function isQwenStyleModel() {
  const m = getModel().toLowerCase();
  return m.startsWith("qwen/") || m.startsWith("qwen");
}

/**
 * Pre-execution gate (orchestrator-level policy before calling an agent tool).
 */
function securityGate(decision) {
  void decision;
  return { pass: true };
}

/**
 * Post-execution gate — stub; real Monitor agent hooks in via monitor_review_output tool.
 */
function monitorGate(step) {
  void step;
  return { pass: true };
}

/**
 * @typedef {{
 *   step: number,
 *   toolName: string,
 *   toolInput: object,
 *   result: import("./validate.js").ToolResult,
 *   timestamp: string,
 *   agent?: string,
 * }} Step
 */

/**
 * @param {{
 *   goal: string,
 *   mapSnapshot?: object | null,
 *   autoApproveHuman?: boolean,
 *   onToolStart?: (toolName: string) => void,
 *   onStepComplete?: (step: Step) => void,
 * }} options
 * @returns {Promise<{ steps: Step[], finalAnswer: string, context: object }>}
 */
export async function runOrchestrator({
  goal,
  mapSnapshot = null,
  githubToken = null,
  autoApproveHuman = false,
  onToolStart,
  onStepComplete,
}) {
  const ctx = createRunContext({ goal, mapSnapshot, githubToken, autoApproveHuman });
  const tools = createOrchestratorTools(ctx);

  /** @type {Array<object>} */
  const messages = [
    { role: "system", content: buildOrchestratorSystemPrompt(ctx) },
    { role: "user", content: goal },
  ];

  /** @type {Step[]} */
  const steps = [];

  for (let stepNum = 1; stepNum <= MAX_STEPS; stepNum++) {
    const decision = await callGroqWithTools(messages, tools);

    if (decision.done) {
      return {
        steps,
        finalAnswer: decision.content,
        context: serializeContext(ctx),
      };
    }

    const { toolName, toolInput } = decision;

    const secResult = securityGate({ toolName, toolInput });
    if (!secResult.pass) {
      const reason = secResult.reason ?? "blocked by security gate";
      return {
        steps,
        finalAnswer: `Orchestrator halted: ${reason}`,
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

    if (typeof onToolStart === "function") {
      onToolStart(toolName);
    }

    const raw = await tool.run(toolInput ?? {});
    const result = assertToolResult(raw, toolName);

    /** @type {Step} */
    const step = {
      step: stepNum,
      toolName,
      toolInput: toolInput ?? {},
      result,
      timestamp: new Date().toISOString(),
      agent: toolNameToAgentLabel(toolName),
    };
    steps.push(step);

    console.log(
      `[orchestrator/loop] Step ${stepNum}: ${toolName}`,
      JSON.stringify(toolInput),
      "→",
      result.ok ? "ok" : `error: ${result.error}`
    );

    if (typeof onStepComplete === "function") {
      onStepComplete(step);
    }

    const monResult = monitorGate({ toolName, toolInput, result });
    if (!monResult.pass) {
      const reason = monResult.reason ?? "blocked by monitor gate";
      return {
        steps,
        finalAnswer: `Orchestrator halted: ${reason}`,
        context: serializeContext(ctx),
      };
    }

    if (
      REVIEW_TOOLS.has(toolName) &&
      result.ok &&
      result.output &&
      result.output.pass === false
    ) {
      messages.push(
        assistantToolMessage(stepNum, toolName, toolInput),
        toolResultMessage(stepNum, result)
      );
      messages.push({
        role: "user",
        content:
          `Review failed for artifact ${result.output.artifactId}. ` +
          `Feedback: ${result.output.feedback ?? result.output.note ?? "Fix issues and regenerate."} ` +
          `Re-run the appropriate codegen tool, then monitor and security again.`,
      });
      continue;
    }

    messages.push(
      assistantToolMessage(stepNum, toolName, toolInput),
      toolResultMessage(stepNum, result)
    );

    // For Qwen (system-prompt tool calling), replace the standard tool message pair
    // with a plain assistant/user exchange that Qwen reads correctly.
    // We already pushed the OpenAI-format messages above for non-Qwen models —
    // for Qwen we swap the last two messages out.
    if (isQwenStyleModel()) {
      // Remove the last two messages (assistantToolMessage + toolResultMessage)
      messages.splice(messages.length - 2, 2);
      // Add a Qwen-readable pair instead
      messages.push(
        {
          role: "assistant",
          content: JSON.stringify({ name: toolName, arguments: toolInput ?? {} }),
        },
        {
          role: "user",
          content: result.ok
            ? `Tool result: ${JSON.stringify(result.output)}\n\nContinue with the next pipeline step.`
            : `Tool "${toolName}" returned an error: ${result.error}\n\nDecide how to proceed.`,
        }
      );
    }

    if (CODEGEN_TOOLS.has(toolName) && result.ok) {
      messages.push({
        role: "user",
        content:
          `Codegen step completed (artifactId: ${result.output?.artifactId}). ` +
          `You MUST call monitor_review_output then security_review_output for this artifact before push or finishing.`,
      });
    }
  }

  return {
    steps,
    finalAnswer: `Orchestrator reached the maximum step limit (${MAX_STEPS}) without completing.`,
    context: serializeContext(ctx),
  };
}

function toolNameToAgentLabel(toolName) {
  if (toolName.startsWith("github_")) return "GitHub";
  if (toolName.startsWith("map_parser")) return "Map Parser";
  if (toolName.startsWith("db_agent")) return "Database";
  if (toolName.startsWith("ui_agent")) return "UI";
  if (toolName.startsWith("api_agent")) return "API";
  if (toolName.startsWith("monitor_")) return "Monitor";
  if (toolName.startsWith("security_")) return "Security";
  if (toolName.startsWith("live_preview")) return "Live Preview";
  return "Orchestrator";
}

function assistantToolMessage(stepNum, toolName, toolInput) {
  return {
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id: `call_${stepNum}`,
        type: "function",
        function: {
          name: toolName,
          arguments: JSON.stringify(toolInput ?? {}),
        },
      },
    ],
  };
}

function toolResultMessage(stepNum, result) {
  return {
    role: "tool",
    tool_call_id: `call_${stepNum}`,
    content: JSON.stringify(result),
  };
}
