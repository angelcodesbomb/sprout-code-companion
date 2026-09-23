import { AnimatePresence, motion } from "motion/react";
import { Code2, GitBranch, Search, Settings } from "lucide-react";
import { useState } from "react";
import { SproutMark } from "../shared/SproutMark";
import { ThemeToggle } from "../shared/ThemeToggle";
import { AgentSidebar } from "../agents/AgentSidebar";
import { FileMapGraph } from "../filemap/FileMapGraph";
import { RepoInput } from "../filemap/RepoInput";
// FileSystemMap kept as unused fallback for very large repos or D3 rendering issues
// import { FileSystemMap } from "../filemap/FileSystemMap";
import { CodeExplainer } from "../editor/CodeExplainer";

/**
 * DashboardShell
 *
 * Props (new additions marked with ★):
 *   agents          — array of agent objects
 *   files           — nested tree nodes (null = empty, real array = loaded)  ★ changed: was mock array
 *   repoMeta        — { owner, repo, branch, fullName, truncated } | null    ★ new
 *   isLoadingFiles  — boolean, shows skeleton in FileMap while fetching       ★ new
 *   codeBlocks      — array of code block objects for CodeExplainer
 *   isDark          — boolean
 *   onThemeToggle   — () => void
 *   onRepoLoad      — (flatItems, meta) => void  forwarded to RepoInput       ★ new
 *   onLoadStart     — () => void                 forwarded to RepoInput       ★ new
 */
export function DashboardShell({
  agents,
  files,
  repoMeta,
  isLoadingFiles,
  codeBlocks,
  isDark,
  onThemeToggle,
  onRepoLoad,
  onLoadStart,
}) {  const [view, setView] = useState("map");
  const [activeAgent, setActiveAgent] = useState("Review");

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
        <button className="icon-control" type="button" aria-label="Settings">
          <Settings size={18} />
        </button>
      </header>

      <div className="dashboard-body">
        <AgentSidebar
          agents={agents}
          activeAgent={activeAgent}
          onAgentSelect={setActiveAgent}
        />

        <div className="dashboard-main">
          <div className="workspace-tabs" role="tablist" aria-label="Workspace views">
            <button
              type="button"
              role="tab"
              aria-selected={view === "map"}
              className={view === "map" ? "is-active" : ""}
              onClick={() => setView("map")}
            >
              <GitBranch size={16} /> File map
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "code"}
              className={view === "code" ? "is-active" : ""}
              onClick={() => setView("code")}
            >
              <Code2 size={16} /> Explain code
            </button>
            <span className="workspace-tabs__status">
              <i /> {activeAgent} agent is active
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
              {view === "map" ? (
                <>
                  {/* URL input — always visible in file map tab */}
                  <RepoInput
                    onLoad={onRepoLoad}
                    onLoadStart={onLoadStart}
                    isLoading={isLoadingFiles}
                  />

                  {/* View heading — outside the graph canvas */}
                  <div className="view-heading" style={{ maxWidth: 1120, margin: "0 auto 18px" }}>
                    <div>
                      <span className="mono-label">VISUAL FILE MAP</span>
                      <h2 style={{ fontSize: "clamp(28px,4vw,42px)", marginTop: 5 }}>
                        {repoMeta
                          ? "See how everything connects."
                          : "Paste a repo to see its file map."}
                      </h2>
                      <p style={{ margin: "7px 0 0", color: "var(--muted-foreground)", fontSize: 13 }}>
                        {repoMeta
                          ? "Click any node to explore. Drag or scroll to pan and zoom."
                          : "Enter any public GitHub URL above."}
                      </p>
                    </div>
                    {repoMeta && (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                        <span
                          className="repo-badge"
                          title={repoMeta.fullName ?? `${repoMeta.owner}/${repoMeta.repo}`}
                        >
                          <GitBranch size={10} aria-hidden="true" />
                          <span className="repo-badge__name">
                            {repoMeta.fullName ?? `${repoMeta.owner}/${repoMeta.repo}`}
                          </span>
                          <span>·</span>
                          <span>{repoMeta.branch}</span>
                        </span>
                        {repoMeta.truncated && (
                          <span
                            className="view-heading__badge"
                            style={{ borderColor: "var(--coral)", color: "var(--coral)" }}
                          >
                            ⚠ partial tree
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <FileMapGraph
                    nodes={files}
                    repoMeta={repoMeta}
                    isLoading={isLoadingFiles}
                    isDark={isDark}
                  />
                </>
              ) : (
                <CodeExplainer
                  title="Code, without the code-speak."
                  fileName="useProjectFiles.js"
                  blocks={codeBlocks}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </main>
  );
}
