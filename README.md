# Sprout

**AI-powered code companion that maps your codebase, explains every file, and runs a token-efficient multi-agent pipeline to generate and ship code — straight to GitHub.**

Built for a hackathon. Built to solve a real problem: most AI coding agents burn 10–13× more tokens than needed by re-reading code they've already seen. Sprout fixes that from the ground up.

---

## What it does

### 1. Visual File Map
Load any public GitHub repo (or private with OAuth). Sprout fetches the full recursive file tree, classifies every file by domain (UI / API / Database / Security / Validation / Review) using fast rule-based heuristics, and renders an interactive D3 graph.

- Hover any node → on-demand AI summary (~120 tokens, lazy — not upfront)
- Click any node → deeper detail: role, pointers to related files, workflow breakdown
- Ask the map a natural-language question ("where is authentication handled?") → instant answer with target file
- Export the full map as Markdown or JSON to paste into any AI tool

Summaries are cached in `sessionStorage` per repo so they survive page reloads and are never re-fetched.

### 2. Code Explainer
Paste or load any file. Sprout splits it into logical blocks, then explains any selected block in plain English — no full-file re-read on every question.

### 3. Multi-Agent Orchestrator
Describe what you want to build. A **deterministic planner** (no routing LLM) computes the exact pipeline and executes it:

| Phase | What happens |
|---|---|
| `repo_read` | Reads the target GitHub repo tree + optional file samples |
| `map` | Loads a compact repo map snapshot (~800 tokens, not the full tree) |
| `db` *(if goal mentions database)* | DB agent designs schema + seed data + `db.js` data layer |
| `ui` | UI agent generates React component files from the goal + map context |
| Monitor gate | Auto-reviews every generated artifact — quality check, 64-token reply |
| Security gate | Auto-reviews for secrets, eval(), server-only imports, XSS |
| Self-heal | If monitor fails, retries the same agent with feedback injected — no human loop |
| `push` | Creates blobs, builds a tree commit, pushes to GitHub via Trees API |

Every step streams back to the browser over SSE. Generated files render live in a Sandpack in-browser sandbox before anything hits GitHub.

### 4. Run History
Every completed run is saved to `localStorage` per repo. The last 3 runs are injected as compact context on the next run so the agent knows what was already built.

---

## Why the token efficiency matters

| Operation | Typical agent | Sprout |
|---|---|---|
| Routing decision per turn | ~3,500 tokens | **0** — deterministic planner |
| Repo context per run | ~40,000 tokens | **~800** — compact snapshot |
| Code review pass | ~3,500 tokens | **~300** — 2 files × 1.5k chars |
| Node summary (hover) | ~2,000 tokens | **~120** — path + siblings only |
| **Total per run** | **~57,000 tokens** | **~1,620 tokens** |

