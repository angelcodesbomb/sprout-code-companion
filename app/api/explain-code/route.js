import { NextResponse } from "next/server";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL_FILEMAP || "openai/gpt-oss-20b";

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

    const { code } = body ?? {};
    if (!code || typeof code !== "string") {
        return NextResponse.json({ error: "Missing code" }, { status: 400 });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        return NextResponse.json({ error: "No API key configured" }, { status: 500 });
    }

    const system = `You are a code explainer that breaks down a block of code into logical parts for beginners.
Reply with ONLY valid JSON strictly adhering to this schema:
{
  "blocks": [
    {
      "id": "unique-id",
      "title": "A short, plain-english title for this section",
      "explanation": "A 1-2 sentence jargon-free explanation",
      "lines": [
        { "number": 1, "html": "<b>import</b> { useState } <b>from</b> <em>'react'</em>;" }
      ]
    }
  ]
}

Very important formatting rules for the "html" string:
- Use <b> for keywords (import, export, function, const, if, return, await, async, etc)
- Use <em> for string literals (e.g. 'react', "hello")
- Use <mark> for function names and class names
- Use <u> for primitive values (true, false, null, numbers)
- Include all spaces and indentation exactly as they were in the original code. DO NOT ADD HTML ENCODING LIKE &nbsp;, just use normal spaces.
- The line numbers should match the exact original line number of the user's code, starting at 1.
- You must group the code into 2-6 contiguous logical blocks. Every line of the original code must be included exactly once across all blocks in order.`;

    const user = `Break down this code into logical blocks:\n\n${code}`;

    try {
        const res = await fetch(GROQ_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: MODEL,
                temperature: 0.2,
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: user },
                ],
            }),
        });

        if (!res.ok) {
            console.error("LLM API failed", await res.text());
            return NextResponse.json({ error: "Failed to generate explanation" }, { status: 502 });
        }

        const data = await res.json();
        const content = data.choices?.[0]?.message?.content ?? "";
        const parsed = parseModelJson(content);

        if (!parsed || !parsed.blocks) {
            return NextResponse.json({ error: "Invalid response from AI" }, { status: 500 });
        }

        return NextResponse.json(parsed);
    } catch (err) {
        console.error("explain-code route failed", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
