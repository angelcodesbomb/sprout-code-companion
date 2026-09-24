import { NextResponse } from "next/server";
import { AGENT_DOMAINS, guessDomain } from "@/lib/repoMap";
import { buildFallbackPointers, buildFallbackWorkflow } from "@/lib/repoMapExport";

const XAI_URL = "https://api.x.ai/v1/chat/completions";
const MODEL = process.env.XAI_MODEL || "grok-3-mini";

function parseModelJson(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { node, fallbackLabel, summary, context } = body ?? {};
  if (!node || typeof node.path !== "string") {
    return NextResponse.json({ error: "Missing node" }, { status: 400 });
  }

  const entry = {
    name: node.name,
    path: node.path,
    type: node.type,
    domain: guessDomain(node),
    fallbackLabel,
    summary,
  };

  if (!process.env.XAI_API_KEY) {
    const workflow = buildFallbackWorkflow(entry);
    return NextResponse.json(
      {
        useFallback: true,
        workflow,
        pointers: buildFallbackPointers(entry),
        role: workflow.function,
      },
      { status: 503 }
    );
  }

  const siblingLine =
    context?.siblingNames?.length > 0
      ? `Sibling entries: ${context.siblingNames.join(", ")}.`
      : "";

  const system = `You explain one path in a software repo to a beginner.
Reply with ONLY valid JSON with exactly these keys (each value is one short plain-English sentence or phrase):
{"function":"what this file/folder is for","inputs":"what it reads, receives, or depends on","outputs":"what it produces, exports, or affects","process":"how it fits in the flow step-by-step"}
Domain context (one of ${AGENT_DOMAINS.join(", ")}): ${guessDomain(node)}.`;

  const user = [
    context?.repoDescription ? `Repo: ${context.repoDescription}` : null,
    `Path: ${node.path || "(repository root)"}`,
    `Name: ${node.name}`,
    `Type: ${node.type}`,
    summary ? `Known summary: ${summary}` : null,
    context?.parentSummary ? `Parent: ${context.parentSummary}` : null,
    siblingLine || null,
    `Heuristic: ${fallbackLabel ?? "unknown"}`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const res = await fetch(XAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.XAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.35,
        max_tokens: 400,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!res.ok) {
      const workflow = buildFallbackWorkflow(entry);
      return NextResponse.json(
        {
          useFallback: true,
          workflow,
          pointers: buildFallbackPointers(entry),
          role: workflow.function,
        },
        { status: 503 }
      );
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    const parsed = parseModelJson(content);

    const fallbackWf = buildFallbackWorkflow(entry);
    const workflow = {
      function:
        typeof parsed?.function === "string" && parsed.function.trim()
          ? parsed.function.trim()
          : fallbackWf.function,
      inputs:
        typeof parsed?.inputs === "string" && parsed.inputs.trim()
          ? parsed.inputs.trim()
          : fallbackWf.inputs,
      outputs:
        typeof parsed?.outputs === "string" && parsed.outputs.trim()
          ? parsed.outputs.trim()
          : fallbackWf.outputs,
      process:
        typeof parsed?.process === "string" && parsed.process.trim()
          ? parsed.process.trim()
          : fallbackWf.process,
    };

    const role = workflow.function;

    return NextResponse.json({ workflow, role, pointers: buildFallbackPointers(entry) });
  } catch (err) {
    console.error("explain route failed", err);
    const workflow = buildFallbackWorkflow(entry);
    return NextResponse.json(
      {
        useFallback: true,
        workflow,
        pointers: buildFallbackPointers(entry),
        role: workflow.function,
      },
      { status: 503 }
    );
  }
}