At GPT-4-class pricing and 100 runs/day, that's roughly **$9,000/month saved** per team.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | JavaScript / JSX |
| Styling | Tailwind CSS v4 + custom CSS design system |
| Animation | Framer Motion (`motion/react`) |
| Graph | D3 v7 |
| Live preview | Sandpack (`@codesandbox/sandpack-react`) |
| AI / LLM | [Groq](https://console.groq.com) — multi-model routing by role |
| Auth | GitHub OAuth → iron-session (encrypted cookie) |

### Model routing

| Role | Env var | Default |
|---|---|---|
| Orchestrator + UI generation | `GROQ_MODEL_UI` | `openai/gpt-oss-120b` |
| Review / security gates | `GROQ_MODEL_REVIEW` | `openai/gpt-oss-20b` |
| File map summaries | `GROQ_MODEL_FILEMAP` | `openai/gpt-oss-20b` |

---

## Project structure

```
app/
  page.js                    # Landing page
  workspace/
    WorkspaceClient.js       # Client shell — repo loading, orchestrator SSE, history
  api/
    auth/                    # GitHub OAuth (login, callback, logout, session)
    github/tree              # Server-side proxy for GitHub recursive tree API
    github/content           # Proxies individual file content
    filemap/summarize        # AI summary for a single file node (on hover)
    filemap/explain          # Deeper node detail (role, pointers, workflow)
    filemap/ask              # Natural-language Q&A over the repo map
    explain-code             # Full-file structured code explanation
    explain-block            # Selected-block plain-English explanation
    chunk-code               # Splits a file into logical blocks
    orchestrator             # SSE endpoint — streams the multi-agent pipeline
    agents/ui                # Direct UI-agent endpoint (used by live preview standalone)

src/
  components/
    landing/                 # Hero, NavBar, stats strip, how-it-works, token math, FAQ, footer
    dashboard/               # DashboardShell, tab routing
    filemap/                 # FileSystemMap, FileMapGraph (D3), RepoInput, ask/copy bars
    editor/                  # CodeExplainer panel
    agents/                  # AgentSidebar, AgentCardRow, OrchestratorStatus, ReviewResultsPanel
    history/                 # HistorySidebar (run history per repo)
    preview/                 # LivePreviewPanel (Sandpack + orchestrator integration)
    shared/                  # ActionButton, SproutMark logo, ThemeToggle
  context/
    RepoMapContext.jsx       # Shared repo-map state across workspace
  hooks/
    useRepoMapSummarize      # Lazy AI summarisation on node hover/click
    useRepoDependencies      # Parses import graph from file content
    useRunHistory            # localStorage run history per repo key
    useSession               # GitHub auth session
  lib/
    repoMap.js               # Build, persist, merge AI results into the map
    parseGithubTree.js       # Flatten GitHub tree API response
    parseDependencies.js     # Static import/require graph parser
    fileTypeGuess.js         # Rule-based fallback labels before AI runs
    repoMapAsk.js            # Prompt builder for ask-about-repo flow
    repoMapExport.js         # Copy-to-clipboard export (Markdown / JSON)
    auth.js                  # iron-session helpers
    orchestrator/
      loop.js                # Main pipeline runner — iterates phases, fires gates
      planner.js             # Deterministic plan builder (zero LLM calls)
      tools.js               # Tool registry wired to agent implementations
      context.js             # Mutable run context + compactMapSnapshot()
      groq.js                # Groq client — multi-model routing, rate-limit retry
      validate.js            # Tool result shape assertion
      agents/
        uiAgent.js           # Generates React files from goal + repo map context
        dbAgent.js           # Designs database schemas + data layer
        reviewAgent.js       # Monitor (quality) + Security review gates
        githubAgent.js       # Reads/creates repos, pushes commits via Trees API
        stubs.js             # No-op stubs for map-load phase
```

---

## Getting started

Requires Node.js ≥ 18.

```sh
git clone https://github.com/angelcodesbomb/sprout-code-companion
cd sprout-code-companion
npm install
cp .env.example .env.local   # fill in GROQ_API_KEY at minimum
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `GROQ_API_KEY` | ✅ | [Get a free key at console.groq.com](https://console.groq.com) |
| `GROQ_MODEL_UI` | optional | Model for UI generation (default: `openai/gpt-oss-120b`) |
| `GROQ_MODEL_REVIEW` | optional | Model for review gates (default: `openai/gpt-oss-20b`) |
| `GROQ_MODEL_FILEMAP` | optional | Model for file map summaries (default: `openai/gpt-oss-20b`) |
| `GITHUB_CLIENT_ID` | for auth | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | for auth | GitHub OAuth App client secret |
| `AUTH_SECRET` | for auth | 32-byte base64 secret for cookie encryption |
| `GITHUB_TOKEN` | optional | Server-side PAT for higher GitHub API rate limits |

**GitHub OAuth App** (only needed for private repos / pushing):
1. [Create an OAuth App](https://github.com/settings/developers)
2. Homepage URL: `http://localhost:3000`
3. Callback URL: `http://localhost:3000/api/auth/callback`

### Other commands

```sh
npm run build                   # Production build
npm run lint                    # ESLint
npm run test:orchestrator       # Smoke-test the orchestrator pipeline
npm run test:groq-tools         # Smoke-test Groq tool-calling
```

---

## How the orchestrator pipeline works

```
POST /api/orchestrator  { goal, mapSnapshot?, stream: true }
        │
        ▼
  buildPlan(goal, ctx)          ← pure function, zero LLM calls
        │
  for each phase:
  ┌─────────────────────────────────────────────────────┐
  │  tool_start  ──SSE──►  browser                      │
  │  tool.run(input)                                     │
  │  step  ──SSE──►  browser                            │
  │                                                      │
  │  if codegen step succeeded:                          │
  │    monitorGate  → self-heal if quality fails (1×)    │
  │    securityGate → log flags, continue                │
  │    ui_files  ──SSE──►  browser  → Sandpack preview  │
  └─────────────────────────────────────────────────────┘
        │
  done  ──SSE──►  browser
```

The key design choice: routing is a **pure function** (`planner.js`), not an LLM call. The previous approach asked a model "what should I do next?" on every turn (~3,500 tokens each). The current planner uses regex + boolean checks and costs zero tokens.

---

## Architecture decisions worth noting

**File map first, content never** — agents receive a compact snapshot of the repo map (40 sample paths + domain counts), not file content. The UI agent never reads actual source files — it infers stack and structure from paths alone.

**Review as middleware, not a pipeline step** — the Monitor and Security gates run as synchronous middleware after every codegen step, not as orchestrator turns. They don't consume a routing slot and can't be skipped by the planner.

**Sandpack path flattening** — generated files are normalized to a flat root (`/Button.jsx`, `/db.js`) and imports are rewritten automatically so Sandpack resolves them without a bundler config.

**Single CSS file** — the entire design system lives in `src/styles.css`. No Tailwind utility classes in component files for custom UI — only the design token layer (`bg-card`, `text-foreground` etc.) is used where Tailwind makes sense.
