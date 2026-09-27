"use client";

import { AnimatePresence, motion } from "motion/react";
import { Lightbulb, Sparkles, X, Code2, ArrowLeft, Loader2, AlertTriangle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** Basic client-side syntax highlight (no deps) */
function highlight(raw) {
  return raw
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\b(import|export|from|const|let|var|function|return|if|else|for|while|await|async|class|try|catch|throw|new|typeof|instanceof|default|switch|case|break|continue|yield|of|in)\b/g, "<b>$1</b>")
    .replace(/((?<!&amp;lt;)(?<!&amp;gt;))(["'`])(?:(?!\2)[^\\]|\\.)*?\2/g, "<em>$&</em>")
    .replace(/\b(true|false|null|undefined|\d+)\b/g, "<u>$1</u>")
    .replace(/(\w+)(?=\s*\()/g, "<mark>$1</mark>");
}

/**
 * Props:
 *   initialCode      — string: pre-fetched file content (from graph double-click)
 *   autoLoadedFrom   — string: filename shown in code panel header when auto-loaded
 *   autoLoadError    — string | null: fetch/parse error message to show inline
 *   isFetchingFile   — boolean: show loading overlay while fetch is in-flight
 *   truncated        — boolean: whether initialCode was clipped to 1000 lines
 */
export function CodeExplainer({
  initialCode = "",
  autoLoadedFrom = "",
  autoLoadError = null,
  isFetchingFile = false,
  truncated = false,
}) {
  const [code, setCode] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [explanation, setExplanation] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [floatPos, setFloatPos] = useState(null);   // {x, y} for the floating button
  const [selectedSnippet, setSelectedSnippet] = useState("");
  const preRef = useRef(null);

  // When a new file is auto-loaded from the graph, replace editor content
  useEffect(() => {
    if (!initialCode) return;
    setCode(initialCode);
    setSubmitted(true);
    setExplanation(null);
    setError(null);
    setFloatPos(null);
  }, [initialCode]);

  const lines = code.split("\n");

  // Listen for text-selection inside the pre block
  useEffect(() => {
    if (!submitted) return;

    function onMouseUp(e) {
      const sel = window.getSelection();
      const text = sel?.toString().trim();

      if (!text || !preRef.current?.contains(sel?.anchorNode)) {
        setFloatPos(null);
        setSelectedSnippet("");
        return;
      }

      // Position the pill near the cursor
      setFloatPos({ x: e.clientX, y: e.clientY });
      setSelectedSnippet(text);
    }

    document.addEventListener("mouseup", onMouseUp);
    return () => document.removeEventListener("mouseup", onMouseUp);
  }, [submitted]);

  async function explainSelection() {
    if (!selectedSnippet) return;
    setFloatPos(null);
    setIsLoading(true);
    setError(null);
    setExplanation(null);

    try {
      const res = await fetch("/api/explain-block", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snippet: selectedSnippet }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setExplanation(data.explanation);
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleReset() {
    setCode("");
    setSubmitted(false);
    setExplanation(null);
    setError(null);
    setFloatPos(null);
  }

  // The filename label shown in the code panel toolbar
  const panelFileName = autoLoadedFrom
    ? autoLoadedFrom.split("/").pop()
    : "snippet.js";

  return (
    <section className="editor-view">
      <div className="view-heading">
        <div>
          <span className="mono-label">CODE EXPLAINER</span>
          <h2>Translate code to plain English.</h2>
          <p>
            {submitted
              ? "Select any part of the code with your mouse — a button will appear to explain it."
              : "Paste any snippet below and hit Go."}
          </p>
        </div>
        <span className="view-heading__badge"><Sparkles size={13} /> AI ready</span>
      </div>

      {/* ── Fetching overlay: shown while the graph node is loading ──────── */}
      {isFetchingFile && (
        <div className="ce-fetch-banner" role="status" aria-live="polite">
          <Loader2 size={14} className="animate-spin" />
          <span>Loading file from GitHub…</span>
        </div>
      )}

      {/* ── Auto-load error state ─────────────────────────────────────────── */}
      {autoLoadError && !isFetchingFile && (
        <div className="ce-load-error" role="alert">
          <AlertTriangle size={15} />
          <span>{autoLoadError} You can still paste code manually below.</span>
        </div>
      )}

      {/* ── Truncation notice ─────────────────────────────────────────────── */}
      {truncated && submitted && !isFetchingFile && !autoLoadError && (
        <div className="ce-truncation-notice" role="status">
          <span>⚡ File was large — showing first 1 000 lines only.</span>
        </div>
      )}

      {!submitted ? (
        /* ── INPUT SCREEN ─────────────────────────────────────────────── */
        <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: 1, padding: "10px 0" }}>
          {error && <div className="repo-map-ask__error">{error}</div>}
          <div style={{ position: "relative", flex: 1, display: "flex", minHeight: 300 }}>
            <textarea
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder={"// Paste your code here…\nconst greet = (name) => `Hello, ${name}!`;"}
              style={{
                width: "100%", flex: 1, padding: "16px",
                background: "var(--background)", border: "2px solid var(--border)",
                borderRadius: 12, fontFamily: "var(--font-mono)",
                fontSize: 13, color: "var(--foreground)",
                resize: "none", outline: "none", lineHeight: 1.6,
              }}
            />
            <div style={{ position: "absolute", bottom: 16, right: 16 }}>
              <button
                type="button"
                className="repo-map-ask__submit"
                disabled={!code.trim()}
                onClick={() => { setError(null); setSubmitted(true); }}
              >
                <Code2 size={14} /> View Code
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* ── CODE + EXPLANATION SCREEN ────────────────────────────────── */
        <div className="editor-layout" style={{ position: "relative" }}>

          {/* Floating "Explain" pill that appears on text selection */}
          <AnimatePresence>
            {floatPos && (
              <motion.button
                type="button"
                className="ce-explain-pill"
                style={{ top: floatPos.y - 48, left: floatPos.x - 60 }}
                initial={{ opacity: 0, scale: 0.8, y: 6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.8, y: 6 }}
                transition={{ duration: 0.15 }}
                onClick={explainSelection}
              >
                <Sparkles size={12} /> Explain this
              </motion.button>
            )}
          </AnimatePresence>

          {/* Code panel */}
          <div className="code-panel">
            <div className="code-panel__top">
              <span className="traffic-lights"><i /><i /><i /></span>
              <strong>{panelFileName}</strong>
              <button
                type="button"
                onClick={handleReset}
                style={{
                  marginLeft: "auto", display: "flex", alignItems: "center",
                  gap: 4, fontSize: 11, fontWeight: "bold",
                  background: "transparent", border: "none",
                  color: "var(--muted-foreground)", cursor: "pointer",
                }}
              >
                <ArrowLeft size={12} /> New Code
              </button>
            </div>
            <pre ref={preRef} style={{ userSelect: "text", cursor: "text" }}>
              {lines.map((line, i) => (
                <span key={i} style={{ display: "flex" }}>
                  <i style={{
                    display: "inline-block", minWidth: 32, paddingRight: 12,
                    textAlign: "right", opacity: 0.35,
                    fontStyle: "normal", userSelect: "none",
                    fontSize: 11, lineHeight: "1.6",
                  }}>
                    {i + 1}
                  </i>
                  <code
                    style={{ flex: 1 }}
                    dangerouslySetInnerHTML={{ __html: highlight(line) || " " }}
                  />
                </span>
              ))}
            </pre>
          </div>

          {/* Explanation panel */}
          <AnimatePresence mode="wait">
            {(isLoading || explanation || error) ? (
              <motion.aside
                className="explanation-panel"
                key="explain"
                initial={{ opacity: 0, x: 35 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 25 }}
              >
                {explanation && (
                  <button
                    className="explanation-panel__close"
                    type="button"
                    onClick={() => setExplanation(null)}
                    aria-label="Close"
                  >
                    <X size={15} />
                  </button>
                )}
                <span className="explanation-panel__icon"><Lightbulb size={24} /></span>
                <span className="mono-label">HERE'S WHAT THIS DOES</span>

                {isLoading && (
                  <p style={{ display: "flex", alignItems: "center", gap: 8, fontStyle: "italic", opacity: 0.7, marginTop: 12 }}>
                    <Loader2 size={14} className="animate-spin" /> Thinking…
                  </p>
                )}
                {error && <p style={{ color: "var(--coral)", marginTop: 12 }}>{error}</p>}
                {explanation && (
                  <>
                    <h3 style={{ marginTop: 12 }}>Selected block</h3>
                    <p>{explanation}</p>
                    <div className="explanation-panel__note">No jargon. Just the useful part.</div>
                  </>
                )}
              </motion.aside>
            ) : (
              <motion.aside
                className="explanation-panel explanation-panel--empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                <span className="explanation-panel__icon"><Lightbulb size={24} /></span>
                <h3>Select some code</h3>
                <p>Click and drag to highlight any part of the code, then hit the <strong>Explain this</strong> button that appears.</p>
              </motion.aside>
            )}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}
