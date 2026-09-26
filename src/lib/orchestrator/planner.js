/**
 * Deterministic Pipeline Planner
 * ================================
 * Pure functions — zero LLM calls, zero async, no side effects.
 * Replaces the Groq routing loop: the orchestrator now follows a
 * pre-computed plan rather than asking a model "what's next?".
 *
 * Pipeline order (fixed):
 *   repo → confirm → map → db? → ui? → api? → push?
 *
 * Only inclusion is conditional — the order never changes.
 */

// ─── Phase → tool name ────────────────────────────────────────────────────────

/**
 * Maps a phase label to the exact tool name registered in tools.js.
 * Throws on an unrecognized phase so bugs are loud, not silent.
 *
 * @param {string} phase
 * @returns {string}
 */
export function phaseToToolName(phase) {
  switch (phase) {
    case "repo_read":    return "github_read_repo";
    case "repo_init":    return "github_propose_init_repo";
    case "repo_confirm": return "github_confirm_human_action";
    case "map":          return "map_parser_load_cache";
    case "db":           return "db_agent_design_schema";
    case "ui":           return "ui_agent_generate";
    case "push":         return "github_propose_push";
    default:
      throw new Error(`[planner] Unknown phase: ${phase}`);
  }
}

// ─── Goal / context heuristics ───────────────────────────────────────────────

/** Keyword signal: goal mentions database-related concepts. */
const DB_KEYWORDS = /\b(database|db|schema|table|sql|postgres|supabase|prisma|data model|entity|entities|storage|persist|crud)\b/i;

/** Keyword signal: goal explicitly requests backend/API work with no UI. */
const NO_UI_KEYWORDS = /\b(backend[- ]only|no[- ]ui|api[- ]only|headless|server[- ]only)\b/i;

/** Keyword signal: goal or ctx explicitly requests dry-run / no push. */
const NO_PUSH_KEYWORDS = /\b(dry[- ]run|no[- ]push|skip[- ]push|no[- ]deploy|preview[- ]only)\b/i;

// ─── Plan builder ─────────────────────────────────────────────────────────────

/**
 * Compute the ordered list of phases for this run.
 * Same goal + ctx → same plan, always. No randomness, no async.
 *
 * @param {string} goal
 * @param {import("./context.js").OrchestratorContext} ctx
 * @returns {string[]}
 */
