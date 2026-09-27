"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "motion/react";

const stats = [
  {
    value: 49,
    suffix: "%",
    label: "Drop in general SWE job postings since 2022",
    tone: "coral",
    source: "Indeed Hiring Lab",
  },
  {
    value: 40,
    suffix: "%",
    label: "Of May 2026 US tech layoffs cited AI as the reason",
    tone: "pink",
    source: "Challenger, Gray & Christmas",
  },
  {
    value: 90,
    suffix: "%",
    label: "Of agent tokens wasted re-reading already-seen code",
    tone: "mint",
    source: "Augment Code analysis",
  },
  {
    value: 59,
    suffix: "%",
    label: "Jump in ML / AI engineer openings over the same period",
    tone: "cyan",
    source: "Indeed Hiring Lab",
  },
];

function CountUp({ target, suffix, active }) {
  const [display, setDisplay] = useState(0);
  const raf = useRef(null);

  useEffect(() => {
    if (!active) return;
    const start = performance.now();
    const duration = 1600;

    function tick(now) {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(ease * target));
      if (t < 1) raf.current = requestAnimationFrame(tick);
    }
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [active, target]);

  return (
    <span className="stats-strip__num">
      {display}
      {suffix}
    </span>
  );
}

export function StatsStrip() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, amount: 0.3 });

  return (
    <section className="stats-strip" ref={ref} aria-label="Industry statistics">
      <div className="stats-strip__inner">
        {stats.map((s, i) => (
          <motion.div
            key={s.label}
            className={`stats-strip__card stats-strip__card--${s.tone}`}
            initial={{ opacity: 0, y: 32 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.55, delay: i * 0.1 }}
          >
            <CountUp target={s.value} suffix={s.suffix} active={inView} />
            <p className="stats-strip__label">{s.label}</p>
            <span className="stats-strip__source">{s.source}</span>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
