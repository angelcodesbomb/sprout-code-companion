"use client";

/**
 * HistorySidebar
 *
 * A collapsible right-side panel that shows the version history of orchestrator
 * runs for the currently loaded repo. Mirrors the AgentSidebar visual language:
 * same card style, mono labels, organic border radii, design token colours.
 *
 * Props:
 *   runs          — from useRunHistory(repoKey).runs
 *   currentSteps  — live orchSteps[] for the run in progress
 *   currentGoal   — the goal string currently in the textarea
 *   orchStatus    — "idle" | "running" | "done" | "error"
 *   onDeleteRun   — (id: string) => void
 *   onClearAll    — () => void
 *   onReplayGoal  — (goal: string) => void  — pre-fills the orchestrator input
 */

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  History, ChevronLeft, ChevronRight, Trash2, RotateCcw,
  CheckCircle2, XCircle, Clock, FileCode2, Sparkles, ChevronsRight,
} from "lucide-react";

const TOOL_LABELS = {
  github_read_repo:            "Read Repo",
  github_propose_init_repo:    "GitHub Init",
  github_propose_push:         "GitHub Push",
  github_confirm_human_action: "Confirm",
  map_parser_load_cache:       "Load Map",
  map_parser_refresh:          "Refresh Map",
  db_agent_design_schema:      "DB Schema",
  ui_agent_generate:           "UI Agent",
  api_agent_generate:          "API Agent",
  monitor_review_output:       "Monitor",
  security_review_output:      "Security",
  live_preview_sync:           "Live Preview",
};

const TOOL_TONE = {
  github_read_repo:            "coral",
  github_propose_init_repo:    "coral",
  github_propose_push:         "coral",
  github_confirm_human_action: "coral",
  map_parser_load_cache:       "cyan",
  map_parser_refresh:          "cyan",
  db_agent_design_schema:      "cyan",
  ui_agent_generate:           "pink",
  api_agent_generate:          "mint",
  monitor_review_output:       "mint",
  security_review_output:      "mint",
  live_preview_sync:           "pink",
};

function relativeTime(isoString) {
  if (!isoString) return "";
  const diff = Date.now() - new Date(isoString).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  <  1) return "just now";
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

// ─── Single step row ──────────────────────────────────────────────────────────

function StepRow({ step, isLive = false }) {
  const label = TOOL_LABELS[step.toolName] ?? step.agent ?? step.toolName ?? "Step";
  const tone  = TOOL_TONE[step.toolName] ?? "cyan";
  const ok    = step.ok !== false && step.result?.ok !== false;

  return (
    <div className={`hs-step-row ${isLive ? "is-live" : ""} ${!ok ? "is-fail" : ""}`}>
      <span className={`hs-step-row__dot hs-step-row__dot--${tone}`}>
        {isLive
          ? <Clock size={9} />
          : ok
            ? <CheckCircle2 size={9} />
            : <XCircle size={9} />}
      </span>
      <span className="hs-step-row__label">{label}</span>
    </div>
  );
}

// ─── Expanded run card ────────────────────────────────────────────────────────

