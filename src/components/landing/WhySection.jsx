"use client";

import { motion } from "motion/react";

export function WhySection() {
  return (
    <section className="why-section" id="why">
      <div className="why-section__inner">

        {/* Left — eyebrow + heading */}
        <motion.div
          className="why-section__heading-col"
          initial={{ opacity: 0, x: -28 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={{ duration: 0.6 }}
        >
          <span className="mono-label why-section__mono">02 / WHY IT EXISTS</span>
          <h2 className="why-section__h2">
            The engineers who survive make AI work{" "}
            <em>for</em> them.
          </h2>
        </motion.div>

        {/* Right — body copy */}
        <motion.div
          className="why-section__body-col"
          initial={{ opacity: 0, x: 28 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={{ duration: 0.6, delay: 0.1 }}
        >
          <p>
            Amazon cut over 30,000 corporate jobs between October 2025 and
            January 2026. Weeks later, recruiters inside its AI agent org
            — under AWS VP Swami Sivasubramanian — were emailing those same
            former employees through what they called the{" "}
            <strong>"Boomerang Reengagement Initiative"</strong>, specifically
            looking for AI and machine learning experience.
          </p>
          <p>
            That's not a contradiction. That's the shape of the new market:
            general software engineering postings are down 49%, while ML and
            AI engineer roles are up 59% over the same window. The floor has
            dropped for developers who work <em>beside</em> AI. The ceiling
            has risen for those who know how to wield it.
          </p>
          <p>
            Token cost is now a real budget line — not a theoretical one. Uber
            burned through its entire 2026 AI coding budget in four months.
            Microsoft cancelled Claude Code licenses for thousands of engineers
            after costs hit $2,000 per person per month. These aren't startups
            miscalculating. These are companies with the biggest AI budgets in
            the world, hitting the same wall: agents that re-read code they've
            already seen, on every single turn.
          </p>
          <p>
            Studies show coding agents burning 10–13× more tokens than
            necessary because they have no persistent context. They start
            from scratch every time. Sprout was built to fix that — map the
            codebase once, reference the compact snapshot on every run, and
            never re-read what you already know.
          </p>

          {/* Pull quote */}
          <blockquote className="why-section__quote">
            "Your agent just burned roughly 118,000 tokens. Not on reasoning.
            Not on generating code. On reading the raw output of commands that
            could have been expressed in a fraction of the space."
            <cite>— Augment Code cost analysis, 2026</cite>
          </blockquote>
        </motion.div>

      </div>

      {/* Decorative ticker */}
      <div className="why-section__ticker" aria-hidden="true">
        <div className="why-section__ticker-track">
          {[
            "Context is finite.",
            "Tokens cost money.",
            "Build the map once.",
            "Stop re-reading.",
            "Ship with confidence.",
            "Context is finite.",
            "Tokens cost money.",
            "Build the map once.",
            "Stop re-reading.",
            "Ship with confidence.",
          ].map((t, i) => (
            <span key={i} className="why-section__ticker-item">
              {t} <span className="why-section__ticker-dot">✦</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
