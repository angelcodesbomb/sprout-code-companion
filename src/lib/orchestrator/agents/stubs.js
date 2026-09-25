/**
 * Stub agent implementations — real agents replace these later.
 * Each returns a ToolResult-compatible object.
 */

import { uid, compactMapSnapshot } from "../context.js";

/** @param {import("../context.js").OrchestratorContext} ctx */
export async function stubGithubProposeInit(ctx, input) {
  const actionId = uid("init");
  const proposal = {
    id: actionId,
    kind: "github_init_repo",
    summary: `Create repo "${input.repoName}"`,
    payload: {
      repoName: input.repoName,
      description: input.description ?? "",
      template: input.template ?? "nextjs-app",
    },
  };
  ctx.pendingHumanActions.push(proposal);
  ctx.phase = "awaiting_init_approval";

  if (ctx.autoApproveHuman) {
    return {
      ok: true,
      output: {
        status: "auto_approve_hint",
        actionId,
        message: "Call github_confirm_human_action with this actionId and approved=true.",
        proposal,
      },
      error: null,
    };
  }

  return {
    ok: true,
    output: { status: "pending_approval", actionId, proposal },
    error: null,
  };
}

/** @param {import("../context.js").OrchestratorContext} ctx */
export async function stubGithubConfirmHuman(ctx, input) {
  const action = ctx.pendingHumanActions.find((a) => a.id === input.actionId);
  if (!action) {
    return { ok: false, output: null, error: `Unknown actionId: ${input.actionId}` };
  }
  if (!input.approved) {
    ctx.phase = "halted";
    return {
      ok: true,
      output: { status: "rejected", actionId: input.actionId, kind: action.kind },
      error: null,
    };
  }

  if (action.kind === "github_init_repo") {
    ctx.repo = {
      name: action.payload.repoName,
      description: action.payload.description,
      createdAt: new Date().toISOString(),
    };
    ctx.phase = "repo_ready";
    ctx.pendingHumanActions = ctx.pendingHumanActions.filter((a) => a.id !== action.id);
    return {
      ok: true,
      output: { status: "repo_created", repo: ctx.repo },
      error: null,
    };
  }

  if (action.kind === "github_push") {
    ctx.phase = "pushed";
    ctx.pendingHumanActions = ctx.pendingHumanActions.filter((a) => a.id !== action.id);
    return {
      ok: true,
      output: {
        status: "pushed",
        commitMessage: action.payload.commitMessage,
        files: action.payload.files,
      },
      error: null,
    };
  }

  return { ok: false, output: null, error: `Unsupported action kind: ${action.kind}` };
}

/** @param {import("../context.js").OrchestratorContext} ctx */
export async function stubMapParserLoad(ctx, input) {
  if (input.mapSnapshot && typeof input.mapSnapshot === "object") {
    ctx.mapSnapshot = input.mapSnapshot;
    ctx.mapCompact = compactMapSnapshot(input.mapSnapshot);
  }
  if (!ctx.mapCompact && !ctx.mapSnapshot) {
    return {
      ok: false,
      output: null,
      error: "No map in context. Pass mapSnapshot or load a repo in the workspace first.",
    };
  }
  ctx.phase = "map_loaded";
  return {
    ok: true,
    output: {
      status: "map_loaded",
      map: ctx.mapCompact,
      source: input.source ?? "cache",
    },
    error: null,
  };
}

/** @param {import("../context.js").OrchestratorContext} ctx */
export async function stubMapParserRefresh(ctx) {
  ctx.phase = "map_refreshed";
  return {
    ok: true,
    output: {
      status: "map_refreshed",
      map: ctx.mapCompact,
      note: "Stub: would re-parse repo after push.",
    },
    error: null,
  };
}

/** @param {import("../context.js").OrchestratorContext} ctx */
export async function stubCodegenAgent(ctx, agent, input) {
  const artifactId = uid(agent);
  const paths = input.targetPaths ?? input.routes ?? [];
  const artifact = {
    id: artifactId,
    agent,
    paths: Array.isArray(paths) ? paths : [paths].filter(Boolean),
    summary: input.task ?? input.spec ?? "Generated stub artifact",
    stubCode: `// [${agent}] stub output for: ${input.task ?? "task"}`,
  };
  ctx.artifacts.push(artifact);
  ctx.phase = "codegen";
  return {
    ok: true,
    output: { artifactId, artifact },
    error: null,
  };
}

/** @param {import("../context.js").OrchestratorContext} ctx */
export async function stubMonitorReview(ctx, input) {
  const artifact = ctx.artifacts.find((a) => a.id === input.artifactId);
  if (!artifact) {
    return { ok: false, output: null, error: `Unknown artifactId: ${input.artifactId}` };
  }
  const review = {
    agent: "Monitor",
    artifactId: input.artifactId,
    pass: true,
    feedback: input.forceFail
      ? "Stub forced fail for testing."
      : "Stub: best practices OK, token efficiency OK, no loop-in-function issues.",
    checks: ["best_practices", "token_efficiency", "control_flow"],
  };
  if (input.forceFail) review.pass = false;
  ctx.lastMonitor = review;
  return { ok: true, output: review, error: null };
}

/** @param {import("../context.js").OrchestratorContext} ctx */
export async function stubSecurityReview(ctx, input) {
  const artifact = ctx.artifacts.find((a) => a.id === input.artifactId);
  if (!artifact) {
    return { ok: false, output: null, error: `Unknown artifactId: ${input.artifactId}` };
  }
  const review = {
    agent: "Security",
    artifactId: input.artifactId,
    pass: true,
    flags: [],
    note: "Stub: no secrets, injection, or auth issues detected.",
  };
  ctx.lastSecurity = review;
  return { ok: true, output: review, error: null };
}

/** @param {import("../context.js").OrchestratorContext} ctx */
export async function stubLivePreviewSync(ctx) {
  ctx.preview.revision += 1;
  ctx.preview.status = "live";
  ctx.preview.url = `/preview/stub-rev-${ctx.preview.revision}`;
  return {
    ok: true,
    output: {
      status: ctx.preview.status,
      revision: ctx.preview.revision,
      url: ctx.preview.url,
      artifactCount: ctx.artifacts.length,
    },
    error: null,
  };
}

/** @param {import("../context.js").OrchestratorContext} ctx */
export async function stubGithubProposePush(ctx, input) {
  const actionId = uid("push");
  const files = input.files ?? ctx.artifacts.flatMap((a) => a.paths);
  const proposal = {
    id: actionId,
    kind: "github_push",
    summary: input.commitMessage ?? "Orchestrator changes",
    payload: { commitMessage: input.commitMessage ?? "feat: orchestrator update", files },
  };
  ctx.pendingHumanActions.push(proposal);
  ctx.phase = "awaiting_push_approval";

  if (ctx.autoApproveHuman) {
    return {
      ok: true,
      output: {
        status: "auto_approve_hint",
        actionId,
        message: "Call github_confirm_human_action with this actionId and approved=true.",
        proposal,
      },
      error: null,
    };
  }

  return {
    ok: true,
    output: { status: "pending_approval", actionId, proposal },
    error: null,
  };
}
