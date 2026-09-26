import { AnimatePresence, motion } from "motion/react";
import { Code2, GitBranch, Search, Settings, LogOut, Layers } from "lucide-react";
import { useState, useEffect } from "react";
import { useSession, signIn, signOut } from "@/hooks/useSession";
import { SproutMark } from "../shared/SproutMark";
import { ThemeToggle } from "../shared/ThemeToggle";
import { AgentSidebar } from "../agents/AgentSidebar";
import { FileMapGraph } from "../filemap/FileMapGraph";
import { RepoInput } from "../filemap/RepoInput";
import { RepoMapCopyBar } from "../filemap/RepoMapCopyBar";
import { RepoMapAskBar } from "../filemap/RepoMapAskBar";
import { CodeExplainer } from "../editor/CodeExplainer";
import { LivePreviewPanel } from "../preview/LivePreviewPanel";
import { HistorySidebar } from "../history/HistorySidebar";

export function DashboardShell({
  files,
  repoMeta,
  isLoadingFiles,
  codeBlocks,
  isDark,
  onThemeToggle,
  onRepoLoad,
  onLoadStart,
  depEdges,
  depEdgesByPath,
  depStatus,
  orchStatus,
  orchSteps,
  orchCurrentTool,
  orchFinalAnswer,
  orchError,
  orchFiles,
  onOrchestratorRun,
  // ── History sidebar props ─────────────────────────────────────────────
  historyRuns       = [],
  onDeleteRun,
  onClearHistory,
  onReplayGoal,
}) {
  const [view, setView] = useState("build"); // default to build so orchestrator is front-and-centre
  const [activeAgent, setActiveAgent] = useState(null);

  // ── Auto-switch to build tab when orchestrator produces UI files ──────────
  useEffect(() => {
    if (orchFiles?.files?.length) setView("build");
  }, [orchFiles]);

  // ── Explain-file bridge ───────────────────────────────────────────────────
  const [explainCode,      setExplainCode]      = useState("");
  const [explainFileName,  setExplainFileName]  = useState("");
  const [explainError,     setExplainError]     = useState(null);
  const [explainTruncated, setExplainTruncated] = useState(false);
  const [isFetchingFile,   setIsFetchingFile]   = useState(false);

  function handleExplainFile({ code = "", fileName = "", error = null, truncated = false }) {
    setExplainCode(code);
    setExplainFileName(fileName);
    setExplainError(error);
    setExplainTruncated(truncated);
    setIsFetchingFile(false);
    setView("code");
  }

  function handleFetchingFile(fileName) {
    setIsFetchingFile(true);
    setExplainError(null);
    setExplainCode("");
    setExplainFileName(fileName);
    setExplainTruncated(false);
    setView("code");
  }

  const { data: session, status: sessionStatus } = useSession();

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "/" && e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") {
        e.preventDefault();
        document.getElementById("repo-map-ask-input")?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <main className="dashboard-shell">
      <header className="dashboard-topbar">
        <a href="/" className="dashboard-topbar__brand">
          <SproutMark />
        </a>
        <div className="project-chip">
          <span>SP</span>
          <div>
            <small>CURRENT PROJECT</small>
            <strong>
              {repoMeta
                ? repoMeta.fullName ?? `${repoMeta.owner}/${repoMeta.repo}`
                : "sprout-app"}
            </strong>
          </div>
        </div>
        <label className="dashboard-search">
          <Search size={15} />
          <input aria-label="Search project" placeholder="Search project…" />
        </label>
        <ThemeToggle isDark={isDark} onToggle={onThemeToggle} />

        {sessionStatus === "loading" ? null : session ? (
          <div className="gh-auth-chip">
            {session.user?.avatarUrl && (
              <img src={session.user.avatarUrl} alt={session.user.name ?? "avatar"} className="gh-auth-chip__avatar" />
            )}
            <span className="gh-auth-chip__name">{session.user?.name ?? session.user?.login}</span>
            <button type="button" className="gh-auth-chip__btn" onClick={() => signOut()} aria-label="Sign out">
              <LogOut size={14} />
            </button>
          </div>
        ) : (
          <motion.button
            type="button"
            className="gh-signin-btn"
            onClick={() => signIn()}
            whileHover={{ scale: 1.03, y: -1 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: "spring", stiffness: 400, damping: 22 }}
            aria-label="Sign in with GitHub"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor" width={15} height={15}>
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
            </svg>
            <span>Sign in with GitHub</span>
          </motion.button>
        )}

        <button className="icon-control" type="button" aria-label="Settings">
          <Settings size={18} />
        </button>
      </header>

      <div className="dashboard-body">
        <AgentSidebar
          activeAgent={activeAgent}
          onAgentSelect={setActiveAgent}
          activeView={view}
          onViewSelect={setView}
          orchStatus={orchStatus}
          orchSteps={orchSteps}
          orchCurrentTool={orchCurrentTool}
        />

        <div className="dashboard-main">
          <div className="workspace-tabs" role="tablist" aria-label="Workspace views">
            <button type="button" role="tab" aria-selected={view === "build"}
              className={view === "build" ? "is-active" : ""} onClick={() => setView("build")}>
              <Layers size={16} /> Build
            </button>
            <button type="button" role="tab" aria-selected={view === "map"}
              className={view === "map" ? "is-active" : ""} onClick={() => setView("map")}>
              <GitBranch size={16} /> File map
            </button>
            <button type="button" role="tab" aria-selected={view === "code"}
              className={view === "code" ? "is-active" : ""} onClick={() => setView("code")}>
              <Code2 size={16} /> Explain code
            </button>
            <span className="workspace-tabs__status">
              <i /> {activeAgent ? `${activeAgent} agent active` : "No agent selected"}
            </span>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              className="workspace-view"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22 }}
            >
              {view === "build" ? (
                <LivePreviewPanel
                  repoMap={null}
                  repoMeta={repoMeta}
                  isDark={isDark}
                  orchFiles={orchFiles}
                  orchStatus={orchStatus}
                  orchSteps={orchSteps}
                  orchCurrentTool={orchCurrentTool}
                  orchFinalAnswer={orchFinalAnswer}
                  orchError={orchError}
                  onOrchestratorRun={onOrchestratorRun}
                  onRepoLoad={onRepoLoad}
                  onLoadStart={onLoadStart}
                  isLoadingRepo={isLoadingFiles}
                />
              ) : view === "map" ? (
                <>
                  <RepoInput onLoad={onRepoLoad} onLoadStart={onLoadStart} isLoading={isLoadingFiles} />
                  <div className="view-heading" style={{ maxWidth: 1120, margin: "0 auto 18px" }}>
                    <div>
                      <span className="mono-label">VISUAL FILE MAP</span>
                      <h2 style={{ fontSize: "clamp(28px,4vw,42px)", marginTop: 5 }}>
                        {repoMeta ? "See how everything connects." : "Paste a repo to see its file map."}
                      </h2>
                      <p style={{ margin: "7px 0 0", color: "var(--muted-foreground)", fontSize: 13 }}>
                        {repoMeta
                          ? "Hover for a quick line. Click for details. Double-click a folder to focus it."
                          : "Enter any public GitHub URL above."}
                      </p>
                    </div>
                    {repoMeta && (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                        <span className="repo-badge" title={repoMeta.fullName}>
                          <GitBranch size={10} aria-hidden="true" />
                          <span className="repo-badge__name">{repoMeta.fullName ?? `${repoMeta.owner}/${repoMeta.repo}`}</span>
                          <span>·</span>
                          <span>{repoMeta.branch}</span>
                        </span>
                        {repoMeta.truncated && (
                          <span className="view-heading__badge" style={{ borderColor: "var(--coral)", color: "var(--coral)" }}>
                            ⚠ partial tree
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {repoMeta && <RepoMapCopyBar />}
                  <FileMapGraph
                    nodes={files} repoMeta={repoMeta} isLoading={isLoadingFiles} isDark={isDark}
                    edges={depEdges} edgesByPath={depEdgesByPath} depStatus={depStatus}
                    onExplainFile={handleExplainFile} onFetchingFile={handleFetchingFile}
                  />
                  <RepoMapAskBar repoMeta={repoMeta} />
                </>
              ) : (
                <CodeExplainer
                  title="Code, without the code-speak."
                  fileName="useProjectFiles.js"
                  blocks={codeBlocks}
                  initialCode={explainCode}
                  autoLoadedFrom={explainFileName}
                  autoLoadError={explainError}
                  isFetchingFile={isFetchingFile}
                  truncated={explainTruncated}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <HistorySidebar
          runs={historyRuns}
          currentSteps={orchSteps}
          currentGoal=""
          orchStatus={orchStatus}
          onDeleteRun={onDeleteRun}
          onClearAll={onClearHistory}
          onReplayGoal={onReplayGoal}
        />
      </div>
    </main>
  );
}
