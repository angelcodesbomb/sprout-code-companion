"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { Loader2, Play } from "lucide-react";
import { AgentCardRow } from "./agents/AgentCardRow";
import {
  stepToDisplayAgent,
  getPipelineAgent,
  resolveLiveAgentName,
  toolToDisplayAgent,
} from "@/lib/orchestrator/agentDisplay";

export function OrchestratorStatus({
  goal: externalGoal,
  status = "idle",
  currentTool = null,
  steps = [],
  finalAnswer = null,
  error = null,
  onRun,
}) {
  const [inputGoal, setInputGoal] = useState(externalGoal ?? "");
  const stepsScrollRef = useRef(null);

  useEffect(() => {
    const el = stepsScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [steps.length, currentTool]);

  useEffect(() => {
    if (externalGoal != null) setInputGoal(externalGoal);
  }, [externalGoal]);

  const liveAgentName = useMemo(
    () => resolveLiveAgentName(steps, currentTool, status),
    [steps, currentTool, status]
  );

  function handleSubmit(e) {
    e.preventDefault();
    if (!inputGoal.trim() || status === "running") return;
    onRun?.(inputGoal.trim());
  }

  const isRunning = status === "running";
  const isDone = status === "done";
  const isError = status === "error";

  const runningAgentName =
    isRunning && currentTool ? toolToDisplayAgent(currentTool) : null;

  return (
    <section className="orch-panel" aria-label="Orchestrator">
      <div className="orch-panel__header">
        <span className="agent-sidebar__label">ORCHESTRATOR</span>
        <span className={`orch-panel__status orch-panel__status--${status}`}>
          {isRunning && <Loader2 size={10} className="orch-panel__spinner" aria-hidden="true" />}
          {status}
        </span>
      </div>

      <form onSubmit={handleSubmit} className="orch-panel__form">
        <textarea
          value={inputGoal}
          onChange={(e) => setInputGoal(e.target.value)}
          placeholder="Ask the orchestrator…"
          disabled={isRunning}
          rows={2}
          className="orch-panel__input"
          aria-label="Orchestrator goal"
        />
        <button
          type="submit"
          disabled={isRunning || !inputGoal.trim()}
          className="orch-panel__run"
        >
          {isRunning ? (
            <>
              <Loader2 size={12} className="orch-panel__spinner" aria-hidden="true" />
              Running…
            </>
          ) : (
            <>
              <Play size={11} aria-hidden="true" />
              Run
            </>
          )}
        </button>
      </form>

      {(isRunning || steps.length > 0) && (
        <div className="orch-panel__timeline" aria-label="Orchestrator agent activity">
          <div
            ref={stepsScrollRef}
            className="orch-panel__steps agent-sidebar__list"
          >
            {steps.map((s) => {
              const displayName = stepToDisplayAgent(s);
              const meta = getPipelineAgent(displayName);
              const isLastStep = s.step === steps[steps.length - 1]?.step;
              const isLive =
                displayName === liveAgentName &&
                isLastStep &&
                !(isRunning && currentTool);

              return (
                <AgentCardRow
                  key={s.step}
                  name={meta.name}
                  tone={meta.tone}
                  isLive={Boolean(isLive)}
                />
              );
            })}
            {isRunning && runningAgentName && (
              <AgentCardRow
                name={getPipelineAgent(runningAgentName).name}
                tone={getPipelineAgent(runningAgentName).tone}
                isLive
              />
            )}
          </div>
        </div>
      )}

      {isDone && finalAnswer && (
        <div className="orch-panel__result" role="status">
          <span className="agent-sidebar__label">RESULT</span>
          <p>{finalAnswer}</p>
        </div>
      )}

      {isError && error && (
        <p className="orch-panel__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
