/**
 * Orchestrator Loop
 * =================
 * Pipeline execution is now deterministic: buildPlan() computes the phase
 * sequence up front and the loop iterates over it directly. No LLM call
 * decides "what's next" — routing is pure logic in planner.js.
 *
 * What was removed vs the previous version:
 *   - callGroqWithTools / getModel imports (routing no longer uses LLM)
 *   - messages[] conversation history array
 *   - trimMessages() + MAX_HISTORY_MESSAGES
 *   - assistantToolMessage() + toolResultMessage()
 *   - isQwenStyleModel() and the Qwen message-splice block
 *   - buildOrchestratorSystemPrompt import
 *   - MAX_STEPS = 14 (replaced by plan.length, at most 7 phases)
 *
 * What is unchanged in behaviour:
 *   - securityGate / monitorGate fire at exactly the same relative point
 *     (immediately after a CODEGEN_TOOLS step completes, before the next phase)
 *   - onToolStart / onStepComplete fire with the same timing and argument shapes
 *   - steps[] entry shape is identical: { step, toolName, toolInput, result,
 *     timestamp, agent, securityFlags? }
 *   - Final return shape: { steps, finalAnswer, context }
 *   - compressToolResult is kept — still used for the step.result stored in
 *     steps[] and emitted via onStepComplete to the SSE / frontend layer
 */

import { createOrchestratorTools, findTool } from "./tools.js";
import { assertToolResult } from "./validate.js";
import { createRunContext, serializeContext } from "./context.js";
import { runMonitorReview, runSecurityReview } from "./agents/reviewAgent.js";
import { buildPlan, phaseToToolName, buildToolInput, buildFinalAnswer } from "./planner.js";

const CODEGEN_TOOLS = new Set(["ui_agent_generate", "api_agent_generate", "db_agent_design_schema"]);

// ─── Gates ────────────────────────────────────────────────────────────────────

/**
 * Security gate — runs automatically after every codegen step.
 * Calls the Review Agent directly (Qwen, ~300 tokens) — no orchestrator turn wasted.
 * Returns { pass, flags, note }.
 */
async function securityGate(artifact) {
  if (!artifact?.files?.length) return { pass: true };
  try {
    return await runSecurityReview(artifact);
  } catch (err) {
    console.warn(`[orchestrator/loop] securityGate error — passing through: ${err.message}`);
    return { pass: true };
  }
}

/**
 * Monitor gate — runs automatically after every codegen step.
 * Calls the Review Agent directly (Qwen, ~300 tokens) — no orchestrator turn wasted.
 * Returns { pass, feedback, checks }.
 */
async function monitorGate(artifact) {
  if (!artifact?.files?.length) return { pass: true };
  try {
    return await runMonitorReview(artifact);
  } catch (err) {
    console.warn(`[orchestrator/loop] monitorGate error — passing through: ${err.message}`);
    return { pass: true };
  }
}

// ─── Result compression ───────────────────────────────────────────────────────

/**
 * Strip file content from a tool result before storing in steps[].
 * File content can be thousands of tokens — the step record only needs
 * metadata: ok, artifactId, summary, paths.
 */
function compressToolResult(result, toolName) {
  if (!result?.output) return result;

  const out = result.output;

  // Codegen tools: strip the file content arrays, keep only metadata
  if (CODEGEN_TOOLS.has(toolName) && out.artifact) {
    return {
      ...result,
      output: {
        artifactId: out.artifactId,
        summary:    out.artifact?.summary ?? "",
        paths:      out.artifact?.paths   ?? [],
        agent:      out.artifact?.agent   ?? "",
      },
    };
  }

  // github_read_repo: strip samplePaths which can be large
  if (toolName === "github_read_repo" && out.samplePaths) {
    const { samplePaths: _, ...rest } = out;
    return { ...result, output: rest };
  }

  return result;
}

// ─── Agent label helper ───────────────────────────────────────────────────────

