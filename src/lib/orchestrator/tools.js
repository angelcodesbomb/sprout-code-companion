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
      description: "Load an existing GitHub repo's file tree into map context.",
      parameters: {
        owner: { type: "string", description: "GitHub username or org." },
        repo:  { type: "string", description: "Repository name." },
      },
      required: ["owner", "repo"],
      run: (input) => runGithubReadRepo(ctx, input),
    },
    {
      name: "github_propose_init_repo",
      description: "Create a new GitHub repository (auto-executes when auto-approve is on).",
      parameters: {
        repoName:    { type: "string", description: "Repo name." },
        description: { type: "string", description: "Short description." },
        private:     { type: "boolean", description: "Private repo? Default false." },
      },
      required: ["repoName"],
      run: (input) => runGithubProposeInit(ctx, input),
    },
    {
      name: "github_confirm_human_action",
      description: "Approve or reject a pending GitHub action (init or push).",
      parameters: {
        actionId: { type: "string", description: "Id from a propose_* tool." },
        approved: { type: "boolean", description: "True to approve." },
      },
      required: ["actionId", "approved"],
      run: (input) => runGithubConfirmHuman(ctx, input),
    },
    {
      name: "map_parser_load_cache",
      description: "Activate the loaded repo map for agent context.",
      parameters: {},
      required: [],
      run: (input) => stubMapParserLoad(ctx, input),
    },
    {
      name: "map_parser_refresh",
      description: "Re-parse the repo file tree after a push.",
      parameters: {},
      required: [],
      run: () => stubMapParserRefresh(ctx),
    },
    {
      name: "db_agent_design_schema",
      description: "Generate db/schema.json, db/seed.json, and lib/db.js for local data storage.",
      parameters: {
        task: { type: "string", description: "What data the app needs." },
        spec: { type: "string", description: "Optional extra requirements." },
      },
      required: ["task"],
      run: (input) => runDbAgent(ctx, input),
    },
    {
      name: "ui_agent_generate",
      description: "Generate or update front-end components, pages, and styles.",
      parameters: {
        task:        { type: "string", description: "What to build in the UI." },
        targetPaths: { type: "string", description: "Comma-separated file paths to create or edit." },
        spec:        { type: "string", description: "Optional extra requirements." },
      },
      required: ["task"],
      run: (input) => {
        const paths = input.targetPaths
          ? String(input.targetPaths).split(",").map((s) => s.trim()).filter(Boolean)
          : [];
        return runUiAgent(ctx, { ...input, targetPaths: paths });
      },
    },
    {
      name: "api_agent_generate",
      description: "Generate or update server routes and API handlers.",
      parameters: {
        task:   { type: "string", description: "What to build in the API." },
        routes: { type: "string", description: "Comma-separated route paths." },
        spec:   { type: "string", description: "Optional extra requirements." },
      },
      required: ["task"],
      run: (input) => {
        const routes = input.routes
          ? String(input.routes).split(",").map((s) => s.trim()).filter(Boolean)
          : [];
        return stubCodegenAgent(ctx, "API", { ...input, routes });
      },
    },
    {
      name: "monitor_review_output",
      description: "Review a codegen artifact for best practices. Returns pass or feedback.",
      parameters: {
        artifactId: { type: "string", description: "Artifact id from codegen tool." },
        forceFail:  { type: "string", description: "Set 'true' to simulate failure (testing only)." },
      },
      required: ["artifactId"],
      run: (input) => stubMonitorReview(ctx, {
        artifactId: input.artifactId,
        forceFail: input.forceFail === "true" || input.forceFail === true,
      }),
    },
    {
      name: "security_review_output",
      description: "Security-review a codegen artifact before push.",
      parameters: {
        artifactId: { type: "string", description: "Artifact id to review." },
      },
      required: ["artifactId"],
      run: (input) => stubSecurityReview(ctx, input),
    },
    {
      name: "live_preview_sync",
      description: "Refresh the live preview with latest generated artifacts.",
      parameters: {},
      required: [],
      run: () => stubLivePreviewSync(ctx),
    },
    {
      name: "github_propose_push",
      description: "Commit and push all artifact files to GitHub (call only after monitor + security pass).",
      parameters: {
        commitMessage: { type: "string", description: "Git commit message." },
        files:         { type: "string", description: "Optional comma-separated file paths to include." },
      },
      required: ["commitMessage"],
      run: (input) => {
        const files = input.files
          ? String(input.files).split(",").map((s) => s.trim()).filter(Boolean)
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
