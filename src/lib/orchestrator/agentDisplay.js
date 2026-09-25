/**
 * Maps orchestrator tools/steps to sidebar pipeline agent cards (UI, Database, …).
 */

export const PIPELINE_AGENTS = [
  { name: "UI", tone: "pink", description: "Checks layouts and components" },
  { name: "Database", tone: "cyan", description: "Understands your data model" },
  { name: "API", tone: "mint", description: "Maps requests and responses" },
  { name: "Review", tone: "coral", description: "Reviews code in context" },
  { name: "Security", tone: "pink", description: "Looks for risky patterns" },
  { name: "Validation", tone: "cyan", description: "Checks inputs and edge cases" },
];

const AGENT_BY_NAME = Object.fromEntries(PIPELINE_AGENTS.map((a) => [a.name, a]));

/** @param {string} toolName */
export function toolToDisplayAgent(toolName) {
  if (!toolName) return null;
  if (toolName.startsWith("ui_agent") || toolName.startsWith("live_preview")) return "UI";
  if (toolName.startsWith("api_agent")) return "API";
  if (toolName.startsWith("monitor_")) return "Review";
  if (toolName.startsWith("security_")) return "Security";
  if (toolName.startsWith("map_parser")) return "Database";
  if (toolName.startsWith("github_")) return "Validation";
  return null;
}

/** @param {{ toolName?: string, agent?: string }} step */
export function stepToDisplayAgent(step) {
  const fromTool = toolToDisplayAgent(step.toolName ?? "");
  if (fromTool) return fromTool;
  const label = step.agent ?? "";
  if (label === "Monitor") return "Review";
  if (label === "Map Parser") return "Database";
  if (label === "GitHub") return "Validation";
  if (label === "Live Preview") return "UI";
  if (AGENT_BY_NAME[label]) return label;
  return "Review";
}

export function getPipelineAgent(name) {
  return AGENT_BY_NAME[name] ?? PIPELINE_AGENTS[3];
}

/**
 * Agent name that should show the green status dot.
 * @param {Array} steps
 * @param {string | null} currentTool
 * @param {string} status
 */
export function resolveLiveAgentName(steps, currentTool, status) {
  if (status === "idle" || status === "error") return null;
  if (status === "running" && currentTool) {
    return toolToDisplayAgent(currentTool);
  }
  if (steps?.length) {
    return stepToDisplayAgent(steps[steps.length - 1]);
  }
  return null;
}
