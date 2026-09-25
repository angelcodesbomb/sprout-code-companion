import { motion } from "motion/react";
import { FileTree, MessageSquareText, Gauge } from "lucide-react";

const icons = { map: FileTree, explain: MessageSquareText, review: Gauge };

export function FeatureGrid({ heading, features }) {
  return (
    <section className="features-section" id="features">
      <div className="features-section__head"><span className="mono-label">01 / WHAT SPROUT DOES</span><h2>{heading}</h2></div>
      <motion.div className="feature-grid" initial="hidden" whileInView="show" viewport={{ once: true, amount: .2 }} variants={{ hidden: {}, show: { transition: { staggerChildren: .13 } } }}>
        {features.map((feature, index) => {
          const Icon = icons[feature.icon];
          return (
            <motion.article className={`feature-card feature-card--${feature.tone}`} key={feature.title} variants={{ hidden: { opacity: 0, y: 28 }, show: { opacity: 1, y: 0 } }} transition={{ duration: .5 }}>
              <span className="feature-card__number">0{index + 1}</span>
              <div className="feature-card__icon"><Icon size={30} strokeWidth={1.7}/></div>
              <h3>{feature.title}</h3><p>{feature.description}</p>
              <span className="feature-card__scribble" aria-hidden="true">↝</span>
            </motion.article>
          );
        })}
      </motion.div>
    </section>
  );
}
