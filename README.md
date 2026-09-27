# Sprout — Code Companion

> **Understand the code. Grow with confidence.**

Sprout turns any GitHub repository into a visual, interactive map and explains every file in plain English — then lets you describe a goal and watches a multi-agent pipeline build, review, and push production-ready code for you.

Built for the **IBM BoB 2.0 Hackathon**. IBM BoB IDE was central to the project: the orchestrator architecture was designed and debugged inside BoB, the FileMap component was created and refined with BoB's assistance, and BoB was used throughout to trace agent communication flows, catch edge cases, and finalize the self-healing review pipeline.

---

## The Problem

Token cost is now a real budget line. Uber burned its entire 2026 AI coding budget in four months. Microsoft cancelled Claude Code licenses for thousands of engineers after costs hit $2,000 per person per month. Studies show coding agents burning 10–13× more tokens than necessary because they have no persistent context — they re-read the whole codebase from scratch on every single turn.

Meanwhile, general software engineering postings are down 49% while ML and AI engineer roles are up 59%. The engineers who survive are the ones who know how to make AI work efficiently for them — not around them.

Sprout was built to fix the token problem: map the codebase once, reference a compact snapshot on every agent run, and never re-read what you already know.

---

## Value Proposition

| Operation | Typical agent | Sprout |
|---|---|---|
| Routing decision per turn | ~3,500 tokens | **0** — deterministic planner |
| Repo context per run | ~40,000 tokens | **~800** — compact 40-path snapshot |
| Code review pass | ~3,500 tokens | **~300** — 2 files × 1.5k chars |
| Node summary (hover) | ~2,000 tokens | **~120** — path + siblings only |
| History context injected | ~8,000 tokens | **~400** — last 3 runs, truncated |
| **Total per run** | **~57,000 tokens** | **~1,620 tokens** |

That is roughly **97% fewer tokens per full pipeline run** — the difference between a $0.04 run and a $0.80 run, multiplied across hundreds of builds per day.

---

## Features

**FileMap** — Visual codebase explorer
- Paste any GitHub `owner/repo` (public or private). Sprout fetches the full recursive file tree via the GitHub API — no clone, no local setup.
- Every file is domain-tagged instantly (UI / API / Database / Security / Validation / Review) using fast regex heuristics. Zero LLM calls for the initial map.
- Hover any node to trigger an on-demand AI summary — one focused 120-token call rather than a bulk scan.
- Interactive D3-powered graph with dependency edges computed from the file tree.
- FileMap component was created and iteratively refined using IBM BoB IDE.

**Code Explainer** — Plain-English code understanding
- Paste or load any file and Sprout chunks it into logical blocks (Imports, State, Handlers, Render).
- Every block gets a plain-English explanation written like a patient friend explaining over chai — no jargon, no assumptions about what you already know.
- Fallback explanations work even without an AI key, so the tool is always useful.

**Orchestrator** — Multi-agent build pipeline
- Describe your goal in plain English. A deterministic planner computes the exact pipeline — no routing LLM, no wasted turns deciding what to do next.
- The pipeline stages: repo load → map activation → database schema generation → UI code generation → automated review → GitHub push.
- The orchestrator architecture was designed and debugged in IBM BoB IDE, including tracing agent communication flows and resolving context-passing edge cases between agents.

**Self-Healing Review Pipeline** — Automated quality and security gates
- After every code generation step, Monitor and Security gates fire automatically — each sending only 2 files × 1,500 chars to a fast model, capped at 64-token responses.
- If the monitor fails, the agent retries with feedback injected. If the security gate flags issues (hardcoded secrets, `eval()`, `dangerouslySetInnerHTML`, server-only imports in client components), the agent self-heals before the step is marked complete.
- No human loop required. ~300 tokens per review pass versus ~3,500 for a full orchestrator turn.

**Live Preview** — Sandpack sandbox
- Generated files render immediately in a CodeSandbox (Sandpack) sandbox in the browser. No deploy, no build step. File paths are flattened and imports rewritten automatically.

**GitHub Push** — One-click deploy
- When satisfied, one click creates blobs, builds a tree on top of the current HEAD, creates a commit, and updates the branch ref — all via the GitHub Trees API. No local git required.

**Run History** — Persistent per-repo context
- Every completed orchestrator run is saved to `localStorage` keyed by repo. Prior run summaries are injected as context on the next run so the agent knows what was already built.

---

## Architecture

