/**
 * Database Agent — generates a fully self-contained, local-only data layer.
 *
 * Called by the orchestrator via tools.js → db_agent_design_schema.
 *
 * ── What it produces ──────────────────────────────────────────────────────────
 *
 * Given a goal and the current context (repo map + existing UI artifacts),
 * the agent asks Groq to design a schema and generate four files:
 *
 *   db/schema.json        — canonical schema: tables, fields, types, relations
 *   db/seed.json          — realistic seed data (10–20 records per table)
 *   lib/db.js             — zero-dependency in-memory store backed by seed.json
 *                           Exports: getAll, getById, insert, update, remove
 *   lib/db.types.ts       — TypeScript types (only if the project uses TS)
 *
 * ── Design constraints ────────────────────────────────────────────────────────
 * - No external DB packages (no Prisma, SQLite, pg, mongoose, etc.)
 * - No environment variables or connection strings
 * - No server-only Node APIs — everything must work in a browser sandbox too
 * - Schema is the single source of truth; seed data is regenerated fresh each time
 *
 * ── Output shape ──────────────────────────────────────────────────────────────
 * {
 *   artifactId: string,
 *   artifact: {
 *     id: string,
 *     agent: "Database",
 *     task: string,
 *     summary: string,
 *     schema: object,          // compact schema stored in ctx.dbSchema
 *     files: Array<{ path, content, action }>,
 *     paths: string[],
 *     rawResponse: string,
 *   }
 * }
 */

import { uid } from "../context.js";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
// DB agent needs the smarter model — schema design + valid JSON output is harder than summarization
const DB_MODEL = process.env.GROQ_MODEL_ORCHESTRATOR || "openai/gpt-oss-120b";

// ─── Groq call ────────────────────────────────────────────────────────────────

async function callGroq(messages, maxTokens = 4000) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("[db-agent] GROQ_API_KEY is not set.");

  let attempt = 0;
  while (attempt < 4) {
    const res = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: DB_MODEL,
        messages,
        temperature: 0.1,   // lower = more deterministic JSON output
        max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(60_000),
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
      throw new Error(`[db-agent] Groq error ${res.status}: ${text}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "";
  }

  throw new Error("[db-agent] Groq rate-limit retries exhausted.");
}

// ─── Context analysis helpers ─────────────────────────────────────────────────

/**
 * Infer whether the project uses TypeScript from the repo map.
 */
function usesTypeScript(mapSnapshot) {
  if (!mapSnapshot?.nodesByPath) return false;
  return Object.keys(mapSnapshot.nodesByPath).some((p) => p.endsWith(".ts") || p.endsWith(".tsx"));
}

/**
 * Extract existing Database-domain file paths from the map.
 * These hint at an existing schema the agent should respect.
 */
function getDbPaths(mapSnapshot) {
  if (!mapSnapshot?.nodesByPath) return [];
  return Object.entries(mapSnapshot.nodesByPath)
    .filter(([, node]) => node.type === "file" && node.domain === "Database")
    .map(([path]) => path)
    .slice(0, 20);
}

/**
 * Scan already-generated UI artifact files for entity name hints.
 * e.g. a file containing "UserCard" or "productId" suggests users/products tables.
 */
function extractEntityHintsFromArtifacts(artifacts) {
  const hints = new Set();

  for (const artifact of artifacts) {
    if (!Array.isArray(artifact.files)) continue;
    for (const file of artifact.files) {
      const content = file.content ?? "";
      // Pick out PascalCase nouns that look like model names (e.g. UserCard, PostList)
      const pascalMatches = content.match(/\b([A-Z][a-z]+){1,3}(Card|List|Row|Item|Form|Detail|Table)\b/g) ?? [];
      for (const m of pascalMatches) {
        // Strip the suffix to get the entity (UserCard → user, PostList → post)
        const entity = m.replace(/(Card|List|Row|Item|Form|Detail|Table)$/, "").toLowerCase();
        if (entity.length > 2) hints.add(entity);
      }
      // Also match explicit prop names like "userId", "productId", "orderId"
      const idMatches = content.match(/\b([a-z][a-zA-Z]+)Id\b/g) ?? [];
      for (const m of idMatches) {
        const entity = m.replace(/Id$/, "").toLowerCase();
        if (entity.length > 2 && entity !== "action" && entity !== "artifact") {
          hints.add(entity);
        }
      }
    }
  }

  return [...hints].slice(0, 8);
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildSystemPrompt(ctx, input) {
  const ts          = usesTypeScript(ctx.mapSnapshot);
  const dbPaths     = getDbPaths(ctx.mapSnapshot);   // max 20, existing DB files only
  const entityHints = extractEntityHintsFromArtifacts(ctx.artifacts); // max 8 entity names
  const repoKey     = ctx.mapCompact?.repoKey ?? ctx.repo?.name ?? "unknown repo";

  const existingDbSection = dbPaths.length
    ? `\nExisting DB files (don't duplicate):\n${dbPaths.join("\n")}`
    : "";

  const entitySection = entityHints.length
    ? `\nEntity hints from UI code: ${entityHints.join(", ")}`
    : "";

  const existingSchemaSection = ctx.dbSchema
    ? `\nExtend this schema (don't discard):\n${JSON.stringify(ctx.dbSchema)}`
    : "";

  const tsNote = ts
    ? "Project uses TypeScript — include lib/db.types.ts."
    : "Project uses JavaScript — no .ts files.";

  return `You are the Database Agent. Design a minimal local data layer.
No external DB packages. No env vars. No Node-only APIs. Must work in a browser sandbox.

Project: ${repoKey}. ${tsNote}
${existingDbSection}${entitySection}${existingSchemaSection}

Generate EXACTLY these files:

1. db/schema.json — schema definition:
{"tables":{"<name>":{"fields":{"<field>":{"type":"string|number|boolean|date|id","required":true}},"relations":{}}}}

2. db/seed.json — {"<table>":[...8-12 realistic records each, unique string ids, real values]}

3. lib/db.js — localStorage-backed singleton store. MUST:
- Inline ALL seed data as SEED_DATA constant (no file imports)
- STORAGE_KEY = "sprout_db"
- loadDb(): JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? deepClone(SEED_DATA)
- saveDb(db): localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
- let _db = loadDb() at module level
- export getAll(table), getById(table,id), insert(table,record), update(table,id,patch), remove(table,id), reset()
- Pure ES module syntax. No console.log. No Node APIs.

Output ONLY valid JSON, no markdown:
{"summary":"one sentence","schema":{...},"files":[{"path":"...","action":"create","content":"..."}]}`;
}

// ─── Response parser ──────────────────────────────────────────────────────────

function parseResponse(raw) {
  const trimmed = raw.trim();

  try { return JSON.parse(trimmed); } catch { /* fall through */ }

  // Strip markdown fences if the model ignored the instruction
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch { /* fall through */ }
  }

  // Last resort — find outermost { }
  const start = trimmed.indexOf("{");
  const end   = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { /* fall through */ }
  }

  return null;
}

