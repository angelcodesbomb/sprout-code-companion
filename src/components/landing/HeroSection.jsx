import { motion } from "motion/react";
import { ActionButton } from "../shared/ActionButton";
import { HeroDoodle } from "./HeroDoodle";

export function HeroSection({ eyebrow, title, italicText, description, ctaLabel }) {
  return (
    <section className="hero-section">
      <HeroDoodle />
      <motion.div className="hero-section__content" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .65 }}>
        <div className="eyebrow"><span />{eyebrow}<span /></div>
        <h1>{title} <em>{italicText}</em></h1>
        <p>{description}</p>
        <ActionButton href="/workspace">{ctaLabel}</ActionButton>
      </motion.div>
      <div className="hero-stamp" aria-hidden="true"><span>CODE</span><strong>clearly</strong><span>✦ 2026 ✦</span></div>
      <div className="hero-branch" aria-hidden="true"><span>⌁</span><span>⌁</span><span>⌁</span></div>
    </section>
  );
}
