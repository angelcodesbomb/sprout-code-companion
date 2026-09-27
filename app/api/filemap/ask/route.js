import { NextResponse } from "next/server";
import {
  buildFallbackAnswer,
  buildAskIndex,
  resolvePathFromQuestion,
} from "@/lib/repoMapAsk";
import { isWatsonConfigured, callWatsonChat } from "@/lib/watsonx";

const GROQ_URL   = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = process.env.GROQ_MODEL_FILEMAP || "openai/gpt-oss-20b";

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

  const map = nodesByPath ? { nodesByPath, repoMeta: repoMeta ?? {} } : null;

  // Offline path resolution runs regardless of AI availability
  const offlinePath = map ? resolvePathFromQuestion(question, map) : null;

  // No AI configured at all — offline answer only
  if (!isWatsonConfigured() && !process.env.GROQ_API_KEY) {
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
    .map((n) => `- ${n.path || "(root)"} [${n.type}] ${n.summary || ""}`.trim())
    .join("\n");

  const systemPrompt = `You answer questions about a codebase using ONLY the path index below.
Reply with ONLY valid JSON:
{"answer":"2-4 plain-English sentences","targetPath":"exact path string from the index"}
Crucial rule: If the user asks about a "function", "API", or "component" (e.g. "where is the login function?"), use your developer knowledge to guess which file it lives in based on the path, name, and summary (e.g., auth/login.tsx or userController.js). ALWAYS give a best-effort \`targetPath\`. If you absolutely cannot find it, leave targetPath empty and suggest where to look.`;

  const userPrompt = [
    repoMeta?.fullName    ? `Repository: ${repoMeta.fullName}`    : null,
    repoMeta?.description ? `About: ${repoMeta.description}`      : null,
    `Question: ${question}`,
    "",
    "Path index:",
    indexBlock || "(empty)",
  ]
    .filter(Boolean)
    .join("\n");

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user",   content: userPrompt },
  ];

  /**
   * Normalise the parsed LLM JSON into a final { answer, targetPath } pair,
   * validating the targetPath against the real node map.
   */
  function resolveResponse(parsed) {
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

    return { answer, targetPath: targetPath || offlinePath || null };
  }

  // ── 1. Try Watson.ai (primary) ───────────────────────────────────────────
  if (isWatsonConfigured()) {
    try {
      const content = await callWatsonChat(messages, { maxTokens: 320, temperature: 0.25 });
      const parsed  = parseModelJson(content);
      const { answer, targetPath } = resolveResponse(parsed);
      console.log(`[ask] ✔ provider=watson  q="${question.slice(0, 60)}"`);
      return NextResponse.json({ answer, targetPath, provider: "watson" });
    } catch (err) {
      console.warn(`[ask] ✘ Watson failed (${err.message}) — trying Groq`);
    }
  }

  // ── 2. Try Groq (fallback) ───────────────────────────────────────────────
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return NextResponse.json({
      answer: buildFallbackAnswer(question, map, offlinePath),
      targetPath: offlinePath,
      useFallback: true,
    });
  }

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.25,
        max_tokens: 320,
        messages,
      }),
    });

    if (!res.ok) {
      return NextResponse.json({
        answer: buildFallbackAnswer(question, map, offlinePath),
        targetPath: offlinePath,
        useFallback: true,
      });
    }

    const data    = await res.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    const parsed  = parseModelJson(content);
    const { answer, targetPath } = resolveResponse(parsed);
    console.log(`[ask] ✔ provider=groq   q="${question.slice(0, 60)}"`);
    return NextResponse.json({ answer, targetPath, provider: "groq" });
  } catch (err) {
    console.error("[ask] Groq request failed:", err);
    return NextResponse.json({
      answer: buildFallbackAnswer(question, map, offlinePath),
      targetPath: offlinePath,
      useFallback: true,
    });
  }
}
