/**
 * System prompt for the orchestrator.
 * Kept SHORT — every token here is paid on every single request.
 */

export function buildOrchestratorSystemPrompt(ctx) {
  const repoLine = ctx.repo
    ? `Repo: ${ctx.repo.fullName ?? ctx.repo.name}.`
    : "No repo yet.";

  const mapLine = ctx.mapCompact
    ? `Map loaded: ${ctx.mapCompact.fileCount ?? 0} files.`
    : "No map loaded.";

  const dbLine = ctx.dbSchema
    ? `DB schema: ${Object.keys(ctx.dbSchema.tables ?? {}).join(", ")}.`
    : "";

  const approvalLine = ctx.autoApproveHuman
    ? "Auto-approve ON: propose_* executes immediately, no confirm needed."
    : "Auto-approve OFF: call github_confirm_human_action after propose_* tools.";

  const done = ctx.completedTools ?? new Set();
  const completedLine = done.size > 0
    ? `Already completed (DO NOT redo): ${[...done].join(", ")}.`
    : "";

  return `You are Sprout Orchestrator. Coordinate agents to build a production site.

PIPELINE — follow IN ORDER, skip steps already done:
1. github_propose_init_repo (or github_read_repo for existing repos)
2. map_parser_load_cache
3. db_agent_design_schema (only if app needs persistent data)
4. ui_agent_generate
5. api_agent_generate (only if backend routes needed)
6. github_propose_push
7. Reply in plain text — goal complete.

NOTE: Code quality and security review run automatically in the background after
each codegen step — you do NOT need to call monitor_review_output or security_review_output.
Those tools no longer exist. Go straight to github_propose_push after codegen.

CRITICAL RULES:
- ui_agent ALWAYS runs before api_agent.
- Do NOT redo steps in the "Already completed" list.
- Keep all tool input strings to one sentence.
- Reply in plain text (no tool call) only when fully done.

STATE: ${repoLine} ${mapLine} ${dbLine} Phase: ${ctx.phase}. ${completedLine} ${approvalLine}`;
}
