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
 *   autoApproveHuman?: boolean,
 * }} options
 */
export function createRunContext({ goal, mapSnapshot = null, autoApproveHuman = false }) {
  /** @type {import("./context.js").OrchestratorContext} */
  const ctx = {
    goal,
    autoApproveHuman,
    phase: "init",
    repo: null,
    mapCompact: compactMapSnapshot(mapSnapshot),
    mapSnapshot: mapSnapshot ?? null,
    pendingHumanActions: [],
    artifacts: [],
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
 *   phase: string,
 *   repo: { name: string, description?: string, createdAt?: string } | null,
 *   mapCompact: object | null,
 *   mapSnapshot: object | null,
 *   pendingHumanActions: Array<{ id: string, kind: string, summary: string, payload: object }>,
 *   artifacts: Array<{ id: string, agent: string, paths: string[], summary: string }>,
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
    preview: ctx.preview,
    lastMonitor: ctx.lastMonitor,
    lastSecurity: ctx.lastSecurity,
  };
}

export { uid };
