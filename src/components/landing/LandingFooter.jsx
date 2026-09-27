"use client";

import { motion } from "motion/react";
import { SproutMark } from "../shared/SproutMark";
import { ActionButton } from "../shared/ActionButton";
import { Github } from "lucide-react";

export function LandingFooter() {
  return (
    <footer className="landing-footer">
      {/* CTA band */}
      <motion.div
        className="footer-cta"
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.6 }}
      >
        <div className="footer-cta__doodle" aria-hidden="true">
          <svg viewBox="0 0 400 120" fill="none">
            <path d="M20 80 C80 20 160 100 240 40 C300 -10 360 70 390 50" strokeDasharray="6 10" />
            <circle cx="20" cy="80" r="6" />
            <circle cx="240" cy="40" r="8" />
            <circle cx="390" cy="50" r="5" />
          </svg>
        </div>
        <span className="footer-cta__mono">06 / GET STARTED</span>
        <h2>
          Your codebase,<br />
          <em>finally legible.</em>
        </h2>
        <p>
          Load a repo, map the code, ship with confidence.
          Built for developers who need to move fast without burning tokens.
        </p>
        <ActionButton href="/workspace">Open Workspace</ActionButton>
      </motion.div>

      {/* Bottom bar */}
      <div className="footer-bar">
        <SproutMark />
        <div className="footer-bar__center">
          <span className="footer-bar__hackathon">
            Built for a hackathon ✦ 2026
          </span>
        </div>
        <a
          href="https://github.com/angelcodesbomb/sprout-code-companion"
          target="_blank"
          rel="noopener noreferrer"
          className="footer-bar__github"
          aria-label="View source on GitHub"
        >
          <Github size={18} />
          <span>Source</span>
        </a>
      </div>
    </footer>
  );
}
