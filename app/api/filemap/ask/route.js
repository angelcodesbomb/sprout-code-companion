import { NextResponse } from "next/server";
import {
  buildFallbackAnswer,
  buildAskIndex,
  resolvePathFromQuestion,
} from "@/lib/repoMapAsk";

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

  const { question, repoMeta, nodesByPath } = body ?? {};
  if (!question || typeof question !== "string") {
    return NextResponse.json({ error: "Missing question" }, { status: 400 });
  }

  const map = nodesByPath
    ? { nodesByPath, repoMeta: repoMeta ?? {} }
    : null;

  const offlinePath = map ? resolvePathFromQuestion(question, map) : null;

  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      answer: buildFallbackAnswer(question, map, offlinePath),
      targetPath: offlinePath,
      useFallback: true,
    });
  }

  const index =
    body.index?.length > 0 ? body.index : map ? buildAskIndex(map) : [];

  const indexBlock = index
    .slice(0, 350)
    .map(
      (n) =>
        `- ${n.path || "(root)"} [${n.type}] ${n.summary || ""}`.trim()
    )
    .join("\n");

  const system = `You answer questions about a codebase using ONLY the path index below.
Reply with ONLY valid JSON:
{"answer":"2-4 plain-English sentences","targetPath":"exact path string from the index"}
Crucial rule: If the user asks about a "function", "API", or "component" (e.g. "where is the login function?"), use your developer knowledge to guess which file it lives in based on the path, name, and summary (e.g., auth/login.tsx or userController.js). ALWAYS give a best-effort \`targetPath\`. If you absolutely cannot find it, leave targetPath empty and suggest where to look.`;

  const user = [
    repoMeta?.fullName ? `Repository: ${repoMeta.fullName}` : null,
    repoMeta?.description ? `About: ${repoMeta.description}` : null,
    `Question: ${question}`,
    "",
    "Path index:",
    indexBlock || "(empty)",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const res = await fetch(XAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.25,
        max_tokens: 320,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!res.ok) {
      return NextResponse.json({
        answer: buildFallbackAnswer(question, map, offlinePath),
        targetPath: offlinePath,
        useFallback: true,
      });
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    const parsed = parseModelJson(content);

    let targetPath =
      typeof parsed?.targetPath === "string" ? parsed.targetPath.trim() : "";
    if (targetPath && map?.nodesByPath && !map.nodesByPath[targetPath]) {
      const fix = Object.keys(map.nodesByPath).find(
        (p) => p === targetPath || p.endsWith("/" + targetPath) || p.endsWith(targetPath)
      );
      targetPath = fix ?? offlinePath ?? "";
    }
    if (!targetPath && offlinePath) targetPath = offlinePath;

    const answer =
      typeof parsed?.answer === "string" && parsed.answer.trim()
        ? parsed.answer.trim()
        : buildFallbackAnswer(question, map, targetPath || offlinePath);

    return NextResponse.json({
      answer,
      targetPath: targetPath || offlinePath || null,
    });
  } catch (err) {
    console.error("ask route failed", err);
    return NextResponse.json({
      answer: buildFallbackAnswer(question, map, offlinePath),
      targetPath: offlinePath,
      useFallback: true,
    });
  }
}
