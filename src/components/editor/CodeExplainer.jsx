import { AnimatePresence, motion } from "motion/react";
import { Lightbulb, Sparkles, X } from "lucide-react";
import { useState } from "react";

export function CodeExplainer({ title, fileName, blocks }) {
  const [selected, setSelected] = useState(null);
  return (
    <section className="editor-view">
      <div className="view-heading"><div><span className="mono-label">CODE EXPLAINER</span><h2>{title}</h2><p>Select any highlighted block to translate it.</p></div><span className="view-heading__badge"><Sparkles size={13}/> AI ready</span></div>
      <div className="editor-layout">
        <div className="code-panel">
          <div className="code-panel__top"><span className="traffic-lights"><i/><i/><i/></span><strong>{fileName}</strong><span>JavaScript</span></div>
          <pre>{blocks.map((block) => <button type="button" key={block.id} className={`code-block ${selected?.id === block.id ? "is-selected" : ""}`} onClick={() => setSelected(block)}>{block.lines.map((line) => <span key={line.number}><i>{line.number}</i><code dangerouslySetInnerHTML={{ __html: line.html }} /></span>)}</button>)}</pre>
        </div>
        <AnimatePresence mode="wait">
          {selected ? (
            <motion.aside className="explanation-panel" key={selected.id} initial={{ opacity: 0, x: 35 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 25 }}>
              <button className="explanation-panel__close" type="button" onClick={() => setSelected(null)} aria-label="Close explanation"><X size={15}/></button>
              <span className="explanation-panel__icon"><Lightbulb size={24}/></span><span className="mono-label">HERE'S WHAT THIS DOES</span><h3>{selected.title}</h3><p>{selected.explanation}</p><div className="explanation-panel__note">No jargon. Just the useful part.</div>
            </motion.aside>
          ) : (
            <motion.aside className="explanation-panel explanation-panel--empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><span className="explanation-panel__icon"><Lightbulb size={24}/></span><h3>Pick a code block</h3><p>Your explanation will appear here.</p></motion.aside>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
