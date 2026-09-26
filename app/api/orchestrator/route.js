import { NextResponse } from "next/server";
import { runOrchestrator } from "@/lib/orchestrator/loop.js";

/**
 * POST /api/orchestrator
 *
 * SSE events emitted:
 *   event: tool_start   data: { toolName }
 *   event: step         data: Step
 *   event: ui_files     data: { files: [{path,content,action}], summary, artifactId }
 *   event: done         data: { steps, finalAnswer }
 *   event: error        data: { error }
 */
export async function POST(request) {
  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }

  const { goal, stream = true, mapSnapshot = null, autoApproveHuman = false } = body ?? {};
  if (!goal || typeof goal !== "string") {
    return NextResponse.json({ error: "Missing required field: goal (string)." }, { status: 400 });
  }
  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json({ error: "GROQ_API_KEY is not configured." }, { status: 500 });
  }

  if (stream) {
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        const send = (event, data) => {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        };

        try {
          const result = await runOrchestrator({
            goal,
            mapSnapshot,
            autoApproveHuman: Boolean(autoApproveHuman),
            onToolStart: (toolName) => send("tool_start", { toolName }),
            onStepComplete: (step) => {
              send("step", step);

              // When the UI agent completes, immediately emit the generated files
              // so the client can push them into Sandpack without waiting for "done".
              if (
                step.toolName === "ui_agent_generate" &&
                step.result?.ok &&
                Array.isArray(step.result?.output?.artifact?.files)
              ) {
                const { artifact } = step.result.output;
                send("ui_files", {
                  artifactId: artifact.id,
                  summary:    artifact.summary ?? "",
                  files:      artifact.files,   // [{path, content, action}]
                });
              }
            },
          });
          send("done", result);
        } catch (err) {
          console.error("[api/orchestrator] runOrchestrator failed:", err);
          send("error", { error: err.message ?? "Internal server error." });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type":  "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection:      "keep-alive",
      },
    });
  }

  // Non-streaming fallback
  try {
    const result = await runOrchestrator({ goal, mapSnapshot, autoApproveHuman: Boolean(autoApproveHuman) });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/orchestrator] runOrchestrator failed:", err);
    return NextResponse.json({ error: err.message ?? "Internal server error." }, { status: 502 });
  }
}
