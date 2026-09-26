/**
 * Mutable run context shared across orchestrator tools for one user goal.
 */

let nextId = 1;
function uid(prefix) {
  return `${prefix}_${nextId++}_${Date.now().toString(36)}`;
}

/**
 * @param {object} mapSnapshot — full or partial repo map JSON from the workspace
 */
export function compactMapSnapshot(mapSnapshot) {
  if (!mapSnapshot?.nodesByPath) {
    return null;
  }
  const paths = Object.keys(mapSnapshot.nodesByPath);
  const files = paths.filter((p) => mapSnapshot.nodesByPath[p]?.type === "file");
  const sample = files.slice(0, 40);
  const byDomain = {};
  for (const p of sample) {
    const d = mapSnapshot.nodesByPath[p]?.domain ?? "Review";
    byDomain[d] = (byDomain[d] ?? 0) + 1;
  }
  return {
    repoKey: mapSnapshot.repoKey ?? mapSnapshot.repoMeta?.fullName ?? null,
    fileCount: files.length,
    pathCount: paths.length,
    domainCounts: byDomain,
    samplePaths: sample,
  };
}

/**
 * @param {{
 *   goal: string,
 *   mapSnapshot?: object | null,
 *   githubToken?: string | null,
 *   autoApproveHuman?: boolean,
 * }} options
 */
export function createRunContext({ goal, mapSnapshot = null, githubToken = null, autoApproveHuman = false }) {
  /** @type {import("./context.js").OrchestratorContext} */
  const ctx = {
    goal,
    autoApproveHuman,
    githubToken,
    phase: "init",
    repo: null,
    mapCompact: compactMapSnapshot(mapSnapshot),
    mapSnapshot: mapSnapshot ?? null,
    pendingHumanActions: [],
    artifacts: [],
    dbSchema: null,
    preview: { status: "idle", revision: 0, url: null },
    lastMonitor: null,
    lastSecurity: null,
  };
  return ctx;
}

/**
 * @typedef {{
 *   goal: string,
 *   autoApproveHuman: boolean,
 *   githubToken: string | null,
 *   phase: string,
 *   repo: { name: string, description?: string, createdAt?: string } | null,
 *   mapCompact: object | null,
 *   mapSnapshot: object | null,
 *   pendingHumanActions: Array<{ id: string, kind: string, summary: string, payload: object }>,
 *   artifacts: Array<{ id: string, agent: string, paths: string[], summary: string }>,
 *   dbSchema: { tables: object } | null,
 *   preview: { status: string, revision: number, url: string | null },
 *   lastMonitor: object | null,
 *   lastSecurity: object | null,
 * }} OrchestratorContext
 */

export function serializeContext(ctx) {
  return {
    phase: ctx.phase,
    repo: ctx.repo,
    mapCompact: ctx.mapCompact,
    pendingHumanActions: ctx.pendingHumanActions,
    artifacts: ctx.artifacts,
    dbSchema: ctx.dbSchema,
    preview: ctx.preview,
    lastMonitor: ctx.lastMonitor,
    lastSecurity: ctx.lastSecurity,
  };
}

export { uid };
