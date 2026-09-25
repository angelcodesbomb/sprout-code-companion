"use client";

import { useState, useEffect, useCallback } from "react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { parseGithubTree } from "@/lib/parseGithubTree";
import { buildRepoMap } from "@/lib/repoMap";
import { useRepoMapSummarize } from "@/hooks/useRepoMapSummarize";
import { useRepoDependencies } from "@/hooks/useRepoDependencies";
import { RepoMapProvider } from "@/context/RepoMapContext";

// ── Static mock data (agents + code explainer) ────────────────────────────────
// These remain unchanged — only the `files` data is now driven by real GitHub data.

const codeBlocks = [
  {
    id: "imports",
    title: "Brings in the tools",
    explanation: "These lines import React's state helper and the project service that knows how to fetch files.",
    lines: [
      { number: 1, html: '<b>import</b> { useState } <b>from</b> <em>"react"</em>;' },
      { number: 2, html: '<b>import</b> { getFiles } <b>from</b> <em>"../lib/project"</em>;' },
    ],
  },
  {
    id: "hook",
    title: "Creates the file-list helper",
    explanation: "This custom hook keeps the current file list and loading state together so any screen can reuse them.",
    lines: [
      { number: 4, html: '<b>export function</b> <mark>useProjectFiles</mark>(projectId) {' },
      { number: 5, html: '  <b>const</b> [files, setFiles] = useState([]);' },
      { number: 6, html: '  <b>const</b> [loading, setLoading] = useState(<u>true</u>);' },
    ],
  },
  {
    id: "load",
    title: "Loads and stores the files",
    explanation: "This function asks for the project's files, saves the result, and then marks loading as finished.",
    lines: [
      { number: 8, html: '  <b>async function</b> <mark>loadFiles</mark>() {' },
      { number: 9, html: '    <b>const</b> result = <b>await</b> getFiles(projectId);' },
      { number: 10, html: '    setFiles(result);' },
      { number: 11, html: '    setLoading(<u>false</u>);' },
      { number: 12, html: '  }' },
    ],
  },
  {
    id: "return",
    title: "Shares what the screen needs",
    explanation: "The hook gives other components the file list, loading status, and a function to refresh everything.",
    lines: [
      { number: 14, html: '  <b>return</b> { files, loading, refresh: loadFiles };' },
      { number: 15, html: '}' },
    ],
  },
];

// ── WorkspaceClient ───────────────────────────────────────────────────────────

export default function WorkspaceClient() {
  const [isDark, setIsDark] = useState(false);

  // ── Orchestrator state ───────────────────────────────────────────────────
  const [orchStatus,      setOrchStatus]      = useState("idle");   // "idle"|"running"|"done"|"error"
  const [orchSteps,       setOrchSteps]       = useState([]);
  const [orchCurrentTool, setOrchCurrentTool] = useState(null);
  const [orchFinalAnswer, setOrchFinalAnswer] = useState(null);
  const [orchError,       setOrchError]       = useState(null);

  const handleOrchestratorRun = useCallback(async (goal, options = {}) => {
    setOrchStatus("running");
    setOrchSteps([]);
    setOrchCurrentTool(null);
    setOrchFinalAnswer(null);
    setOrchError(null);

    try {
      const res = await fetch("/api/orchestrator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal,
          stream: true,
          mapSnapshot: options.mapSnapshot ?? null,
          autoApproveHuman: Boolean(options.autoApproveHuman),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setOrchError(data.error ?? "Orchestrator request failed.");
        setOrchStatus("error");
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setOrchError("Streaming not supported.");
        setOrchStatus("error");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const lines = chunk.split("\n");
          let event = "message";
          let dataStr = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) event = line.slice(7);
            else if (line.startsWith("data: ")) dataStr = line.slice(6);
          }
          if (!dataStr) continue;

          let data;
          try {
            data = JSON.parse(dataStr);
          } catch {
            continue;
          }

          if (event === "tool_start") {
            setOrchCurrentTool(data.toolName ?? null);
          } else if (event === "step") {
            setOrchSteps((prev) => [...prev, data]);
            setOrchCurrentTool(null);
          } else if (event === "done") {
            setOrchSteps(data.steps ?? []);
            setOrchFinalAnswer(data.finalAnswer ?? null);
            setOrchStatus("done");
          } else if (event === "error") {
            setOrchError(data.error ?? "Orchestrator failed.");
            setOrchStatus("error");
          }
        }
      }
    } catch (err) {
      setOrchError(err.message ?? "Network error.");
      setOrchStatus("error");
    } finally {
      setOrchCurrentTool(null);
    }
  }, []);

  // GitHub repo state
  const [repoTree, setRepoTree] = useState(null);    // null = nothing loaded yet
  const [repoMeta, setRepoMeta] = useState(null);    // { owner, repo, branch, fullName, ... }
  const [repoMap, setRepoMap] = useState(null);

  const runOrchestratorWithContext = useCallback(
    (goal) =>
      handleOrchestratorRun(goal, {
        mapSnapshot: repoMap,
        autoApproveHuman: true,
      }),
    [handleOrchestratorRun, repoMap]
  );
  const [isLoading, setIsLoading] = useState(false);

  const {
    requestSummary,
    requestNodeDetail,
    getDescriptionForPath,
    getDomainForPath,
    getPointersForPath,
    getRoleForPath,
    getWorkflowForPath,
  } = useRepoMapSummarize(repoMap, setRepoMap);

  const {
    edges: depEdges,
    edgesByPath: depEdgesByPath,
    status: depStatus,
  } = useRepoDependencies(repoMeta, repoMap);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
    return () => document.documentElement.classList.remove("dark");
  }, [isDark]);

  /**
   * Called by RepoInput when the GitHub API returns successfully.
   * @param {Array}  flatItems  Raw flat item array from GitHub's tree API
   * @param {object} meta       { owner, repo, branch, fullName, truncated }
   */
  function handleRepoLoad(flatItems, meta) {
    // Convert the flat GitHub tree response to a nested structure
    const tree = parseGithubTree(flatItems);
    setRepoTree(tree);
    setRepoMeta(meta);
    setRepoMap(buildRepoMap(tree, meta));
    setIsLoading(false);
  }

  function handleLoadStart() {
    setIsLoading(true);
    // Clear previous data so the skeleton shows cleanly
    setRepoTree(null);
    setRepoMeta(null);
    setRepoMap(null);
  }

  return (
    <RepoMapProvider
      repoMap={repoMap}
      setRepoMap={setRepoMap}
      requestSummary={requestSummary}
      requestNodeDetail={requestNodeDetail}
      getDescriptionForPath={getDescriptionForPath}
      getDomainForPath={getDomainForPath}
      getPointersForPath={getPointersForPath}
      getRoleForPath={getRoleForPath}
      getWorkflowForPath={getWorkflowForPath}
    >
      <DashboardShell
        files={repoTree}
        repoMeta={repoMeta}
        isLoadingFiles={isLoading}
        codeBlocks={codeBlocks}
        isDark={isDark}
        onThemeToggle={() => setIsDark((v) => !v)}
        onRepoLoad={handleRepoLoad}
        onLoadStart={handleLoadStart}
        depEdges={depEdges}
        depEdgesByPath={depEdgesByPath}
        depStatus={depStatus}
        orchStatus={orchStatus}
        orchSteps={orchSteps}
        orchCurrentTool={orchCurrentTool}
        orchFinalAnswer={orchFinalAnswer}
        orchError={orchError}
        onOrchestratorRun={runOrchestratorWithContext}
      />
    </RepoMapProvider>
  );
}
