import { AnimatePresence, motion } from "motion/react";
import { FileCode2, Folder, X } from "lucide-react";
import { useState } from "react";

export function FileSystemMap({ nodes, title, subtitle }) {
  const [activeNode, setActiveNode] = useState(null);
  return (
    <section className="map-view" aria-label={title}>
      <div className="view-heading"><div><span className="mono-label">VISUAL FILE MAP</span><h2>{title}</h2><p>{subtitle}</p></div><span className="view-heading__badge">{nodes.length} nodes</span></div>
      <div className="file-map-canvas">
        <svg className="map-connectors" viewBox="0 0 1000 590" preserveAspectRatio="none" aria-hidden="true">
          <path d="M500 105V175M500 175H245V245M500 175H755V245M245 315V390M245 390H115V470M245 390H380V470M755 315V470"/><circle cx="500" cy="175" r="6"/><circle cx="245" cy="390" r="6"/>
        </svg>
        {nodes.map((node) => {
          const Icon = node.type === "folder" ? Folder : FileCode2;
          return (
            <motion.button key={node.name} type="button" className={`file-node file-node--${node.position} file-node--${node.tone}`} onMouseEnter={() => setActiveNode(node)} onMouseLeave={() => setActiveNode(null)} onFocus={() => setActiveNode(node)} onClick={() => setActiveNode(node)} whileHover={{ y: -4, rotate: node.position.includes("left") ? -1 : 1 }}>
              <Icon size={18}/><span>{node.name}</span><small>{node.type}</small>
            </motion.button>
          );
        })}
        <AnimatePresence>
          {activeNode && (
            <motion.div className="file-popover" initial={{ opacity: 0, rotateX: -18, y: 10 }} animate={{ opacity: 1, rotateX: 0, y: 0 }} exit={{ opacity: 0, y: 8 }}>
              <button type="button" onClick={() => setActiveNode(null)} aria-label="Close explanation"><X size={14}/></button>
              <span className="mono-label">IN PLAIN ENGLISH</span><strong>{activeNode.name}</strong><p>{activeNode.description}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
