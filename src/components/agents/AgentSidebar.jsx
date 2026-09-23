import { motion } from "motion/react";
import { AppWindow, Database, Braces, ScanSearch, ShieldCheck, BadgeCheck } from "lucide-react";

const agentIcons = { UI: AppWindow, Database, API: Braces, Review: ScanSearch, Security: ShieldCheck, Validation: BadgeCheck };

export function AgentSidebar({ agents, activeAgent, onAgentSelect }) {
  return (
    <aside className="agent-sidebar" aria-label="Coding agents">
      <span className="agent-sidebar__label">AGENTS</span>
      <div className="agent-sidebar__list">
        {agents.map((agent) => {
          const Icon = agentIcons[agent.name] || Braces;
          return (
            <button type="button" key={agent.name} className={`agent-card ${activeAgent === agent.name ? "is-selected" : ""}`} onClick={() => onAgentSelect(agent.name)} aria-label={`${agent.name} agent — ${agent.status}`}>
              <span className={`agent-card__avatar agent-card__avatar--${agent.tone}`}><Icon size={19}/><motion.i className={`status-dot ${agent.status === "active" ? "is-active" : ""}`} animate={agent.status === "active" ? { scale: [1, 1.5, 1] } : {}} transition={{ duration: 1.5, repeat: Infinity }}/></span>
              <span className="agent-card__name">{agent.name}</span>
              <span className="agent-tooltip">{agent.description}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
