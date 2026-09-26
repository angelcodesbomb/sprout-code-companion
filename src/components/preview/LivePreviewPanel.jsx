"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  SandpackProvider,
  SandpackPreview,
  SandpackCodeEditor,
  SandpackConsole,
  SandpackLayout,
} from "@codesandbox/sandpack-react";
import { motion, AnimatePresence } from "motion/react";
import {
  Play, Loader2, AlertCircle, Code2, Eye, Trash2, Sparkles,
  Send, CheckCircle2, XCircle, GitBranch, Terminal,
} from "lucide-react";
import { RepoInput } from "../filemap/RepoInput";

// ─── Sandpack scaffold ────────────────────────────────────────────────────────

const PLACEHOLDER_APP = `export default function App() {
  return (
    <div style={{
      display:"flex",flexDirection:"column",alignItems:"center",
      justifyContent:"center",minHeight:"100vh",
      fontFamily:"system-ui,sans-serif",background:"#f7f3ec",color:"#2a2620",
    }}>
      <h1 style={{fontSize:28,fontWeight:700,marginBottom:8}}>Sprout</h1>
      <p style={{opacity:0.55,fontSize:14,textAlign:"center",maxWidth:340}}>
        Describe what you want to build above and hit Run — the orchestrator will
        generate your UI and render it here live.
      </p>
    </div>
  );
}`;

// ─── Export-style detection ───────────────────────────────────────────────────

function detectExportStyle(content) {
  if (/export\s+default\s+(?:function|class|(?:async\s+)?(?:function\s*\*?)?\w)/.test(content)) return "default";
  return "named";
}

/**
 * Build a minimal /App.js that imports and renders all generated components.
 *
 * Fixes vs the old version:
 * - Uses the full normalized Sandpack path (e.g. /components/Button.jsx) not
 *   just the basename, so imports resolve correctly.
 * - Falls back to default import for every file to avoid named-export mismatches
 *   (the most common cause of blank renders).
 * - Skips db/schema.json and db/seed.json — not React components.
 * - If a generated file IS already /App.js or /App.jsx, use it directly instead
 *   of wrapping it.
 */
function buildAppJs(generatedFiles) {
  // If agent produced a file literally named App.js / App.jsx, use it as-is
  const appEntry =
    generatedFiles["/App.jsx"] ??
    generatedFiles["/App.js"] ??
    generatedFiles["/app.jsx"] ??
    generatedFiles["/app.js"];
  if (appEntry) return appEntry;

  // Filter to only React-renderable files
  const entries = Object.entries(generatedFiles).filter(([p]) => {
    const lower = p.toLowerCase();
    if (!/\.(jsx?|tsx?)$/.test(lower)) return false;
    const base = p.split("/").pop().replace(/\.[^.]+$/, "").toLowerCase();
    return base !== "index" && base !== "db" && !base.startsWith("db.");
  });

  if (!entries.length) return null;

  const imports = entries.map(([p, content], i) => {
    const id = `Comp${i}`;
    // Always try default import first; fall back to namespace import
    if (detectExportStyle(content) === "default") {
      return `import ${id} from "${p}";`;
    }
    // For named exports, try to find the exported name and use it directly
    const namedMatch = content.match(/export\s+(?:function|class|const)\s+([A-Z][a-zA-Z0-9]*)/);
    if (namedMatch) {
      return `import { ${namedMatch[1]} as ${id} } from "${p}";`;
    }
    return `import * as ${id}Mod from "${p}";\nconst ${id} = ${id}Mod.default ?? Object.values(${id}Mod)[0] ?? (() => null);`;
  }).join("\n");

  const renders = entries.map((_, i) => `  <Comp${i} />`).join("\n");

  return `import React from "react";\n${imports}\n\nexport default function App() {\n  return (\n    <div>\n${renders}\n    </div>\n  );\n}`;
}

// ─── Normalise agent file path → absolute Sandpack path ──────────────────────
// Preserves directory structure (e.g. src/components/Foo.jsx → /src/components/Foo.jsx)
// so relative imports between files can resolve.
function normalizePath(path) {
  return path.startsWith("/") ? path : `/${path}`;
}