export function buildPlan(goal, ctx) {
  const plan = [];

  // ── Repo phase ──────────────────────────────────────────────────────────────
  // Skip if ctx already has a fully initialized repo for this run
  // (ctx.repo is populated by github_read_repo or github_propose_init_repo).
  const repoAlreadyReady = Boolean(ctx.repo);

  if (!repoAlreadyReady) {
    // Use github_read_repo when the goal names an existing repo (owner/repo pattern),
    // or when ctx carries a pre-loaded map snapshot that implies a known repo.
    const existingRepoHint =
      /[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+/.test(goal) && ctx.mapSnapshot !== null;

    if (existingRepoHint) {
      // Read an existing repo — no confirm step needed.
      plan.push("repo_read");
    } else {
      // Create a new repo.
      plan.push("repo_init");
      // Confirm is only needed when auto-approve is off; with auto-approve on the
      // propose_* tool executes immediately and returns without a pending action.
      if (!ctx.autoApproveHuman) {
        plan.push("repo_confirm");
      }
    }
  }

  // ── Map phase ────────────────────────────────────────────────────────────────
  // Skip only if ctx already carries a fresh compact map from this run
  // (set by github_read_repo or a prior map_parser_load_cache call).
  const mapAlreadyLoaded = ctx.phase === "map_loaded" || ctx.phase === "map_refreshed";

  if (!mapAlreadyLoaded) {
    plan.push("map");
  }

  // ── DB phase ─────────────────────────────────────────────────────────────────
  // Include when the goal text signals a database need via keyword matching.
  // Never include if the schema is already present in ctx (avoid redo).
  const needsDb = DB_KEYWORDS.test(goal) && !ctx.dbSchema;
  if (needsDb) {
    plan.push("db");
  }

  // ── UI phase ─────────────────────────────────────────────────────────────────
  // Included by default — this is a UI-generation pipeline.
  // Skip only when the goal explicitly signals backend/API-only with clear keywords.
  const skipUi = NO_UI_KEYWORDS.test(goal);
  if (!skipUi) {
    plan.push("ui");
  }

  // ── Push phase ────────────────────────────────────────────────────────────────
  // Skip when the goal or a ctx flag explicitly requests dry-run / no-push.
  const skipPush = NO_PUSH_KEYWORDS.test(goal) || Boolean(ctx.dryRun);
  if (!skipPush) {
    plan.push("push");
  }

  return plan;
}

// ─── Tool input builder ───────────────────────────────────────────────────────

/**
 * Build the input object a tool at the given phase expects.
 * Input shapes are sourced directly from the tool definitions in tools.js
 * and match exactly what was previously passed by the Groq routing loop.
 *
 * @param {string} phase
 * @param {import("./context.js").OrchestratorContext} ctx
 * @returns {object}
 */
export function buildToolInput(phase, ctx) {
  switch (phase) {
    case "repo_read": {
      // github_read_repo requires: owner, repo (strings).
      // Extract from ctx.mapSnapshot.repoMeta if available, else
      // parse "owner/repo" from the goal string as a fallback.
      const meta = ctx.mapSnapshot?.repoMeta ?? ctx.mapCompact;
      if (meta?.owner && meta?.repo) {
        return { owner: meta.owner, repo: meta.repo };
      }
      // Fallback: parse first "owner/repo" token from goal
      const match = ctx.goal.match(/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)/);
      return {
        owner: match?.[1] ?? "unknown",
        repo:  match?.[2] ?? "repo",
      };
    }

    case "repo_init": {
      // github_propose_init_repo requires: repoName (string).
      // Derive a slug from the goal: lowercase, spaces → hyphens, max 50 chars.
      const slug = ctx.goal
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 50);
      return {
        repoName:    slug || "new-app",
        description: ctx.goal.slice(0, 120),
        private:     false,
      };
    }

    case "repo_confirm": {
      // github_confirm_human_action requires: actionId (string), approved (boolean).
      // The pending action was queued by repo_init; take the last one.
      const pending = ctx.pendingHumanActions ?? [];
      const last    = pending[pending.length - 1];
      return {
        actionId: last?.id ?? "",
        approved: true,
      };
    }

    case "map": {
      // map_parser_load_cache has no required params — passes mapSnapshot if present.
      // This is the same shape the stub always received from the old routing loop.
      return ctx.mapSnapshot ? { mapSnapshot: ctx.mapSnapshot } : {};
    }

    case "db": {
      // db_agent_design_schema requires: task (string). spec is optional.
      return {
        task: `Design the database schema for: ${ctx.goal}`,
        spec: "",
      };
    }

    case "ui": {
      // ui_agent_generate requires: task (string). targetPaths and spec are optional.
      return {
        task:        ctx.goal,
        targetPaths: "",  // let the agent decide paths from the map
        spec:        "",
      };
    }

    case "push": {
      // github_propose_push requires: commitMessage (string).
      const artifactSummary = ctx.artifacts?.length
        ? ctx.artifacts.map((a) => a.summary ?? a.id).join("; ")
        : "generated changes";
      return {
        commitMessage: `feat: ${artifactSummary.slice(0, 72)}`,
      };
    }

    default:
      throw new Error(`[planner] Unknown phase for buildToolInput: ${phase}`);
  }
}

// ─── Final answer builder ─────────────────────────────────────────────────────

/**
 * Produce the human-readable summary returned as finalAnswer at the end of
 * a successful run. Matches the kind of summary the old orchestrator loop
 * returned when the model signalled done (plain-text completion message)
 * — synthesized from ctx state rather than from an LLM call.
 *
 * @param {import("./context.js").OrchestratorContext} ctx
 * @returns {string}
 */
export function buildFinalAnswer(ctx) {
  const parts = [];

  if (ctx.repo) {
    const name = ctx.repo.fullName ?? ctx.repo.name ?? "repo";
    parts.push(`Repository: ${name}.`);
  }

  if (ctx.artifacts?.length) {
    const agentNames = [...new Set(ctx.artifacts.map((a) => a.agent ?? "Agent"))];
    const filePaths  = ctx.artifacts.flatMap((a) => a.paths ?? []);
    parts.push(
      `Generated ${filePaths.length} file(s) via ${agentNames.join(", ")}: ${filePaths.slice(0, 8).join(", ")}${filePaths.length > 8 ? ` (+${filePaths.length - 8} more)` : ""}.`
    );
  }

  if (ctx.dbSchema) {
    const tables = Object.keys(ctx.dbSchema.tables ?? {});
    parts.push(`Database schema: ${tables.join(", ")}.`);
  }

  if (ctx.phase === "pushed") {
    parts.push("All changes pushed to GitHub.");
  }

  if (parts.length === 0) {
    return "Pipeline complete.";
  }

  return `Pipeline complete. ${parts.join(" ")}`;
}
