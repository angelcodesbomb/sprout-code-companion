/**
 * UI Agent — generates frontend code (components, pages, styles) from a task
 * description and the repo's cached file map.
 *
 * Called by the orchestrator via tools.js → ui_agent_generate.
 * Also callable directly from /api/agents/ui for standalone use.
 *
 * ── What it does ──────────────────────────────────────────────────────────────
 * 1. Builds a focused system prompt that includes:
 *    - The tech stack inferred from the map (Next.js, React, Tailwind, etc.)
 *    - Which files already exist (so it avoids inventing paths)
 *    - UI-domain files specifically, so it can be consistent with existing components
 *    - The design tokens / conventions already in use
 * 2. Sends the task + context to Groq and asks for:
 *    - A list of files to create or modify (with full content for each)
 *    - A short plain-English summary of what it built
 * 3. Returns a structured artifact that the orchestrator pushes to ctx.artifacts
 *    and the Monitor/Security agents then review.
 *
 * ── Output shape (artifact.output) ───────────────────────────────────────────
 * {
 *   artifactId: string,
 *   artifact: {
 *     id: string,
 *     agent: "UI",
 *     task: string,
 *     summary: string,           // plain-English "what I built"
 *     files: Array<{             // files to write to disk / GitHub
 *       path: string,
 *       content: string,
 *       action: "create" | "modify",
 *     }>,
 *     paths: string[],           // flat list of paths (for orchestrator loop)
 *     rawResponse: string,       // full Groq response for debugging
 *   }
 * }
 */

import { uid } from "../context.js";
import { getModel } from "../groq.js";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

// ─── Groq call ────────────────────────────────────────────────────────────────

