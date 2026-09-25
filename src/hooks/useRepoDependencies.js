"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { buildDependencyGraph, filterParseable } from "@/lib/parseDependencies";

/**
 * useRepoDependencies
 *
 * Fetches source files for a repo and returns parsed import edges.
 *
 * Strategy — lazy batch fetch:
 *   1. On repoMeta change, collect all parseable file paths from the flat
 *      repoMap and POST them to /api/github/content in one request.
 *   2. Run buildDependencyGraph over the returned content map.
 *   3. Expose the result as `edges` (Array) and `edgesByPath` (Map from
 *      filePath → { out: Edge[], in: Edge[] }) for O(1) lookup in D3 handlers.
 *
 * @param {object|null} repoMeta  — { owner, repo, branch, … }
 * @param {object|null} repoMap   — { nodesByPath: { [path]: node } }
 * @returns {{
 *   edges: Array<{from, to, type}>,
 *   edgesByPath: Map<string, {out: Edge[], in: Edge[]}>,
 *   status: "idle"|"loading"|"done"|"error",
 * }}
 */
export function useRepoDependencies(repoMeta, repoMap) {
  const [edges, setEdges]         = useState([]);
  const [edgesByPath, setEdgesByPath] = useState(() => new Map());
  const [status, setStatus]       = useState("idle");

  // Track the last repoKey we fetched so a stale response from a previous
  // repo doesn't overwrite a freshly-loaded one.
  const fetchedKeyRef = useRef(null);

  useEffect(() => {
    if (!repoMeta?.owner || !repoMeta?.repo || !repoMeta?.branch || !repoMap?.nodesByPath) {
      setEdges([]);
      setEdgesByPath(new Map());
      setStatus("idle");
      fetchedKeyRef.current = null;
      return;
    }

    const repoKey = `${repoMeta.owner}/${repoMeta.repo}@${repoMeta.branch}`;

    // Don't re-fetch the same repo (e.g. on re-renders)
    if (fetchedKeyRef.current === repoKey) return;
    fetchedKeyRef.current = repoKey;

    setStatus("loading");
    setEdges([]);
    setEdgesByPath(new Map());

    const allPaths = Object.keys(repoMap.nodesByPath).filter(
      (p) => repoMap.nodesByPath[p]?.type === "file"
    );
    const parseable = filterParseable(allPaths);

    if (parseable.length === 0) {
      setStatus("done");
      return;
    }

    // Build a Set of all repo file paths for import resolution
    const pathSet = new Set(allPaths);

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/github/content", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            owner:  repoMeta.owner,
            repo:   repoMeta.repo,
            branch: repoMeta.branch,
            paths:  parseable,
          }),
        });

        if (cancelled) return;
        if (!res.ok) {
          setStatus("error");
          return;
        }

        const data = await res.json();
        if (cancelled) return;

        const sourceMap = new Map(Object.entries(data.contents ?? {}));
        const rawEdges  = buildDependencyGraph(sourceMap, pathSet);

        // Index edges by file path for fast lookup in D3 hover handlers
        const byPath = new Map();
        for (const edge of rawEdges) {
          if (!byPath.has(edge.from)) byPath.set(edge.from, { out: [], in: [] });
          if (!byPath.has(edge.to))   byPath.set(edge.to,   { out: [], in: [] });
          byPath.get(edge.from).out.push(edge);
          byPath.get(edge.to).in.push(edge);
        }

        setEdges(rawEdges);
        setEdgesByPath(byPath);
        setStatus("done");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => { cancelled = true; };
  }, [repoMeta, repoMap]);

  /**
   * Get all dependency edges touching a file path (outgoing + incoming).
   * Returns { out: Edge[], in: Edge[] } or { out: [], in: [] }.
   */
  const getEdgesForPath = useCallback(
    (path) => edgesByPath.get(path) ?? { out: [], in: [] },
    [edgesByPath]
  );

  return { edges, edgesByPath, getEdgesForPath, status };
}
