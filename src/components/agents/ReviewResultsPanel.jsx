"use client";

import { motion, AnimatePresence } from "motion/react";
import {
  ShieldCheck, ShieldAlert, ScanSearch, CheckCircle2,
  XCircle, AlertTriangle, Wrench, ChevronDown, ChevronUp,
} from "lucide-react";
import { useState } from "react";

// ─── Severity badge ───────────────────────────────────────────────────────────

const SEVERITY_STYLES = {
  critical: { bg: "#3d1a1a", border: "#c0392b", text: "#ff6b6b", label: "CRITICAL" },
  high:     { bg: "#3d2a1a", border: "#e67e22", text: "#ffa94d", label: "HIGH" },
  medium:   { bg: "#2a2d1a", border: "#f1c40f", text: "#ffd43b", label: "MEDIUM" },
  low:      { bg: "#1a2a2d", border: "#3498db", text: "#74c0fc", label: "LOW" },
};

function SeverityBadge({ severity }) {
  const s = SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.low;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 7px",
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.06em",
        background: s.bg,
        border: `1px solid ${s.border}`,
        color: s.text,
        fontFamily: "var(--font-dm-mono, monospace)",
      }}
    >
      {s.label}
    </span>
  );
}

// ─── Individual flag row ──────────────────────────────────────────────────────

function FlagRow({ flag }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "8px 12px",
        borderRadius: 6,
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.07)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <SeverityBadge severity={flag.severity} />
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "rgba(255,255,255,0.85)",
            fontFamily: "var(--font-dm-mono, monospace)",
          }}
        >
          {flag.rule}
        </span>
        {flag.file && (
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginLeft: "auto" }}>
            {flag.file.split("/").pop()}
            {flag.line ? `:${flag.line}` : ""}
            {" "}
            <span style={{
              padding: "1px 5px",
              borderRadius: 3,
              background: flag.layer === 1 ? "rgba(52,152,219,0.15)" : "rgba(155,89,182,0.15)",
              color: flag.layer === 1 ? "#74c0fc" : "#da77f2",
              fontSize: 9,
              fontWeight: 700,
            }}>
              L{flag.layer}
            </span>
          </span>
        )}
      </div>
      <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.55)", lineHeight: 1.5 }}>
        {flag.description}
      </p>
      {flag.snippet && (
        <code style={{
          display: "block",
          fontSize: 10,
          padding: "4px 8px",
          borderRadius: 4,
          background: "rgba(0,0,0,0.35)",
          color: "#ffa94d",
          fontFamily: "var(--font-dm-mono, monospace)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
        }}>
          {flag.snippet.slice(0, 120)}{flag.snippet.length > 120 ? "…" : ""}
        </code>
      )}
    </motion.div>
  );
}

// ─── Gate card ────────────────────────────────────────────────────────────────

function GateCard({ title, icon: Icon, pass, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{
      borderRadius: 8,
      border: `1px solid ${pass ? "rgba(52,211,153,0.25)" : "rgba(248,113,113,0.25)"}`,
      background: pass ? "rgba(52,211,153,0.04)" : "rgba(248,113,113,0.05)",
      overflow: "hidden",
    }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
        aria-expanded={open}
      >
        <Icon size={14} color={pass ? "#34d399" : "#f87171"} aria-hidden="true" />
        <span style={{
          flex: 1,
          fontSize: 12,
          fontWeight: 600,
          color: pass ? "#34d399" : "#f87171",
          letterSpacing: "0.04em",
        }}>
          {title}
        </span>
        <span style={{
          fontSize: 10,
          fontWeight: 700,
          padding: "2px 8px",
          borderRadius: 12,
          background: pass ? "rgba(52,211,153,0.15)" : "rgba(248,113,113,0.15)",
          color: pass ? "#34d399" : "#f87171",
          letterSpacing: "0.05em",
        }}>
          {pass ? "PASSED" : "FLAGGED"}
        </span>
        {open
          ? <ChevronUp size={12} color="rgba(255,255,255,0.35)" />
          : <ChevronDown size={12} color="rgba(255,255,255,0.35)" />}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: "hidden" }}
          >
            <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Public component ─────────────────────────────────────────────────────────

/**
 * ReviewResultsPanel
 *
 * Rendered inside LivePreviewPanel when the orchestrator completes a run.
 * Scans orchSteps for steps that carry monitorResult / securityResult data
 * (attached by loop.js after gate middleware runs) and renders a structured
 * card for each reviewed codegen step.
 *
 * @param {{ orchSteps: import("../../lib/orchestrator/loop.js").Step[], orchStatus: string }} props
 */
