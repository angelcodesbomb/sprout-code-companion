"use client";

import { useState } from "react";
import { Copy, FileJson } from "lucide-react";
import { useRepoMapContext } from "@/context/RepoMapContext";
import {
  exportRepoMapJson,
  exportRepoMapMarkdown,
  getMapStats,
} from "@/lib/repoMapExport";

async function copyText(text) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  return false;
}

/**
 * Copy the accumulated repo map for Claude, Cursor, etc.
 */
export function RepoMapCopyBar() {
  const { repoMap } = useRepoMapContext();
  const [flash, setFlash] = useState(null);

  if (!repoMap) return null;

  const stats = getMapStats(repoMap);

  async function handleCopy(format) {
    const text =
      format === "json"
        ? exportRepoMapJson(repoMap)
        : exportRepoMapMarkdown(repoMap);
    const ok = await copyText(text);
    setFlash(ok ? format : "err");
    setTimeout(() => setFlash(null), 2200);
  }

  return (
    <div className="repo-map-copy" role="region" aria-label="Export repository map">
      <p className="repo-map-copy__hint">
        Sprout builds a shared index as you explore — copy it so you or another AI
        already knows which file holds what ({stats.withSummary}/{stats.total} summarized
        · {stats.withPointers}/{stats.total} with click detail).
      </p>
      <div className="repo-map-copy__actions">
        <button
          type="button"
          className="repo-map-copy__btn repo-map-copy__btn--coral"
          onClick={() => handleCopy("markdown")}
        >
          <Copy size={14} aria-hidden="true" />
          Copy map for Claude
        </button>
        <button
          type="button"
          className="repo-map-copy__btn repo-map-copy__btn--mint"
          onClick={() => handleCopy("json")}
        >
          <FileJson size={14} aria-hidden="true" />
          Copy JSON
        </button>
        {flash === "markdown" && (
          <span className="repo-map-copy__flash">Markdown copied</span>
        )}
        {flash === "json" && (
          <span className="repo-map-copy__flash">JSON copied</span>
        )}
        {flash === "err" && (
          <span className="repo-map-copy__flash repo-map-copy__flash--err">
            Copy failed — try again
          </span>
        )}
      </div>
    </div>
  );
}
