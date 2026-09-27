import { NextResponse } from "next/server";
import { AGENT_DOMAINS, guessDomain } from "@/lib/repoMap";
import { isWatsonConfigured, callWatsonChat } from "@/lib/watsonx";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
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

export async function GET() {
  return NextResponse.json({
    aiEnabled: Boolean(isWatsonConfigured() || process.env.GROQ_API_KEY),
    primary: isWatsonConfigured() ? "watson" : process.env.GROQ_API_KEY ? "groq" : "none",
  });
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { node, fallbackLabel, context } = body ?? {};
  if (!node || typeof node.path !== "string") {
    return NextResponse.json({ error: "Missing node" }, { status: 400 });
  }

  const ruleDomain = guessDomain(node);

  // No AI configured at all — return heuristic fallback immediately
  if (!isWatsonConfigured() && !process.env.GROQ_API_KEY) {
    return NextResponse.json(
      { useFallback: true, domain: ruleDomain },
      { status: 503 }
    );
  }

  const siblingLine =
    context?.siblingNames?.length > 0
      ? `Sibling entries at this level: ${context.siblingNames.join(", ")}.`
      : "";

  const systemPrompt = `You summarize one file or folder in a software repository for beginners.
Reply with ONLY valid JSON: {"summary":"one plain-English sentence under 120 chars","domain":"one of ${AGENT_DOMAINS.join(", ")}"}
Pick domain by primary purpose: UI (components/styles), Database (schema/migrations), API (routes/handlers), Security (auth/secrets), Validation (tests/schemas), Review (docs/config/general).`;

  const userPrompt = [
    context?.repoDescription ? `Repo: ${context.repoDescription}` : null,
    `Path: ${node.path || "(repository root)"}`,
    `Name: ${node.name}`,
    `Type: ${node.type}`,
    context?.parentSummary ? `Parent context: ${context.parentSummary}` : null,
    siblingLine || null,
    `Heuristic label (may be wrong): ${fallbackLabel ?? "unknown"}`,
    "Write summary as if explaining to someone new to the codebase.",
  ]
    .filter(Boolean)
    .join("\n");

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user",   content: userPrompt },
  ];

  // ── 1. Try Watson.ai (primary) ───────────────────────────────────────────
  if (isWatsonConfigured()) {
    try {
      const content = await callWatsonChat(messages, { maxTokens: 120, temperature: 0.3 });
      const parsed  = parseModelJson(content);

      let summary =
        typeof parsed?.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim()
          : content.split("\n")[0]?.trim().slice(0, 200) || fallbackLabel;

      let domain = parsed?.domain;
      if (!AGENT_DOMAINS.includes(domain)) domain = ruleDomain;

      console.log(`[summarize] ✔ provider=watson  node=${node.path}`);
      return NextResponse.json({ summary, domain, provider: "watson" });
    } catch (err) {
      console.warn(`[summarize] ✘ Watson failed (${err.message}) — trying Groq`);
    }
  }

  // ── 2. Try Groq (fallback) ───────────────────────────────────────────────
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return NextResponse.json(
      { useFallback: true, domain: ruleDomain },
      { status: 503 }
    );
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
        temperature: 0.3,
        max_tokens: 120,
        messages,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("[summarize] Groq error", res.status, errText.slice(0, 500));

      let needsCredits = false;
      try {
        const errorData = JSON.parse(errText);
        if (errorData.code === "permission-denied" && errorData.error?.includes("credits")) {
          needsCredits = true;
        }
      } catch {}

      return NextResponse.json(
        {
          useFallback: true,
          domain: ruleDomain,
          error: res.status === 403 ? "credits_exhausted" : "api_error",
          message: needsCredits
            ? "Groq account credits exhausted. Add credits to enable AI summaries."
            : undefined,
        },
        { status: 503 }
      );
    }

    const data    = await res.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    const parsed  = parseModelJson(content);

    let summary =
      typeof parsed?.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim()
        : content.split("\n")[0]?.trim().slice(0, 200) || fallbackLabel;

    let domain = parsed?.domain;
    if (!AGENT_DOMAINS.includes(domain)) domain = ruleDomain;

    console.log(`[summarize] ✔ provider=groq   node=${node.path}`);
    return NextResponse.json({ summary, domain, provider: "groq" });
  } catch (err) {
    console.error("[summarize] Groq request failed:", err);    return NextResponse.json(
      { useFallback: true, domain: ruleDomain },
      { status: 503 }
    );
  }
}
