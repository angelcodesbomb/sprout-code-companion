/**
 * Shared repository map — built once per repo load, used by the graph, tree, and AI routes.
 * Summaries are filled lazily on hover and persisted in sessionStorage per repo key.
 */

import { guessDescription } from "./fileTypeGuess.js";
import { flattenTree } from "./parseGithubTree.js";

export const INDEX_STATE = {
  UNINDEXED: "unindexed",
  SUMMARIZED: "summarized",
  STALE: "stale",
};

export const AGENT_DOMAINS = [
  "UI",
  "Database",
  "API",
  "Review",
  "Security",
  "Validation",
];

/** Agent sidebar tones → CSS var names (same palette as the dashboard). */
export const DOMAIN_TONE = {
  UI: "pink",
  Database: "cyan",
  API: "mint",
  Review: "coral",
  Security: "pink",
  Validation: "cyan",
};

const STORAGE_PREFIX = "sprout-repo-map:";

export function repoMapKey(meta) {
  if (!meta?.owner || !meta?.repo) return null;
  const branch = meta.branch ?? "main";
  return `${meta.owner}/${meta.repo}@${branch}`;
}

/**
 * Cheap rule-based domain tag before / without AI.
 * @param {{ name: string, path: string, type: string }} node
 */
export function guessDomain(node) {
  const path = (node.path || node.name || "").toLowerCase();
  const name = (node.name || "").toLowerCase();

  if (
    /(^|\/)(prisma|migrations|seeds|db|database)(\/|$)/.test(path) ||
    /\.(sql|prisma)$/.test(name)
  ) {
    return "Database";
  }
  if (
    /(^|\/)(api|routes|middleware|handlers|controllers)(\/|$)/.test(path) ||
    name.includes("route.") ||
    name.endsWith("handler.js") ||
    name.endsWith("handler.ts")
  ) {
    return "API";
  }
  if (
    /(^|\/)(components|ui|styles|css|assets|icons|pages|app)(\/|$)/.test(path) ||
    /\.(jsx|tsx|vue|svelte|css|scss)$/.test(name)
  ) {
    return "UI";
  }
  if (
    /(^|\/)(test|tests|__tests__|spec|e2e|cypress|playwright)(\/|$)/.test(path) ||
    /\.(test|spec)\.(js|ts|jsx|tsx)$/.test(name)
  ) {
    return "Validation";
  }
  if (
    /(^|\/)(auth|security|encrypt|crypto)(\/|$)/.test(path) ||
    /security|auth|oauth|jwt|csrf/i.test(name)
  ) {
    return "Security";
  }
  return "Review";
}

function depthFromPath(path) {
  if (!path) return 0;
  return path.split("/").filter(Boolean).length;
}

function parentPathFromPath(path) {
  if (!path) return null;
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join("/");
}

/**
 * @param {Array} treeNodes — nested tree from parseGithubTree
 * @param {object} repoMeta — { owner, repo, branch, description?, ... }
 * @returns {object|null} repo map
 */
export function buildRepoMap(treeNodes, repoMeta) {
  const key = repoMapKey(repoMeta);
  if (!key || !treeNodes?.length) return null;

  const persisted = loadPersistedRepoMap(key);
  const nodesByPath = {};

  const flat = flattenTree(treeNodes);
  for (const node of flat) {
    const path = node.path ?? "";
    const depth = depthFromPath(path);
    const parentPath = path.includes("/") ? parentPathFromPath(path) : "";
    const fallbackLabel = guessDescription(node);
    const prev = persisted?.nodesByPath?.[path];

    nodesByPath[path] = {
      name: node.name,
      path,
      depth,
      parentPath,
      type: node.type,
      fallbackLabel,
      summary: prev?.summary ?? null,
      domain: prev?.domain ?? guessDomain(node),
      role: prev?.role ?? null,
      pointers: prev?.pointers ?? null,
      workflow: prev?.workflow ?? null,
      indexState:
        prev?.summary && prev?.indexState === INDEX_STATE.SUMMARIZED
          ? INDEX_STATE.SUMMARIZED
          : INDEX_STATE.UNINDEXED,
    };
  }

  // Synthetic root entry for graph drill-down
  nodesByPath[""] = {
    name: repoMeta.repo ?? "repo",
    path: "",
    depth: 0,
    parentPath: null,
    type: "folder",
    fallbackLabel: repoMeta.description || "Repository root",
    summary: persisted?.nodesByPath?.[""]?.summary ?? null,
    domain: persisted?.nodesByPath?.[""]?.domain ?? "Review",
    role: persisted?.nodesByPath?.[""]?.role ?? null,
    pointers: persisted?.nodesByPath?.[""]?.pointers ?? null,
    indexState:
      persisted?.nodesByPath?.[""]?.summary
        ? INDEX_STATE.SUMMARIZED
        : INDEX_STATE.UNINDEXED,
  };

  const map = {
    version: 2,
    repoKey: key,
    repoMeta: {
      owner: repoMeta.owner,
      repo: repoMeta.repo,
      branch: repoMeta.branch ?? "main",
      fullName: repoMeta.fullName,
      description: repoMeta.description ?? null,
      truncated: repoMeta.truncated ?? false,
    },
    nodesByPath,
  };

  persistRepoMap(map);
  return map;
}

