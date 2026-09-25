"use client";

/**
 * FileMapGraph.js  — D3 radial node-link diagram for Sprout.
 *
 * Architecture notes (why things are done this way):
 *
 * 1. Nodes use translate(x,y) in CARTESIAN space (converted from polar after
 *    d3.cluster), NOT the rotate(deg)+translate(r,0) idiom. This avoids the
 *    CSS transform-origin conflict where `transform: scale(0)` in a keyframe
 *    and `transform="rotate(...)"` on the SVG element fight each other and
 *    collapse all nodes to the origin.
 *
 * 2. Tooltip state is managed entirely in React (not appended via D3) so it
 *    survives React re-renders without D3 touching the same DOM nodes.
 *
 * 3. drawKey is included in the main useEffect dependency array so that
 *    expand/collapse clicks (which call setDrawKey) actually trigger a redraw.
 *
 * 4. drillInto / redraw are refs (useRef), not useCallback closures, so the
 *    D3 event handlers (which close over the ref) always call the current
 *    version without stale closure issues.
 */

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { RotateCcw, GitBranch } from "lucide-react";
import { countFiles } from "@/lib/parseGithubTree";
import { DOMAIN_TONE } from "@/lib/repoMap";
import { useRepoMapContext } from "@/context/RepoMapContext";
import { FileMapNodePanel } from "./FileMapNodePanel";

// ─── Constants ────────────────────────────────────────────────────────────────

const PROGRESSIVE_THRESHOLD = 150;  // if total nodes > this, start collapsed
const SIZE_WARN_THRESHOLD = 500;  // show banner above this many visible nodes
const CANVAS_H = 620;  // must match .fmg-wrap height in CSS
const MARGIN = 60;   // px breathing room around radial tree

// Node radius by depth (root=0 is largest)
const R_BY_DEPTH = [22, 13, 10, 8, 6, 5];
const nodeR = (depth) => R_BY_DEPTH[Math.min(depth, R_BY_DEPTH.length - 1)];

// Four brand tones assigned round-robin to top-level folders
const TONES = ["coral", "mint", "cyan", "pink"];

// CSS var cache — busted on theme switch
let _cssCache = {};
function cssVar(name) {
  if (_cssCache[name]) return _cssCache[name];
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  return (_cssCache[name] = v || "#888");
}
function bustCssCache() { _cssCache = {}; }

// ─── Pure tree helpers ────────────────────────────────────────────────────────

/** Count visible nodes, treating _collapsed folders as leaves. */
function countVisible(node) {
  if (!node.children || node._collapsed) return 1;
  return 1 + node.children.reduce((s, c) => s + countVisible(c), 0);
}

/** Deep-clone nodes array, stamping _tone and _collapsed onto each node. */
function cloneNodes(nodes, toneIdx = 0, depth = 0) {
  return nodes.map((n, i) => {
    const tone = depth === 0 ? (i % TONES.length) : toneIdx;
    return {
      ...n,
      _tone: tone,
      _collapsed: false,
      children: n.children ? cloneNodes(n.children, tone, depth + 1) : undefined,
    };
  });
}

/** Wrap cloned top-level nodes in a single synthetic root. */
function syntheticRoot(nodes, name) {
  return { name: name || "repo", path: "", type: "folder", _tone: 0, _collapsed: false, children: nodes };
}

/** Build d3.hierarchy, hiding children of collapsed folders. */
function buildH(root) {
  return d3.hierarchy(root, (d) =>
    (d.type === "folder" && !d._collapsed && d.children?.length) ? d.children : null
  );
}

/** Collect all d3 ancestor nodes of n (inclusive, root→n). */
function getAncestors(n) {
  const acc = [];
  let cur = n;
  while (cur) { acc.unshift(cur); cur = cur.parent; }
  return acc;
}

/** Recursively collapse folders at depth >= minDepth (mutates in place). */
function collapseBelow(node, minDepth, cur = 0) {
  if (!node.children) return;
  if (cur >= minDepth && node.type === "folder") node._collapsed = true;
  node.children.forEach((c) => collapseBelow(c, minDepth, cur + 1));
}

/** Convert polar (angle in radians, radius) to Cartesian {x, y}. */
function polar2cart(angle, r) {
  return { x: Math.cos(angle - Math.PI / 2) * r, y: Math.sin(angle - Math.PI / 2) * r };
}

