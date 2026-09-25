"use client";

import { AnimatePresence, motion } from "motion/react";
import { FileCode2, Folder, FolderOpen, X, GitBranch } from "lucide-react";
import { useEffect, useState } from "react";
import { countFiles } from "@/lib/parseGithubTree";
import { DOMAIN_TONE } from "@/lib/repoMap";
import { useRepoMapContext } from "@/context/RepoMapContext";

// ── Skeleton (loading state) ──────────────────────────────────────────────────

const GHOST_POSITIONS = [
  "root",
  "mid-left",
  "mid-right",
  "low-left",
  "low-center",
  "low-right",
];

function SkeletonCanvas() {
  return (
    <div className="file-map-skeleton" aria-label="Loading file tree…" aria-busy="true">
      {/* Static SVG connectors — same geometry as the real map */}
      <svg
        className="map-connectors"
        viewBox="0 0 1000 590"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d="M500 105V175M500 175H245V245M500 175H755V245M245 315V390M245 390H115V470M245 390H380V470M755 315V470" />
        <circle cx="500" cy="175" r="6" />
        <circle cx="245" cy="390" r="6" />
      </svg>

      {GHOST_POSITIONS.map((pos) => (
        <div
          key={pos}
          className={`file-node-ghost file-node-ghost--${pos} skeleton-shimmer`}
        />
      ))}
    </div>
  );
}

// ── Empty state (no repo loaded) ──────────────────────────────────────────────

function EmptyCanvas() {
  return (
    <div className="file-map-empty" role="region" aria-label="No repository loaded">
      <span className="file-map-empty__illustration" aria-hidden="true">
        <GitBranch size={26} />
      </span>
      <h3 className="file-map-empty__title">Paste a repo to get started</h3>
      <p className="file-map-empty__subtitle">
        Enter any public GitHub URL above and Sprout will map out the entire
        file structure for you.
      </p>
    </div>
  );
}

// ── Recursive tree list ───────────────────────────────────────────────────────