export function loadPersistedRepoMap(key) {
  if (typeof sessionStorage === "undefined" || !key) return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function persistRepoMap(map) {
  if (typeof sessionStorage === "undefined" || !map?.repoKey) return;
  try {
    sessionStorage.setItem(STORAGE_PREFIX + map.repoKey, JSON.stringify(map));
  } catch {
    /* quota or private mode */
  }
}

/**
 * @param {object} map
 * @param {string} path
 * @returns {object|undefined}
 */
export function getMapEntry(map, path) {
  if (!map?.nodesByPath) return undefined;
  const p = path ?? "";
  return map.nodesByPath[p];
}

/**
 * Display text for tooltip: AI summary, or fallback while loading / unindexed.
 */
export function getDisplayDescription(entry, { loading = false } = {}) {
  if (!entry) return "Project file";
  if (loading) return "Thinking…";
  if (entry.summary) return entry.summary;
  return entry.fallbackLabel;
}

/**
 * Merge an AI result into the map and persist.
 */
export function applyNodeSummary(map, path, { summary, domain }) {
  if (!map?.nodesByPath) return map;
  const p = path ?? "";
  const entry = map.nodesByPath[p];
  if (!entry) return map;

  const next = {
    ...map,
    nodesByPath: {
      ...map.nodesByPath,
      [p]: {
        ...entry,
        summary: summary || entry.fallbackLabel,
        domain: AGENT_DOMAINS.includes(domain) ? domain : entry.domain,
        indexState: INDEX_STATE.SUMMARIZED,
      },
    },
  };
  persistRepoMap(next);
  return next;
}

/**
 * Merge click-to-explore detail (pointers + optional role) into the map.
 */
export function applyNodeDetail(map, path, { pointers, role, workflow }) {
  if (!map?.nodesByPath) return map;
  const p = path ?? "";
  const entry = map.nodesByPath[p];
  if (!entry) return map;

  const nextWorkflow =
    workflow && typeof workflow === "object"
      ? {
          function: workflow.function ?? entry.workflow?.function,
          inputs: workflow.inputs ?? entry.workflow?.inputs,
          outputs: workflow.outputs ?? entry.workflow?.outputs,
          process: workflow.process ?? entry.workflow?.process,
        }
      : entry.workflow;

  const next = {
    ...map,
    nodesByPath: {
      ...map.nodesByPath,
      [p]: {
        ...entry,
        pointers: Array.isArray(pointers) && pointers.length ? pointers : entry.pointers,
        role: role || entry.role,
        workflow: nextWorkflow,
      },
    },
  };
  persistRepoMap(next);
  return next;
}

/** Paths whose domain matches an agent (for future filtering). */
export function getPathsForDomain(map, domain) {
  if (!map?.nodesByPath || !domain) return [];
  return Object.values(map.nodesByPath)
    .filter((n) => n.domain === domain)
    .map((n) => n.path);
}

/**
 * Lightweight context for the summarize API (not the raw tree).
 */
export function buildSummarizeContext(map, path) {
  const entry = getMapEntry(map, path);
  if (!entry || !map) return null;

  const parent = entry.parentPath != null ? getMapEntry(map, entry.parentPath) : null;

  const siblingNames = [];
  for (const [p, n] of Object.entries(map.nodesByPath)) {
    if (p === path) continue;
    if (n.parentPath === entry.parentPath) {
      siblingNames.push(n.name);
    }
  }

  return {
    repoDescription: map.repoMeta?.description ?? null,
    parentSummary: parent?.summary || parent?.fallbackLabel || null,
    siblingNames: siblingNames.slice(0, 12),
  };
}
