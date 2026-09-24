import { NextResponse } from "next/server";

const XAI_URL = "https://api.x.ai/v1/chat/completions";
const MODEL = process.env.XAI_MODEL || "grok-3-mini";

export async function POST(request) {
    let body;
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

    const { snippet } = body ?? {};
    if (!snippet?.trim()) return NextResponse.json({ error: "Missing snippet" }, { status: 400 });

    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
        return NextResponse.json({
            explanation: "No AI key found. Add XAI_API_KEY to your .env.local to get live explanations.",
        });
    }

    const system = `You explain short code snippets to developers in plain English.
Write 2-4 clear sentences describing what the selected code does.
No markdown, no bullet points — just clean readable prose.`;

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
                max_tokens: 200,
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: `Explain this code:\n\n${snippet}` },
                ],
            }),
        });

        const rawText = await res.text();

        if (!res.ok) {
            console.error("explain-block: API error", res.status, rawText);
            return NextResponse.json({
                explanation: `AI returned an error (${res.status}). Check that your XAI_API_KEY is valid.`,
            });
        }

        let data;
        try { data = JSON.parse(rawText); }
        catch { return NextResponse.json({ explanation: "AI response was malformed." }); }

        const content = data.choices?.[0]?.message?.content?.trim() ?? "";
        return NextResponse.json({ explanation: content || "No explanation generated." });
    } catch (err) {
        console.error("explain-block failed:", err);
        return NextResponse.json({ explanation: "Network error reaching the AI. Check your connection." });
    }
}
