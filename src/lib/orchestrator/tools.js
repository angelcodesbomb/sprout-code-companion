/**
 * Orchestrator Tool Registry — one tool per agent capability.
 * UI Agent and GitHub Agent are real implementations; others are stubs.
 */

import {
  stubMapParserLoad,
  stubMapParserRefresh,
  stubMonitorReview,
  stubSecurityReview,
  stubLivePreviewSync,
  stubCodegenAgent,
} from "./agents/stubs.js";
import { runUiAgent } from "./agents/uiAgent.js";
import {
  runGithubReadRepo,
  runGithubProposeInit,
  runGithubProposePush,
  runGithubConfirmHuman,
} from "./agents/githubAgent.js";
import { runDbAgent } from "./agents/dbAgent.js";

/** @typedef {import("./context.js").OrchestratorContext} OrchestratorContext */

/**
 * @param {OrchestratorContext} ctx
 * @returns {Array<{ name: string, description: string, parameters: object, run: (input: object) => Promise<object> }>}
 */
export function createOrchestratorTools(ctx) {
  return [
    {
      name: "github_read_repo",
      description:
        "GitHub Agent: read an existing GitHub repository's file tree and load it as the repo map context. " +
        "Call this at the start of a run when the user provides an existing repo (owner/repo). " +
        "Populates ctx with the file map so downstream agents have full repo context.",
      parameters: {
        owner: { type: "string", description: "GitHub username or org, e.g. vercel." },
        repo: { type: "string", description: "Repository name, e.g. next.js." },
        fetchContent: {
          type: "boolean",
          description:
            "Whether to also fetch a sample of file contents for richer context. Defaults to true.",
        },
      },
      required: ["owner", "repo"],
      run: (input) => runGithubReadRepo(ctx, input),
    },
    {
      name: "github_propose_init_repo",
      description:
        "GitHub Agent: propose creating a new GitHub repository for the project. " +
        "Actually calls the GitHub API to create the repo when approved. " +
        "Requires human approval before creation unless autoApproveHuman is on.",
      parameters: {
        repoName: { type: "string", description: "Repository name (e.g. my-saas-app)." },
        description: { type: "string", description: "Short repo description." },
        private: {
          type: "boolean",
          description: "Whether to create a private repo. Defaults to false.",
        },
      },
      required: ["repoName"],
      run: (input) => runGithubProposeInit(ctx, input),
    },
    {
      name: "github_confirm_human_action",
      description:
        "Apply human approval or rejection for a pending GitHub action (init repo or push). " +
        "On approval, the GitHub API call is executed immediately (create repo or commit + push).",
      parameters: {
        actionId: { type: "string", description: "Id from a propose_* tool output." },
        approved: { type: "boolean", description: "True if the human approved." },
      },
      required: ["actionId", "approved"],
      run: (input) => runGithubConfirmHuman(ctx, input),
    },
    {
      name: "map_parser_load_cache",
      description:
        "Map Parser: load cached repo map JSON as orchestrator context (no live GitHub fetch).",
      parameters: {
        source: {
          type: "string",
          description: "Label for the cache source, e.g. workspace or session.",
        },
      },
      required: [],
      run: (input) => stubMapParserLoad(ctx, input),
    },
    {
      name: "map_parser_refresh",
      description:
        "Map Parser: re-build file tree and dependency graph after the repo changed (e.g. after push).",
      parameters: {},
      required: [],
      run: () => stubMapParserRefresh(ctx),
    },
    {
      name: "db_agent_design_schema",
      description:
        "Database Agent: design a local JSON-backed data schema for the project and generate " +
        "db/schema.json (schema definition), db/seed.json (realistic seed data), and lib/db.js " +
        "(zero-dependency in-memory CRUD store). Call this before ui_agent_generate when the " +
        "project needs persistent data (users, posts, products, orders, etc.). " +
        "Also generates lib/db.types.ts for TypeScript projects.",
      parameters: {
        task: {
          type: "string",
          description:
            "What data the project needs, e.g. 'a blog with posts, authors, and comments'.",
        },
        spec: {
          type: "string",
          description: "Optional extra requirements, e.g. specific fields or relations.",
        },
      },
      required: ["task"],
      run: (input) => runDbAgent(ctx, input),
    },
    {
      name: "ui_agent_generate",
      description:
        "UI Agent: generate or update front-end code (components, pages, styles) for the given task.",
      parameters: {
        task: { type: "string", description: "What to build or change in the UI." },
        targetPaths: {
          type: "string",
          description: "Comma-separated file paths from the map to create or edit.",
        },
        spec: { type: "string", description: "Optional extra requirements." },
      },
      required: ["task"],
      run: (input) => {
        const paths = input.targetPaths
          ? String(input.targetPaths)
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
        return runUiAgent(ctx, { ...input, targetPaths: paths });
      },
    },
    {
      name: "api_agent_generate",
      description:
        "API Agent: generate or update server routes, handlers, and API contracts.",
      parameters: {
        task: { type: "string", description: "What to build or change in the API layer." },
        routes: {
          type: "string",
          description: "Comma-separated route paths or file paths to create or edit.",
        },
        spec: { type: "string", description: "Optional extra requirements." },
      },
      required: ["task"],
      run: (input) => {
        const routes = input.routes
          ? String(input.routes)
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
        return stubCodegenAgent(ctx, "API", { ...input, routes });
      },
    },
    {
      name: "monitor_review_output",
      description:
        "Monitor Agent: review a codegen artifact (best practices, token efficiency, loops vs functions). Returns pass or feedback to redo.",
      parameters: {
        artifactId: { type: "string", description: "Artifact id from ui_agent_generate or api_agent_generate." },
        forceFail: {
          type: "string",
          description: "Testing only: set to 'true' to simulate a failed review.",
        },
      },
      required: ["artifactId"],
      run: (input) =>
        stubMonitorReview(ctx, {
          artifactId: input.artifactId,
          forceFail: input.forceFail === "true" || input.forceFail === true,
        }),
    },
    {
      name: "security_review_output",
      description:
        "Security Agent: review code that passed Monitor for security issues before push.",
      parameters: {
        artifactId: { type: "string", description: "Artifact id to review." },
      },
      required: ["artifactId"],
      run: (input) => stubSecurityReview(ctx, input),
    },
    {
      name: "live_preview_sync",
      description:
        "Live Preview: refresh the running preview with the latest generated artifacts.",
      parameters: {},
      required: [],
      run: () => stubLivePreviewSync(ctx),
    },
    {
      name: "github_propose_push",
      description:
        "GitHub Agent: propose pushing all generated artifact files to the remote repo as a single commit. " +
        "Actually calls the GitHub Git Data API (blob → tree → commit → ref update) when approved. " +
        "Only call this after monitor_review_output and security_review_output have both passed.",
      parameters: {
        commitMessage: { type: "string", description: "Git commit message." },
        files: {
          type: "string",
          description:
            "Optional comma-separated file paths to include; defaults to all artifact files.",
        },
      },
      required: ["commitMessage"],
      run: (input) => {
        const files = input.files
          ? String(input.files)
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined;
        return runGithubProposePush(ctx, { ...input, files });
      },
    },
  ];
}

/** Dev-only minimal tools for groq tool-picking tests. */
export const DEV_TEST_TOOLS = [
  {
    name: "echo",
    description: "Returns the input message unchanged.",
    parameters: { message: { type: "string", description: "Text to echo." } },
    run: async (input) => ({
      ok: true,
      output: { echoed: input.message ?? "(empty)" },
      error: null,
    }),
  },
  {
    name: "greet",
    description: "Generates a friendly greeting for a given name.",
    parameters: { name: { type: "string", description: "Person to greet." } },
    run: async (input) => ({
      ok: true,
      output: { greeting: `Hello, ${input.name ?? "friend"}!` },
      error: null,
    }),
  },
];

/**
 * @param {ReturnType<typeof createOrchestratorTools>} tools
 * @param {string} name
 */
export function findTool(tools, name) {
  return tools.find((t) => t.name === name);
}
