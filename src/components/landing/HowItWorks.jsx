"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  GitBranch, Map, Wand2, ShieldCheck, MonitorPlay, Rocket,
} from "lucide-react";

const steps = [
  {
    n: "01",
    icon: GitBranch,
    tone: "coral",
    title: "Load any GitHub repo",
    body: "Paste an owner/repo. Sprout fetches the full recursive tree via the GitHub API — no clone, no local setup. Works with public and private repos using your GitHub OAuth token.",
    aside: "Zero LLM calls to build the initial map. Pure rule-based domain tagging runs instantly.",
  },
  {
    n: "02",
    icon: Map,
    tone: "mint",
    title: "File Map builds in seconds",
    body: "Every file gets domain-tagged (UI / API / Database / Security) by fast regex heuristics, then laid out as an interactive graph. On-demand AI summaries fill in per-node on hover — one focused 120-token call, not a bulk scan.",
    aside: "The compact map snapshot (40 sample paths + domain counts) is what agents actually read. Not the whole tree.",
  },
  {
    n: "03",
    icon: Wand2,
    tone: "cyan",
    title: "Describe your goal",
    body: "Type what you want to build in the Orchestrator bar. A deterministic planner computes the exact pipeline — GitHub read → map load → code generation → review → push. No routing LLM, no wasted turns deciding what to do next.",
    aside: "The old approach: ask an LLM \"what should I do next?\" each turn (~3,500 tokens). Sprout: zero tokens on routing.",
  },
  {
    n: "04",
    icon: ShieldCheck,
    tone: "pink",
    title: "Auto review + self-heal",
    body: "After every code generation step, the Monitor and Security gates run automatically — each sending only 2 files × 1,500 chars to a fast model, capped at 64-token responses. If the monitor fails, the agent retries with feedback injected. No human loop required.",
    aside: "~300 tokens per review pass vs ~3,500 tokens for a full orchestrator turn. 10× cheaper, runs every time.",
  },
  {
    n: "05",
    icon: MonitorPlay,
    tone: "coral",
    title: "Live preview in the browser",
    body: "Generated files render immediately in a Sandpack (CodeSandbox) sandbox. No deploy, no build step. Edit manually or trigger another orchestrator run — the preview updates in real time.",
    aside: "File paths are flattened and imports rewritten automatically so Sandpack resolves them without a bundler config.",
  },
  {
    n: "06",
    icon: Rocket,
    tone: "mint",
    title: "Push to GitHub in one click",
    body: "When you're happy, one click creates blobs, builds a tree on top of your current HEAD, creates a commit, and updates the branch ref — all via the GitHub Trees API. No local git required.",
    aside: "Run history is persisted per repo and fed back as context on the next run, so the agent knows what was already built.",
  },
];

const TONE_COLORS = {
  coral: "var(--coral)",
  mint:  "var(--mint)",
  cyan:  "var(--cyan)",
  pink:  "var(--pink)",
};

export function HowItWorks() {
  const [active, setActive] = useState(0);
  const step = steps[active];
  const Icon = step.icon;

  // Height per pill ≈ 64px (14px text + 2×18px padding + 8px gap top) — used for progress line
  const PILL_H = 64;
  const GAP    = 8;
  const progressTop = active * (PILL_H + GAP) + PILL_H / 2;

  return (
    <section className="how-section" id="how-it-works">
      <div className="how-section__head">
        <span className="mono-label">03 / HOW IT WORKS</span>
        <h2>Six steps. One coherent pipeline.</h2>
      </div>

      <div className="how-section__body">
        {/* ── Step nav with timeline ───────────────────────────────────── */}
        <div className="how-section__timeline-wrap">
          {/* Static vertical rail */}
          <div className="how-timeline__rail" aria-hidden="true" />

          {/* Animated progress line — slides down to active step midpoint */}
          <motion.div
            className="how-timeline__progress"
            animate={{ height: progressTop }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            aria-hidden="true"
          />

          <nav className="how-section__nav" aria-label="Pipeline steps">
            {steps.map((s, i) => {
              const isActive = active === i;
              const isPast   = i < active;
              const Icon_s   = s.icon;
              return (
                <button
                  key={s.n}
                  type="button"
                  className={`how-step-pill ${isActive ? "is-active" : ""} ${isPast ? "is-past" : ""} how-step-pill--${s.tone}`}
                  onClick={() => setActive(i)}
                  aria-current={isActive ? "step" : undefined}
                >
                  {/* Timeline dot */}
                  <span
                    className="how-step-pill__dot"
                    style={isActive || isPast ? { background: TONE_COLORS[s.tone], borderColor: TONE_COLORS[s.tone] } : {}}
                    aria-hidden="true"
                  >
                    {isPast && (
                      <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                        <path d="M1.5 4l2 2 3-3" stroke="oklch(0.254 0.018 75)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>

                  <span className="how-step-pill__n">{s.n}</span>
                  <span className="how-step-pill__title">{s.title}</span>

                  {/* Active indicator icon */}
                  {isActive && (
                    <motion.span
                      className="how-step-pill__active-icon"
                      initial={{ opacity: 0, scale: 0.6 }}
                      animate={{ opacity: 1, scale: 1 }}
                      style={{ color: TONE_COLORS[s.tone] }}
                    >
                      <Icon_s size={14} aria-hidden="true" />
                    </motion.span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* ── Detail panel ──────────────────────────────────────────────── */}
        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            className={`how-section__detail how-section__detail--${step.tone}`}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.28 }}
            role="region"
            aria-label={`Step ${step.n}: ${step.title}`}
          >
            <div className={`how-section__detail-icon how-section__detail-icon--${step.tone}`}>
              <Icon size={26} aria-hidden="true" />
            </div>
            <span className="how-section__detail-n">{step.n}</span>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
            <div className="how-section__aside">
              <span className="how-section__aside-label">TOKEN NOTE</span>
              {step.aside}
            </div>

            {/* Prev / Next navigation */}
            <div className="how-section__nav-btns">
              <button
                type="button"
                className="how-nav-btn"
                onClick={() => setActive((v) => Math.max(0, v - 1))}
                disabled={active === 0}
                aria-label="Previous step"
              >
                ← Prev
              </button>
              <span className="how-section__step-count">
                {active + 1} / {steps.length}
              </span>
              <button
                type="button"
                className="how-nav-btn"
                onClick={() => setActive((v) => Math.min(steps.length - 1, v + 1))}
                disabled={active === steps.length - 1}
                aria-label="Next step"
              >
                Next →
              </button>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