// ─── Pipeline step pill ───────────────────────────────────────────────────────

const TOOL_LABELS = {
  map_parser_load_cache:   "Loading map",
  map_parser_refresh:      "Refreshing map",
  ui_agent_generate:       "UI Agent",
  api_agent_generate:      "API Agent",
  monitor_review_output:   "Monitor",
  security_review_output:  "Security",
  live_preview_sync:       "Live Preview",
  github_propose_push:     "GitHub Push",
  github_propose_init_repo:"GitHub Init",
  github_confirm_human_action: "Confirming",
};

function StepPill({ step, isLive }) {
  const label = TOOL_LABELS[step.toolName] ?? step.toolName ?? step.agent ?? "Step";
  const ok    = step.result?.ok !== false;
  return (
    <motion.div
      className={`orch-step-pill ${isLive ? "is-live" : ""} ${ok ? "" : "is-fail"}`}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.18 }}
    >
      <span className="orch-step-pill__icon">
        {isLive
          ? <Loader2 size={11} className="lp-status-badge__spin" />
          : ok
            ? <CheckCircle2 size={11} />
            : <XCircle size={11} />}
      </span>
      <span className="orch-step-pill__label">{label}</span>
    </motion.div>
  );
}

// ─── File tabs ────────────────────────────────────────────────────────────────