function RunCard({ run, onDelete, onReplay }) {
  const [expanded, setExpanded] = useState(false);
  const stepsFailed = run.steps?.filter((s) => !s.ok).length ?? 0;

  return (
    <div className="hs-run-card">
      {/* Header row — always visible */}
      <button
        type="button"
        className="hs-run-card__header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="hs-run-card__chevron" aria-hidden="true">
          <ChevronsRight size={11} style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 180ms" }} />
        </span>
        <div className="hs-run-card__meta">
          <span className="hs-run-card__goal">{run.goal}</span>
          <span className="hs-run-card__time">
            {relativeTime(run.ranAt)} · {run.stepCount} step{run.stepCount !== 1 ? "s" : ""}
            {stepsFailed > 0 && <span className="hs-run-card__fail-badge"> · {stepsFailed} failed</span>}
          </span>
        </div>
      </button>

      {/* Expanded detail */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            className="hs-run-card__body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: "hidden" }}
          >
            {/* Steps */}
            {run.steps?.length > 0 && (
              <div className="hs-run-card__steps">
                {run.steps.map((s, i) => (
                  <StepRow key={i} step={s} />
                ))}
              </div>
            )}

            {/* Final answer */}
            {run.finalAnswer && (
              <p className="hs-run-card__answer">{run.finalAnswer}</p>
            )}

            {/* Files generated */}
            {run.filesGenerated?.length > 0 && (
              <div className="hs-run-card__files">
                <span className="hs-run-card__files-label">
                  <FileCode2 size={10} /> {run.filesGenerated.length} file{run.filesGenerated.length !== 1 ? "s" : ""}
                </span>
                <ul className="hs-run-card__files-list">
                  {run.filesGenerated.map((f, i) => (
                    <li key={i} className="hs-run-card__file">{f}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Actions */}
            <div className="hs-run-card__actions">
              <button
                type="button"
                className="hs-run-card__action-btn"
                onClick={() => onReplay?.(run.goal)}
                title="Re-run this goal"
              >
                <RotateCcw size={11} />
                <span>Re-run</span>
              </button>
              <button
                type="button"
                className="hs-run-card__action-btn hs-run-card__action-btn--danger"
                onClick={() => onDelete?.(run.id)}
                title="Delete this run"
              >
                <Trash2 size={11} />
                <span>Delete</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main sidebar ─────────────────────────────────────────────────────────────

export function HistorySidebar({
  runs          = [],
  currentSteps  = [],
  currentGoal   = "",
  orchStatus    = "idle",
  onDeleteRun,
  onClearAll,
  onReplayGoal,
}) {
  const [open, setOpen] = useState(true);
  const isRunning = orchStatus === "running";

  return (
    <div className={`history-sidebar ${open ? "is-open" : "is-collapsed"}`}>

      {/* ── Toggle button ───────────────────────────────────────────────── */}
      <button
        type="button"
        className="history-sidebar__toggle"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Collapse history panel" : "Expand history panel"}
        aria-expanded={open}
      >
        <History size={14} />
        {open
          ? <ChevronRight size={12} />
          : <ChevronLeft  size={12} />}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="history-sidebar__body"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.2 }}
          >
            {/* Header */}
            <div className="history-sidebar__head">
              <span className="agent-sidebar__label" style={{ margin: 0 }}>
                VERSION HISTORY
              </span>
              {runs.length > 0 && (
                <button
                  type="button"
                  className="history-sidebar__clear-btn"
                  onClick={onClearAll}
                  title="Clear all history for this repo"
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>

            {/* Live run — shown while orchestrator is active */}
            {isRunning && currentSteps.length > 0 && (
              <div className="hs-live-run">
                <div className="hs-live-run__header">
                  <span className="agent-sidebar__running-dot" />
                  <span className="hs-live-run__label">RUNNING</span>
                  {currentGoal && (
                    <span className="hs-live-run__goal">{currentGoal}</span>
                  )}
                </div>
                <div className="hs-run-card__steps">
                  {currentSteps.map((s, i) => (
                    <StepRow
                      key={i}
                      step={s}
                      isLive={i === currentSteps.length - 1}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Past runs */}
            {runs.length === 0 && !isRunning ? (
              <div className="history-sidebar__empty">
                <Sparkles size={22} style={{ opacity: 0.35 }} />
                <p>
                  No runs yet.
                  <br />
                  <span style={{ opacity: 0.6 }}>
                    Completed orchestrator runs will appear here, linked to this repo.
                  </span>
                </p>
              </div>
            ) : (
              <div className="history-sidebar__runs">
                {runs.map((run) => (
                  <RunCard
                    key={run.id}
                    run={run}
                    onDelete={onDeleteRun}
                    onReplay={onReplayGoal}
                  />
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
