import { motion } from "motion/react";
import { AppWindow, Database, Braces, ScanSearch, ShieldCheck, BadgeCheck, GitBranch, Code2 } from "lucide-react";

const agentIcons = {
  UI: AppWindow,
  Database,
  API: Braces,
  Review: ScanSearch,
  Security: ShieldCheck,
  Validation: BadgeCheck,
};

const exploreItems = [
  { id: "map",  label: "File Map",     Icon: GitBranch },
  { id: "code", label: "Explain Code", Icon: Code2     },
];

/**
 * AgentSidebar
 *
 * Props:
 *   agents        — array of agent objects (UI/Database/API/Review/Security/Validation)
 *   activeAgent   — which pipeline agent is selected (null = none)
 *   onAgentSelect — (agentName) => void
 *   activeView    — "map" | "code"  — controls the Explore Code highlight
 *   onViewSelect  — (viewId) => void — switches the main content tab
 */
export function AgentSidebar({ agents, activeAgent, onAgentSelect, activeView, onViewSelect }) {
  return (
    <aside className="agent-sidebar" aria-label="Sidebar navigation">

      {/* ── Explore Code section ──────────────────────────────────────── */}
      <span className="agent-sidebar__label">EXPLORE CODE</span>
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
              {/* No status dot for explore items */}
            </span>
            <span className="agent-card__name">{label}</span>
          </button>
        ))}
      </div>

      {/* ── Divider ───────────────────────────────────────────────────── */}
      <div className="agent-sidebar__divider" aria-hidden="true" />

      {/* ── Pipeline Agents section ───────────────────────────────────── */}
      <span className="agent-sidebar__label">AGENTS</span>
      <div className="agent-sidebar__list">
        {agents.map((agent) => {
          const Icon = agentIcons[agent.name] || Braces;
          return (
            <button
              type="button"
              key={agent.name}
              className={`agent-card ${activeAgent === agent.name ? "is-selected" : ""}`}
              onClick={() => onAgentSelect(agent.name)}
              aria-label={`${agent.name} agent — ${agent.status}`}
            >
              <span className={`agent-card__avatar agent-card__avatar--${agent.tone}`}>
                <Icon size={19} />
                <motion.i
                  className={`status-dot ${agent.status === "active" ? "is-active" : ""}`}
                  animate={agent.status === "active" ? { scale: [1, 1.5, 1] } : {}}
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
