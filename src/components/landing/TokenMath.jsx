"use client";

import { motion, useInView } from "motion/react";
import { useRef, useState, useEffect } from "react";

const rows = [
  {
    label: "Routing decision per turn",
    them: 3500,
    us: 0,
    usLabel: "0 — deterministic planner",
  },
  {
    label: "Repo context per run (full tree)",
    them: 40000,
    us: 800,
    usLabel: "~800 — compact snapshot, 40 paths",
  },
  {
    label: "Code review pass",
    them: 3500,
    us: 300,
    usLabel: "~300 — 2 files × 1.5k chars, 64-tok reply",
  },
  {
    label: "Node summary (hover)",
    them: 2000,
    us: 120,
    usLabel: "~120 — path + siblings only",
  },
  {
    label: "History context injected",
    them: 8000,
    us: 400,
    usLabel: "~400 — last 3 runs, truncated to 120 chars each",
  },
];

const TOTAL_THEM = rows.reduce((a, r) => a + r.them, 0);
const TOTAL_US   = rows.reduce((a, r) => a + r.us, 0);
const MAX_BAR    = rows.reduce((a, r) => Math.max(a, r.them), 0);
// GPT-4-class pricing: $15 per 1M tokens
const PRICE_PER_TOKEN = 15 / 1_000_000;

function Bar({ value, max, tone, active, delay }) {
  const pct = Math.max((value / max) * 100, value === 0 ? 0 : 2);
  return (
    <motion.div
      className={`token-bar token-bar--${tone}`}
      initial={{ width: 0 }}
      animate={active ? { width: `${pct}%` } : { width: 0 }}
      transition={{ duration: 0.9, delay, ease: [0.16, 1, 0.3, 1] }}
      aria-label={`${value.toLocaleString()} tokens`}
    />
  );
}