function TreeNode({ node, depth = 0, onSelect, activeNode, onHoverExplain }) {
  const [open, setOpen] = useState(depth < 2); // auto-expand top two levels

  const isFolder = node.type === "folder";
  const isActive = activeNode?.path === node.path;
  const fileCount = isFolder ? countFiles(node) : null;

  const Icon = isFolder ? (open ? FolderOpen : Folder) : FileCode2;
  const iconClass = isFolder
    ? open
      ? "file-tree__icon file-tree__icon--open"
      : "file-tree__icon file-tree__icon--folder"
    : "file-tree__icon";

  function handleClick() {
    if (isFolder) setOpen((v) => !v);
    onSelect(node);
  }

  function handleMouseEnter() {
    onHoverExplain?.(node);
  }

  return (
    <li className="file-tree__item">
      <button
        type="button"
        className={`file-tree__row${isActive ? " file-tree__row--active" : ""}`}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        aria-expanded={isFolder ? open : undefined}
        title={node.path}
      >
        <Icon size={13} className={iconClass} aria-hidden="true" />
        <span className="file-tree__name">{node.name}</span>
        <DomainPill path={node.path} />
        {isFolder && fileCount !== null && (
          <span className="file-tree__count">{fileCount}</span>
        )}
      </button>

      {isFolder && open && node.children?.length > 0 && (
        <ul className="file-tree file-tree--nested" role="group">
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              onSelect={onSelect}
              activeNode={activeNode}
              onHoverExplain={onHoverExplain}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

// ── Domain pill on tree rows ──────────────────────────────────────────────────

function DomainPill({ path }) {
  const { getDomainForPath } = useRepoMapContext();
  const domain = getDomainForPath(path);
  if (!domain) return null;
  const tone = DOMAIN_TONE[domain] ?? "coral";
  return (
    <span
      className={`file-tree__domain file-tree__domain--${tone}`}
      title={domain}
      aria-label={`${domain} agent domain`}
    >
      {domain.slice(0, 3)}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * FileSystemMap
 *
 * Props:
 *   nodes     — array of top-level tree nodes ({ name, path, type, children })
 *               Pass null/undefined for empty state, "loading" string for skeleton.
 *   title     — heading string
 *   subtitle  — subheading string
 *   repoMeta  — optional { owner, repo, branch, fullName, truncated }
 *   isLoading — boolean, shows skeleton when true
 */
export function FileSystemMap({ nodes, title, subtitle, repoMeta, isLoading }) {
  const [activeNode, setActiveNode] = useState(null);
  const { requestSummary, requestNodeDetail, getDescriptionForPath } = useRepoMapContext();

  useEffect(() => {
    if (!activeNode) return;
    requestSummary(activeNode.path ?? "");
    requestNodeDetail(activeNode.path ?? "");
  }, [activeNode, requestSummary, requestNodeDetail]);

  function handleHoverExplain(node) {
    requestSummary(node.path ?? "");
  }

  // ── Loading state ───────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <section className="map-view" aria-label="Loading file map">
        <div className="view-heading">
          <div>
            <span className="mono-label">VISUAL FILE MAP</span>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
        </div>
        <SkeletonCanvas />
      </section>
    );
  }

  // ── Empty state ─────────────────────────────────────────────────────────────
  if (!nodes || nodes.length === 0) {
    return (
      <section className="map-view" aria-label="File map — no data">
        <div className="view-heading">
          <div>
            <span className="mono-label">VISUAL FILE MAP</span>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
        </div>
        <EmptyCanvas />
      </section>
    );
  }

  // ── Loaded state ────────────────────────────────────────────────────────────
  const totalNodes = countAllNodes(nodes);

  return (
    <section className="map-view" aria-label={title}>
      <div className="view-heading">
        <div>
          <span className="mono-label">VISUAL FILE MAP</span>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          {repoMeta && (
            <span className="repo-badge" title={repoMeta.fullName ?? `${repoMeta.owner}/${repoMeta.repo}`}>
              <GitBranch size={10} aria-hidden="true" />
              <span className="repo-badge__name">
                {repoMeta.fullName ?? `${repoMeta.owner}/${repoMeta.repo}`}
              </span>
              <span>·</span>
              <span>{repoMeta.branch}</span>
            </span>
          )}
          <span className="view-heading__badge">{totalNodes} nodes</span>
        </div>
      </div>

      {/* Truncation notice */}
      {repoMeta?.truncated && (
        <p
          style={{
            maxWidth: 1120,
            margin: "0 auto 10px",
            fontSize: 11,
            color: "var(--muted-foreground)",
            fontFamily: "var(--font-mono)",
          }}
        >
          ⚠ This repo is very large — GitHub returned a partial tree.
        </p>
      )}

      {/* Canvas: scrollable tree + floating popover */}
      <div className="file-map-canvas" role="tree" aria-label="File tree">
        <div className="file-tree-scroll">
          {/* Sticky popover at top of scroll area */}
          <AnimatePresence>
            {activeNode && (
              <motion.div
                className="file-tree-popover"
                initial={{ opacity: 0, rotateX: -18, y: 10 }}
                animate={{ opacity: 1, rotateX: 0, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.18 }}
              >
                <button
                  type="button"
                  className="file-tree-popover__close"
                  onClick={() => setActiveNode(null)}
                  aria-label="Close explanation"
                >
                  <X size={14} />
                </button>
                <span className="mono-label">IN PLAIN ENGLISH</span>
                <strong>{activeNode.name}</strong>
                <p className="file-tree-popover__desc">
                  {getDescriptionForPath(activeNode.path ?? "")}
                </p>
                <p className="file-tree-popover__path">{activeNode.path}</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Tree */}
          <ul className="file-tree" role="tree" aria-label="Repository file tree">
            {nodes.map((node) => (
              <TreeNode
                key={node.path}
                node={node}
                depth={0}
                onSelect={setActiveNode}
                activeNode={activeNode}
                onHoverExplain={handleHoverExplain}
              />
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function countAllNodes(nodes) {
  return nodes.reduce((sum, n) => {
    return sum + 1 + (n.children ? countAllNodes(n.children) : 0);
  }, 0);
}