function FileTabs({ files, activeFile, onSelect }) {
  const names = Object.keys(files).filter((p) => p !== "/index.js" && p !== "/App.js");
  if (!names.length) return null;
  return (
    <div className="lp-file-tabs" role="tablist" aria-label="Generated files">
      {names.map((path) => (
        <button key={path} type="button" role="tab"
          aria-selected={activeFile === path}
          className={`lp-file-tab ${activeFile === path ? "is-active" : ""}`}
          onClick={() => onSelect(path)}>
          {path.split("/").pop()}
        </button>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * LivePreviewPanel
 *
 * Two generation modes:
 *  A) Orchestrator-driven: when `orchFiles` prop changes, Sandpack updates automatically.
 *     The orchestrator prompt bar at the top handles this path.
 *  B) Manual (standalone): the user types a task directly in the panel and hits Generate.
 *     Uses /api/agents/ui/stream directly — no orchestrator overhead.
 *
 * Props:
 *   repoMap           — workspace repoMap (optional context for manual mode)
 *   isDark            — boolean
 *   orchFiles         — { files, summary, artifactId } | null  (from orchestrator)
 *   orchStatus        — "idle"|"running"|"done"|"error"
 *   orchSteps         — Step[]
 *   orchCurrentTool   — string | null
 *   orchFinalAnswer   — string | null
 *   orchError         — string | null
 *   onOrchestratorRun — (goal: string) => void
 */
export function LivePreviewPanel({
  repoMap,
  repoMeta,
  isDark,
  orchFiles        = null,
  orchStatus       = "idle",
  orchSteps        = [],
  orchCurrentTool  = null,
  orchFinalAnswer  = null,
  orchError        = null,
  onOrchestratorRun,
  onRepoLoad,
  onLoadStart,
  isLoadingRepo    = false,
}) {
  // ── Orchestrator prompt bar state ─────────────────────────────────────────
  const [orchGoal, setOrchGoal] = useState("");

  // ── Sandpack file state ───────────────────────────────────────────────────
  const [generatedFiles, setGeneratedFiles] = useState({});
  const [sandpackKey,    setSandpackKey]    = useState(0);
  const [activeFile,     setActiveFile]     = useState(null);
  const [previewSummary, setPreviewSummary] = useState("");
  const [panelMode,      setPanelMode]      = useState("preview");

  // ── Manual (standalone) generation state ─────────────────────────────────
  const [manualTask,    setManualTask]    = useState("");
  const [manualSpec,    setManualSpec]    = useState("");
  const [showSpec,      setShowSpec]      = useState(false);
  const [manualStatus,  setManualStatus]  = useState("idle");
  const [manualMessage, setManualMessage] = useState("");
  const [manualError,   setManualError]   = useState(null);
  const [manualCount,   setManualCount]   = useState(0);
  const abortRef    = useRef(null);
  const firstFile   = useRef(null);

  // ── Sync Sandpack when orchestrator sends files ───────────────────────────
  useEffect(() => {
    if (!orchFiles?.files?.length) return;

    const next = {};
    let first = null;
    for (const f of orchFiles.files) {
      const sp = normalizePath(f.path);
      next[sp] = f.content;
      if (!first) first = sp;
    }

    setGeneratedFiles(next);
    setActiveFile(first);
    setSandpackKey((k) => k + 1);
    setPreviewSummary(orchFiles.summary ?? "");
    // Clear any manual error when orchestrator succeeds
    setManualError(null);
  }, [orchFiles]);

  // ── Manual generation ─────────────────────────────────────────────────────
  const handleManualGenerate = useCallback(async () => {
    if (!manualTask.trim() || manualStatus === "streaming") return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    firstFile.current = null;

    setManualStatus("streaming");
    setManualError(null);
    setManualMessage("Connecting…");
    setManualCount(0);
    setGeneratedFiles({});
    setActiveFile(null);
    setPreviewSummary("");

    const collected = {};
    let count = 0;

    try {
      const res = await fetch("/api/agents/ui/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          task: manualTask.trim(),
          spec: manualSpec.trim() || undefined,
          mapSnapshot: repoMap ?? null,
        }),
      });

      if (!res.ok) throw new Error(`Server error ${res.status}`);

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const lines = chunk.split("\n");
          let event = "message", dataStr = "";
          for (const line of lines) {
            if (line.startsWith("event: "))     event   = line.slice(7).trim();
            else if (line.startsWith("data: ")) dataStr = line.slice(6).trim();
          }
          if (!dataStr) continue;
          let data;
          try { data = JSON.parse(dataStr); } catch { continue; }

          if (event === "status") {
            setManualMessage(data.message ?? "");
          } else if (event === "file") {
            const sp = normalizePath(data.path);
            collected[sp] = data.content;
            if (!firstFile.current) firstFile.current = sp;
            count++;
            setManualCount(count);
            setManualMessage(`Writing ${sp.slice(1)}…`);
          } else if (event === "summary") {
            setPreviewSummary(data.text ?? "");
          } else if (event === "done") {
            setGeneratedFiles({ ...collected });
            setActiveFile(firstFile.current);
            setSandpackKey((k) => k + 1);
            setManualStatus("done");
            setManualMessage("");
          } else if (event === "error") {
            throw new Error(data.error ?? "Generation failed.");
          }
        }
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        setManualError(err.message);
        setManualStatus("error");
      } else {
        setManualStatus("idle");
      }
    }
  }, [manualTask, manualSpec, repoMap, manualStatus]);

  const handleClear = () => {
    abortRef.current?.abort();
    setGeneratedFiles({});
    setActiveFile(null);
    setManualStatus("idle");
    setManualError(null);
    setPreviewSummary("");
    setManualCount(0);
    setManualMessage("");
    setSandpackKey((k) => k + 1);
  };

  // ── Assemble Sandpack file map ────────────────────────────────────────────
  const appJs = buildAppJs(generatedFiles) ?? PLACEHOLDER_APP;
  const sandpackFiles = {
    "/App.js": appJs,
    ...generatedFiles,
    "/index.js": [
      `import React from "react";`,
      `import { createRoot } from "react-dom/client";`,
      `import App from "./App.js";`,
      `createRoot(document.getElementById("root")).render(<App />);`,
    ].join("\n"),
  };

  const isOrchRunning  = orchStatus === "running";
  const hasFiles       = Object.keys(generatedFiles).length > 0;
  const isManualStream = manualStatus === "streaming";

  return (
    <div className="lp-panel">

      {/* ══ REPO CONTEXT BAR ════════════════════════════════════════════════ */}
      <div className="lp-repo-bar">
        <div className="lp-repo-bar__label">
          <GitBranch size={13} aria-hidden="true" />
          <span>REPO CONTEXT</span>
        </div>
        {repoMeta ? (
          <div className="lp-repo-bar__loaded">
            <span className="lp-repo-bar__name">
              {repoMeta.fullName ?? `${repoMeta.owner}/${repoMeta.repo}`}
            </span>
            <span className="lp-repo-bar__branch">@ {repoMeta.branch}</span>
            <span className="lp-repo-bar__hint">
              — repo map loaded, orchestrator has full context
            </span>
          </div>
        ) : (
          <div className="lp-repo-bar__input">
            <RepoInput
              onLoad={onRepoLoad}
              onLoadStart={onLoadStart}
              isLoading={isLoadingRepo}
            />
            <p className="lp-repo-bar__skip">
              Or skip this — the orchestrator will create a new repo automatically.
            </p>
          </div>
        )}
      </div>

      {/* ══ ORCHESTRATOR COMMAND BAR ════════════════════════════════════════ */}
      <div className="orch-command-bar">
        <div className="orch-command-bar__inner">

          {/* Prompt input */}
          <div className="orch-command-bar__prompt-wrap">
            <div className="orch-command-bar__label">ORCHESTRATOR</div>
            <div className="orch-command-bar__input-row">
              <textarea
                className="orch-command-bar__input"
                rows={2}
                placeholder="Describe what you want to build — the orchestrator will plan, generate, and review it…"
                value={orchGoal}
                onChange={(e) => setOrchGoal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && orchGoal.trim() && !isOrchRunning) {
                    onOrchestratorRun?.(orchGoal.trim());
                  }
                }}
                disabled={isOrchRunning}
                aria-label="Orchestrator goal"
              />
              <motion.button
                type="button"
                className="orch-command-bar__run-btn"
                disabled={!orchGoal.trim() || isOrchRunning}
                onClick={() => onOrchestratorRun?.(orchGoal.trim())}
                whileHover={orchGoal.trim() && !isOrchRunning ? { scale: 1.04, y: -1 } : {}}
                whileTap={{ scale: 0.97 }}
                transition={{ type: "spring", stiffness: 420, damping: 22 }}
                aria-label="Run orchestrator"
              >
                {isOrchRunning
                  ? <Loader2 size={15} className="lp-status-badge__spin" />
                  : <Send size={15} />}
                <span>{isOrchRunning ? "Running…" : "Run"}</span>
              </motion.button>
            </div>
          </div>

          {/* Pipeline step pills */}
          {(isOrchRunning || orchSteps.length > 0) && (
            <div className="orch-command-bar__pipeline" aria-label="Pipeline progress">
              <AnimatePresence initial={false}>
                {orchSteps.map((s, i) => (
                  <StepPill
                    key={s.step ?? i}
                    step={s}
                    isLive={false}
                  />
                ))}
                {isOrchRunning && orchCurrentTool && (
                  <StepPill
                    key="live"
                    step={{ toolName: orchCurrentTool }}
                    isLive
                  />
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Final answer / error */}
          {orchStatus === "done" && orchFinalAnswer && (
            <motion.p
              className="orch-command-bar__answer"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
            >
              {orchFinalAnswer}
            </motion.p>
          )}
          {orchStatus === "error" && orchError && (
            <p className="orch-command-bar__error">
              <AlertCircle size={12} /> {orchError}
            </p>
          )}
        </div>
      </div>

      {/* ══ DIVIDER ══════════════════════════════════════════════════════════ */}
      <div className="lp-section-divider">
        <span>— or generate manually —</span>
      </div>

      {/* ══ MANUAL TASK INPUT ════════════════════════════════════════════════ */}
      <div className="lp-input-area">
        <div className="lp-input-row">
          <textarea
            className="lp-task-input"
            rows={2}
            placeholder='Quick generate — bypass the orchestrator, e.g. "A pricing card with three tiers"'
            value={manualTask}
            onChange={(e) => setManualTask(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleManualGenerate(); }}
            disabled={isManualStream || isOrchRunning}
            aria-label="Manual UI task"
          />
          <div className="lp-input-actions">
            <button type="button" className="lp-spec-toggle"
              onClick={() => setShowSpec((v) => !v)} aria-expanded={showSpec}>
              <Sparkles size={13} />
              <span>{showSpec ? "Hide spec" : "Add spec"}</span>
            </button>
            <motion.button type="button" className="lp-generate-btn"
              onClick={handleManualGenerate}
              disabled={!manualTask.trim() || isManualStream || isOrchRunning}
              whileHover={manualTask.trim() && !isManualStream && !isOrchRunning ? { scale: 1.03, y: -1 } : {}}
              whileTap={{ scale: 0.97 }}
              transition={{ type: "spring", stiffness: 420, damping: 22 }}
              aria-label="Generate">
              {isManualStream
                ? <Loader2 size={14} className="lp-status-badge__spin" />
                : <Play size={14} />}
              <span>{isManualStream ? "Generating…" : "Generate"}</span>
            </motion.button>
          </div>
        </div>

        <AnimatePresence>
          {showSpec && (
            <motion.div
              initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }}
              style={{ overflow: "hidden" }}>
              <textarea className="lp-spec-input" rows={2}
                placeholder="Extra requirements — colours, fonts, behaviour…"
                value={manualSpec} onChange={(e) => setManualSpec(e.target.value)}
                disabled={isManualStream} aria-label="Extra spec" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ══ STATUS / META BAR ════════════════════════════════════════════════ */}
      <div className="lp-meta-bar">
        {isManualStream && (
          <span className="lp-status-badge" style={{ "--badge-color": "var(--coral)" }}>
            <Loader2 size={10} className="lp-status-badge__spin" />
            {manualMessage || "Generating…"}
          </span>
        )}
        {!isManualStream && manualStatus === "done" && (
          <span className="lp-status-badge" style={{ "--badge-color": "var(--mint)" }}>
            {manualCount} file{manualCount !== 1 ? "s" : ""} built
          </span>
        )}
        {!isManualStream && orchFiles && orchStatus !== "idle" && (
          <span className="lp-status-badge" style={{ "--badge-color": "var(--mint)" }}>
            Orchestrator built {orchFiles.files?.length ?? 0} file{orchFiles.files?.length !== 1 ? "s" : ""}
          </span>
        )}
        {previewSummary && <span className="lp-summary">{previewSummary}</span>}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button type="button" className={`lp-mode-btn ${panelMode === "preview" ? "is-active" : ""}`}
            onClick={() => setPanelMode("preview")} title="Preview">
            <Eye size={13} />
          </button>
          <button type="button" className={`lp-mode-btn ${panelMode === "code" ? "is-active" : ""}`}
            onClick={() => setPanelMode("code")} title="View code">
            <Code2 size={13} />
          </button>
          <button type="button" className={`lp-mode-btn ${panelMode === "console" ? "is-active" : ""}`}
            onClick={() => setPanelMode("console")} title="Console (debug errors)">
            <Terminal size={13} />
          </button>
          {hasFiles && (
            <button type="button" className="lp-mode-btn" onClick={handleClear} title="Clear">
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {manualError && (
        <div className="lp-error" role="alert">
          <AlertCircle size={13} /><span>{manualError}</span>
        </div>
      )}

      <FileTabs files={sandpackFiles} activeFile={activeFile} onSelect={setActiveFile} />

      {/* ══ SANDPACK ═════════════════════════════════════════════════════════ */}
      <div className={`lp-sandpack-wrap${(isManualStream || isOrchRunning) ? " is-generating" : ""}`}>
        <SandpackProvider
          key={sandpackKey}
          template="react"
          theme={isDark ? "dark" : "light"}
          files={sandpackFiles}
          options={{
            activeFile: activeFile ?? "/App.js",
            visibleFiles: Object.keys(sandpackFiles).filter((p) => p !== "/index.js"),
            recompileMode: "delayed",
            recompileDelay: 300,
          }}
          customSetup={{ dependencies: { react: "^18.0.0", "react-dom": "^18.0.0" } }}
        >
          <SandpackLayout>
            {panelMode === "code" ? (
              <SandpackCodeEditor showTabs={false} showLineNumbers showInlineErrors wrapContent style={{ height: 520, fontSize: 12 }} />
            ) : panelMode === "console" ? (
              <SandpackConsole style={{ height: 520, fontSize: 12 }} />
            ) : (
              <SandpackPreview showNavigator={false} showRefreshButton showOpenInCodeSandbox={false} style={{ height: 520 }} />
            )}
          </SandpackLayout>
        </SandpackProvider>
      </div>
    </div>
  );
}