// ─── Public agent function ────────────────────────────────────────────────────

/**
 * Run the Database Agent.
 *
 * @param {import("../context.js").OrchestratorContext} ctx
 * @param {{
 *   task: string,
 *   targetPaths?: string[],
 *   spec?: string,
 * }} input
 * @returns {Promise<{ ok: boolean, output: object|null, error: string|null }>}
 */
export async function runDbAgent(ctx, input) {
  if (!input?.task?.trim()) {
    return { ok: false, output: null, error: "Database agent requires a non-empty task." };
  }

  const system  = buildSystemPrompt(ctx, input);
  const userMsg = `Task: ${input.task.trim()}${input.spec ? `\n\nAdditional requirements:\n${input.spec}` : ""}`;

  let rawResponse;
  try {
    rawResponse = await callGroq(
      [
        { role: "system", content: system },
        { role: "user",   content: userMsg },
      ]
    );
  } catch (err) {
    return { ok: false, output: null, error: err.message };
  }

  const parsed = parseResponse(rawResponse);

  if (!parsed) {
    return {
      ok: false,
      output: null,
      error: `[db-agent] Could not parse Groq response as JSON. Raw: ${rawResponse.slice(0, 300)}`,
    };
  }

  if (!Array.isArray(parsed.files) || parsed.files.length === 0) {
    return {
      ok: false,
      output: null,
      error: "[db-agent] Groq returned no files. Prompt may need more specificity.",
    };
  }

  const validFiles = parsed.files.filter(
    (f) => typeof f.path === "string" && typeof f.content === "string"
  );

  if (validFiles.length === 0) {
    return {
      ok: false,
      output: null,
      error: "[db-agent] Groq returned files but none had valid path + content fields.",
    };
  }

  const artifactId = uid("DB");
  const artifact = {
    id:          artifactId,
    agent:       "Database",
    task:        input.task,
    summary:     parsed.summary ?? `Database: ${input.task}`,
    schema:      parsed.schema ?? null,
    files:       validFiles.map((f) => ({
      path:    f.path,
      content: f.content,
      action:  f.action === "modify" ? "modify" : "create",
    })),
    paths:       validFiles.map((f) => f.path),
    rawResponse,
  };

  // Push artifact so monitor/security/push tools handle it identically to UI artifacts
  ctx.artifacts.push(artifact);
  ctx.phase = "codegen";

  // Store compact schema in context so UI and API agents can reference real field names
  if (parsed.schema?.tables) {
    ctx.dbSchema = parsed.schema;
  }

  return {
    ok: true,
    output: { artifactId, artifact },
    error: null,
  };
}