// Animated count-up for the savings callout
function CountUp({ target, active, suffix = "", delay = 0 }) {
  const [display, setDisplay] = useState(0);
  const raf = useRef(null);

  useEffect(() => {
    if (!active) return;
    const startTime = performance.now() + delay * 1000;
    const duration  = 1400;

    function tick(now) {
      if (now < startTime) { raf.current = requestAnimationFrame(tick); return; }
      const t = Math.min((now - startTime) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(ease * target));
      if (t < 1) raf.current = requestAnimationFrame(tick);
    }
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [active, target, delay]); // eslint-disable-line react-hooks/exhaustive-deps

  return <>{display}{suffix}</>;
}

export function TokenMath() {
  const ref        = useRef(null);
  const calloutRef = useRef(null);
  const inView        = useInView(ref,        { once: true, amount: 0.2 });
  const calloutInView = useInView(calloutRef, { once: true, amount: 0.5 });

  const savings = Math.round(((TOTAL_THEM - TOTAL_US) / TOTAL_THEM) * 100);

  // Cost calculator
  const [runsPerDay, setRunsPerDay] = useState(100);
  const wastedPerRun    = TOTAL_THEM - TOTAL_US;
  const dailyWaste      = wastedPerRun * runsPerDay;
  const monthlyCost     = dailyWaste * 30 * PRICE_PER_TOKEN;
  const monthlyWithUs   = TOTAL_US * runsPerDay * 30 * PRICE_PER_TOKEN;
  const monthlySavings  = monthlyCost - monthlyWithUs;

  return (
    <section className="token-section" id="token-math" ref={ref}>
      <div className="token-section__head">
        <span className="mono-label">04 / THE TOKEN MATH</span>
        <h2>
          Stop feeding your AI<br />
          <em>the same code twice.</em>
        </h2>
        <p>
          Studies show most coding agents re-read what they've already seen,
          burning 10–13× more tokens than necessary. Here's how Sprout
          compares, operation by operation.
        </p>
      </div>

      {/* Comparison table */}
      <div className="token-section__table">
        <div className="token-row token-row--head">
          <span className="token-row__label">Operation</span>
          <span className="token-row__col token-row__col--them">Typical agent</span>
          <span className="token-row__col token-row__col--us">Sprout</span>
        </div>

        {rows.map((row, i) => (
          <motion.div
            key={row.label}
            className="token-row"
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: i * 0.08 }}
          >
            <span className="token-row__label">{row.label}</span>
            <div className="token-row__col token-row__col--them">
              <div className="token-bar-wrap">
                <Bar value={row.them} max={MAX_BAR} tone="coral" active={inView} delay={i * 0.08} />
                <span className="token-bar__num">{row.them.toLocaleString()}</span>
              </div>
            </div>
            <div className="token-row__col token-row__col--us">
              <div className="token-bar-wrap">
                <Bar value={row.us} max={MAX_BAR} tone="mint" active={inView} delay={i * 0.08 + 0.15} />
                <span className="token-bar__num token-bar__num--us">{row.usLabel}</span>
              </div>
            </div>
          </motion.div>
        ))}

        <motion.div
          className="token-row token-row--total"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.5 }}
        >
          <span className="token-row__label"><strong>Total per run</strong></span>
          <span className="token-row__col token-row__col--them">
            <strong>{TOTAL_THEM.toLocaleString()} tokens</strong>
          </span>
          <span className="token-row__col token-row__col--us">
            <strong className="token-total--us">{TOTAL_US.toLocaleString()} tokens</strong>
          </span>
        </motion.div>
      </div>

      {/* ── Savings callout with count-up ──────────────────────────────── */}
      <motion.div
        className="token-callout"
        ref={calloutRef}
        initial={{ opacity: 0, scale: 0.92 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <span className="token-callout__num" aria-label={`${savings}% fewer tokens`}>
          <CountUp target={savings} active={calloutInView} suffix="%" delay={0.3} />
        </span>
        <span className="token-callout__label">
          fewer tokens per full pipeline run
          <span className="token-callout__sub">
            That's the difference between a $0.04 run and a $0.80 run —
            multiply by hundreds of builds per day.
          </span>
        </span>
      </motion.div>

      {/* ── Cost calculator ────────────────────────────────────────────── */}
      <motion.div
        className="token-calc"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.55, delay: 0.1 }}
      >
        <div className="token-calc__head">
          <span className="mono-label token-calc__mono">COST CALCULATOR</span>
          <p className="token-calc__desc">
            Drag to set your team's daily orchestrator runs. Pricing based on
            GPT-4-class ($15 / 1M tokens).
          </p>
        </div>

        <div className="token-calc__slider-row">
          <label className="token-calc__slider-label" htmlFor="runs-slider">
            Runs per day
          </label>
          <div className="token-calc__slider-wrap">
            <input
              id="runs-slider"
              type="range"
              min={10}
              max={1000}
              step={10}
              value={runsPerDay}
              onChange={(e) => setRunsPerDay(Number(e.target.value))}
              className="token-calc__slider"
              aria-label={`${runsPerDay} runs per day`}
            />
            <span className="token-calc__slider-val">{runsPerDay.toLocaleString()}</span>
          </div>
        </div>

        <div className="token-calc__results">
          <div className="token-calc__result token-calc__result--bad">
            <span className="token-calc__result-label">Typical agent / month</span>
            <span className="token-calc__result-num token-calc__result-num--bad">
              ${monthlyCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
            <span className="token-calc__result-sub">
              {(dailyWaste * 30).toLocaleString()} wasted tokens
            </span>
          </div>

          <div className="token-calc__result-arrow" aria-hidden="true">→</div>

          <div className="token-calc__result token-calc__result--good">
            <span className="token-calc__result-label">Sprout / month</span>
            <span className="token-calc__result-num token-calc__result-num--good">
              ${monthlyWithUs.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
            <span className="token-calc__result-sub">
              {(TOTAL_US * runsPerDay * 30).toLocaleString()} tokens
            </span>
          </div>

          <div className="token-calc__result token-calc__result--savings">
            <span className="token-calc__result-label">You save</span>
            <span className="token-calc__result-num token-calc__result-num--savings">
              ${monthlySavings.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
            <span className="token-calc__result-sub">per month</span>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