function toolNameToAgentLabel(toolName) {
  if (toolName.startsWith("github_"))       return "GitHub";
  if (toolName.startsWith("map_parser"))    return "Map Parser";
  if (toolName.startsWith("db_agent"))      return "Database";
  if (toolName.startsWith("ui_agent"))      return "UI";
  if (toolName.startsWith("api_agent"))     return "API";
  if (toolName.startsWith("monitor_"))      return "Monitor";
  if (toolName.startsWith("security_"))     return "Security";
  if (toolName.startsWith("live_preview"))  return "Live Preview";
  return "Orchestrator";
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export async function runOrchestrator({
  goal,
  mapSnapshot      = null,
  githubToken      = null,
  autoApproveHuman = false,
  onToolStart,
  onStepComplete,
}) {
  const ctx   = createRunContext({ goal, mapSnapshot, githubToken, autoApproveHuman });
  const tools = createOrchestratorTools(ctx);

  // Compute the full pipeline plan up front — pure function, no LLM call.
  const plan = buildPlan(goal, ctx);

  const steps = [];

  for (const phase of plan) {
    const toolName = phaseToToolName(phase);
    const tool     = findTool(tools, toolName);

    if (!tool) {
      // Should never happen if planner.js and tools.js are in sync —
      // surface it clearly rather than silently skipping.
      return {
        steps,
        finalAnswer: `Orchestrator error: planner requested unknown tool "${toolName}" for phase "${phase}".`,
        context: serializeContext(ctx),
      };
    }

    const toolInput = buildToolInput(phase, ctx);

    if (typeof onToolStart === "function") onToolStart(toolName);

    const raw    = await tool.run(toolInput);
    const result = assertToolResult(raw, toolName);

    const stepNum = steps.length + 1;
    const step = {
      step:      stepNum,
      toolName,
      toolInput,
      result,
      timestamp: new Date().toISOString(),
      agent:     toolNameToAgentLabel(toolName),
    };
    steps.push(step);

    console.log(
      `[orchestrator/loop] Step ${stepNum} (${phase}): ${toolName}`,
      "→", result.ok ? "ok" : `error: ${result.error}`
    );

    // Track successful completions (same as before — ctx.completedTools mirrors
    // the old loop's tracking, kept in case agents read it from ctx).
    if (result.ok) {
      ctx.completedTools = ctx.completedTools ?? new Set();
      ctx.completedTools.add(toolName);
    }

    // ── Hard stop on codegen failure — never push incomplete work ────────────
    // If a codegen tool (ui_agent, db_agent, api_agent) fails, abort the entire
    // pipeline immediately. Continuing to push would commit partial/no-UI artifacts.
    if (!result.ok && CODEGEN_TOOLS.has(toolName)) {
      console.error(
        `[orchestrator/loop] Codegen step "${toolName}" failed — aborting pipeline before push.`,
        result.error
      );
      for (const s of steps) delete s.artifact;
      return {
        steps,
        finalAnswer: `Pipeline aborted: ${toolName} failed — ${result.error ?? "unknown error"}. No files were pushed.`,
        context: serializeContext(ctx),
      };
    }

    // Compress result for the step record / SSE payload (strips large file content).
    // The full artifact is stashed on step.artifact so the onStepComplete callback
    // (route.js) can emit the ui_files SSE event with file content intact.
    // It is stripped from the step before the final steps[] is returned.
    const compressed = compressToolResult(result, toolName);
    step.result   = compressed;
    step.artifact = result.output?.artifact ?? null;   // full artifact, not compressed

    if (typeof onStepComplete === "function") onStepComplete(step);

    // ── Automatic review middleware ───────────────────────────────────────────
    // Runs immediately after every codegen step — same relative position as
    // before this refactor. Gates fire before the next phase executes.
    if (CODEGEN_TOOLS.has(toolName) && result.ok) {
      const artifact = result.output?.artifact;

      // Monitor gate (quality check)
      const monResult = await monitorGate(artifact);
      if (!monResult.pass) {
        console.log(`[orchestrator/loop] Monitor gate FAIL — self-healing: ${monResult.feedback}`);
        // Self-heal: re-run the same codegen tool with the feedback injected,
        // without adding an extra plan phase. Limit to one auto-retry.
        const retryInput = {
          ...toolInput,
          spec: `${toolInput.spec ?? ""}\n\nFix required: ${monResult.feedback}`.trim(),
        };
        const retryRaw    = await tool.run(retryInput);
        const retryResult = assertToolResult(retryRaw, toolName);
        if (retryResult.ok) {
          const fixedArtifact = retryResult.output?.artifact;
          if (fixedArtifact) {
            const idx = ctx.artifacts.findIndex((a) => a.id === result.output?.artifact?.id);
            if (idx !== -1) ctx.artifacts[idx] = fixedArtifact;
          }
          console.log(`[orchestrator/loop] Monitor self-heal succeeded.`);
          // Update the step result so SSE gets the fixed files
          step.result   = compressToolResult(retryResult, toolName);
          step.artifact = retryResult.output?.artifact ?? null;
          if (typeof onStepComplete === "function") onStepComplete(step);
        } else {
          console.warn(`[orchestrator/loop] Monitor self-heal failed — continuing anyway.`);
        }
      }

      // Security gate (security check on the final artifact after any self-heal)
      const finalArtifact = ctx.artifacts[ctx.artifacts.length - 1];
      let secResult = await securityGate(finalArtifact);
      let securityHealed = false;
      if (!secResult.pass) {
        const flagSummary = (secResult.flags ?? []).join(", ") || secResult.note || "security issues detected";
        console.log(`[orchestrator/loop] Security gate FAIL — self-healing: ${flagSummary}`);
        // Self-heal: re-run the same codegen tool with the security flags injected
        // as a fix instruction. One auto-retry, same as the monitor gate.
        const secRetryInput = {
          ...toolInput,
          spec: `${toolInput.spec ?? ""}\n\nSecurity fix required: ${flagSummary}. Remove all hardcoded secrets, API keys, or tokens. Do not use eval() or new Function(). Do not use dangerouslySetInnerHTML. Do not import server-only modules (fs, path, crypto, next/server, next/headers) in client components.`.trim(),
        };
        const secRetryRaw    = await tool.run(secRetryInput);
        const secRetryResult = assertToolResult(secRetryRaw, toolName);
        if (secRetryResult.ok) {
          securityHealed = true;
          const secFixedArtifact = secRetryResult.output?.artifact;
          if (secFixedArtifact) {
            const idx = ctx.artifacts.findIndex((a) => a.id === (finalArtifact?.id ?? result.output?.artifact?.id));
            if (idx !== -1) ctx.artifacts[idx] = secFixedArtifact;
          }
          console.log(`[orchestrator/loop] Security self-heal succeeded.`);
          step.result   = compressToolResult(secRetryResult, toolName);
          step.artifact = secRetryResult.output?.artifact ?? null;
          // Re-run security review on the healed artifact so the UI shows the
          // updated result, not the original flagged one.
          secResult = await securityGate(secRetryResult.output?.artifact ?? finalArtifact);
        } else {
          console.warn(`[orchestrator/loop] Security self-heal failed — continuing anyway.`);
        }
      }
      // Attach both gate results to the step so they reach the SSE client and
      // can be displayed in the review/security results panel.
      step.monitorResult = {
        pass:     monResult.pass,
        feedback: monResult.feedback ?? null,
        healed:   !monResult.pass,  // true when self-heal was attempted
      };
      step.securityResult = {
        pass:   secResult.pass,
        flags:  secResult.flags ?? [],
        note:   secResult.note  ?? null,
        healed: securityHealed,  // true when self-heal was attempted and re-check passed
      };
      step.securityFlags = secResult.flags ?? [];
      // Re-emit the step with review data attached so SSE clients get the full picture.
      if (typeof onStepComplete === "function") onStepComplete(step);
    }
  }

  // Strip the temporary full-artifact field before returning — it was only
  // needed during onStepComplete callbacks and should not be in the final payload.
  for (const s of steps) delete s.artifact;

  return {
    steps,
    finalAnswer: buildFinalAnswer(ctx),
    context: serializeContext(ctx),
  };
}
