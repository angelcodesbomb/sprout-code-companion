"use client";

import { useState } from "react";
import { X, FolderInput, Github, Copy, Check, ChevronDown, FileInput, FileOutput, Bot, Code2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { DOMAIN_TONE } from "@/lib/repoMap";
import { useRepoMapContext } from "@/context/RepoMapContext";

const WORKFLOW_FIELDS = [
  { key: "inputs", label: "Inputs", Icon: FileInput, tone: "cyan" },
  { key: "outputs", label: "Outputs", Icon: FileOutput, tone: "coral" },
  { key: "process", label: "Process", Icon: Bot, tone: "mint" },
  { key: "function", label: "Function", Icon: Code2, tone: "pink" },
];

/**
 * Shown when a graph node is clicked — structured workflow from the shared map.
 */
export function FileMapNodePanel({ node, onClose, onFocusFolder, repoMeta }) {
  const [copied, setCopied] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState(() => new Set(["function"]));
  const { getDescriptionForPath, getDomainForPath, getWorkflowForPath } =
    useRepoMapContext();

  if (!node) {
    return (
      <div className="fmg-panel fmg-panel--empty" aria-live="polite">
        <span className="mono-label">CLICK A NODE</span>
        <p>
          Select any file or folder in the graph to see function, inputs, outputs,
          and process. Use the ask bar above to jump straight to a path.
        </p>
      </div>
    );
  }

  const path = node.path ?? "";
  const domain = getDomainForPath(path);
  const tone = domain ? DOMAIN_TONE[domain] : "coral";
  const workflow = getWorkflowForPath(path);
  const isFolder = node.type === "folder";

  return (
    <div className="fmg-panel" aria-label={`Details for ${node.name}`}>
      <button
        type="button"
        className="fmg-panel__close"
        onClick={onClose}
        aria-label="Clear selection"
      >
        <X size={14} />
      </button>

      <span className="mono-label">IN PLAIN ENGLISH</span>
      <div className="fmg-panel__head">
        <div>
          <strong>{node.name || "Repository"}</strong>
          {domain && (
            <span className={`fmg-panel__domain fmg-panel__domain--${tone}`}>
              {domain}
            </span>
          )}
        </div>

        {/* Sleeker Actions at the top right of the header */}
        <div className="fmg-panel__actions">
          {repoMeta && path && (
            <a
              href={`https://github.com/${repoMeta.owner}/${repoMeta.repo}/${isFolder ? "tree" : "blob"}/${repoMeta.branch}/${path}`}
              target="_blank"
              rel="noreferrer"
              className="fmg-panel__action-btn"
              title="Open on GitHub"
            >
              <Github size={12} />
            </a>
          )}
          {path && (
            <button
              type="button"
              className="fmg-panel__action-btn"
              onClick={() => {
                navigator.clipboard.writeText(path);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              title="Copy path"
            >
              {copied ? <Check size={12} className="text-mint" /> : <Copy size={12} />}
            </button>
          )}
        </div>
      </div>

      <p className="fmg-panel__summary">{getDescriptionForPath(path)}</p>

      <div className="fmg-panel__accordion">
        {WORKFLOW_FIELDS.map(({ key, label, Icon, tone }) => {
          const val = workflow[key];
          const hasData = val && val !== "—" && val.trim() !== "";
          const isOpen = expandedKeys.has(key);

          return (
            <div key={key} className={`fmg-acc-item fmg-acc-item--${tone} ${isOpen ? 'is-open' : ''}`}>
              <button
                type="button"
                className="fmg-acc-header"
                onClick={() => setExpandedKeys(prev => {
                  const next = new Set(prev);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  return next;
                })}
              >
                <div className="fmg-acc-icon">
                  <Icon size={14} />
                </div>
                <span className="fmg-acc-label">{label}</span>
                <ChevronDown
                  size={14}
                  className="fmg-acc-chevron"
                  style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0)" }}
                />
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: "easeInOut" }}
                    style={{ overflow: "hidden" }}
                  >
                    <div className="fmg-acc-content">
                      {hasData ? val : <span style={{ opacity: 0.4, fontStyle: "italic" }}>No details available.</span>}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      <p className="fmg-panel__path">{path || "(repository root)"}</p>

      {isFolder && onFocusFolder && (
        <button
          type="button"
          className="fmg-panel__focus"
          onClick={() => onFocusFolder(node)}
        >
          <FolderInput size={14} aria-hidden="true" />
          Focus this folder in the graph
        </button>
      )}
    </div>
  );
}