export function ReviewResultsPanel({ orchSteps = [], orchStatus = "idle", isFullView = false }) {
  // Find steps that were run through the review gates
  const reviewedSteps = orchSteps.filter(
    (s) => s.monitorResult || s.securityResult || (s.securityFlags?.length > 0)
  );

  if (reviewedSteps.length === 0) return null;

  const totalFlags = reviewedSteps.reduce((acc, s) => acc + (s.securityResult?.flags?.length ?? s.securityFlags?.length ?? 0), 0);
  const totalHealed = reviewedSteps.filter((s) => s.monitorResult?.healed).length;
  const hasAnyFailure = reviewedSteps.some((s) => s.monitorResult?.pass === false || s.securityResult?.pass === false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      style={{ display: "flex", flexDirection: "column", gap: isFullView ? 18 : 12 }}
      aria-label="Review and security results"
    >
      {/* ── Header ── */}
      {isFullView ? (
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          paddingBottom: 12,
          borderBottom: "1px solid rgba(255,255,255,0.1)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: hasAnyFailure ? "rgba(248,113,113,0.15)" : "rgba(52,211,153,0.15)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <ShieldCheck size={18} color={hasAnyFailure ? "#f87171" : "#34d399"} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--foreground)" }}>
                Security & Quality Audit Report
              </h3>
              <p style={{ margin: 0, fontSize: 11, color: "var(--muted-foreground)" }}>
                Automated multi-agent inspection pipeline (Monitor + Security Gate)
              </p>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <div style={{
              padding: "6px 12px", borderRadius: 6,
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
              display: "flex", flexDirection: "column", alignItems: "center",
            }}>
              <span style={{ fontSize: 10, color: "var(--muted-foreground)", textTransform: "uppercase" }}>Steps Audited</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--foreground)" }}>{reviewedSteps.length}</span>
            </div>

            <div style={{
              padding: "6px 12px", borderRadius: 6,
              background: totalHealed > 0 ? "rgba(52,211,153,0.08)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${totalHealed > 0 ? "rgba(52,211,153,0.25)" : "rgba(255,255,255,0.08)"}`,
              display: "flex", flexDirection: "column", alignItems: "center",
            }}>
              <span style={{ fontSize: 10, color: "var(--muted-foreground)", textTransform: "uppercase" }}>Auto-Healed</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#34d399" }}>{totalHealed}</span>
            </div>

            <div style={{
              padding: "6px 12px", borderRadius: 6,
              background: totalFlags > 0 ? "rgba(248,113,113,0.08)" : "rgba(52,211,153,0.08)",
              border: `1px solid ${totalFlags > 0 ? "rgba(248,113,113,0.25)" : "rgba(52,211,153,0.25)"}`,
              display: "flex", flexDirection: "column", alignItems: "center",
            }}>
              <span style={{ fontSize: 10, color: "var(--muted-foreground)", textTransform: "uppercase" }}>Security Flags</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: totalFlags > 0 ? "#f87171" : "#34d399" }}>{totalFlags}</span>
            </div>
          </div>
        </div>
      ) : (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          paddingBottom: 6,
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}>
          <ShieldCheck size={13} color="rgba(255,255,255,0.45)" aria-hidden="true" />
          <span style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            color: "rgba(255,255,255,0.45)",
            textTransform: "uppercase",
          }}>
            Review Gates
          </span>
        </div>
      )}

      {/* ── One card per reviewed codegen step ── */}
      {reviewedSteps.map((step, idx) => {
        const agentLabel = step.agent ?? step.toolName ?? `Step ${step.step}`;
        const monResult  = step.monitorResult  ?? null;
        const secResult  = step.securityResult ?? null;
        const secFlags   = secResult?.flags ?? step.securityFlags ?? [];
        const overallPass = (monResult?.pass !== false) && (secResult?.pass !== false);

        return (
          <div key={step.step ?? idx} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {/* Step label row */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{
                width: 20, height: 20,
                borderRadius: "50%",
                background: overallPass ? "rgba(52,211,153,0.15)" : "rgba(248,113,113,0.15)",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}>
                {overallPass
                  ? <CheckCircle2 size={11} color="#34d399" />
                  : <AlertTriangle size={11} color="#f87171" />}
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>
                {agentLabel}
              </span>
            </div>

            {/* Monitor gate card */}
            {monResult && (
              <GateCard
                title="Quality Review"
                icon={ScanSearch}
                pass={monResult.pass}
                defaultOpen={isFullView || !monResult.pass}
              >
                {monResult.pass
                  ? (
                    <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.45)" }}>
                      No quality issues found.
                    </p>
                  )
                  : (
                    <>
                      <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.65)", lineHeight: 1.5 }}>
                        {monResult.feedback ?? "Issue detected."}
                      </p>
                      {monResult.healed && (
                        <div style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "5px 10px",
                          borderRadius: 5,
                          background: "rgba(52,211,153,0.08)",
                          border: "1px solid rgba(52,211,153,0.2)",
                        }}>
                          <Wrench size={10} color="#34d399" />
                          <span style={{ fontSize: 10, color: "#34d399", fontWeight: 600 }}>
                            Auto-healed — regenerated with fix applied
                          </span>
                        </div>
                      )}
                    </>
                  )}
              </GateCard>
            )}

            {/* Security gate card */}
            {(secResult || secFlags.length > 0) && (
              <GateCard
                title="Security Review"
                icon={secResult?.pass !== false ? ShieldCheck : ShieldAlert}
                pass={secResult?.pass !== false}
                defaultOpen={isFullView || secFlags.length > 0}
              >
                {secFlags.length === 0
                  ? (
                    <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.45)" }}>
                      {secResult?.note ?? "No security issues found."}
                    </p>
                  )
                  : (
                    <>
                      {secResult?.note && (
                        <p style={{ margin: "0 0 4px", fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
                          {secResult.note}
                        </p>
                      )}
                      {secFlags.map((flag, fi) => (
                        <FlagRow
                          key={`${flag.rule}-${flag.line ?? fi}`}
                          flag={typeof flag === "string" ? { rule: flag, severity: "medium", description: flag } : flag}
                        />
                      ))}
                    </>
                  )}
              </GateCard>
            )}
          </div>
        );
      })}
    </motion.div>
  );
}
