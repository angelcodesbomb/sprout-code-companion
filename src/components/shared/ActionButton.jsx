import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";

export function ActionButton({ children, onClick, href, tone = "coral", className = "" }) {
  const content = (
    <>
      <span>{children}</span>
      <span className="action-button__arrow" aria-hidden="true"><ArrowRight size={16} /></span>
    </>
  );

  return (
    <motion.span
      className={`action-button action-button--${tone} ${className}`}
      whileHover={{ scale: 1.035, y: -2 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "spring", stiffness: 420, damping: 22 }}
    >
      {href ? <a href={href}>{content}</a> : <button type="button" onClick={onClick}>{content}</button>}
    </motion.span>
  );
}
