import { NextResponse } from "next/server";
import { isWatsonConfigured, callWatsonChat } from "@/lib/watsonx";

const GROQ_URL   = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = process.env.GROQ_MODEL_FILEMAP || "openai/gpt-oss-20b";

function parseModelJson(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {}
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {}
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

  const { code } = body ?? {};
  if (!code || typeof code !== "string") {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  const lineCount = code.split("\n").length;

  const makeFallback = () => ({
    blocks: [{ id: "block-1", startLine: 1, endLine: lineCount, title: "Code Snippet" }],
  });

  // No AI configured — single-block fallback
  if (!isWatsonConfigured() && !process.env.GROQ_API_KEY) {
    return NextResponse.json(makeFallback());
  }

  const systemPrompt = `You are an expert developer. The user will provide a code snippet of exactly ${lineCount} lines.
Divide it into 2-6 logical, contiguous blocks (e.g. Imports, State, Handlers, Render).
Reply ONLY with valid JSON matching this schema exactly:
{"blocks":[{"id":"block-1","startLine":1,"endLine":4,"title":"Imports"}]}

CRITICAL RULES:
- Blocks must be contiguous with no gaps or overlaps.
- First block startLine must be 1, last block endLine must be ${lineCount}.
- No explanations — only id, startLine, endLine, and title per block.`;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user",   content: `Code to partition:\n\n${code}` },
  ];

  // ── 1. Try Watson.ai (primary) ───────────────────────────────────────────
  if (isWatsonConfigured()) {
    try {
      const content = await callWatsonChat(messages, { maxTokens: 300, temperature: 0.1 });
      const parsed  = parseModelJson(content);
      if (!parsed?.blocks?.length) throw new Error("Watson response missing blocks");
      console.log(`[chunk-code] ✔ provider=watson  blocks=${parsed.blocks.length}`);
      return NextResponse.json({ ...parsed, provider: "watson" });
    } catch (err) {
      console.warn(`[chunk-code] ✘ Watson failed (${err.message}) — trying Groq`);
    }
  }

  // ── 2. Try Groq (fallback) ───────────────────────────────────────────────
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return NextResponse.json(makeFallback());

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.1,
        messages,
      }),
    });

    if (!res.ok) {
      console.error("[chunk-code] Groq returned", res.status);
      return NextResponse.json(makeFallback());
    }

    const data   = await res.json();
    const parsed = parseModelJson(data.choices?.[0]?.message?.content ?? "");
    if (!parsed?.blocks?.length) return NextResponse.json(makeFallback());

    console.log(`[chunk-code] ✔ provider=groq   blocks=${parsed.blocks.length}`);
    return NextResponse.json({ ...parsed, provider: "groq" });
  } catch (err) {
    console.error("[chunk-code] Groq request failed:", err);
    return NextResponse.json(makeFallback());
  }
}
