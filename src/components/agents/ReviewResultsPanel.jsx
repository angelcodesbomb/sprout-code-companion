"use client";

import { motion, AnimatePresence } from "motion/react";
import {
  ShieldCheck, ShieldAlert, ScanSearch, CheckCircle2,
  XCircle, AlertTriangle, Wrench, ChevronDown, ChevronUp,
} from "lucide-react";
import { useState } from "react";

// ─── Severity badge ───────────────────────────────────────────────────────────

const SEVERITY_STYLES = {
  critical: { tone: "coral",  label: "CRITICAL" },
  high:     { tone: "orange", label: "HIGH"     },
  medium:   { tone: "yellow", label: "MEDIUM"   },
  low:      { tone: "cyan",   label: "LOW"      },
};

const SEVERITY_VARS = {
  coral:  { bg: "color-mix(in oklab, var(--coral) 18%, var(--card))",  border: "color-mix(in oklab, var(--coral) 55%, var(--border))",  text: "var(--coral)"  },
  orange: { bg: "color-mix(in oklab, #e67e22 18%, var(--card))",       border: "color-mix(in oklab, #e67e22 55%, var(--border))",       text: "#c96a12"        },
  yellow: { bg: "color-mix(in oklab, var(--mint) 18%, var(--card))",   border: "color-mix(in oklab, var(--mint) 55%, var(--border))",   text: "color-mix(in oklab, var(--mint) 70%, var(--foreground))"  },
  cyan:   { bg: "color-mix(in oklab, var(--cyan) 18%, var(--card))",   border: "color-mix(in oklab, var(--cyan) 55%, var(--border))",   text: "color-mix(in oklab, var(--cyan) 70%, var(--foreground))"  },
};

