import { motion } from "motion/react";
import { AppWindow, Database, Braces, ScanSearch, ShieldCheck, BadgeCheck } from "lucide-react";

const agentIcons = {
  UI: AppWindow,
  Database,
  API: Braces,
  Review: ScanSearch,
  Security: ShieldCheck,
  Validation: BadgeCheck,
};

/**
 * Read-only agent row matching sidebar agent-card styling.
 */
export function AgentCardRow({ name, tone, isLive = false, as = "div", className = "" }) {
  const Icon = agentIcons[name] || Braces;
  const Tag = as;

  return (
    <Tag
      className={`agent-card agent-card--timeline ${isLive ? "is-live" : ""} ${className}`.trim()}
      aria-label={`${name} agent${isLive ? " — active" : ""}`}
    >
      <span className={`agent-card__avatar agent-card__avatar--${tone}`}>
        <Icon size={19} />
        <motion.i
          className={`status-dot ${isLive ? "is-live" : ""}`}
          animate={isLive ? { scale: [1, 1.35, 1] } : {}}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
      </span>
      <span className="agent-card__name">{name}</span>
    </Tag>
  );
}
