import { NextResponse } from "next/server";
import { AGENT_DOMAINS, guessDomain } from "@/lib/repoMap";

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

export async function GET() {
  return NextResponse.json({ aiEnabled: Boolean(process.env.GROQ_API_KEY) });
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

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { useFallback: true, domain: ruleDomain },
      { status: 503 }
    );
  }

  const siblingLine =
    context?.siblingNames?.length > 0
      ? `Sibling entries at this level: ${context.siblingNames.join(", ")}.`
      : "";

  const system = `You summarize one file or folder in a software repository for beginners.
Reply with ONLY valid JSON: {"summary":"one plain-English sentence under 120 chars","domain":"one of ${AGENT_DOMAINS.join(", ")}"}
Pick domain by primary purpose: UI (components/styles), Database (schema/migrations), API (routes/handlers), Security (auth/secrets), Validation (tests/schemas), Review (docs/config/general).`;

  const user = [
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

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.3,
        max_tokens: 120,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("xAI error", res.status, errText.slice(0, 500));
      
      // Check if it's a credits issue
      let needsCredits = false;
      try {
        const errorData = JSON.parse(errText);
        if (errorData.code === 'permission-denied' && errorData.error?.includes('credits')) {
          needsCredits = true;
        }
      } catch {}
      
      return NextResponse.json(
        { 
          useFallback: true, 
          domain: ruleDomain,
          error: res.status === 403 ? 'credits_exhausted' : 'api_error',
          message: needsCredits ? 'x.ai account credits exhausted. Add credits to enable AI summaries.' : undefined
        },
        { status: 503 }
      );
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    const parsed = parseModelJson(content);

    let summary =
      typeof parsed?.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim()
        : content.split("\n")[0]?.trim().slice(0, 200) || fallbackLabel;

    let domain = parsed?.domain;
    if (!AGENT_DOMAINS.includes(domain)) {
      domain = ruleDomain;
    }

    return NextResponse.json({ summary, domain });
  } catch (err) {
    console.error("summarize route failed", err);
    return NextResponse.json(
      { useFallback: true, domain: ruleDomain },
      { status: 503 }
    );
  }
}
