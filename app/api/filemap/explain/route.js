import { NextResponse } from "next/server";
import { AGENT_DOMAINS, guessDomain } from "@/lib/repoMap";
import { buildFallbackPointers, buildFallbackWorkflow } from "@/lib/repoMapExport";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

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

  if (!process.env.GROQ_API_KEY) {
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

  const system = `You are a friendly, patient "topper friend" explaining ONE path (a file or a folder) from a software repo to a complete beginner. The reader might be a new developer or a student who doesn't know jargon, frameworks, or programming concepts. After reading your answer, they should clearly understand what this path does and why it exists, without feeling confused or overwhelmed.

Reply with ONLY valid JSON with exactly these keys, in this order. No markdown, no code fences, no extra keys, and no text before or after the JSON:
{"function":"...","inputs":"...","outputs":"...","process":"..."}

What each key should contain (each value is 1-3 plain-English sentences):
- "function": The big-picture purpose. Answer "why does this exist?" in everyday words, like you're telling a friend what this part of the project is responsible for. If it helps, use a simple real-life analogy (e.g. "like a receptionist that directs visitors to the right room").
- "inputs": What it takes in or relies on: data, settings, other files, user actions, or libraries. Say where these come from in simple terms. If it needs nothing, say that.
- "outputs": What it gives back or changes: values it returns, things other files import from it, files it creates, or what the user or app sees as a result. Say who or what uses that output.
- "process": How it works and where it fits in the bigger flow, told as a mini story in order ("First..., then..., finally..."). Mention what happens before it runs and what happens after, so the reader sees the big picture.

Style rules:
- Write like a kind friend explaining over chai: simple, warm, and direct. Never talk down to the reader.
- Avoid jargon. If a technical term is unavoidable (e.g. API, component, middleware), explain it in a few plain words right after using it.
- Be concrete: mention real names from the path (file names, function names, folder names) when you can tell what they do, instead of vague phrases like "handles logic".
- Don't start sentences with "This file" every time; vary the wording.
- For a folder, explain what the group of files inside is for as a whole, not each file one by one.
- Only say what you can reasonably tell from the path and context. If you're unsure, say "probably" or "most likely" instead of inventing details.
- Keep values on a single line, with no line breaks, and use single quotes (not double quotes) inside the text so the JSON stays valid.

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
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
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