// ─── Skeleton & empty states (unchanged from FileSystemMap) ──────────────────

const GHOST_POS = ["root", "mid-left", "mid-right", "low-left", "low-center", "low-right"];

function SkeletonCanvas() {
  return (
    <div className="file-map-skeleton" aria-label="Loading…" aria-busy="true">
      <svg className="map-connectors" viewBox="0 0 1000 590" preserveAspectRatio="none" aria-hidden="true">
        <path d="M500 105V175M500 175H245V245M500 175H755V245M245 315V390M245 390H115V470M245 390H380V470M755 315V470" />
        <circle cx="500" cy="175" r="6" /><circle cx="245" cy="390" r="6" />
      </svg>
      {GHOST_POS.map((p) => <div key={p} className={`file-node-ghost file-node-ghost--${p} skeleton-shimmer`} />)}
    </div>
  );
}

function EmptyCanvas() {
  return (
    <div className="file-map-empty" role="region" aria-label="No repository loaded">
      <span className="file-map-empty__illustration" aria-hidden="true"><GitBranch size={26} /></span>
      <h3 className="file-map-empty__title">Paste a repo to get started</h3>
      <p className="file-map-empty__subtitle">
        Enter any public GitHub URL above and Sprout will draw its entire
        file structure as a radial node graph.
      </p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function FileMapGraph({ nodes, repoMeta, isLoading, isDark }) {
  const {
    requestSummary,
    requestNodeDetail,
    getDescriptionForPath,
    getDomainForPath,
    registerGraphNavigator,
  } = useRepoMapContext();

  const svgRef = useRef(null);
  const wrapRef = useRef(null);

  const requestSummaryRef = useRef(requestSummary);
  const requestDetailRef = useRef(requestNodeDetail);
  const getDomainRef = useRef(getDomainForPath);
  requestSummaryRef.current = requestSummary;
  requestDetailRef.current = requestNodeDetail;
  getDomainRef.current = getDomainForPath;

  // Stable mutable refs — safe to read inside D3 event handlers
  const treeRef = useRef(null);   // working copy of the cloned tree
  const zoomRef = useRef(null);   // d3.zoom instance
  const linkSelRef = useRef(null);   // current link selection (for hover highlighting)
  const nodeSelRef = useRef(null);   // current node selection

  // These refs hold the *current* versions of state-setter callbacks so
  // D3 event handlers never close over stale values.
  const setFocusRef = useRef(null);
  const setBreadRef = useRef(null);
  const setTooltipRef = useRef(null);
  const setDrawKeyRef = useRef(null);

  // React state
  const [focusNode, setFocusNode] = useState(null);
  const [breadcrumb, setBreadcrumb] = useState([]);
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, node: null });
  const [visibleCount, setVisibleCount] = useState(0);
  const [drawKey, setDrawKey] = useState(0);
  const [selectedNode, setSelectedNode] = useState(null);

  const setSelectedRef = useRef(null);
  setSelectedRef.current = setSelectedNode;

  // Keep refs in sync with latest setters
  setFocusRef.current = setFocusNode;
  setBreadRef.current = setBreadcrumb;
  setTooltipRef.current = setTooltip;
  setDrawKeyRef.current = setDrawKey;

  // ── Reset everything when a new repo loads ──────────────────────────────
  useEffect(() => {
    treeRef.current = null;
    setFocusNode(null);
    setBreadcrumb([]);
    setTooltip({ visible: false, x: 0, y: 0, node: null });
    setSelectedNode(null);
    setDrawKey(0);
  }, [nodes]);

  // ── Bust colour cache on theme change ───────────────────────────────────
  useEffect(() => { bustCssCache(); }, [isDark]);

  // ── Refresh domain pills when AI fills in tags (no full graph redraw) ───
  useEffect(() => {
    const sel = nodeSelRef.current;
    if (!sel?.size()) return;
    sel.each(function (d) {
      if (d.depth === 0) return;
      const domain = getDomainForPath(d.data.path);
      if (!domain) return;
      const tone = DOMAIN_TONE[domain] ?? "coral";
      const fill = cssVar(tone);
      const pill = d3.select(this).select(".fmg-domain-pill");
      if (pill.empty()) return;
      pill.attr("fill", fill).attr("title", domain);
    });
  }, [getDomainForPath, getDescriptionForPath]);

  // ── Highlight selected node ring ────────────────────────────────────────
  useEffect(() => {
    const sel = nodeSelRef.current;
    if (!sel?.size()) return;
    const path = selectedNode?.path ?? "__none__";
    sel.classed("fmg-node--selected", (n) => n.data.path === path);
  }, [selectedNode, drawKey]);

  // ── Main D3 draw effect ─────────────────────────────────────────────────
  useEffect(() => {
    if (!nodes?.length || !svgRef.current || !wrapRef.current) return;

    const wrap = wrapRef.current;
    const W = wrap.clientWidth || 800;
    const H = CANVAS_H;
    const svg = d3.select(svgRef.current);

    // 1. Build working tree (once per repo load)
    if (!treeRef.current) {
      const cloned = cloneNodes(nodes);
      const root = syntheticRoot(cloned, repoMeta?.repo ?? "repo");
      treeRef.current = root;
      if (countVisible(root) > PROGRESSIVE_THRESHOLD) {
        collapseBelow(root, 1);
      }
    }

    // 2. Pick display root (full tree or drilled-in subtree)
    const displayRoot = focusNode ?? treeRef.current;

    // 3. Build hierarchy & run layout
    const rootH = buildH(displayRoot);
    const radius = Math.min(W, H) / 2 - MARGIN;

    d3.cluster()
      .size([2 * Math.PI, radius])
      .separation((a, b) => (a.parent === b.parent ? 1 : 1.8) / Math.max(1, a.depth))
      (rootH);

    // Pre-compute Cartesian positions for every node
    rootH.each((d) => {
      const p = polar2cart(d.x, d.y);
      d._cx = p.x;
      d._cy = p.y;
    });

    setVisibleCount(rootH.descendants().length);

    // 4. Clear SVG and rebuild
    svg.attr("viewBox", `${-W / 2} ${-H / 2} ${W} ${H}`);
    svg.selectAll("*").remove();

    // Panning group (zoom target)
    const g = svg.append("g").attr("class", "fmg-g");

    // 5. Zoom
    const zoom = d3.zoom()
      .scaleExtent([0.1, 10])
      .filter((e) => e.type !== "dblclick")
      .on("zoom", (e) => {
        g.attr("transform", e.transform);
        setTooltipRef.current((t) => t.visible ? { ...t, visible: false } : t);
      });
    svg.call(zoom);
    zoomRef.current = zoom;

    // 6. Edges — drawn as curved lines between Cartesian positions
    const line = d3.linkVertical()
      .x((d) => d._cx)
      .y((d) => d._cy);

    // For radial we use a custom cubic bezier between source and target
    function radialLink(d) {
      const s = d.source, t = d.target;
      // Midpoint on a line 60% of the way from parent to child radius
      const mr = (s.y + t.y) / 2;
      const ms = polar2cart(s.x, mr);
      const mt = polar2cart(t.x, mr);
      return `M${s._cx},${s._cy} C${ms.x},${ms.y} ${mt.x},${mt.y} ${t._cx},${t._cy}`;
    }

    const linkSel = g.append("g").attr("class", "fmg-links")
      .selectAll("path")
      .data(rootH.links())
      .join("path")
      .attr("class", "fmg-link")
      .attr("d", radialLink);

    // Grow-in animation — set --len per path, add class
    linkSel.each(function (d) {
      const len = this.getTotalLength();
      this.style.setProperty("--len", `${len}px`);
      this.style.animationDelay = `${d.target.depth * 55}ms`;
    });
    linkSel.classed("fmg-link--animate", true);
    linkSelRef.current = linkSel;

    // 7. Nodes — positioned at Cartesian coords, NO rotate transform
    const nodeSel = g.append("g").attr("class", "fmg-nodes")
      .selectAll("g")
      .data(rootH.descendants())
      .join("g")
      .attr("class", "fmg-node")
      .attr("transform", (d) => `translate(${d._cx},${d._cy})`);

    nodeSelRef.current = nodeSel;

    // Draw each node's circle(s) and label
    nodeSel.each(function (d) {
      const el = d3.select(this);
      const isRoot = d.depth === 0;
      const isFolder = d.data.type === "folder";
      const r = nodeR(d.depth);
      const tone = d.data._tone ?? 0;
      const fill = cssVar(TONES[tone]);

      // Pop-in via CSS animation — delay by depth
      el.style("opacity", 0)
        .style("animation-delay", `${d.depth * 35}ms`);

      // Animate opacity in (simpler than fmg-pop which conflicted with transform)
      el.transition()
        .delay(d.depth * 35)
        .duration(220)
        .style("opacity", 1);

      // Main circle
      el.append("circle")
        .attr("r", r)
        .attr("fill", isRoot ? cssVar("coral") : isFolder ? "var(--card)" : fill)
        .attr("stroke", isRoot ? "var(--foreground)" : fill)
        .attr("stroke-width", isRoot ? 3 : isFolder ? 2.5 : 1.5);

      // Root: dashed inner ring for the "trunk" look
      if (isRoot) {
        el.append("circle")
          .attr("r", r - 7)
          .attr("fill", "none")
          .attr("stroke", "var(--foreground)")
          .attr("stroke-width", 1.5)
          .attr("stroke-dasharray", "3 3")
          .attr("opacity", 0.55);
      }

      // Collapsed folder dot
      if (isFolder && d.data._collapsed && d.data.children?.length) {
        el.append("circle")
          .attr("r", Math.max(2, r * 0.35))
          .attr("fill", fill)
          .attr("pointer-events", "none");
      }

      // Agent domain pill (skip synthetic root)
      if (!isRoot) {
        const domain = getDomainRef.current?.(d.data.path);
        const toneName = domain ? (DOMAIN_TONE[domain] ?? TONES[tone]) : TONES[tone];
        const pillFill = domain ? cssVar(toneName) : cssVar(TONES[tone]);
        el.append("rect")
          .attr("class", "fmg-domain-pill")
          .attr("x", r * 0.55)
          .attr("y", -r * 0.85)
          .attr("width", domain ? 14 : 6)
          .attr("height", 6)
          .attr("rx", 3)
          .attr("ry", 2)
          .attr("fill", pillFill)
          .attr("stroke", "var(--foreground)")
          .attr("stroke-width", 1.2)
          .attr("pointer-events", "none")
          .attr("title", domain ?? "");
      }

      // Label — flip text on the left half of the circle so it reads left→right
      const flip = d.x > Math.PI;   // left hemisphere when angle > 180°
      const lx = (r + 5) * (flip ? -1 : 1);

      el.append("text")
        .attr("x", lx)
        .attr("dy", "0.32em")
        .attr("text-anchor", flip ? "end" : "start")
        .attr("opacity", d.depth <= 2 ? 0.9 : 0)
        .text(() => {
          const name = d.data.name || (repoMeta?.repo ?? "repo");
          return name.length > 20 ? name.slice(0, 18) + "…" : name;
        });
    });

    // 8. Hover interaction
    nodeSel
      .on("mouseenter", function (event, d) {
        const svgEl = svgRef.current;
        const svgRect = svgEl.getBoundingClientRect();
        const wrapRect = wrap.getBoundingClientRect();
        const transform = d3.zoomTransform(svgEl);

        // Map node Cartesian → screen position inside wrapper
        const [sx, sy] = transform.apply([d._cx, d._cy]);
        const ex = sx + svgRect.width / 2;
        const ey = sy + svgRect.height / 2;

        const tw = 240, th = 140;
        const tx = Math.min(Math.max(ex + 16, 8), svgRect.width - tw - 8);
        const ty = Math.min(Math.max(ey - th / 2, 8), svgRect.height - th - 8);

        setTooltipRef.current({ visible: true, x: tx, y: ty, node: d.data });

        requestSummaryRef.current?.(d.data.path ?? "");

        // Scale up the node circle
        const r = nodeR(d.depth);
        d3.select(this).select("circle:first-child")
          .transition().duration(160)
          .attr("r", (d.depth === 0 ? 22 : r) * 1.5);

        // Highlight ancestor chain
        const ancSet = new Set(getAncestors(d).map((a) => a.data.path));
        linkSelRef.current
          ?.classed("fmg-link--dim", (l) =>
            !(ancSet.has(l.source.data.path) && ancSet.has(l.target.data.path)))
          .classed("fmg-link--lit", (l) =>
            ancSet.has(l.source.data.path) && ancSet.has(l.target.data.path));
        nodeSelRef.current
          ?.classed("fmg-node--dim", (n) => !ancSet.has(n.data.path));
      })
      .on("mouseleave", function (event, d) {
        setTooltipRef.current((t) => ({ ...t, visible: false }));

        d3.select(this).select("circle:first-child")
          .transition().duration(180)
          .attr("r", nodeR(d.depth));

        linkSelRef.current
          ?.classed("fmg-link--dim", false)
          .classed("fmg-link--lit", false);
        nodeSelRef.current
          ?.classed("fmg-node--dim", false);
      })
      // 9. Click — select + detail; double-click folder to focus in graph
      .on("click", function (event, d) {
        event.stopPropagation();

        setSelectedRef.current?.(d.data);
        const nodePath = d.data.path ?? "";
        requestSummaryRef.current?.(nodePath);
        requestDetailRef.current?.(nodePath);

        if (d.data.type === "folder" && d.data._collapsed) {
          d.data._collapsed = false;
          setDrawKeyRef.current((k) => k + 1);
        }
      })
      .on("dblclick", function (event, d) {
        event.stopPropagation();
        if (d.data.type !== "folder" || d.depth === 0) return;
        if (d.data._collapsed) return;

        setFocusRef.current(d.data);
        setBreadRef.current((prev) => {
          const last = prev[prev.length - 1];
          return last === d.data ? prev : [...prev, d.data];
        });
        setTooltipRef.current({ visible: false, x: 0, y: 0, node: null });
      });

    // 10. Fit everything into view
    requestAnimationFrame(() => fitView(svg, zoom, W, H));

    // drawKey is intentionally included so expand/collapse triggers a redraw
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, focusNode, isDark, drawKey]);

  // ── Register graph navigator so ask-bar can jump to a path ─────────────────
  useEffect(() => {
    if (!registerGraphNavigator) return;
    const unregister = registerGraphNavigator(async (targetPath) => {
      // Find the matching data node recursively in the working tree
      const treeRoot = treeRef.current;
      if (!treeRoot) return;

      function findNode(node, path) {
        if (node.path === path) return node;
        if (node.children) {
          for (const c of node.children) {
            const found = findNode(c, path);
            if (found) return found;
          }
        }
        return null;
      }

      const match = findNode(treeRoot, targetPath);
      if (!match) return;

      // Un-collapse ancestors so the node is visible
      function uncollapsePath(node, path) {
        if (node.path === path) return true;
        if (node.children) {
          for (const c of node.children) {
            if (uncollapsePath(c, path)) {
              node._collapsed = false;
              return true;
            }
          }
        }
        return false;
      }
      uncollapsePath(treeRoot, targetPath);

      // Select the node in React state → opens detail panel
      setSelectedRef.current?.(match);
      requestSummaryRef.current?.(targetPath);
      requestDetailRef.current?.(targetPath);

      // Trigger a redraw so uncollapsed nodes appear
      setDrawKeyRef.current?.((k) => k + 1);

      // After redraw, fly the camera to the node
      setTimeout(() => {
        const sel = nodeSelRef.current;
        if (!sel) return;
        let targetD3Node = null;
        sel.each((d) => {
          if (d.data.path === targetPath) targetD3Node = d;
        });
        if (!targetD3Node || !svgRef.current || !wrapRef.current) return;

        const wrap = wrapRef.current;
        const W = wrap.clientWidth || 800;
        const H = CANVAS_H;
        const scale = 1.8;
        const tx = -targetD3Node._cx * scale;
        const ty = -targetD3Node._cy * scale;

        d3.select(svgRef.current)
          .transition().duration(700)
          .call(
            zoomRef.current.transform,
            d3.zoomIdentity.translate(tx, ty).scale(scale)
          );

        // Pulse the selected circle briefly
        sel.classed("fmg-node--selected", (n) => n.data.path === targetPath);
      }, 120);
    });
    return unregister;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerGraphNavigator]);

  // ── Breadcrumb navigation ─────────────────────────────────────────────────
  function navigateTo(idx) {
    if (idx < 0) {
      setBreadcrumb([]);
      setFocusNode(null);
    } else {
      setBreadcrumb((prev) => prev.slice(0, idx + 1));
      setFocusNode(breadcrumb[idx]);
    }
    setTooltip({ visible: false, x: 0, y: 0, node: null });
  }

  // ── Reset view button ─────────────────────────────────────────────────────
  function handleReset() {
    setBreadcrumb([]);
    setFocusNode(null);
    setSelectedNode(null);
    setTooltip({ visible: false, x: 0, y: 0, node: null });
    if (svgRef.current && zoomRef.current) {
      d3.select(svgRef.current)
        .transition().duration(480)
        .call(zoomRef.current.transform, d3.zoomIdentity);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (isLoading) return <SkeletonCanvas />;
  if (!nodes?.length) return <EmptyCanvas />;

  function focusFolder(node) {
    if (!node || node.type !== "folder") return;
    setFocusNode(node);
    setBreadcrumb((prev) => {
      const last = prev[prev.length - 1];
      return last === node ? prev : [...prev, node];
    });
    setDrawKey((k) => k + 1);
  }

  const repoLabel = repoMeta?.fullName ?? repoMeta?.repo ?? "repo";

  return (
    <div className="file-map-stack">
      <div className="fmg-wrap" ref={wrapRef} aria-label="File map graph">

        {visibleCount > SIZE_WARN_THRESHOLD && (
          <div className="fmg-size-warning" role="status" aria-live="polite">
            {visibleCount} nodes visible — double-click folders to focus a branch
          </div>
        )}

        {breadcrumb.length > 0 && (
          <nav className="fmg-breadcrumb" aria-label="File tree navigation">
            <button type="button" className="fmg-breadcrumb__item" onClick={() => navigateTo(-1)}>
              {repoLabel}
            </button>
            {breadcrumb.map((crumb, i) => (
              <span key={crumb.path || i} style={{ display: "contents" }}>
                <span className="fmg-breadcrumb__sep" aria-hidden="true">/</span>
                <button
                  type="button"
                  className={`fmg-breadcrumb__item${i === breadcrumb.length - 1 ? " fmg-breadcrumb__item--current" : ""}`}
                  onClick={() => i < breadcrumb.length - 1 ? navigateTo(i) : undefined}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </nav>
        )}

        <svg ref={svgRef} className="fmg-svg" style={{ cursor: "grab" }} aria-hidden="true" />

        {/* Tooltip — React-managed, absolutely positioned inside wrapper */}
        <div
          role="tooltip"
          aria-hidden={!tooltip.visible}
          className={`fmg-tooltip ${tooltip.visible ? "fmg-tooltip--visible" : "fmg-tooltip--hidden"}`}
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.node && (
            <>
              <span className="fmg-tooltip__label">IN PLAIN ENGLISH</span>
              <strong className="fmg-tooltip__name">{tooltip.node.name || repoLabel}</strong>
              <p className="fmg-tooltip__desc fmg-tooltip__desc--live">
                {getDescriptionForPath(tooltip.node.path ?? "")}
              </p>
              <p className="fmg-tooltip__path">{tooltip.node.path || repoLabel}</p>
            </>
          )}
        </div>

        <button type="button" className="fmg-reset" onClick={handleReset} aria-label="Reset view">
          <span>Reset view</span>
          <span className="fmg-reset__arrow" aria-hidden="true"><RotateCcw size={12} /></span>
        </button>
      </div>

      <FileMapNodePanel
        node={selectedNode}
        onClose={() => setSelectedNode(null)}
        onFocusFolder={focusFolder}
      />
    </div>
  );
}

// ─── Module-level D3 helpers ──────────────────────────────────────────────────

function fitView(svg, zoom, W, H) {
  const g = svg.select(".fmg-g");
  if (g.empty()) return;
  try {
    const b = g.node().getBBox();
    if (!b.width || !b.height) return;
    const scale = 0.85 * Math.min(W / b.width, H / b.height);
    const tx = -scale * (b.x + b.width / 2);
    const ty = -scale * (b.y + b.height / 2);
    svg.transition().duration(700)
      .call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  } catch (_) { /* getBBox unavailable — skip */ }
}
