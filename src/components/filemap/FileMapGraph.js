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
 *
 * 5. Dependency edges (file→file imports) are drawn as a SECOND layer above
 *    containment links. They are stored in posMapRef (path→Cartesian) after
 *    each D3 layout run so they can be redrawn independently when `edges` or
 *    `showDeps` change without triggering a full tree redraw.
 */

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { RotateCcw, GitBranch, GitMerge, Loader2 } from "lucide-react";
import { countFiles } from "@/lib/parseGithubTree";
import { DOMAIN_TONE } from "@/lib/repoMap";
import { useRepoMapContext } from "@/context/RepoMapContext";
import { FileMapNodePanel } from "./FileMapNodePanel";

// ─── Constants ────────────────────────────────────────────────────────────────

const PROGRESSIVE_THRESHOLD = 150;
const SIZE_WARN_THRESHOLD   = 500;
const CANVAS_H = 620;
const MARGIN   = 60;

const R_BY_DEPTH = [22, 13, 10, 8, 6, 5];
const nodeR = (depth) => R_BY_DEPTH[Math.min(depth, R_BY_DEPTH.length - 1)];

const TONES = ["coral", "mint", "cyan", "pink"];

// Dep-edge accent — coral, matching the brand highlight colour.
// A single colour keeps it readable; direction is shown by the arrowhead.
const DEP_COLOR_DEFAULT = "var(--coral)";
const DEP_COLOR_HOT     = "var(--coral)";   // hovered edge — same but full opacity
const DEP_STROKE_W      = 1.8;
const DEP_STROKE_W_HOT  = 2.8;

// CSS var cache — busted on theme switch
let _cssCache = {};
function cssVar(name) {
  if (_cssCache[name]) return _cssCache[name];
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  return (_cssCache[name] = v || "#888");
}
function bustCssCache() { _cssCache = {}; }

// ─── Pure tree helpers ────────────────────────────────────────────────────────

function countVisible(node) {
  if (!node.children || node._collapsed) return 1;
  return 1 + node.children.reduce((s, c) => s + countVisible(c), 0);
}

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

function syntheticRoot(nodes, name) {
  return { name: name || "repo", path: "", type: "folder", _tone: 0, _collapsed: false, children: nodes };
}

function buildH(root) {
  return d3.hierarchy(root, (d) =>
    (d.type === "folder" && !d._collapsed && d.children?.length) ? d.children : null
  );
}

function getAncestors(n) {
  const acc = [];
  let cur = n;
  while (cur) { acc.unshift(cur); cur = cur.parent; }
  return acc;
}

function collapseBelow(node, minDepth, cur = 0) {
  if (!node.children) return;
  if (cur >= minDepth && node.type === "folder") node._collapsed = true;
  node.children.forEach((c) => collapseBelow(c, minDepth, cur + 1));
}

function polar2cart(angle, r) {
  return { x: Math.cos(angle - Math.PI / 2) * r, y: Math.sin(angle - Math.PI / 2) * r };
}

// ─── Dep-edge path generator ──────────────────────────────────────────────────

/**
 * Draw a dep edge as a slightly-offset cubic Bézier so it doesn't exactly
 * overlap with the structural containment lines that share the same endpoint.
 * The offset is perpendicular to the chord, giving a gentle arc.
 */
function depEdgePath(sx, sy, tx, ty) {
  const mx = (sx + tx) / 2;
  const my = (sy + ty) / 2;
  // Perpendicular offset — 18% of chord length, always curving "outward"
  const dx = tx - sx;
  const dy = ty - sy;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const perp = 0.18;
  const cx = mx - dy * perp;
  const cy = my + dx * perp;
  return `M${sx},${sy} Q${cx},${cy} ${tx},${ty}`;
}

// ─── Skeleton & empty states ──────────────────────────────────────────────────

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

/**
 * Props:
 *   nodes           — nested tree from parseGithubTree (or null)
 *   repoMeta        — { owner, repo, branch, fullName, … } | null
 *   isLoading       — boolean
 *   isDark          — boolean
 *   edges           — Array<{from, to, type}> from useRepoDependencies
 *   edgesByPath     — Map<path, {out, in}> from useRepoDependencies
 *   depStatus       — "idle"|"loading"|"done"|"error"
 *   onExplainFile   — ({ code, fileName, error, truncated }) => void
 *   onFetchingFile  — (fileName) => void
 */
