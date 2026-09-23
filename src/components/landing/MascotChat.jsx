import { motion } from "motion/react";

export function MascotChat({ name, greeting, buttonLabel }) {
  return (
    <motion.aside className="mascot-chat" animate={{ y: [0, -5, 0], scale: [1, 1.02, 1] }} transition={{ duration: 3.8, repeat: Infinity, ease: "easeInOut" }}>
      <div className="mascot-chat__title"><span>{greeting}</span><strong>{name}</strong></div>
      <div className="mascot-avatar" aria-hidden="true"><span className="mascot-avatar__hair"/><span className="mascot-avatar__face"><i/><i/><b/></span><span className="mascot-avatar__body"/></div>
      <button type="button">{buttonLabel} <span>→</span></button>
    </motion.aside>
  );
}
