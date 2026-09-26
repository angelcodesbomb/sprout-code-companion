import { NextResponse } from "next/server";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL_FILEMAP || "openai/gpt-oss-20b";

function parseModelJson(text) {
    const trimmed = text.trim();
    try { return JSON.parse(trimmed); } catch { }
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) { try { return JSON.parse(match[0]); } catch { } }
    return null;
}

export async function POST(request) {
    let body;
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

    const { code } = body ?? {};
    if (!code || typeof code !== "string") {
        return NextResponse.json({ error: "Missing code" }, { status: 400 });
    }

    const lineCount = code.split("\n").length;

    // Graceful fallback — wraps everything in 1 block when no AI key configured
    const makeFallback = () => ({
        blocks: [{ id: "block-1", startLine: 1, endLine: lineCount, title: "Code Snippet" }],
    });

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return NextResponse.json(makeFallback());

    const system = `You are an expert developer. The user will provide a code snippet of exactly ${lineCount} lines.
Divide it into 2-6 logical, contiguous blocks (e.g. Imports, State, Handlers, Render).
Reply ONLY with valid JSON matching this schema exactly:
{"blocks":[{"id":"block-1","startLine":1,"endLine":4,"title":"Imports"}]}

CRITICAL RULES:
- Blocks must be contiguous with no gaps or overlaps.
- First block startLine must be 1, last block endLine must be ${lineCount}.
- No explanations — only id, startLine, endLine, and title per block.`;

    try {
        const res = await fetch(GROQ_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: MODEL,
                temperature: 0.1,
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: `Code to partition:\n\n${code}` },
                ],
            }),
        });

        if (!res.ok) {
            console.error("chunk-code: LLM returned", res.status);
            return NextResponse.json(makeFallback());
        }

        const data = await res.json();
        const parsed = parseModelJson(data.choices?.[0]?.message?.content ?? "");
        if (!parsed?.blocks?.length) return NextResponse.json(makeFallback());

        return NextResponse.json(parsed);
    } catch (err) {
        console.error("chunk-code failed:", err);
        return NextResponse.json(makeFallback());
    }
}
