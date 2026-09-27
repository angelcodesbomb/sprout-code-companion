"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Plus, Minus } from "lucide-react";

const items = [
  {
    q: "Does it work with any GitHub repository?",
    a: "Yes — public repos work without any token. Private repos use your GitHub OAuth session (sign in with GitHub in the workspace). The GitHub API tree endpoint fetches the full file list recursively; Sprout never clones anything locally.",
  },
  {
    q: "What AI models does it use, and can I change them?",
    a: "Sprout uses Groq-hosted models and routes by role: the orchestrator and UI agent default to gpt-oss-120b for its tool-calling capability, while file map summaries and review gates use the faster gpt-oss-20b. Every model is an environment variable (GROQ_MODEL_ORCHESTRATOR, GROQ_MODEL_UI, GROQ_MODEL_FILEMAP, GROQ_MODEL_REVIEW) — swap any of them in .env.local without touching code.",
  },
  {
    q: "Is my code sent to a third party?",
    a: "Only what's needed for the task. File map node summaries send a single file path + name + sibling context (~120 tokens). Code review gates send at most 2 files × 1,500 characters. The UI agent receives up to 80 file paths from your map — never full file content. All requests go to Groq's API directly from your server; nothing is stored externally.",
  },
  {
    q: "What does \"self-healing\" actually mean?",
    a: "After every code generation step, the Monitor gate checks the output against 5 rules (no DOM APIs, no TypeScript syntax in JSX, default export present, no console.log, no JSX attribute syntax errors). If it fails, Sprout immediately re-runs the same agent with the monitor's feedback appended to the spec — one automatic retry, no human in the loop. The Security gate runs after, checking for hardcoded secrets, eval(), dangerouslySetInnerHTML, and server-only imports.",
  },
  {
    q: "Why build a file map at all — can't the AI just read the repo?",
    a: "It can, but at enormous cost. Sending a full repo through context on every turn is how agents burn 40,000–118,000 tokens per task. Sprout builds the map once, stores it in sessionStorage per repo, and passes only a compact snapshot (40 sample paths + domain counts, ~800 tokens) on each run. Node summaries are generated lazily on hover — one 120-token call per file, never upfront.",
  },
  {
    q: "Does it push directly to main?",
    a: "It pushes to whatever branch the repo loaded from — typically main. The push uses the GitHub Trees API (create blobs → create tree → create commit → update ref), so it creates a proper commit in your history. There's a dry-run mode: include \"no-push\" or \"dry-run\" in your goal and the pipeline skips the push phase entirely.",
  },
];

function Item({ item, open, onToggle, i }) {
  return (
    <motion.div
      className="qa-item"
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.4, delay: i * 0.07 }}
    >
      <button
        type="button"
        className="qa-item__trigger"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="qa-item__q">{item.q}</span>
        <span className="qa-item__icon" aria-hidden="true">
          {open ? <Minus size={16} /> : <Plus size={16} />}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="answer"
            className="qa-item__answer"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
          >
            <p>{item.a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function QASection() {
  const [open, setOpen] = useState(null);

  return (
    <section className="qa-section" id="faq">
      <div className="qa-section__inner">
        <div className="qa-section__head">
          <span className="mono-label">05 / COMMON QUESTIONS</span>
          <h2>
            Answers up front,<br />
            <em>no digging required.</em>
          </h2>
        </div>

        <div className="qa-section__list">
          {items.map((item, i) => (
            <Item
              key={item.q}
              item={item}
              i={i}
              open={open === i}
              onToggle={() => setOpen(open === i ? null : i)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
