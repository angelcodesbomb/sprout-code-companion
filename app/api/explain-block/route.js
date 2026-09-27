import { NextResponse } from "next/server";
import { isWatsonConfigured, callWatsonChat } from "@/lib/watsonx";

const GROQ_URL   = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = process.env.GROQ_MODEL_FILEMAP || "openai/gpt-oss-20b";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { snippet } = body ?? {};
  if (!snippet?.trim()) {
    return NextResponse.json({ error: "Missing snippet" }, { status: 400 });
  }

  if (!isWatsonConfigured() && !process.env.GROQ_API_KEY) {
    return NextResponse.json({
      explanation: "No AI key found. Add WATSONX_API_KEY or GROQ_API_KEY to your .env.local to get live explanations.",
    });
  }

  const systemPrompt = `You explain short code snippets to developers in plain English.
Write 2-4 clear sentences describing what the selected code does.
No markdown, no bullet points — just clean readable prose.`;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user",   content: `Explain this code:\n\n${snippet}` },
  ];

  // ── 1. Try Watson.ai (primary) ───────────────────────────────────────────
  if (isWatsonConfigured()) {
    try {
      const explanation = await callWatsonChat(messages, { maxTokens: 200, temperature: 0.25 });
      console.log(`[explain-block] ✔ provider=watson`);
      return NextResponse.json({ explanation: explanation.trim(), provider: "watson" });
    } catch (err) {
      console.warn(`[explain-block] ✘ Watson failed (${err.message}) — trying Groq`);
    }
  }

  // ── 2. Try Groq (fallback) ───────────────────────────────────────────────
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return NextResponse.json({
      explanation: "No AI key found. Add WATSONX_API_KEY or GROQ_API_KEY to your .env.local to get live explanations.",
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
        max_tokens: 200,
        messages,
      }),
    });

    const rawText = await res.text();

    if (!res.ok) {
      console.error("[explain-block] Groq API error", res.status, rawText);

      let errorMessage = `AI returned an error (${res.status}).`;
      try {
        const errorData = JSON.parse(rawText);
        if (
          errorData.error?.message?.includes("rate limit") ||
          errorData.error?.includes("quota")
        ) {
          errorMessage = "Groq API rate limit or quota exceeded. Check your Groq account limits.";
        } else if (errorData.error) {
          errorMessage = `AI error: ${errorData.error.message || errorData.error}`;
        }
      } catch {}

      return NextResponse.json({
        explanation: errorMessage,
        needsCredits: res.status === 403,
      });
    }

    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      return NextResponse.json({ explanation: "AI response was malformed." });
    }

    const content = data.choices?.[0]?.message?.content?.trim() ?? "";
    console.log(`[explain-block] ✔ provider=groq`);
    return NextResponse.json({
      explanation: content || "No explanation generated.",
      provider: "groq",
    });
  } catch (err) {
    console.error("[explain-block] Groq request failed:", err);
    return NextResponse.json({
      explanation: "Network error reaching the AI. Check your connection.",
    });
  }
}
