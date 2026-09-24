/**
 * Repo Q&A helpers — compact index for the ask API and offline path matching.
 */

import { getMapEntry } from "./repoMap.js";

export function buildAskIndex(map, limit = 450) {
  if (!map?.nodesByPath) return [];
  return Object.values(map.nodesByPath)
    .filter((n) => n.path !== "" || n.depth === 0)
    .sort((a, b) => a.path.localeCompare(b.path))
    .slice(0, limit)
    .map((n) => ({
      path: n.path,
      name: n.name,
      type: n.type,
      summary: (n.summary || n.fallbackLabel || "").slice(0, 160),
      domain: n.domain ?? null,
    }));
}

function tokenizeQuestion(question) {
  return (question || "")
    .toLowerCase()
    .replace(/[^\w\s./-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

const STOP = new Set([
  "the",
  "where",
  "which",
  "what",
  "does",
  "file",
  "files",
  "folder",
  "function",
  "this",
  "that",
  "find",
  "repo",
  "repository",
  "code",
  "located",
  "live",
  "handle",
  "handles",
]);

/** Best-effort path match when AI is unavailable. */
export function resolvePathFromQuestion(question, map) {
  if (!map?.nodesByPath || !question?.trim()) return null;

  const q = question.toLowerCase();
  const paths = Object.keys(map.nodesByPath);

  const pathMatch = q.match(/(?:^|[\s"'`])([\w.-]+(?:\/[\w.-]+)+)(?:[\s"'`]|$)/);
  if (pathMatch) {
    const candidate = pathMatch[1].replace(/^\//, "");
    if (map.nodesByPath[candidate]) return candidate;
    const suffix = paths.find((p) => p.endsWith(candidate) || p.includes(candidate));
    if (suffix) return suffix;
  }

  const fnMatch =
    q.match(/(?:function|method|class|component)\s+[`'"]?([\w$]+)/i) ||
    q.match(/[`'`]([\w$]+)[`'`](?:\s+function)?/);
  const fnName = fnMatch?.[1];

  const tokens = tokenizeQuestion(question);
  if (fnName) tokens.unshift(fnName.toLowerCase());

  let best = null;
  let bestScore = 0;

  for (const p of paths) {
    const entry = map.nodesByPath[p];
    if (!entry) continue;
    const name = (entry.name || "").toLowerCase();
    const pathLower = p.toLowerCase();
    const summary = (entry.summary || entry.fallbackLabel || "").toLowerCase();

    let score = 0;
    for (const t of tokens) {
      if (name === t) score += 12;
      else if (name.includes(t)) score += 8;
      else if (pathLower.includes(t)) score += 5;
      else if (summary.includes(t)) score += 2;
    }
    if (fnName && (name.includes(fnName.toLowerCase()) || pathLower.includes(fnName.toLowerCase()))) {
      score += 15;
    }

    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }

  return bestScore >= 5 ? best : null;
}

export function buildFallbackAnswer(question, map, targetPath) {
  if (targetPath != null && targetPath !== "") {
    const entry = getMapEntry(map, targetPath);
    const label = entry?.name || targetPath;
    return `That looks like \`${targetPath}\` (${label}). I highlighted it on the file map — click the node for function, inputs, outputs, and process.`;
  }
  return "I couldn't tie that question to a specific path. Try naming the file, folder, or function (e.g. “where is useRepoMapSummarize?”).";
}
