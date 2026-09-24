/**
 * Export the shared repo map for Claude, Cursor, or other tools.
 */

import { getMapEntry } from "./repoMap.js";

export function getMapStats(map) {
  if (!map?.nodesByPath) {
    return { total: 0, withSummary: 0, withPointers: 0 };
  }
  const nodes = Object.values(map.nodesByPath);
  return {
    total: nodes.length,
    withSummary: nodes.filter((n) => n.summary).length,
    withPointers: nodes.filter((n) => n.pointers?.length).length,
  };
}

function sortedNodes(map) {
  return Object.values(map.nodesByPath ?? {}).sort((a, b) =>
    a.path.localeCompare(b.path)
  );
}

/**
 * Markdown index — optimized for pasting into Claude as repo context.
 */
export function exportRepoMapMarkdown(map) {
  if (!map) return "";

  const meta = map.repoMeta ?? {};
  const stats = getMapStats(map);
  const title = meta.fullName || `${meta.owner}/${meta.repo}`;

  const lines = [
    `# Repository map: ${title}`,
    "",
    `Branch: \`${meta.branch ?? "main"}\``,
    meta.description ? `About: ${meta.description}` : null,
    "",
    "This is a Sprout-generated index: each path lists what it is for so you or an AI assistant do not need to re-scan the whole repository.",
    "",
    `Indexed: ${stats.withSummary}/${stats.total} summaries · ${stats.withPointers}/${stats.total} with click-detail pointers`,
    meta.truncated ? "⚠ GitHub returned a partial tree for this repo." : null,
    "",
    "---",
    "",
  ].filter(Boolean);

  for (const n of sortedNodes(map)) {
    if (n.path === "" && n.depth === 0) {
      lines.push("## `(repository root)`");
    } else {
      lines.push(`## \`${n.path}\``);
    }
    lines.push(`- **Type:** ${n.type}`);
    lines.push(`- **Agent domain:** ${n.domain ?? "Review"}`);
    lines.push(`- **Summary:** ${n.summary || n.fallbackLabel || "—"}`);
    if (n.role) {
      lines.push(`- **Role in the project:** ${n.role}`);
    }
    if (n.pointers?.length) {
      lines.push("- **What it does / pointers:**");
      for (const p of n.pointers) {
        lines.push(`  - ${p}`);
      }
    } else {
      lines.push(
        "- **Pointers:** not generated yet (click the node in Sprout to add detail)"
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function exportRepoMapJson(map) {
  if (!map) return "{}";
  return JSON.stringify(
    {
      format: "sprout-repo-map",
      version: map.version ?? 1,
      repoKey: map.repoKey,
      repoMeta: map.repoMeta,
      exportedAt: new Date().toISOString(),
      stats: getMapStats(map),
      nodes: sortedNodes(map).map((n) => ({
        path: n.path,
        name: n.name,
        type: n.type,
        depth: n.depth,
        parentPath: n.parentPath,
        domain: n.domain,
        summary: n.summary || n.fallbackLabel,
        role: n.role ?? null,
        pointers: n.pointers ?? [],
        indexState: n.indexState,
      })),
    },
    null,
    2
  );
}

/** Rule-based bullets when Grok is unavailable. */
export function buildFallbackPointers(entry) {
  if (!entry) return [];
  const domain = entry.domain ?? "Review";
  const lines = [
    `Tagged for the ${domain} agent — use when working on ${domain.toLowerCase()} concerns.`,
    entry.summary || entry.fallbackLabel,
  ];
  if (entry.type === "folder") {
    lines.push(
      "Contains nested paths — use the graph to expand or focus this folder."
    );
  } else {
    lines.push(
      "Edit or read this file when changing behavior tied to the summary above."
    );
  }
  return lines;
}

export function buildFallbackWorkflow(entry) {
  if (!entry) {
    return {
      function: "Unknown path in this repository.",
      inputs: "—",
      outputs: "—",
      process: "—",
    };
  }
  const summary = entry.summary || entry.fallbackLabel || "Project file or folder.";
  const domain = entry.domain ?? "Review";
  if (entry.type === "folder") {
    return {
      function: summary,
      inputs: "Other files and folders nested under this path.",
      outputs: "Organized structure for the rest of the repo map.",
      process: `Expand or focus this folder in the graph; tagged for the ${domain} agent.`,
    };
  }
  return {
    function: summary,
    inputs: "Imports, props, API payloads, or config this file reads (open the file to see exact names).",
    outputs: "UI, data, exports, or side effects this file produces.",
    process: `Follow the summary above; use when ${domain.toLowerCase()}-related work touches ${entry.name}.`,
  };
}

export function getDisplayPointers(entry, { loading = false } = {}) {
  if (!entry) return [];
  if (loading) return ["Thinking…"];
  if (entry.pointers?.length) return entry.pointers;
  return buildFallbackPointers(entry);
}

export function getDisplayWorkflow(entry, { loading = false } = {}) {
  if (loading) {
    return {
      function: "Thinking…",
      inputs: "…",
      outputs: "…",
      process: "…",
    };
  }
  if (entry?.workflow && typeof entry.workflow === "object") {
    return {
      function: entry.workflow.function || entry.summary || entry.fallbackLabel || "—",
      inputs: entry.workflow.inputs || "—",
      outputs: entry.workflow.outputs || "—",
      process: entry.workflow.process || "—",
    };
  }
  return buildFallbackWorkflow(entry);
}
