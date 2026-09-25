"use client";

import { useState, useEffect } from "react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { parseGithubTree } from "@/lib/parseGithubTree";
import { buildRepoMap } from "@/lib/repoMap";
import { useRepoMapSummarize } from "@/hooks/useRepoMapSummarize";
import { useRepoDependencies } from "@/hooks/useRepoDependencies";
import { RepoMapProvider } from "@/context/RepoMapContext";

// ── Static mock data (agents + code explainer) ────────────────────────────────
// These remain unchanged — only the `files` data is now driven by real GitHub data.

const agents = [
  { name: "UI", status: "idle", tone: "pink", description: "Checks layouts and components" },
  { name: "Database", status: "idle", tone: "cyan", description: "Understands your data model" },
  { name: "API", status: "active", tone: "mint", description: "Maps requests and responses" },
  { name: "Review", status: "active", tone: "coral", description: "Reviews code in context" },
  { name: "Security", status: "idle", tone: "pink", description: "Looks for risky patterns" },
  { name: "Validation", status: "idle", tone: "cyan", description: "Checks inputs and edge cases" },
];

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

  // GitHub repo state
  const [repoTree, setRepoTree] = useState(null);    // null = nothing loaded yet
  const [repoMeta, setRepoMeta] = useState(null);    // { owner, repo, branch, fullName, ... }
  const [repoMap, setRepoMap] = useState(null);
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
        agents={agents}
        // Pass the real tree (or null for empty state) instead of the old mock array.
        // DashboardShell forwards this directly to <FileSystemMap nodes={files} />.
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
      />
    </RepoMapProvider>
  );
}
