import { AnimatePresence, motion } from "motion/react";
import { Code2, GitBranch, Search, Settings, LogIn, LogOut } from "lucide-react";
import { useState, useEffect } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import { SproutMark } from "../shared/SproutMark";
import { ThemeToggle } from "../shared/ThemeToggle";
import { AgentSidebar } from "../agents/AgentSidebar";
import { FileMapGraph } from "../filemap/FileMapGraph";
import { RepoInput } from "../filemap/RepoInput";
import { RepoMapCopyBar } from "../filemap/RepoMapCopyBar";
import { RepoMapAskBar } from "../filemap/RepoMapAskBar";
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
}) {
  const [view, setView] = useState("map");
  const [activeAgent, setActiveAgent] = useState("Review");
  const { data: session, status } = useSession();

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

        {/* GitHub auth button */}
        {status === "loading" ? null : session ? (
          <div className="gh-auth-chip">
            {session.user?.image && (
              <img
                src={session.user.image}
                alt={session.user.name ?? "GitHub avatar"}
                className="gh-auth-chip__avatar"
              />
            )}
            <span className="gh-auth-chip__name">{session.user?.name ?? session.user?.login}</span>
            <button
              type="button"
              className="gh-auth-chip__btn"
              onClick={() => signOut()}
              aria-label="Sign out of GitHub"
              title="Sign out"
            >
              <LogOut size={14} />
            </button>
          </div>
        ) : (
          <motion.button
            type="button"
            className="gh-signin-btn"
            onClick={() => signIn("github")}
            whileHover={{ scale: 1.03, y: -1 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: "spring", stiffness: 400, damping: 22 }}
            aria-label="Sign in with GitHub to access private repos"
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
                          ? "Hover for a quick line. Click for pointers. Double-click a folder to focus it."
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

                  {repoMeta && <RepoMapCopyBar />}

                  <FileMapGraph
                    nodes={files}
                    repoMeta={repoMeta}
                    isLoading={isLoadingFiles}
                    isDark={isDark}
                  />

                  {/* Ask-bar — only shown once a repo is loaded */}
                  <RepoMapAskBar repoMeta={repoMeta} />
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
