import { motion } from "motion/react";
import {
  AppWindow, Database, Braces, ScanSearch, ShieldCheck, BadgeCheck,
  GitBranch, Code2, Layers,
} from "lucide-react";
import { PIPELINE_AGENTS, resolveLiveAgentName, toolToDisplayAgent } from "@/lib/orchestrator/agentDisplay";

const agentIcons = {
  UI: AppWindow, Database, API: Braces,
  Review: ScanSearch, Security: ShieldCheck, Validation: BadgeCheck,
};

const exploreItems = [
  { id: "build", label: "Build",        Icon: Layers    },
  { id: "map",   label: "File Map",     Icon: GitBranch },
  { id: "code",  label: "Explain Code", Icon: Code2     },
];

export function AgentSidebar({
  activeAgent,
  onAgentSelect,
  activeView,
  onViewSelect,
  orchStatus    = "idle",
  orchSteps     = [],
  orchCurrentTool = null,
}) {
  const liveAgentName = resolveLiveAgentName(orchSteps, orchCurrentTool, orchStatus);
  const isRunning     = orchStatus === "running";

  return (
    <aside className="agent-sidebar" aria-label="Sidebar navigation">

      {/* ── Explore / navigate section ──────────────────────────────────── */}
      <span className="agent-sidebar__label">NAVIGATE</span>
      <div className="agent-sidebar__list">
        {exploreItems.map(({ id, label, Icon }) => (
          <button
            type="button"
            key={id}
            className={`agent-card ${activeView === id ? "is-selected" : ""}`}
            onClick={() => onViewSelect?.(id)}
            aria-label={label}
            aria-current={activeView === id ? "page" : undefined}
          >
            <span className="agent-card__avatar agent-card__avatar--cyan">
              <Icon size={19} />
            </span>
            <span className="agent-card__name">{label}</span>
          </button>
        ))}
      </div>

      <div className="agent-sidebar__divider" aria-hidden="true" />

      {/* ── Pipeline agents ────────────────────────────────────────────── */}
      <span className="agent-sidebar__label">
        AGENTS
        {isRunning && (
          <span className="agent-sidebar__running-badge" aria-label="Orchestrator running">
            <span className="agent-sidebar__running-dot" />
            running
          </span>
        )}
      </span>
      <div className="agent-sidebar__list">
        {PIPELINE_AGENTS.map((agent) => {
          const Icon   = agentIcons[agent.name] || Braces;
          const isLive = liveAgentName === agent.name;
          return (
            <button
              type="button"
              key={agent.name}
              className={`agent-card ${activeAgent === agent.name ? "is-selected" : ""}`}
              onClick={() => onAgentSelect(agent.name)}
              aria-label={`${agent.name} agent${isLive ? " — active" : ""}`}
            >
              <span className={`agent-card__avatar agent-card__avatar--${agent.tone}`}>
                <Icon size={19} />
                <motion.i
                  className={`status-dot ${isLive ? "is-live" : ""}`}
                  animate={isLive ? { scale: [1, 1.35, 1] } : {}}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
              </span>
              <span className="agent-card__name">{agent.name}</span>
              <span className="agent-tooltip">{agent.description}</span>
            </button>
          );
        })}
      </div>

    </aside>
  );
}