### High-Level System

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Browser Client                             │
│                                                                     │
│  ┌──────────────┐   ┌──────────────────┐   ┌────────────────────┐  │
│  │  Landing Page│   │  FileMap / Graph  │   │  Orchestrator UI   │  │
│  │  (Next.js)   │   │  (D3 + RepoMap)  │   │  (SSE stream)      │  │
│  └──────────────┘   └────────┬─────────┘   └─────────┬──────────┘  │
│                               │                       │             │
└───────────────────────────────┼───────────────────────┼─────────────┘
                                │                       │
                    ┌───────────▼───────────────────────▼──────────┐
                    │              Next.js API Routes               │
                    │                                               │
                    │  /api/filemap/summarize   (node hover)        │
                    │  /api/filemap/explain     (node deep dive)    │
                    │  /api/filemap/ask         (free-form Q&A)     │
                    │  /api/explain-code        (file explainer)    │
                    │  /api/chunk-code          (logical chunking)  │
                    │  /api/explain-block       (block explainer)   │
                    │  /api/orchestrator        (pipeline + SSE)    │
                    │  /api/auth/*              (GitHub OAuth)      │
                    └──────────────────┬────────────────────────────┘
                                       │
                    ┌──────────────────▼────────────────────────────┐
                    │           Orchestrator Core                    │
                    │        (src/lib/orchestrator/)                 │
                    │                                               │
                    │  planner.js  ─→  deterministic phase plan     │
                    │  loop.js     ─→  executes plan, fires gates   │
                    │  tools.js    ─→  tool registry                │
                    │  context.js  ─→  shared run state             │
                    └──────────────────┬────────────────────────────┘
                                       │
              ┌────────────────────────┼──────────────────────────┐
              │                        │                          │
   ┌──────────▼────────┐  ┌────────────▼──────────┐  ┌───────────▼────────┐
   │   GitHub Agent    │  │     UI Agent           │  │   Database Agent   │
   │  (read / push)    │  │  (React code gen)      │  │  (schema + db.js)  │
   └───────────────────┘  └────────────────────────┘  └────────────────────┘
                                       │
              ┌────────────────────────┼──────────────────────────┐
              │                        │                          │
   ┌──────────▼────────┐  ┌────────────▼──────────┐
   │   Monitor Gate    │  │   Security Gate        │
   │  (quality review) │  │  (vuln + secret check) │
   └───────────────────┘  └────────────────────────┘
                                       │
                    ┌──────────────────▼────────────────────────────┐
                    │              Groq API                          │
                    │  (LLM inference — openai/gpt-oss-120b,        │
                    │   openai/gpt-oss-20b for lighter tasks)       │
                    └───────────────────────────────────────────────┘
```

### Orchestrator Pipeline (Deterministic Planner)

```
User types goal
       │
       ▼
 buildPlan(goal, ctx)   ← pure function, zero LLM calls
       │
       │   Computes phases based on:
       │   • Is a repo already loaded?  (skip repo_read)
       │   • Does goal mention "database"?  (include db phase)
       │   • Does goal say "backend-only"?  (skip ui phase)
       │   • Does goal say "dry-run"?  (skip push phase)
       │
       ▼
 [ repo_read → map → db? → ui → push ]
       │
       │   For each phase:
       │
       ├──► phaseToToolName(phase)   ← maps phase to exact tool name
       │
       ├──► buildToolInput(phase, ctx)  ← constructs tool arguments
       │
       ├──► tool.run(input)   ← executes the agent
       │
       ├──► if CODEGEN tool:
       │       ├── monitorGate(artifact)    → self-heal on fail
       │       └── securityGate(artifact)  → self-heal on fail
       │
       └──► onStepComplete(step)  → SSE event to browser
```

### FileMap Data Flow

```
GitHub API
    │
    │  GET /repos/:owner/:repo/git/trees/:sha?recursive=1
    ▼
parseGithubTree()
    │  Converts flat blob/tree list → nested tree structure
    ▼
buildRepoMap()
    │  Tags every node with domain (UI/API/DB/Security/etc.)
    │  using regex heuristics — zero LLM calls
    ▼
RepoMapContext (React context)
    │  Shared state: nodesByPath, domainCounts, repoMeta
    ▼
D3 Force Graph
    │  Renders nodes + edges in the browser
    │
    │  User hovers a node
    ▼
/api/filemap/summarize   ← 120-token focused call
    │  Returns: { summary, domain }
    ▼
Node tooltip / detail panel
    │
    │  User clicks "Explain"
    ▼
/api/filemap/explain     ← 400-token structured call
    │  Returns: { function, inputs, outputs, process }
    ▼
Workflow detail drawer
```

### Self-Healing Review Gates

```
UI Agent / DB Agent generates files
              │
              ▼
     monitorGate(artifact)
         sends: 2 files × 1,500 chars
         receives: { pass, feedback }
              │
      ┌───────┴────────┐
    pass              fail
      │                │
      │         inject feedback into spec
      │         re-run same agent (1 retry)
      │                │
      └───────┬─────────┘
              ▼
     securityGate(artifact)
         checks: hardcoded secrets, eval(),
                 dangerouslySetInnerHTML,
                 server-only imports in client files
              │
      ┌───────┴────────┐
    pass              fail
      │                │
      │         inject security fix instructions
      │         re-run same agent (1 retry)
      │                │
      └───────┬─────────┘
              ▼
         Next phase
         (push to GitHub)
```

### Auth Flow

```
User clicks "Connect GitHub"
         │
         ▼
GET /api/auth/login
  → Redirects to GitHub OAuth
         │
         ▼ (GitHub callback)
GET /api/auth/callback
  → Exchanges code for access_token
  → Stores token in iron-session (encrypted cookie)
         │
         ▼
GET /api/auth/session
  → Returns { user, isLoggedIn }
         │
         ▼
Orchestrator reads session.accessToken
  → Used for private repo access and GitHub push
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| UI | React 19, Tailwind CSS v4, Radix UI primitives |
| Animations | Motion (Framer Motion v13) |
| Graph rendering | D3 v7 |
| Code preview | Sandpack (CodeSandbox) |
| LLM inference | Groq API (`openai/gpt-oss-120b` for agents, `openai/gpt-oss-20b` for FileMap) |
| Auth | GitHub OAuth + iron-session (encrypted cookies) |
| State management | React Context + TanStack Query |
| Build tooling | PostCSS, ESLint, Prettier |
| IDE (core features) | **IBM BoB 2.0** |

---

## Getting Started

### Prerequisites

- Node.js 20+
- A Groq API key ([console.groq.com](https://console.groq.com))
- A GitHub OAuth App (for private repos and push)

### Installation

```bash
git clone https://github.com/your-username/sprout-code-companion
cd sprout-code-companion
npm install
```

### Environment Variables

Copy `.env.example` to `.env.local` and fill in:

```env
# Required — LLM inference
GROQ_API_KEY=your_groq_api_key

# Optional — model overrides
GROQ_MODEL_FILEMAP=openai/gpt-oss-20b
GROQ_MODEL_UI=openai/gpt-oss-120b
GROQ_MODEL_ORCHESTRATOR=openai/gpt-oss-120b

# Required for private repos and push
GITHUB_TOKEN=your_github_pat

# Required for OAuth login
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
NEXTAUTH_SECRET=your_random_secret
NEXTAUTH_URL=http://localhost:3000

# Required for encrypted session cookies
SESSION_SECRET=your_32_char_minimum_secret
```

### Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## IBM BoB 2.0 — How It Was Used

IBM BoB IDE was used as the primary development environment for Sprout's most complex subsystems:

- **Orchestrator architecture** — the deterministic planner (`planner.js`) and execution loop (`loop.js`) were designed inside BoB, with BoB helping trace the context-passing chain between phases and surface edge cases where `ctx` state was stale or incomplete.
- **FileMap component** — the RepoMap data model, domain-tagging heuristics, and the D3 graph rendering pipeline were created and refined iteratively inside BoB.
- **Self-healing review pipeline** — the monitor and security gates with automatic retry logic were built with BoB's help, including diagnosing cases where self-heal retries would overwrite the wrong artifact in `ctx.artifacts`.
- **Debugging agent communication** — BoB was used to trace SSE event flows from the orchestrator route through to the browser, catching cases where `ui_files` events were emitted before the security gate had run.
- **UI Agent prompt engineering** — the system prompt for the UI Agent (React code generation with Sandpack compatibility rules, accessibility requirements, and guardrails) was developed and tested inside BoB.

---

## Project Structure

```
sprout-code-companion/
├── app/
│   ├── page.js                    # Landing page
│   ├── workspace/
│   │   ├── page.js                # Workspace metadata
│   │   └── WorkspaceClient.js     # Main workspace shell
│   └── api/
│       ├── orchestrator/route.js  # Pipeline endpoint (SSE)
│       ├── filemap/
│       │   ├── summarize/         # Node hover summaries
│       │   ├── explain/           # Deep-dive explanations
│       │   └── ask/               # Free-form Q&A
│       ├── chunk-code/            # Logical block chunker
│       ├── explain-code/          # Full file explainer
│       ├── explain-block/         # Single block explainer
│       ├── github/                # Repo tree + file content
│       └── auth/                  # GitHub OAuth flow
├── src/
│   ├── lib/
│   │   ├── orchestrator/
│   │   │   ├── planner.js         # Deterministic pipeline planner
│   │   │   ├── loop.js            # Execution loop + review gates
│   │   │   ├── tools.js           # Tool registry
│   │   │   ├── context.js         # Shared run state
│   │   │   └── agents/
│   │   │       ├── uiAgent.js     # React code generator
│   │   │       ├── dbAgent.js     # Schema + data layer generator
│   │   │       ├── githubAgent.js # Repo read / push
│   │   │       └── reviewAgent.js # Monitor + security gates
│   │   ├── repoMap.js             # Domain tagging heuristics
│   │   ├── parseGithubTree.js     # Tree parser
│   │   └── auth.js                # Session helpers
│   ├── components/
│   │   ├── landing/               # Marketing page sections
│   │   ├── dashboard/             # Workspace shell
│   │   ├── agents/                # Agent sidebar + results panels
│   │   └── editor/                # Code explainer UI
│   ├── context/                   # RepoMapContext
│   └── hooks/                     # useRepoMapSummarize, useRepoDependencies, etc.
└── scripts/                       # Pipeline test runners
```

---

## License

MIT
