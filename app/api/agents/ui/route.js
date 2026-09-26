import { NextResponse } from "next/server";
import { runUiAgent } from "@/lib/orchestrator/agents/uiAgent.js";
import { createRunContext } from "@/lib/orchestrator/context.js";

/**
 * POST /api/agents/ui
 *
 * Runs the UI agent standalone — useful for testing without a full orchestrator run.
 *
 * Body:
 * {
 *   task: string,              // required — what to build, e.g. "Create a Navbar component"
 *   targetPaths?: string[],    // optional — specific paths to create/edit
 *   spec?: string,             // optional — extra design / behaviour requirements
 *   mapSnapshot?: object,      // optional — pass the workspace repoMap for context
 * }
 *
 * Response:
 * {
 *   ok: boolean,
 *   artifactId?: string,
 *   artifact?: {
 *     summary: string,
 *     files: Array<{ path, content, action }>
 *   },
 *   error?: string
 * }
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const { task, targetPaths, spec, mapSnapshot } = body ?? {};

  if (!task || typeof task !== "string" || !task.trim()) {
    return NextResponse.json(
      { ok: false, error: "Missing required field: task (string)." },
      { status: 400 }
    );
  }

  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "GROQ_API_KEY is not configured." },
      { status: 500 }
    );
  }

  // Create a minimal run context — mapSnapshot is optional
  const ctx = createRunContext({
    goal: task,
    mapSnapshot: mapSnapshot ?? null,
  });

  const result = await runUiAgent(ctx, {
    task,
    targetPaths: Array.isArray(targetPaths) ? targetPaths : [],
    spec: spec ?? "",
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    artifactId: result.output.artifactId,
    artifact: {
      summary: result.output.artifact.summary,
      files:   result.output.artifact.files,
      paths:   result.output.artifact.paths,
    },
  });
}
