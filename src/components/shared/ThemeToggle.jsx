import { motion } from "motion/react";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle({ isDark, onToggle }) {
  return (
    <button className="theme-toggle" type="button" onClick={onToggle} aria-label={`Switch to ${isDark ? "light" : "dark"} mode`} aria-pressed={isDark}>
      <Sun size={13} aria-hidden="true" />
      <Moon size={13} aria-hidden="true" />
      <motion.span className="theme-toggle__thumb" animate={{ x: isDark ? 27 : 0 }} transition={{ type: "spring", stiffness: 500, damping: 30 }} />
    </button>
  );
}
