"use client";

import { motion } from "motion/react";

const cases = [
  {
    tone: "coral",
    company: "Uber",
    tag: "Case study — 2026",
    headline: "Annual AI budget gone in 4 months.",
    body: "Uber gave ~5,000 engineers unlimited access to Claude Code in December 2025. By April 2026 the entire annual AI coding budget was exhausted. A single two-hour session cost one executive $1,200. The company responded by capping every engineer at $1,500/month per tool. Uber CTO Praveen Neppalli Naga publicly declared the era of \"tokenmaxxing\" over.",
    sources: "Forbes / Fortune / TechCrunch, 2026",
  },
  {
    tone: "pink",
    company: "Microsoft",
    tag: "Case study — 2026",
    headline: "Cancelled Claude Code for thousands of engineers.",
    body: "Microsoft rolled out Claude Code broadly across its Experiences & Devices division — the team behind Windows, Microsoft 365, Teams, and Surface. Token costs hit $2,000 per engineer per month. By June 2026, Microsoft cancelled most of those licenses and redirected engineers to GitHub Copilot CLI. The tools weren't the problem. The problem was the tools working too well with no context efficiency.",
    sources: "The Verge / Fortune / TheStreet, 2026",
  },
];

export function CaseStudyStrip() {
  return (
    <section className="case-strip" aria-label="Real-world token cost case studies">
      <div className="case-strip__inner">
        <div className="case-strip__label">
          <span className="mono-label">REAL-WORLD COST CRISES</span>
          <p className="case-strip__sublabel">
            These aren't edge cases. They're the companies with the biggest AI budgets,
            hitting the same wall.
          </p>
        </div>

        <div className="case-strip__grid">
          {cases.map((c, i) => (
            <motion.div
              key={c.company}
              className={`case-card case-card--${c.tone}`}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.5, delay: i * 0.14 }}
            >
              <div className="case-card__header">
                <span className="case-card__company">{c.company}</span>
                <span className="case-card__tag">{c.tag}</span>
              </div>
              <h3 className="case-card__headline">{c.headline}</h3>
              <p className="case-card__body">{c.body}</p>
              <span className="case-card__sources">{c.sources}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
