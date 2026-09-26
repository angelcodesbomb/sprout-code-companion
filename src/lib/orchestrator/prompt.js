/**
 * System prompt for the orchestrator.
 * Kept intentionally SHORT — every token here is paid on every single request.
 * Tool descriptions live in tools.js; we only put policy + state here.
 */

export function buildOrchestratorSystemPrompt(ctx) {
  const repoLine = ctx.repo
    ? `Repo: ${ctx.repo.fullName ?? ctx.repo.name} (branch: ${ctx.repo.branch ?? "main"}).`
    : "No repo yet.";

  const mapLine = ctx.mapCompact
    ? `Map: ${ctx.mapCompact.repoKey}, ${ctx.mapCompact.fileCount} files.`
    : "No map loaded.";

  const dbLine = ctx.dbSchema
    ? `Schema: ${Object.keys(ctx.dbSchema.tables ?? {}).join(", ")}.`
    : "";

  const approvalLine = ctx.autoApproveHuman
    ? "Auto-approve ON: propose_* tools execute immediately. Skip github_confirm_human_action."
    : "Auto-approve OFF: call github_confirm_human_action after propose_* tools.";

  return `You are Sprout Orchestrator. Coordinate agents to build a production site.

PIPELINE (in order, skip satisfied steps):
1. github_read_repo OR github_propose_init_repo
2. map_parser_load_cache
3. db_agent_design_schema (if app needs data)
4. ui_agent_generate and/or api_agent_generate
5. monitor_review_output → security_review_output (after each codegen)
6. live_preview_sync
7. github_propose_push → map_parser_refresh
8. Done → reply with plain text, no tool call.

RULES:
- After codegen, ALWAYS call monitor then security before push.
- If monitor/security fail, redo codegen with their feedback.
- Keep task inputs SHORT — one sentence max.
- When goal is complete, reply in plain text only (no tool call).

STATE: ${repoLine} ${mapLine} ${dbLine} Phase: ${ctx.phase}. ${approvalLine}`;
}