async function callGroq(messages, maxTokens = 4096) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("[ui-agent] GROQ_API_KEY is not set.");

  let attempt = 0;
  while (attempt < 4) {
    const res = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: getModel(),
        messages,
        temperature: 0.25,    // low temp = consistent, predictable code
        max_tokens: maxTokens,
      }),
    });

    if (res.status === 429) {
      const text = await res.text().catch(() => "");
      const match = text.match(/try again in ([0-9.]+)s/i);
      const wait = match ? Math.ceil(parseFloat(match[1]) * 1000) + 500 : 12_000;
      await new Promise((r) => setTimeout(r, wait));
      attempt++;
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "(no body)");
      throw new Error(`[ui-agent] Groq error ${res.status}: ${text}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "";
  }

  throw new Error("[ui-agent] Groq rate-limit retries exhausted.");
}

// ─── Map analysis helpers ─────────────────────────────────────────────────────

/**
 * Infer tech stack from file paths in the map.
 * Returns a plain-English description the LLM can use.
 */
function inferStack(mapSnapshot) {
  if (!mapSnapshot?.nodesByPath) return "React frontend (stack unknown — no map loaded).";

  const paths = Object.keys(mapSnapshot.nodesByPath);
  const has = (pat) => paths.some((p) => pat.test(p));

  const stack = [];
  if (has(/next\.config/))         stack.push("Next.js (App Router)");
  if (has(/tailwind\.config/))     stack.push("Tailwind CSS");
  if (has(/\.tsx?$/))              stack.push("TypeScript");
  if (has(/vite\.config/))         stack.push("Vite");
  if (has(/svelte/i))              stack.push("Svelte");
  if (has(/vue/i))                 stack.push("Vue");
  if (has(/\.scss$|\.sass$/))      stack.push("SCSS");
  if (has(/framer-motion|motion/)) stack.push("Framer Motion");
  if (has(/prisma/))               stack.push("Prisma ORM");
  if (has(/supabase/))             stack.push("Supabase");
  if (stack.length === 0)          stack.push("React");

  return stack.join(", ");
}

/**
 * Pull UI-domain file paths from the map (components, pages, styles).
 * Capped at 40 paths to stay within token budget.
 */
function getUiPaths(mapSnapshot) {
  if (!mapSnapshot?.nodesByPath) return [];
  return Object.entries(mapSnapshot.nodesByPath)
    .filter(([, node]) => node.type === "file" && node.domain === "UI")
    .map(([path]) => path)
    .slice(0, 40);
}

/**
 * Get all file paths the map knows about (for "don't invent paths" guidance).
 */
function getAllPaths(mapSnapshot) {
  if (!mapSnapshot?.nodesByPath) return [];
  return Object.keys(mapSnapshot.nodesByPath)
    .filter((p) => mapSnapshot.nodesByPath[p]?.type === "file")
    .slice(0, 80);
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildSystemPrompt(ctx, input) {
  const stack        = inferStack(ctx.mapSnapshot);
  const uiPaths      = getUiPaths(ctx.mapSnapshot);
  const allPaths     = getAllPaths(ctx.mapSnapshot);
  const targetPaths  = input.targetPaths ?? [];
  const repoKey      = ctx.mapCompact?.repoKey ?? ctx.repo?.name ?? "unknown repo";

  const existingSection = allPaths.length
    ? `\nKnown repo files (use these paths — do not invent new ones unless the task requires a new file):\n${allPaths.join("\n")}`
    : "";

  const uiSection = uiPaths.length
    ? `\nExisting UI files (be consistent with these):\n${uiPaths.join("\n")}`
    : "";

  const targetSection = targetPaths.length
    ? `\nThe orchestrator has specified these target paths to create or edit:\n${targetPaths.join("\n")}`
    : "";

  const specSection = input.spec
    ? `\nAdditional spec / requirements:\n${input.spec}`
    : "";

  const dbSection = ctx.dbSchema?.tables
    ? `\nDatabase schema available via import { getAll, getById, insert, update, remove } from "/lib/db.js":\n` +
      Object.entries(ctx.dbSchema.tables)
        .map(([table, def]) => `  ${table}: { ${Object.keys(def.fields ?? {}).join(", ")} }`)
        .join("\n")
    : "";

  return `You are the UI Agent in a multi-agent code generation system.
Your sole responsibility: generate clean, production-ready FRONTEND React code.

CRITICAL: You are generating code for a REACT sandbox (Sandpack). This means:
- Every file MUST be a React component using JSX. No exceptions.
- NEVER generate vanilla JS, HTML files, or plain DOM manipulation code.
- NEVER use document.querySelector, document.getElementById, addEventListener, innerHTML, appendChild, or any direct DOM API.
- NEVER generate an index.html — the sandbox provides one automatically.
- React state (useState) is how you store data. React events (onClick, onChange, onSubmit) are how you handle interaction.
- If you write "document." or "window." anywhere in a component, you are doing it wrong.

Project: ${repoKey}
Tech stack: ${stack}
${existingSection}
${uiSection}
${targetSection}
${dbSection}
${specSection}

OUTPUT FORMAT — reply with ONLY valid JSON, no markdown fences, no extra text:
{
  "summary": "One plain-English sentence describing what you built.",
  "files": [
    {
      "path": "relative/path/from/repo/root.tsx",
      "action": "create",
      "content": "full file content here"
    }
  ]
}

═══ SANDPACK COMPATIBILITY (critical — preview will break if violated) ═══
- ALWAYS use a default export for the main component: "export default function MyComponent()"
- NEVER use TypeScript syntax — no type annotations, no generics like useState<string[]>(),
  no interface/type declarations, no ": SomeType" after variable names.
  The preview runs in a JavaScript-only Babel sandbox. TypeScript will crash it silently.
- File extensions must be .jsx or .js — never .tsx or .ts.
- JSX expression syntax: dynamic values in attributes MUST use {}: key={"value-" + index} not key="value"
- NEVER use React.CSSProperties or any React type references.
- Inline style objects must use plain JS objects with no type annotation:
  const styles = { main: { color: "red" } }  ← correct
  const styles: Record<string, React.CSSProperties> = {...}  ← WRONG, crashes Babel

═══ BEST PRACTICES (always apply) ═══════════════════════════════════════
STRUCTURE
- One component per file. Keep files under 200 lines; split if larger.
- Default export for the main component. Named exports for helpers only.
- Co-locate small helper functions at the bottom of the file, not in separate utils.
- Use descriptive names: ButtonPrimary not Btn, UserProfileCard not Card2.

REACT PATTERNS
- Functional components only — no class components.
- Derive values from props/state with useMemo/useCallback only when genuinely expensive.
- Extract repeated JSX into sub-components (>3 repetitions = extract).
- Never mutate state directly; always create a new reference.
- Keys on lists must be stable and unique — never use array index as key if items reorder.

ACCESSIBILITY (non-negotiable)
- Every interactive element (button, link, input) must have an aria-label or visible text.
- Images must have descriptive alt attributes (alt="" for decorative).
- Use semantic HTML: <nav>, <main>, <section>, <article>, <header>, <footer>.
- Focusable elements must have visible :focus-visible styles.
- Color contrast: text on background must meet WCAG AA (4.5:1 minimum).

STYLING
- Use only inline styles or CSS classes already established in the project.
- Never add Tailwind unless the project already uses it.
- Never import external CSS files or CDN stylesheets.
- Avoid fixed pixel heights on containers — prefer min-height or auto.
- Mobile-first: layouts must work at 320px width minimum.

PERFORMANCE
- Avoid large useEffect chains; prefer event handlers for user interactions.
- Never fetch data directly in a component — accept data as props.
- Lazy-load images with loading="lazy".

═══ GUARDRAILS (hard rules — never violate) ════════════════════════════
- NEVER include API keys, tokens, passwords, or env vars in component code.
- NEVER use dangerouslySetInnerHTML unless explicitly required and the content is sanitised.
- NEVER use eval(), new Function(), or any dynamic code execution.
- NEVER import from next/server, next/headers, or any server-only module.
- NEVER use document.write(), document.querySelector(), document.getElementById(), or any direct DOM API — use React state and refs instead.
- NEVER use addEventListener() — use React event props (onClick, onChange, onSubmit, onKeyDown).
- NEVER generate a plain HTML file or vanilla JS file — every file must be a React component.
- NEVER hardcode localhost URLs or absolute paths — use relative paths only.
- NEVER add console.log, alert(), or debugger statements.
- NEVER use inline event handler strings (onclick="...") — always use JSX event props.
- NEVER produce partial files — write the FULL file content every time, no "// rest unchanged".
- NEVER invent new file paths that don't exist in the map unless the task explicitly requires a new file.
- NEVER import from JSON files or use import assertions (assert { type: "json" }) — these don't work in the browser sandbox.
- If the project has a db.js data layer, import it as: import { getAll, insert, update, remove } from "/lib/db.js"
  Use absolute paths starting with "/" — relative paths like "../lib/db.js" do NOT resolve in the sandbox.`;
}

// ─── Response parser ──────────────────────────────────────────────────────────

function parseResponse(raw) {
  const trimmed = raw.trim();

  // Try direct parse
  try {
    return JSON.parse(trimmed);
  } catch { /* fall through */ }

  // Strip markdown fences if the model ignored the instruction
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch { /* fall through */ }
  }

  // Last resort — find the outermost { } block
  const start = trimmed.indexOf("{");
  const end   = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch { /* fall through */ }
  }

  return null;
}

// ─── Public agent function ────────────────────────────────────────────────────

/**
 * Run the UI agent.
 *
 * @param {import("../context.js").OrchestratorContext} ctx
 * @param {{
 *   task: string,
 *   targetPaths?: string[],
 *   spec?: string,
 * }} input
 * @returns {Promise<{ ok: boolean, output: object|null, error: string|null }>}
 */
export async function runUiAgent(ctx, input) {
  if (!input?.task?.trim()) {
    return { ok: false, output: null, error: "UI agent requires a non-empty task." };
  }

  const system   = buildSystemPrompt(ctx, input);
  const userMsg  = `Task: ${input.task.trim()}`;

  let rawResponse;
  try {
    rawResponse = await callGroq(
      [
        { role: "system", content: system },
        { role: "user",   content: userMsg },
      ],
      // Large token budget — component files can be long
      6000
    );
  } catch (err) {
    return { ok: false, output: null, error: err.message };
  }

  const parsed = parseResponse(rawResponse);

  if (!parsed) {
    // Groq returned something we can't parse — still save it so the monitor
    // can flag it, but mark as failed
    return {
      ok: false,
      output: null,
      error: `[ui-agent] Could not parse Groq response as JSON. Raw: ${rawResponse.slice(0, 300)}`,
    };
  }

  if (!Array.isArray(parsed.files) || parsed.files.length === 0) {
    return {
      ok: false,
      output: null,
      error: "[ui-agent] Groq returned no files. Prompt may need more specificity.",
    };
  }

  // Validate each file entry has the required fields
  const validFiles = parsed.files.filter(
    (f) => typeof f.path === "string" && typeof f.content === "string"
  );

  if (validFiles.length === 0) {
    return {
      ok: false,
      output: null,
      error: "[ui-agent] Groq returned files but none had valid path + content fields.",
    };
  }

  const artifactId = uid("UI");
  const artifact = {
    id:          artifactId,
    agent:       "UI",
    task:        input.task,
    summary:     parsed.summary ?? `UI: ${input.task}`,
    files:       validFiles.map((f) => ({
      path:    f.path,
      content: f.content,
      action:  f.action === "modify" ? "modify" : "create",
    })),
    paths:       validFiles.map((f) => f.path),
    rawResponse,
  };

  // Push into the shared context so the orchestrator loop can pass the
  // artifactId to monitor_review_output and security_review_output
  ctx.artifacts.push(artifact);
  ctx.phase = "codegen";

  return {
    ok: true,
    output: { artifactId, artifact },
    error: null,
  };
}
