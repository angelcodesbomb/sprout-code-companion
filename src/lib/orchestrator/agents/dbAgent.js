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
const DB_MODEL = process.env.GROQ_MODEL_FILEMAP || "openai/gpt-oss-20b";

// ─── Groq call ────────────────────────────────────────────────────────────────

async function callGroq(messages, maxTokens = 6000) {
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
        temperature: 0.2,
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

/**
 * Pull all file paths from the map for "don't invent paths" guidance.
 */
function getAllPaths(mapSnapshot) {
  if (!mapSnapshot?.nodesByPath) return [];
  return Object.keys(mapSnapshot.nodesByPath)
    .filter((p) => mapSnapshot.nodesByPath[p]?.type === "file")
    .slice(0, 60);
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildSystemPrompt(ctx, input) {
  const ts          = usesTypeScript(ctx.mapSnapshot);
  const dbPaths     = getDbPaths(ctx.mapSnapshot);
  const allPaths    = getAllPaths(ctx.mapSnapshot);
  const entityHints = extractEntityHintsFromArtifacts(ctx.artifacts);
  const repoKey     = ctx.mapCompact?.repoKey ?? ctx.repo?.name ?? "unknown repo";

  const existingDbSection = dbPaths.length
    ? `\nExisting database files in the repo (respect these, don't duplicate):\n${dbPaths.join("\n")}`
    : "";

  const entitySection = entityHints.length
    ? `\nEntity hints inferred from UI code already generated:\n${entityHints.map((e) => `- ${e}`).join("\n")}`
    : "";

  const pathsSection = allPaths.length
    ? `\nAll known repo file paths (use existing paths where possible):\n${allPaths.join("\n")}`
    : "";

  const existingSchemaSection = ctx.dbSchema
    ? `\nExisting schema already in context (extend or update, do not discard):\n${JSON.stringify(ctx.dbSchema, null, 2)}`
    : "";

  const tsNote = ts
    ? "The project uses TypeScript — include lib/db.types.ts with full type definitions."
    : "The project uses JavaScript — do NOT generate .ts files.";

  return `You are the Database Agent in a multi-agent code generation system.
Your sole responsibility: design a minimal, self-contained local data layer for the project.
This layer must work with ZERO external dependencies — no Prisma, no SQLite, no pg, no mongodb, no fetch calls.
All data lives in JSON files on disk, loaded at startup into memory.

Project: ${repoKey}
${tsNote}
${existingDbSection}
${entitySection}
${pathsSection}
${existingSchemaSection}

═══ FILES TO GENERATE ══════════════════════════════════════════════════
Generate EXACTLY these files (adjust paths if equivalents already exist in the repo):

1. db/schema.json
   The canonical schema definition. Shape:
   {
     "tables": {
       "<tableName>": {
         "fields": {
           "<fieldName>": { "type": "string|number|boolean|date|id", "required": true|false }
         },
         "relations": {
           "<fieldName>": { "table": "<otherTable>", "cardinality": "one|many" }
         }
       }
     }
   }

2. db/seed.json
   Realistic seed data for every table. Shape: { "<tableName>": [ ...records ] }
   - 8–15 records per table minimum.
   - Every "id" field must be a unique string (use "1", "2", etc.).
   - Foreign key fields must reference real ids from the related seed table.
   - Use realistic names, dates, and values — not "foo", "bar", "test".

3. lib/db.js  (or lib/db.ts if TypeScript)
   A localStorage-backed store that works in both a browser sandbox (Sandpack preview)
   and a real app running on localhost. No file imports — seed data is inlined as a JS object.

   EXACT PATTERN TO FOLLOW (write the actual code, not this pseudocode):
   - Declare a SEED_DATA constant with all tables and 8-15 records each (copy from db/seed.json exactly)
   - STORAGE_KEY = "sprout_db_<projectname>" (unique per project)
   - loadDb(): tries JSON.parse(localStorage.getItem(STORAGE_KEY)), falls back to deep clone of SEED_DATA
   - saveDb(db): calls localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
   - Singleton: let _db = loadDb() at module level
   - Export getAll(table): returns [..._db[table]] or throws "Unknown table: <name>"
   - Export getById(table, id): returns matching record or null
   - Export insert(table, record): spreads record + auto id, pushes to _db[table], calls saveDb, returns new record
   - Export update(table, id, patch): maps over table replacing matched record, calls saveDb, returns updated or null
   - Export remove(table, id): filters out matched record, calls saveDb, returns true/false
   - Export reset(): sets _db back to deep clone of SEED_DATA, calls saveDb

   Rules for db.js:
   - SEED_DATA must contain ALL tables with 8-15 realistic records each
   - NEVER use import to load JSON files — data must be inlined in SEED_DATA
   - NEVER use fs, path, require(), or any Node-only API
   - All mutations must call saveDb() so changes persist across page refreshes
   - The module must use pure ES module syntax (export, not module.exports)

4. lib/db.types.ts  (TypeScript projects only — omit entirely for JS projects)
   Full TypeScript interfaces for every table record.
   Also export a union type: type TableName = "users" | "posts" | ...

═══ BEST PRACTICES ═════════════════════════════════════════════════════
- Design the smallest schema that satisfies the goal — don't add tables speculatively.
- Field names must be camelCase.
- Every table must have an "id" field of type "id".
- Dates stored as ISO 8601 strings in seed data.
- The db.js store must be a singleton (module-level variable) so all imports share state.
- NEVER include server-only imports (fs, path, crypto from Node) in db.js — it must be isomorphic.
- NEVER add console.log, debugger, or TODO comments.

═══ OUTPUT FORMAT ══════════════════════════════════════════════════════
Reply with ONLY valid JSON, no markdown fences, no extra text:
{
  "summary": "One plain-English sentence describing the schema and what was generated.",
  "schema": {
    "tables": { ... }
  },
  "files": [
    {
      "path": "db/schema.json",
      "action": "create",
      "content": "full file content as a string"
    },
    {
      "path": "db/seed.json",
      "action": "create",
      "content": "..."
    },
    {
      "path": "lib/db.js",
      "action": "create",
      "content": "..."
    }
  ]
}`;
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
      ],
      6000
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
