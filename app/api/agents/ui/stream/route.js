import { createRunContext } from "@/lib/orchestrator/context.js";
import { getModel } from "@/lib/orchestrator/groq.js";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

/**
 * POST /api/agents/ui/stream
 *
 * Streams the UI agent's output token-by-token via SSE.
 * The client receives individual file objects as soon as each one is complete,
 * so Sandpack can update the preview incrementally rather than waiting for
 * the full response.
 *
 * Body: { task, spec?, mapSnapshot? }
 *
 * SSE events:
 *   event: status    data: { message }               — progress messages
 *   event: file      data: { path, content, action } — one per generated file
 *   event: summary   data: { text }                  — agent's summary sentence
 *   event: done      data: { fileCount }             — all files sent
 *   event: error     data: { error }                 — something went wrong
 */
export async function POST(request) {
  let body;
  try { body = await request.json(); }
  catch { return new Response("Invalid JSON", { status: 400 }); }

  const { task, spec, mapSnapshot } = body ?? {};

  if (!task?.trim()) {
    return new Response("Missing task", { status: 400 });
  }
  if (!process.env.GROQ_API_KEY) {
    return new Response("GROQ_API_KEY not configured", { status: 500 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event, data) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      try {
        send("status", { message: "Thinking…" });

        // ── Build system prompt ──────────────────────────────────────────
        const ctx = createRunContext({ goal: task, mapSnapshot: mapSnapshot ?? null });

        const stack = inferStack(ctx.mapSnapshot);
        const uiPaths = getUiPaths(ctx.mapSnapshot);
        const allPaths = getAllPaths(ctx.mapSnapshot);
        const repoKey = ctx.mapCompact?.repoKey ?? "unknown repo";

        const system = buildSystemPrompt({
          task, spec, stack, uiPaths, allPaths, repoKey,
        });

        // ── Call Groq with streaming ─────────────────────────────────────
        send("status", { message: "Generating…" });

        const groqRes = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          },
          body: JSON.stringify({
            model: getModel(),
            stream: true,
            temperature: 0.2,
            max_tokens: 6000,
            messages: [
              { role: "system", content: system },
              { role: "user",   content: `Task: ${task.trim()}` },
            ],
          }),
        });

        if (!groqRes.ok) {
          const txt = await groqRes.text().catch(() => "");
          send("error", { error: `Groq error ${groqRes.status}: ${txt.slice(0, 200)}` });
          controller.close();
          return;
        }

        // ── Collect the streaming tokens ─────────────────────────────────
        const reader = groqRes.body.getReader();
        const dec = new TextDecoder();
        let accumulated = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = dec.decode(value, { stream: true });
          // Groq SSE lines: "data: {...}" or "data: [DONE]"
          for (const line of chunk.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (raw === "[DONE]") break;
            try {
              const parsed = JSON.parse(raw);
              const delta = parsed.choices?.[0]?.delta?.content ?? "";
              accumulated += delta;
            } catch { /* partial chunk — skip */ }
          }
        }

        // ── Parse the accumulated JSON ────────────────────────────────────
        send("status", { message: "Parsing files…" });

        const result = parseResponse(accumulated);

        if (!result || !Array.isArray(result.files) || result.files.length === 0) {
          send("error", {
            error: "Could not parse generated files. Raw snippet: " +
              accumulated.slice(0, 300),
          });
          controller.close();
          return;
        }

        if (result.summary) {
          send("summary", { text: result.summary });
        }

        // ── Emit each file as it's validated ─────────────────────────────
        let fileCount = 0;
        for (const f of result.files) {
          if (typeof f.path !== "string" || typeof f.content !== "string") continue;
          send("file", {
            path:    f.path,
            content: f.content,
            action:  f.action === "modify" ? "modify" : "create",
          });
          fileCount++;
        }

        send("done", { fileCount });
      } catch (err) {
        try {
          const send = (event, data) =>
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
            );
          send("error", { error: err.message ?? "Unknown error" });
        } catch { /* controller already closed */ }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection":    "keep-alive",
    },
  });
}

// ─── Helpers (duplicated from uiAgent.js intentionally — this route is
//     server-only and can't import client-side orchestrator context at
//     the edge runtime level without bundling issues) ──────────────────────────

function inferStack(mapSnapshot) {
  if (!mapSnapshot?.nodesByPath) return "React";
  const paths = Object.keys(mapSnapshot.nodesByPath);
  const has = (pat) => paths.some((p) => pat.test(p));
  const s = [];
  if (has(/next\.config/))         s.push("Next.js App Router");
  if (has(/tailwind\.config/))     s.push("Tailwind CSS");
  if (has(/\.tsx?$/))              s.push("TypeScript");
  if (has(/vite\.config/))         s.push("Vite");
  if (has(/framer-motion|motion/)) s.push("Framer Motion");
  if (has(/\.scss$/))              s.push("SCSS");
  if (s.length === 0)              s.push("React");
  return s.join(", ");
}

function getUiPaths(mapSnapshot) {
  if (!mapSnapshot?.nodesByPath) return [];
  return Object.entries(mapSnapshot.nodesByPath)
    .filter(([, n]) => n.type === "file" && n.domain === "UI")
    .map(([p]) => p).slice(0, 30);
}

function getAllPaths(mapSnapshot) {
  if (!mapSnapshot?.nodesByPath) return [];
  return Object.keys(mapSnapshot.nodesByPath)
    .filter((p) => mapSnapshot.nodesByPath[p]?.type === "file")
    .slice(0, 60);
}

function buildSystemPrompt({ task, spec, stack, uiPaths, allPaths, repoKey }) {
  const existingSection = allPaths.length
    ? `\nKnown repo files:\n${allPaths.join("\n")}`
    : "";
  const uiSection = uiPaths.length
    ? `\nExisting UI files (match their style):\n${uiPaths.join("\n")}`
    : "";
  const specSection = spec ? `\nExtra requirements:\n${spec}` : "";

  return `You are a UI code generation agent. Generate clean, self-contained React component code.
Project: ${repoKey} | Stack: ${stack}
${existingSection}${uiSection}${specSection}

CRITICAL: Reply with ONLY valid JSON — no markdown fences, no explanation, nothing else.
Schema:
{
  "summary": "one sentence describing what you built",
  "files": [
    { "path": "src/components/Foo.jsx", "action": "create", "content": "full file content" }
  ]
}

Rules:
- Full file content every time — no partial diffs, no "// rest unchanged" comments.
- Use only inline styles or CSS classes — no Tailwind unless the stack includes it.
- Components must be completely self-contained and renderable in an iframe sandbox.
- No imports from Next.js (next/image, next/router, etc.) — keep it pure React.
- Named exports only (not default) unless it's a page file.
- No external API calls in component code.
- Semantic HTML, aria-labels on all interactive elements.`;
}

function parseResponse(raw) {
  const t = raw.trim();
  try { return JSON.parse(t); } catch { /* */ }
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1].trim()); } catch { /* */ } }
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s !== -1 && e > s) { try { return JSON.parse(t.slice(s, e + 1)); } catch { /* */ } }
  return null;
}
