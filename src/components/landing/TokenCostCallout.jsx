"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "motion/react";

const facts = [
  {
    tone: "coral",
    big: "13×",
    label: "more tokens",
    sub: "Claude Code default mode uses 108–117k tokens per retrieval task. A structural approach: 8.5–13k. Same result.",
    source: "Augment Code / Medium analysis",
  },
  {
    tone: "pink",
    big: "$11k",
    label: "wasted per month",
    sub: "50,000 wasted tokens × 500 runs/day × $15 per 1M tokens = $11,250/month of pure repetition cost per team.",
    source: "Based on GPT-4-class pricing",
  },
  {
    tone: "mint",
    big: "~80%",
    label: "of agent spend",
    sub: "Input tokens re-sent on every turn account for nearly all measured agent cost. The reasoning is cheap. The repetition isn't.",
    source: "Augment Code cost analysis",
  },
];

function CountUpBig({ value, active, delay = 0 }) {
  // value may contain non-numeric chars (×, $, k, %) — animate the numeric part only
  const match = value.match(/^([^0-9]*)([0-9,]+)([^0-9]*)$/);
  const [display, setDisplay] = useState(value);
  const raf = useRef(null);

  useEffect(() => {
    if (!active || !match) return;
    const [, pre, numStr, post] = match;
    const target = parseInt(numStr.replace(",", ""), 10);
    if (isNaN(target)) return;
    const start = performance.now() + delay * 1000;

    function tick(now) {
      if (now < start) { raf.current = requestAnimationFrame(tick); return; }
      const t = Math.min((now - start) / 1200, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      setDisplay(`${pre}${Math.round(ease * target).toLocaleString()}${post}`);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    }
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  return <span>{match ? display : value}</span>;
}

export function TokenCostCallout() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, amount: 0.2 });

  return (
    <section className="tcc-section" id="features" ref={ref}>
      <div className="tcc-head">
        <span className="mono-label">01 / THE REAL COST</span>
        <h2>Token waste isn't a quirk.<br /><em>It's a budget line.</em></h2>
      </div>

      <div className="tcc-grid">
        {facts.map((f, i) => (
          <motion.div
            key={f.label}
            className={`tcc-card tcc-card--${f.tone}`}
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.5, delay: i * 0.12 }}
          >
            <div className="tcc-card__big">
              <CountUpBig value={f.big} active={inView} delay={i * 0.12} />
            </div>
            <div className="tcc-card__label">{f.label}</div>
            <p className="tcc-card__sub">{f.sub}</p>
            <span className="tcc-card__source">{f.source}</span>
          </motion.div>
        ))}
      </div>

      {/* Before/after mockup */}
      <motion.div
        className="tcc-compare"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.55, delay: 0.2 }}
      >
        <div className="tcc-terminal tcc-terminal--bad">
          <div className="tcc-terminal__bar">
            <span /><span /><span />
            <span className="tcc-terminal__title">typical agent — turn 4</span>
          </div>
          <div className="tcc-terminal__body">
            <p><span className="tcc-dim">$</span> fetching full repo tree… <span className="tcc-coral">38,412 tokens</span></p>
            <p><span className="tcc-dim">$</span> building message history… <span className="tcc-coral">21,048 tokens</span></p>
            <p><span className="tcc-dim">$</span> routing: "what should I do next?"… <span className="tcc-coral">3,500 tokens</span></p>
            <p><span className="tcc-dim">$</span> review pass (full context)… <span className="tcc-coral">3,500 tokens</span></p>
            <p className="tcc-terminal__total"><span className="tcc-coral">▶ 66,460 tokens used</span> — $0.99 this turn</p>
          </div>
        </div>

        <div className="tcc-compare__arrow" aria-hidden="true">→</div>

        <div className="tcc-terminal tcc-terminal--good">
          <div className="tcc-terminal__bar">
            <span /><span /><span />
            <span className="tcc-terminal__title">sprout — same task</span>
          </div>
          <div className="tcc-terminal__body">
            <p><span className="tcc-dim">$</span> compact map snapshot… <span className="tcc-mint">800 tokens</span></p>
            <p><span className="tcc-dim">$</span> deterministic planner… <span className="tcc-mint">0 tokens</span></p>
            <p><span className="tcc-dim">$</span> code generation… <span className="tcc-mint">4,096 tokens</span></p>
            <p><span className="tcc-dim">$</span> review gate (2 files, 64-tok reply)… <span className="tcc-mint">300 tokens</span></p>
            <p className="tcc-terminal__total"><span className="tcc-mint">▶ 5,196 tokens used</span> — $0.08 this turn</p>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