export function FileMapGraph({ nodes, repoMeta, isLoading, isDark, edges = [], edgesByPath, depStatus = "idle", onExplainFile, onFetchingFile }) {
  const {
    requestSummary,
    requestNodeDetail,
    getDescriptionForPath,
    getDomainForPath,
    registerGraphNavigator,
  } = useRepoMapContext();

  const svgRef  = useRef(null);
  const wrapRef = useRef(null);

  const requestSummaryRef = useRef(requestSummary);
  const requestDetailRef  = useRef(requestNodeDetail);
  const getDomainRef      = useRef(getDomainForPath);
  requestSummaryRef.current = requestSummary;
  requestDetailRef.current  = requestNodeDetail;
  getDomainRef.current      = getDomainForPath;

  // Stable mutable refs
  const treeRef      = useRef(null);
  const zoomRef      = useRef(null);
  const linkSelRef   = useRef(null);   // containment links selection
  const nodeSelRef   = useRef(null);
  const depSelRef    = useRef(null);   // dep-edge paths selection
  const posMapRef    = useRef(new Map()); // path → {_cx, _cy} — filled after each layout

  const setFocusRef    = useRef(null);
  const setBreadRef    = useRef(null);
  const setTooltipRef  = useRef(null);
  const setDrawKeyRef  = useRef(null);

  // React state
  const [focusNode,    setFocusNode]    = useState(null);
  const [breadcrumb,   setBreadcrumb]   = useState([]);
  const [tooltip,      setTooltip]      = useState({ visible: false, x: 0, y: 0, node: null });
  const [edgeTooltip,  setEdgeTooltip]  = useState({ visible: false, x: 0, y: 0, from: "", to: "" });
  const [visibleCount, setVisibleCount] = useState(0);
  const [drawKey,      setDrawKey]      = useState(0);
  const [selectedNode, setSelectedNode] = useState(null);
  const [showDeps,     setShowDeps]     = useState(true); // dep toggle

  const setSelectedRef = useRef(null);
  setSelectedRef.current = setSelectedNode;

  setFocusRef.current   = setFocusNode;
  setBreadRef.current   = setBreadcrumb;
  setTooltipRef.current = setTooltip;
  setDrawKeyRef.current = setDrawKey;

  // Keep a ref to showDeps so D3 handlers can read the current value
  const showDepsRef = useRef(showDeps);
  showDepsRef.current = showDeps;

  // Keep a ref to edgesByPath so hover handlers always see the latest map
  const edgesByPathRef = useRef(edgesByPath);
  edgesByPathRef.current = edgesByPath;

  // ── Explain-file bridge refs (stable for D3 closures) ─────────────────────
  const onExplainFileRef  = useRef(onExplainFile);
  const onFetchingFileRef = useRef(onFetchingFile);
  onExplainFileRef.current  = onExplainFile;
  onFetchingFileRef.current = onFetchingFile;

  // Tracks which node path is currently being fetched so we can pulse it
  const [loadingNodePath, setLoadingNodePath] = useState(null);
  const loadingNodePathRef = useRef(null);
  loadingNodePathRef.current = loadingNodePath;

  // ── Reset everything when a new repo loads ──────────────────────────────
  useEffect(() => {
    treeRef.current = null;
    posMapRef.current = new Map();
    setFocusNode(null);
    setBreadcrumb([]);
    setTooltip({ visible: false, x: 0, y: 0, node: null });
    setEdgeTooltip({ visible: false, x: 0, y: 0, from: "", to: "" });
    setSelectedNode(null);
    setDrawKey(0);
  }, [nodes]);

  // ── Bust colour cache on theme change ───────────────────────────────────
  useEffect(() => { bustCssCache(); }, [isDark]);

  // ── Refresh domain pills when AI fills in tags ───────────────────────────
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

  // ── Pulse class on the node being fetched ────────────────────────────────
  useEffect(() => {
    const sel = nodeSelRef.current;
    if (!sel?.size()) return;
    sel.classed("fmg-node--fetching", (n) => n.data.path === loadingNodePath);
  }, [loadingNodePath, drawKey]);

  // ── Highlight selected node ring ─────────────────────────────────────────
  useEffect(() => {
    const sel = nodeSelRef.current;
    if (!sel?.size()) return;
    const path = selectedNode?.path ?? "__none__";
    sel.classed("fmg-node--selected", (n) => n.data.path === path);
  }, [selectedNode, drawKey]);

  // ── Draw / redraw dep-edge layer ─────────────────────────────────────────
  // This runs independently of the main D3 draw effect so dep edges can
  // appear/disappear without re-running the expensive full layout.
  useEffect(() => {
    const svg = svgRef.current ? d3.select(svgRef.current) : null;
    if (!svg) return;

    const g = svg.select(".fmg-g");
    if (g.empty()) return;

    // Always remove the old layer first — we either replace or leave empty
    g.select(".fmg-dep-links").remove();

    const posMap = posMapRef.current;
    if (!showDeps || !edges?.length || depStatus !== "done" || !posMap.size) return;

    // Only keep edges where BOTH endpoints are currently visible in posMap
    const visible = edges.filter(
      (e) => posMap.has(e.from) && posMap.has(e.to) && e.from !== e.to
    );
    if (!visible.length) return;

    // ── Arrowhead marker defs ──────────────────────────────────────────────
    // Append <defs> once per SVG (inside g so zoom transform doesn't affect it)
    let defs = svg.select("defs.fmg-dep-defs");
    if (defs.empty()) {
      defs = svg.insert("defs", ":first-child").attr("class", "fmg-dep-defs");
    }
    defs.selectAll("marker").remove();

    // Default arrowhead
    defs.append("marker")
      .attr("id", "fmg-arrow")
      .attr("viewBox", "0 -4 8 8")
      .attr("refX", 7)
      .attr("refY", 0)
      .attr("markerWidth", 5)
      .attr("markerHeight", 5)
      .attr("orient", "auto")
      .append("path")
        .attr("d", "M0,-4L8,0L0,4")
        .attr("fill", cssVar("coral"))
        .attr("opacity", 0.75);

    // Hovered / hot arrowhead
    defs.append("marker")
      .attr("id", "fmg-arrow-hot")
      .attr("viewBox", "0 -4 8 8")
      .attr("refX", 7)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
        .attr("d", "M0,-4L8,0L0,4")
        .attr("fill", cssVar("coral"))
        .attr("opacity", 1);

    // ── Layer group — inserted BELOW .fmg-nodes but ABOVE .fmg-links ──────
    // D3 append order: links first, then dep-links, then nodes.
    // We insert before .fmg-nodes so edges appear underneath node circles.
    const depG = g.insert("g", ".fmg-nodes")
      .attr("class", "fmg-dep-links");

    // Invisible wider hit-area paths (for easy hover on thin lines)
    const hitSel = depG.selectAll("path.fmg-dep-hit")
      .data(visible, (e) => `${e.from}→${e.to}`)
      .join("path")
      .attr("class", "fmg-dep-hit")
      .attr("d", (e) => {
        const s = posMap.get(e.from);
        const t = posMap.get(e.to);
        return depEdgePath(s._cx, s._cy, t._cx, t._cy);
      })
      .attr("fill", "none")
      .attr("stroke", "transparent")
      .attr("stroke-width", 10)  // fat invisible hit zone
      .style("cursor", "crosshair");

    // Visible dep-edge paths
    const depSel = depG.selectAll("path.fmg-dep-link")
      .data(visible, (e) => `${e.from}→${e.to}`)
      .join("path")
      .attr("class", "fmg-dep-link")
      .attr("d", (e) => {
        const s = posMap.get(e.from);
        const t = posMap.get(e.to);
        return depEdgePath(s._cx, s._cy, t._cx, t._cy);
      })
      .attr("marker-end", "url(#fmg-arrow)")
      .attr("pointer-events", "none"); // hit area handles events

    depSelRef.current = depSel;

    // ── Edge hover — show tooltip, highlight touching edges ────────────────
    hitSel
      .on("mouseenter", function (event, e) {
        if (!showDepsRef.current) return;

        // Highlight this edge
        depSelRef.current
          ?.classed("fmg-dep-link--dim", (d) => d.from !== e.from || d.to !== e.to)
          .classed("fmg-dep-link--hot", (d) => d.from === e.from && d.to === e.to);

        // Update marker on hot edge
        depSel.filter((d) => d.from === e.from && d.to === e.to)
          .attr("marker-end", "url(#fmg-arrow-hot)");

        // Edge tooltip — positioned at the midpoint of the path
        const pathEl = depSel.filter((d) => d.from === e.from && d.to === e.to).node();
        if (pathEl && svgRef.current) {
          const svgRect = svgRef.current.getBoundingClientRect();
          const transform = d3.zoomTransform(svgRef.current);
          const totalLen = pathEl.getTotalLength();
          const mid = pathEl.getPointAtLength(totalLen / 2);
          const [sx, sy] = transform.apply([mid.x, mid.y]);
          const ex = sx + svgRect.width / 2;
          const ey = sy + svgRect.height / 2;
          const fromName = e.from.split("/").pop();
          const toName   = e.to.split("/").pop();
          setEdgeTooltip({ visible: true, x: ex + 10, y: ey - 28, from: fromName, to: toName });
        }
      })
      .on("mouseleave", function () {
        depSelRef.current
          ?.classed("fmg-dep-link--dim", false)
          .classed("fmg-dep-link--hot", false);
        depSel.attr("marker-end", "url(#fmg-arrow)");
        setEdgeTooltip({ visible: false, x: 0, y: 0, from: "", to: "" });
      });

  // Re-run when dep data, toggle, or tree layout changes (drawKey tracks the latter)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edges, depStatus, showDeps, drawKey, nodes, focusNode]);

  // ── Main D3 draw effect ──────────────────────────────────────────────────
  useEffect(() => {
    if (!nodes?.length || !svgRef.current || !wrapRef.current) return;

    const wrap = wrapRef.current;
    const W = wrap.clientWidth || 800;
    const H = CANVAS_H;
    const svg = d3.select(svgRef.current);

    // 1. Build working tree (once per repo load)
    if (!treeRef.current) {
      const cloned = cloneNodes(nodes);
      const root   = syntheticRoot(cloned, repoMeta?.repo ?? "repo");
      treeRef.current = root;
      if (countVisible(root) > PROGRESSIVE_THRESHOLD) {
        collapseBelow(root, 1);
      }
    }

    // 2. Pick display root
    const displayRoot = focusNode ?? treeRef.current;

    // 3. Layout
    const rootH  = buildH(displayRoot);
    const radius = Math.min(W, H) / 2 - MARGIN;

    d3.cluster()
      .size([2 * Math.PI, radius])
      .separation((a, b) => (a.parent === b.parent ? 1 : 1.8) / Math.max(1, a.depth))
      (rootH);

    rootH.each((d) => {
      const p = polar2cart(d.x, d.y);
      d._cx = p.x;
      d._cy = p.y;
    });

    // ── Store positions so dep-edge effect can use them ────────────────────
    const posMap = new Map();
    rootH.descendants().forEach((d) => {
      posMap.set(d.data.path, { _cx: d._cx, _cy: d._cy });
    });
    posMapRef.current = posMap;

    setVisibleCount(rootH.descendants().length);

    // 4. Clear SVG and rebuild
    svg.attr("viewBox", `${-W / 2} ${-H / 2} ${W} ${H}`);
    svg.selectAll("*").remove();

    // Panning group
    const g = svg.append("g").attr("class", "fmg-g");

    // 5. Zoom
    const zoom = d3.zoom()
      .scaleExtent([0.1, 10])
      .filter((e) => e.type !== "dblclick")
      .on("zoom", (e) => {
        g.attr("transform", e.transform);
        setTooltipRef.current((t) => t.visible ? { ...t, visible: false } : t);
        setEdgeTooltip({ visible: false, x: 0, y: 0, from: "", to: "" });
      });
    svg.call(zoom);
    zoomRef.current = zoom;

    // 6. Containment edges
    function radialLink(d) {
      const s = d.source, t = d.target;
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

    linkSel.each(function (d) {
      const len = this.getTotalLength();
      this.style.setProperty("--len", `${len}px`);
      this.style.animationDelay = `${d.target.depth * 55}ms`;
    });
    linkSel.classed("fmg-link--animate", true);
    linkSelRef.current = linkSel;

    // NOTE: dep-link layer is NOT drawn here — a separate useEffect handles it
    // so it can redraw independently when `edges` arrives without re-running
    // the expensive full layout.

    // 7. Nodes
    const nodeSel = g.append("g").attr("class", "fmg-nodes")
      .selectAll("g")
      .data(rootH.descendants())
      .join("g")
      .attr("class", "fmg-node")
      .attr("transform", (d) => `translate(${d._cx},${d._cy})`);

    nodeSelRef.current = nodeSel;

    nodeSel.each(function (d) {
      const el      = d3.select(this);
      const isRoot  = d.depth === 0;
      const isFolder = d.data.type === "folder";
      const r    = nodeR(d.depth);
      const tone = d.data._tone ?? 0;
      const fill = cssVar(TONES[tone]);

      el.style("opacity", 0).style("animation-delay", `${d.depth * 35}ms`);
      el.transition().delay(d.depth * 35).duration(220).style("opacity", 1);

      el.append("circle")
        .attr("r", r)
        .attr("fill", isRoot ? cssVar("coral") : isFolder ? "var(--card)" : fill)
        .attr("stroke", isRoot ? "var(--foreground)" : fill)
        .attr("stroke-width", isRoot ? 3 : isFolder ? 2.5 : 1.5);

      if (isRoot) {
        el.append("circle")
          .attr("r", r - 7).attr("fill", "none")
          .attr("stroke", "var(--foreground)").attr("stroke-width", 1.5)
          .attr("stroke-dasharray", "3 3").attr("opacity", 0.55);
      }

      if (isFolder && d.data._collapsed && d.data.children?.length) {
        el.append("circle")
          .attr("r", Math.max(2, r * 0.35)).attr("fill", fill)
          .attr("pointer-events", "none");
      }

      if (!isRoot) {
        const domain   = getDomainRef.current?.(d.data.path);
        const toneName = domain ? (DOMAIN_TONE[domain] ?? TONES[tone]) : TONES[tone];
        const pillFill = domain ? cssVar(toneName) : cssVar(TONES[tone]);
        el.append("rect")
          .attr("class", "fmg-domain-pill")
          .attr("x", r * 0.55).attr("y", -r * 0.85)
          .attr("width", domain ? 14 : 6).attr("height", 6)
          .attr("rx", 3).attr("ry", 2)
          .attr("fill", pillFill)
          .attr("stroke", "var(--foreground)").attr("stroke-width", 1.2)
          .attr("pointer-events", "none").attr("title", domain ?? "");
      }

      const flip = d.x > Math.PI;
      const lx   = (r + 5) * (flip ? -1 : 1);
      el.append("text")
        .attr("x", lx).attr("dy", "0.32em")
        .attr("text-anchor", flip ? "end" : "start")
        .attr("opacity", d.depth <= 2 ? 0.9 : 0)
        .text(() => {
          const name = d.data.name || (repoMeta?.repo ?? "repo");
          return name.length > 20 ? name.slice(0, 18) + "…" : name;
        });
    });

    // 8. Hover
    nodeSel
      .on("mouseenter", function (event, d) {
        const svgEl   = svgRef.current;
        const svgRect = svgEl.getBoundingClientRect();
        const transform = d3.zoomTransform(svgEl);

        const [sx, sy] = transform.apply([d._cx, d._cy]);
        const ex = sx + svgRect.width / 2;
        const ey = sy + svgRect.height / 2;
        const tw = 240, th = 140;
        const tx = Math.min(Math.max(ex + 16, 8), svgRect.width - tw - 8);
        const ty = Math.min(Math.max(ey - th / 2, 8), svgRect.height - th - 8);

        setTooltipRef.current({ visible: true, x: tx, y: ty, node: d.data });
        requestSummaryRef.current?.(d.data.path ?? "");

        const r = nodeR(d.depth);
        d3.select(this).select("circle:first-child")
          .transition().duration(160)
          .attr("r", (d.depth === 0 ? 22 : r) * 1.5);

        // Dim containment links not in ancestor chain
        const ancSet = new Set(getAncestors(d).map((a) => a.data.path));
        linkSelRef.current
          ?.classed("fmg-link--dim", (l) =>
            !(ancSet.has(l.source.data.path) && ancSet.has(l.target.data.path)))
          .classed("fmg-link--lit", (l) =>
            ancSet.has(l.source.data.path) && ancSet.has(l.target.data.path));
        nodeSelRef.current
          ?.classed("fmg-node--dim", (n) => !ancSet.has(n.data.path));

        // Highlight dep edges touching this node; dim the rest
        if (showDepsRef.current && depSelRef.current?.size()) {
          const p = d.data.path;
          const touching = new Set();
          const ebp = edgesByPathRef.current;
          if (ebp?.has(p)) {
            ebp.get(p).out.forEach((e) => touching.add(`${e.from}→${e.to}`));
            ebp.get(p).in.forEach((e)  => touching.add(`${e.from}→${e.to}`));
          }
          depSelRef.current
            .classed("fmg-dep-link--dim", (e) => !touching.has(`${e.from}→${e.to}`))
            .classed("fmg-dep-link--hot", (e) =>  touching.has(`${e.from}→${e.to}`));
          depSelRef.current
            .attr("marker-end", (e) =>
              touching.has(`${e.from}→${e.to}`) ? "url(#fmg-arrow-hot)" : "url(#fmg-arrow)"
            );
        }
      })
      .on("mouseleave", function (event, d) {
        setTooltipRef.current((t) => ({ ...t, visible: false }));

        d3.select(this).select("circle:first-child")
          .transition().duration(180).attr("r", nodeR(d.depth));

        linkSelRef.current
          ?.classed("fmg-link--dim", false).classed("fmg-link--lit", false);
        nodeSelRef.current
          ?.classed("fmg-node--dim", false);

        // Reset dep edges
        if (depSelRef.current?.size()) {
          depSelRef.current
            .classed("fmg-dep-link--dim", false)
            .classed("fmg-dep-link--hot", false)
            .attr("marker-end", "url(#fmg-arrow)");
        }
      })
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

        // ── File node: fetch content and send to Explain Code tab ────────────
        if (d.data.type !== "folder" && d.depth > 0) {
          const filePath = d.data.path ?? "";
          if (!filePath || !repoMeta?.owner) return;

          // Notify DashboardShell immediately (switches tab + shows spinner)
          onFetchingFileRef.current?.(filePath);
          setLoadingNodePath(filePath);
          setTooltipRef.current({ visible: false, x: 0, y: 0, node: null });

          const { owner, repo, branch } = repoMeta;
          const MAX_LINES = 1000;

          fetch("/api/github/content", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ owner, repo, branch, paths: [filePath] }),
          })
            .then((res) => {
              if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
              return res.json();
            })
            .then((data) => {
              const raw = data.contents?.[filePath];
              if (raw === undefined || raw === null) {
                // File is binary, too large, or GitHub couldn't serve it — soft message
                setLoadingNodePath(null);
                onExplainFileRef.current?.({
                  code: "",
                  fileName: filePath,
                  error: "This file couldn't be loaded — it may be binary, empty, or too large to display.",
                  truncated: false,
                });
                return;
              }
              // Guard against suspiciously binary-looking content
              if (raw.length > 0 && raw.slice(0, 512).includes("\0")) {
                setLoadingNodePath(null);
                onExplainFileRef.current?.({
                  code: "",
                  fileName: filePath,
                  error: "This looks like a binary file and cannot be displayed.",
                  truncated: false,
                });
                return;
              }
              const lines = raw.split("\n");
              const truncated = lines.length > MAX_LINES;
              const content   = truncated ? lines.slice(0, MAX_LINES).join("\n") : raw;
              setLoadingNodePath(null);
              onExplainFileRef.current?.({
                code: content,
                fileName: filePath,
                error: null,
                truncated,
              });
            })
            .catch((err) => {
              setLoadingNodePath(null);
              onExplainFileRef.current?.({
                code: "",
                fileName: filePath,
                error: err.message || "Failed to load file. Please try again.",
                truncated: false,
              });
            });
          return;
        }

        // ── Folder node: existing drill-in behaviour ───────────────────────
        if (d.data.type !== "folder" || d.depth === 0) return;
        if (d.data._collapsed) return;
        setFocusRef.current(d.data);
        setBreadRef.current((prev) => {
          const last = prev[prev.length - 1];
          return last === d.data ? prev : [...prev, d.data];
        });
        setTooltipRef.current({ visible: false, x: 0, y: 0, node: null });
      });

    // 10. Fit
    requestAnimationFrame(() => fitView(svg, zoom, W, H));

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, focusNode, isDark, drawKey]);

  // ── Graph navigator (ask-bar) ─────────────────────────────────────────────
  useEffect(() => {
    if (!registerGraphNavigator) return;
    const unregister = registerGraphNavigator(async (targetPath) => {
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

      function uncollapsePath(node, path) {
        if (node.path === path) return true;
        if (node.children) {
          for (const c of node.children) {
            if (uncollapsePath(c, path)) { node._collapsed = false; return true; }
          }
        }
        return false;
      }
      uncollapsePath(treeRoot, targetPath);

      setSelectedRef.current?.(match);
      requestSummaryRef.current?.(targetPath);
      requestDetailRef.current?.(targetPath);
      setDrawKeyRef.current?.((k) => k + 1);

      setTimeout(() => {
        const sel = nodeSelRef.current;
        if (!sel) return;
        let targetD3Node = null;
        sel.each((d) => { if (d.data.path === targetPath) targetD3Node = d; });
        if (!targetD3Node || !svgRef.current || !wrapRef.current) return;

        const wrap  = wrapRef.current;
        const W     = wrap.clientWidth || 800;
        const H     = CANVAS_H;
        const scale = 1.8;
        const tx = -targetD3Node._cx * scale;
        const ty = -targetD3Node._cy * scale;

        d3.select(svgRef.current)
          .transition().duration(700)
          .call(zoomRef.current.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));

        sel.classed("fmg-node--selected", (n) => n.data.path === targetPath);
      }, 120);
    });
    return unregister;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerGraphNavigator]);

  // ── Breadcrumb nav ────────────────────────────────────────────────────────
  function navigateTo(idx) {
    if (idx < 0) { setBreadcrumb([]); setFocusNode(null); }
    else { setBreadcrumb((prev) => prev.slice(0, idx + 1)); setFocusNode(breadcrumb[idx]); }
    setTooltip({ visible: false, x: 0, y: 0, node: null });
  }

  // ── Reset view ────────────────────────────────────────────────────────────
  function handleReset() {
    setBreadcrumb([]); setFocusNode(null); setSelectedNode(null);
    setTooltip({ visible: false, x: 0, y: 0, node: null });
    if (svgRef.current && zoomRef.current) {
      d3.select(svgRef.current).transition().duration(480)
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

  const repoLabel    = repoMeta?.fullName ?? repoMeta?.repo ?? "repo";
  const hasDepData   = depStatus === "done" && edges.length > 0;
  const depLoading   = depStatus === "loading";

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

        {/* Node hover tooltip */}
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
              {/* Subtle double-click hint — only for file nodes */}
              {tooltip.node.type !== "folder" && (
                <span className="fmg-tooltip__dblclick-hint">
                  Double-click to explain
                </span>
              )}
            </>
          )}
        </div>

        {/* Dep-edge hover tooltip */}
        <div
          role="tooltip"
          aria-hidden={!edgeTooltip.visible}
          className={`fmg-dep-tooltip ${edgeTooltip.visible ? "fmg-dep-tooltip--visible" : "fmg-dep-tooltip--hidden"}`}
          style={{ left: edgeTooltip.x, top: edgeTooltip.y }}
        >
          {edgeTooltip.visible && (
            <>
              <span className="fmg-dep-tooltip__pill">imports</span>
              <span className="fmg-dep-tooltip__text">
                <strong>{edgeTooltip.from}</strong>
                {" → "}
                <strong>{edgeTooltip.to}</strong>
              </span>
            </>
          )}
        </div>

        {/* Dep toggle + loading indicator */}
        <div className="fmg-dep-controls">
          {depLoading && (
            <span className="fmg-dep-loading" aria-label="Parsing dependencies…">
              <Loader2 size={11} className="fmg-dep-loading__icon" />
              <span>Parsing deps…</span>
            </span>
          )}
          {(hasDepData || depLoading) && (
            <label className="fmg-dep-toggle" title="Show / hide import dependency edges">
              <input
                type="checkbox"
                checked={showDeps}
                onChange={(e) => setShowDeps(e.target.checked)}
                aria-label="Show dependency edges"
              />
              <span className="fmg-dep-toggle__track">
                <span className="fmg-dep-toggle__thumb" />
              </span>
              <span className="fmg-dep-toggle__label">
                <GitMerge size={11} aria-hidden="true" />
                Deps
                {hasDepData && (
                  <span className="fmg-dep-toggle__count">{edges.length}</span>
                )}
              </span>
            </label>
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

// ─── Module-level helpers ─────────────────────────────────────────────────────

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
  } catch (_) { /* getBBox unavailable */ }
}
