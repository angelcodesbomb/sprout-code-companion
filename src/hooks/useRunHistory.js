"use client";

/**
 * useRunHistory
 *
 * Persists orchestrator run history in localStorage, keyed by repoKey
 * (e.g. "owner/repo@main"). Each run stores:
 *   - goal           the user's prompt
 *   - steps          pipeline step list (toolName, agent, ok/fail, timestamp)
 *   - finalAnswer    the orchestrator's plain-text summary
 *   - filesGenerated flat list of file paths from all artifacts
 *   - ranAt          ISO timestamp
 *
 * When a repo is loaded, calling loadForRepo(repoKey) populates history
 * from storage and returns it to the caller so it can be fed back into
 * the orchestrator as prior-run context.
 *
 * Storage key format: "sprout-run-history:<repoKey>"
 * Max 20 runs per repo, oldest pruned first.
 */

import { useCallback, useEffect, useState } from "react";

const KEY_PREFIX = "sprout-run-history:";
const MAX_RUNS   = 20;

function storageKey(repoKey) {
  return `${KEY_PREFIX}${repoKey}`;
}

function readRuns(repoKey) {
  if (!repoKey) return [];
  try {
    return JSON.parse(localStorage.getItem(storageKey(repoKey)) ?? "[]");
  } catch {
    return [];
  }
}

function writeRuns(repoKey, runs) {
  if (!repoKey) return;
  try {
    localStorage.setItem(storageKey(repoKey), JSON.stringify(runs));
  } catch { /* storage full — silently skip */ }
}

/**
 * @param {string | null} repoKey  e.g. "owner/repo@main" or null if no repo loaded
 */
export function useRunHistory(repoKey) {
  const [runs, setRuns] = useState([]);

  // Hydrate from localStorage when repoKey changes (after mount to avoid SSR)
  useEffect(() => {
    if (!repoKey) { setRuns([]); return; }
    setRuns(readRuns(repoKey));
  }, [repoKey]);

  /**
   * Save a completed orchestrator run to history.
   * @param {{
   *   goal: string,
   *   steps: Array<{ toolName: string, agent?: string, result: { ok: boolean }, timestamp: string }>,
   *   finalAnswer: string | null,
   *   files?: Array<{ path: string }>,
   * }} run
   */
  const saveRun = useCallback((run) => {
    if (!repoKey || !run?.goal) return;

    const entry = {
      id:             `run_${Date.now().toString(36)}`,
      ranAt:          new Date().toISOString(),
      goal:           run.goal,
      finalAnswer:    run.finalAnswer ?? null,
      stepCount:      run.steps?.length ?? 0,
      steps:          (run.steps ?? []).map((s) => ({
        toolName:  s.toolName,
        agent:     s.agent ?? null,
        ok:        s.result?.ok !== false,
        timestamp: s.timestamp ?? null,
      })),
      filesGenerated: (run.files ?? []).map((f) => f.path ?? f).filter(Boolean),
    };

    setRuns((prev) => {
      const next = [entry, ...prev].slice(0, MAX_RUNS);
      writeRuns(repoKey, next);
      return next;
    });
  }, [repoKey]);

  /**
   * Build a compact context string from recent runs to inject into the orchestrator.
   * Kept short to save tokens — just goals + file paths.
   */
  const buildContextString = useCallback((maxRuns = 3) => {
    if (!runs.length) return null;
    const recent = runs.slice(0, maxRuns);
    return recent
      .map((r, i) => {
        const files = r.filesGenerated.length
          ? `  Files: ${r.filesGenerated.join(", ")}`
          : "";
        const status = r.finalAnswer ? `  Summary: ${r.finalAnswer.slice(0, 120)}` : "";
        return `Run ${i + 1} (${r.ranAt.slice(0, 10)}):\n  Goal: ${r.goal}${files ? `\n${files}` : ""}${status ? `\n${status}` : ""}`;
      })
      .join("\n\n");
  }, [runs]);

  /** Delete a single run by id */
  const deleteRun = useCallback((id) => {
    setRuns((prev) => {
      const next = prev.filter((r) => r.id !== id);
      writeRuns(repoKey, next);
      return next;
    });
  }, [repoKey]);

  /** Wipe all history for current repo */
  const clearHistory = useCallback(() => {
    if (!repoKey) return;
    try { localStorage.removeItem(storageKey(repoKey)); } catch { }
    setRuns([]);
  }, [repoKey]);

  return { runs, saveRun, deleteRun, clearHistory, buildContextString };
}
