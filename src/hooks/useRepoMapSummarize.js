"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  INDEX_STATE,
  applyNodeDetail,
  applyNodeSummary,
  buildSummarizeContext,
  getDisplayDescription,
  getMapEntry,
  guessDomain,
} from "@/lib/repoMap";
import {
  buildFallbackPointers,
  buildFallbackWorkflow,
  getDisplayPointers,
  getDisplayWorkflow,
} from "@/lib/repoMapExport";

const inFlight = new Map();
const detailInFlight = new Map();

/**
 * Lazy AI summaries on first hover; falls back to rule-based text when AI is unavailable.
 */
export function useRepoMapSummarize(repoMap, setRepoMap) {
  const [loadingPaths, setLoadingPaths] = useState(() => new Set());
  const [detailLoadingPaths, setDetailLoadingPaths] = useState(() => new Set());
  const aiAvailableRef = useRef(null);
  const mapRef = useRef(repoMap);
  useEffect(() => {
    mapRef.current = repoMap;
    if (!repoMap?.repoKey) return;
    aiAvailableRef.current = null;
    fetch("/api/filemap/summarize")
      .then((r) => r.json())
      .then((d) => {
        if (d && d.aiEnabled === false) aiAvailableRef.current = false;
        else if (d?.aiEnabled) aiAvailableRef.current = true;
      })
      .catch(() => {});
    // Only re-probe when the loaded repo identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps -- repoKey is the intended trigger
  }, [repoMap?.repoKey]);

  const requestSummary = useCallback(
    async (path) => {
      const map = mapRef.current;
      if (!map?.nodesByPath) return;

      const p = path ?? "";
      const entry = getMapEntry(map, p);
      if (!entry) return;

      if (entry.indexState === INDEX_STATE.SUMMARIZED && entry.summary) {
        return;
      }

      if (inFlight.has(p)) {
        await inFlight.get(p);
        return;
      }

      if (aiAvailableRef.current === false) {
        setRepoMap((prev) =>
          applyNodeSummary(prev, p, {
            summary: entry.fallbackLabel,
            domain: entry.domain ?? guessDomain(entry),
          })
        );
        return;
      }

      const promise = (async () => {
        setLoadingPaths((prev) => new Set(prev).add(p));

        try {
          const context = buildSummarizeContext(mapRef.current, p);
          const res = await fetch("/api/filemap/summarize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              node: {
                name: entry.name,
                path: entry.path,
                type: entry.type,
                depth: entry.depth,
                parentPath: entry.parentPath,
              },
              fallbackLabel: entry.fallbackLabel,
              context,
            }),
          });

          const data = await res.json().catch(() => ({}));

          if (res.status === 503 && data.useFallback) {
            aiAvailableRef.current = false;
            setRepoMap((prev) =>
              applyNodeSummary(prev, p, {
                summary: entry.fallbackLabel,
                domain: data.domain ?? entry.domain ?? guessDomain(entry),
              })
            );
            return;
          }

          if (!res.ok) {
            setRepoMap((prev) =>
              applyNodeSummary(prev, p, {
                summary: entry.fallbackLabel,
                domain: entry.domain ?? guessDomain(entry),
              })
            );
            return;
          }

          aiAvailableRef.current = true;
          setRepoMap((prev) =>
            applyNodeSummary(prev, p, {
              summary: data.summary || entry.fallbackLabel,
              domain: data.domain ?? entry.domain,
            })
          );
        } catch {
          setRepoMap((prev) =>
            applyNodeSummary(prev, p, {
              summary: entry.fallbackLabel,
              domain: entry.domain ?? guessDomain(entry),
            })
          );
        } finally {
          inFlight.delete(p);
          setLoadingPaths((prev) => {
            const next = new Set(prev);
            next.delete(p);
            return next;
          });
        }
      })();

      inFlight.set(p, promise);
      await promise;
    },
    [setRepoMap]
  );

  const requestNodeDetail = useCallback(
    async (path) => {
      const map = mapRef.current;
      if (!map?.nodesByPath) return;

      const p = path ?? "";
      const entry = getMapEntry(map, p);
      if (!entry) return;

      if (entry.workflow?.function && entry.pointers?.length) return;

      if (detailInFlight.has(p)) {
        await detailInFlight.get(p);
        return;
      }

      await requestSummary(p);

      const fresh = getMapEntry(mapRef.current, p) ?? entry;

      if (aiAvailableRef.current === false) {
        setRepoMap((prev) =>
          applyNodeDetail(prev, p, {
            pointers: buildFallbackPointers(fresh),
            role: fresh.summary || fresh.fallbackLabel,
            workflow: buildFallbackWorkflow(fresh),
          })
        );
        return;
      }

      const promise = (async () => {
        setDetailLoadingPaths((prev) => new Set(prev).add(p));
        try {
          const context = buildSummarizeContext(mapRef.current, p);
          const res = await fetch("/api/filemap/explain", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              node: {
                name: fresh.name,
                path: fresh.path,
                type: fresh.type,
                depth: fresh.depth,
                parentPath: fresh.parentPath,
              },
              fallbackLabel: fresh.fallbackLabel,
              summary: fresh.summary || fresh.fallbackLabel,
              context,
            }),
          });
          const data = await res.json().catch(() => ({}));

          const pointers =
            data.pointers?.length > 0
              ? data.pointers
              : buildFallbackPointers(fresh);
          const role = data.role || fresh.summary || fresh.fallbackLabel;
          const workflow =
            data.workflow && typeof data.workflow === "object"
              ? data.workflow
              : buildFallbackWorkflow(fresh);

          if (res.status === 503 && data.useFallback) {
            aiAvailableRef.current = false;
          } else if (res.ok) {
            aiAvailableRef.current = true;
          }

          setRepoMap((prev) =>
            applyNodeDetail(prev, p, { pointers, role, workflow })
          );
        } catch {
          setRepoMap((prev) =>
            applyNodeDetail(prev, p, {
              pointers: buildFallbackPointers(fresh),
              role: fresh.summary || fresh.fallbackLabel,
              workflow: buildFallbackWorkflow(fresh),
            })
          );
        } finally {
          detailInFlight.delete(p);
          setDetailLoadingPaths((prev) => {
            const next = new Set(prev);
            next.delete(p);
            return next;
          });
        }
      })();

      detailInFlight.set(p, promise);
      await promise;
    },
    [requestSummary, setRepoMap]
  );

  const getDescriptionForPath = useCallback(
    (path) => {
      const entry = getMapEntry(repoMap, path);
      const loading = loadingPaths.has(path ?? "");
      return getDisplayDescription(entry, { loading });
    },
    [repoMap, loadingPaths]
  );

  const getDomainForPath = useCallback(
    (path) => {
      const entry = getMapEntry(repoMap, path ?? "");
      return entry?.domain ?? null;
    },
    [repoMap]
  );

  const getPointersForPath = useCallback(
    (path) => {
      const entry = getMapEntry(repoMap, path ?? "");
      const loading = detailLoadingPaths.has(path ?? "");
      return getDisplayPointers(entry, { loading });
    },
    [repoMap, detailLoadingPaths]
  );

  const getRoleForPath = useCallback(
    (path) => {
      const entry = getMapEntry(repoMap, path ?? "");
      if (!entry) return "";
      if (detailLoadingPaths.has(path ?? "")) return "Thinking…";
      return entry.role || entry.summary || entry.fallbackLabel || "";
    },
    [repoMap, detailLoadingPaths]
  );

  const getWorkflowForPath = useCallback(
    (path) => {
      const entry = getMapEntry(repoMap, path ?? "");
      const loading = detailLoadingPaths.has(path ?? "");
      return getDisplayWorkflow(entry, { loading });
    },
    [repoMap, detailLoadingPaths]
  );

  return {
    requestSummary,
    requestNodeDetail,
    getDescriptionForPath,
    getDomainForPath,
    getPointersForPath,
    getRoleForPath,
    getWorkflowForPath,
    loadingPaths,
    detailLoadingPaths,
  };
}
