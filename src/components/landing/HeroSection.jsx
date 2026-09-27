"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { ActionButton } from "../shared/ActionButton";
import { HeroDoodle } from "./HeroDoodle";

const EYEBROW_PHRASES = [
  "YOUR CODEBASE, MADE CLEAR",
  "YOUR TOKENS, SAVED",
  "YOUR CONTEXT, PRESERVED",
  "YOUR PIPELINE, AUTOMATED",
];

function TypewriterEyebrow() {
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [displayed,  setDisplayed]  = useState("");
  const [deleting,   setDeleting]   = useState(false);
  const [done,       setDone]       = useState(false);

  useEffect(() => {
    const phrase = EYEBROW_PHRASES[phraseIdx];

    if (!deleting && displayed.length < phrase.length) {
      // Typing forward
      const t = setTimeout(() => setDisplayed(phrase.slice(0, displayed.length + 1)), 55);
      return () => clearTimeout(t);
    }

    if (!deleting && displayed.length === phrase.length) {
      // Pause at full phrase, then start deleting (skip last phrase — leave it)
      if (phraseIdx === EYEBROW_PHRASES.length - 1) {
        setDone(true);
        return;
      }
      const t = setTimeout(() => setDeleting(true), 2200);
      return () => clearTimeout(t);
    }

    if (deleting && displayed.length > 0) {
      // Deleting
      const t = setTimeout(() => setDisplayed(displayed.slice(0, -1)), 28);
      return () => clearTimeout(t);
    }

    if (deleting && displayed.length === 0) {
      // Move to next phrase
      setDeleting(false);
      setPhraseIdx((v) => (v + 1) % EYEBROW_PHRASES.length);
    }
  }, [displayed, deleting, phraseIdx]);

  return (
    <div className="eyebrow" aria-label={EYEBROW_PHRASES[phraseIdx]}>
      <span />
      <span className="hero-typewriter">
        {displayed}
        {!done && <span className="hero-typewriter__cursor" aria-hidden="true" />}
      </span>
      <span />
    </div>
  );
}

export function HeroSection({ title, italicText, description, ctaLabel }) {
  return (
    <section className="hero-section">
      <HeroDoodle />
      <motion.div
        className="hero-section__content"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.65 }}
      >
        <TypewriterEyebrow />
        <h1>{title} <em>{italicText}</em></h1>
        <p>{description}</p>
        <ActionButton href="/workspace">{ctaLabel}</ActionButton>
      </motion.div>
      <div className="hero-stamp" aria-hidden="true">
        <span>CODE</span><strong>clearly</strong><span>✦ 2026 ✦</span>
      </div>
      <div className="hero-branch" aria-hidden="true">
        <span>⌁</span><span>⌁</span><span>⌁</span>
      </div>
    </section>
  );
}