function SeverityBadge({ severity }) {
  const s = SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.low;
  const v = SEVERITY_VARS[s.tone];
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
        background: v.bg,
        border: `1px solid ${v.border}`,
        color: v.text,
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
        background: "var(--muted)",
        border: "1px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <SeverityBadge severity={flag.severity} />
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--foreground)",
            fontFamily: "var(--font-dm-mono, monospace)",
          }}
        >
          {flag.rule}
        </span>
        {flag.file && (
          <span style={{ fontSize: 10, color: "var(--muted-foreground)", marginLeft: "auto" }}>
            {flag.file.split("/").pop()}
            {flag.line ? `:${flag.line}` : ""}
            {" "}
            <span style={{
              padding: "1px 5px",
              borderRadius: 3,
              background: flag.layer === 1
                ? "color-mix(in oklab, var(--cyan) 20%, var(--card))"
                : "color-mix(in oklab, var(--pink) 20%, var(--card))",
              color: flag.layer === 1
                ? "color-mix(in oklab, var(--cyan) 70%, var(--foreground))"
                : "color-mix(in oklab, var(--pink) 70%, var(--foreground))",
              fontSize: 9,
              fontWeight: 700,
            }}>
              L{flag.layer}
            </span>
          </span>
        )}
      </div>
      <p style={{ margin: 0, fontSize: 11, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
        {flag.description}
      </p>
      {flag.snippet && (
        <code style={{
          display: "block",
          fontSize: 10,
          padding: "4px 8px",
          borderRadius: 4,
          background: "color-mix(in oklab, var(--foreground) 6%, var(--card))",
          color: "color-mix(in oklab, var(--coral) 80%, var(--foreground))",
          fontFamily: "var(--font-dm-mono, monospace)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          border: "1px solid var(--border)",
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

  const passColor   = "color-mix(in oklab, var(--mint) 70%, var(--foreground))";
  const failColor   = "color-mix(in oklab, var(--coral) 80%, var(--foreground))";
  const activeColor = pass ? passColor : failColor;

  return (
    <div style={{
      borderRadius: 8,
      border: `1px solid ${pass
        ? "color-mix(in oklab, var(--mint) 40%, var(--border))"
        : "color-mix(in oklab, var(--coral) 40%, var(--border))"}`,
      background: pass
        ? "color-mix(in oklab, var(--mint) 6%, var(--card))"
        : "color-mix(in oklab, var(--coral) 6%, var(--card))",
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
        <Icon size={14} color={activeColor} aria-hidden="true" />
        <span style={{
          flex: 1,
          fontSize: 12,
          fontWeight: 600,
          color: activeColor,
          letterSpacing: "0.04em",
        }}>
          {title}
        </span>
        <span style={{
          fontSize: 10,
          fontWeight: 700,
          padding: "2px 8px",
          borderRadius: 12,
          background: pass
            ? "color-mix(in oklab, var(--mint) 18%, var(--card))"
            : "color-mix(in oklab, var(--coral) 18%, var(--card))",
          color: activeColor,
          letterSpacing: "0.05em",
          border: `1px solid ${pass
            ? "color-mix(in oklab, var(--mint) 40%, var(--border))"
            : "color-mix(in oklab, var(--coral) 40%, var(--border))"}`,
        }}>
          {pass ? "PASSED" : "FLAGGED"}
        </span>
        {open
          ? <ChevronUp size={12} color="var(--muted-foreground)" />
          : <ChevronDown size={12} color="var(--muted-foreground)" />}
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

  const totalFlags   = reviewedSteps.reduce((acc, s) => acc + (s.securityResult?.flags?.length ?? s.securityFlags?.length ?? 0), 0);
  const totalHealed  = reviewedSteps.filter((s) => s.monitorResult?.healed).length;
  const hasAnyFailure = reviewedSteps.some((s) => s.monitorResult?.pass === false || s.securityResult?.pass === false);

  const mintColor = "color-mix(in oklab, var(--mint) 70%, var(--foreground))";
  const failColor = "color-mix(in oklab, var(--coral) 80%, var(--foreground))";

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
          borderBottom: "1px solid var(--border)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: hasAnyFailure
                ? "color-mix(in oklab, var(--coral) 15%, var(--card))"
                : "color-mix(in oklab, var(--mint) 15%, var(--card))",
              display: "flex", alignItems: "center", justifyContent: "center",
              border: `1px solid ${hasAnyFailure
                ? "color-mix(in oklab, var(--coral) 40%, var(--border))"
                : "color-mix(in oklab, var(--mint) 40%, var(--border))"}`,
            }}>
              <ShieldCheck size={18} color={hasAnyFailure ? failColor : mintColor} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--foreground)" }}>
                Security &amp; Quality Audit Report
              </h3>
              <p style={{ margin: 0, fontSize: 11, color: "var(--muted-foreground)" }}>
                Automated multi-agent inspection pipeline (Monitor + Security Gate)
              </p>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <div style={{
              padding: "6px 12px", borderRadius: 6,
              background: "var(--muted)", border: "1px solid var(--border)",
              display: "flex", flexDirection: "column", alignItems: "center",
            }}>
              <span style={{ fontSize: 10, color: "var(--muted-foreground)", textTransform: "uppercase" }}>Steps Audited</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--foreground)" }}>{reviewedSteps.length}</span>
            </div>

            <div style={{
              padding: "6px 12px", borderRadius: 6,
              background: totalHealed > 0
                ? "color-mix(in oklab, var(--mint) 10%, var(--card))"
                : "var(--muted)",
              border: `1px solid ${totalHealed > 0
                ? "color-mix(in oklab, var(--mint) 40%, var(--border))"
                : "var(--border)"}`,
              display: "flex", flexDirection: "column", alignItems: "center",
            }}>
              <span style={{ fontSize: 10, color: "var(--muted-foreground)", textTransform: "uppercase" }}>Auto-Healed</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: mintColor }}>{totalHealed}</span>
            </div>

            <div style={{
              padding: "6px 12px", borderRadius: 6,
              background: totalFlags > 0
                ? "color-mix(in oklab, var(--coral) 10%, var(--card))"
                : "color-mix(in oklab, var(--mint) 10%, var(--card))",
              border: `1px solid ${totalFlags > 0
                ? "color-mix(in oklab, var(--coral) 40%, var(--border))"
                : "color-mix(in oklab, var(--mint) 40%, var(--border))"}`,
              display: "flex", flexDirection: "column", alignItems: "center",
            }}>
              <span style={{ fontSize: 10, color: "var(--muted-foreground)", textTransform: "uppercase" }}>Security Flags</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: totalFlags > 0 ? failColor : mintColor }}>{totalFlags}</span>
            </div>
          </div>
        </div>
      ) : (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          paddingBottom: 6,
          borderBottom: "1px solid var(--border)",
        }}>
          <ShieldCheck size={13} color="var(--muted-foreground)" aria-hidden="true" />
          <span style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            color: "var(--muted-foreground)",
            textTransform: "uppercase",
          }}>
            Review Gates
          </span>
        </div>
      )}

      {/* ── One card per reviewed codegen step ── */}
      {reviewedSteps.map((step, idx) => {
        const agentLabel  = step.agent ?? step.toolName ?? `Step ${step.step}`;
        const monResult   = step.monitorResult  ?? null;
        const secResult   = step.securityResult ?? null;
        const secFlags    = secResult?.flags ?? step.securityFlags ?? [];
        const overallPass = (monResult?.pass !== false) && (secResult?.pass !== false);

        return (
          <div key={step.step ?? idx} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {/* Step label row */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{
                width: 20, height: 20,
                borderRadius: "50%",
                background: overallPass
                  ? "color-mix(in oklab, var(--mint) 18%, var(--card))"
                  : "color-mix(in oklab, var(--coral) 18%, var(--card))",
                border: `1px solid ${overallPass
                  ? "color-mix(in oklab, var(--mint) 45%, var(--border))"
                  : "color-mix(in oklab, var(--coral) 45%, var(--border))"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}>
                {overallPass
                  ? <CheckCircle2 size={11} color={mintColor} />
                  : <AlertTriangle size={11} color={failColor} />}
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--foreground)" }}>
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
                    <p style={{ margin: 0, fontSize: 11, color: "var(--muted-foreground)" }}>
                      No quality issues found.
                    </p>
                  )
                  : (
                    <>
                      <p style={{ margin: 0, fontSize: 11, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
                        {monResult.feedback ?? "Issue detected."}
                      </p>
                      {monResult.healed && (
                        <div style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "5px 10px",
                          borderRadius: 5,
                          background: "color-mix(in oklab, var(--mint) 10%, var(--card))",
                          border: "1px solid color-mix(in oklab, var(--mint) 40%, var(--border))",
                        }}>
                          <Wrench size={10} color={mintColor} />
                          <span style={{ fontSize: 10, color: mintColor, fontWeight: 600 }}>
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
                    <p style={{ margin: 0, fontSize: 11, color: "var(--muted-foreground)" }}>
                      {secResult?.note ?? "No security issues found."}
                    </p>
                  )
                  : (
                    <>
                      {secResult?.note && (
                        <p style={{ margin: "0 0 4px", fontSize: 11, color: "var(--muted-foreground)" }}>
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
