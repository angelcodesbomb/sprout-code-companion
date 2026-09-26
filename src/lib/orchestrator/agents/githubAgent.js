/**
 * GitHub Agent — real implementation of all GitHub orchestrator tools.
 *
 * Replaces the stubs in stubs.js for all github_* tools.
 *
 * ── What it does ──────────────────────────────────────────────────────────────
 *
 * github_read_repo      Read an existing GitHub repo's file tree and a sample of
 *                       file contents, build the repoMap compact snapshot, and load
 *                       it into ctx so subsequent agents have full context.
 *
 * github_propose_init   Call POST /user/repos on the GitHub API to actually create
 *                       a new repository, then store the remote URL in ctx.repo.
 *
 * github_propose_push   Commit all artifact files to the repo in one atomic commit
 *                       using the Git Data API (blob → tree → commit → ref update).
 *
 * github_confirm_human  Resolve a pending human-approval action (approve or reject).
 *                       The actual GitHub side-effect (create / push) fires here.
 *
 * ── Token resolution ──────────────────────────────────────────────────────────
 * The agent never calls getSession() directly (that requires next/headers).
 * Instead, the orchestrator route passes `ctx.githubToken` when it creates the
 * run context from the session.  Falls back to process.env.GITHUB_TOKEN.
 */

import { uid, compactMapSnapshot } from "../context.js";

const GITHUB_API = "https://api.github.com";
const RAW_GITHUB = "https://raw.githubusercontent.com";

// ─── Token helper ─────────────────────────────────────────────────────────────

/** @param {import("../context.js").OrchestratorContext} ctx */
function resolveToken(ctx) {
  return ctx.githubToken ?? process.env.GITHUB_TOKEN ?? null;
}

function authHeaders(token) {
  return token
    ? {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      }
    : {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      };
}

// ─── GitHub API helpers ────────────────────────────────────────────────────────

async function githubFetch(path, token, options = {}) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      ...authHeaders(token),
      ...(options.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  return res;
}

/**
 * Fetch repo metadata + recursive file tree via the GitHub API.
 * Returns { meta, tree } mirroring the /api/github/tree route shape.
 */
async function fetchRepoTree(owner, repo, token) {
  const repoRes = await githubFetch(`/repos/${owner}/${repo}`, token, {
    next: { revalidate: 60 },
  });

  if (repoRes.status === 404) throw new Error(`Repo ${owner}/${repo} not found.`);
  if (repoRes.status === 401 || repoRes.status === 403) {
    throw new Error(
      `GitHub access denied for ${owner}/${repo}. ` +
        (token ? "Check token permissions." : "No token provided — private repo requires auth.")
    );
  }
  if (!repoRes.ok) {
    throw new Error(`GitHub API error ${repoRes.status} fetching repo metadata.`);
  }

  const repoData = await repoRes.json();
  const defaultBranch = repoData.default_branch ?? "main";

  const treeRes = await githubFetch(
    `/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`,
    token
  );
  if (!treeRes.ok) {
    throw new Error(`GitHub API error ${treeRes.status} fetching file tree.`);
  }
  const treeData = await treeRes.json();

  return {
    meta: {
      owner,
      repo,
      branch: defaultBranch,
      fullName: repoData.full_name,
      description: repoData.description ?? null,
      truncated: treeData.truncated ?? false,
      private: repoData.private ?? false,
    },
    tree: treeData.tree ?? [],
  };
}

/**
 * Fetch raw content for a batch of file paths.
 * Mirrors the /api/github/content route logic.
 */
async function fetchFileContents(owner, repo, branch, paths, token) {
  const MAX_FILES = 60;
  const MAX_FILE_SIZE = 80_000; // smaller budget — this is for context, not display
  const CHUNK = 10;

  const capped = paths.slice(0, MAX_FILES);
  const contents = {};

  for (let i = 0; i < capped.length; i += CHUNK) {
    const chunk = capped.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map(async (filePath) => {
        const url = `${RAW_GITHUB}/${owner}/${repo}/${branch}/${filePath}`;
        try {
          const res = await fetch(url, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) return;
          const cl = res.headers.get("content-length");
          if (cl && Number(cl) > MAX_FILE_SIZE) return;
          const text = await res.text();
          if (text.length <= MAX_FILE_SIZE) contents[filePath] = text;
        } catch {
          // timeout or network — skip this file
        }
      })
    );
  }

  return contents;
}

/**
 * Build a compact map snapshot from a raw GitHub tree array + meta.
 * The tree items are flat GitHub blob/tree objects: { path, type, sha }.
 */
function buildCompactFromTree(tree, meta) {
  const nodesByPath = {};

  // Root node
  nodesByPath[""] = {
    name: meta.repo,
    path: "",
    depth: 0,
    parentPath: null,
    type: "folder",
    fallbackLabel: meta.description || "Repository root",
    summary: null,
    domain: "Review",
    indexState: "unindexed",
  };

  for (const item of tree) {
    const path = item.path ?? "";
    const parts = path.split("/").filter(Boolean);
    const name = parts[parts.length - 1] ?? path;
    const depth = parts.length;
    const parentPath = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
    const type = item.type === "blob" ? "file" : "folder";

    // Rule-based domain tag (mirrors repoMap.js guessDomain)
    const domain = guessDomainFromPath(path, name);

    nodesByPath[path] = {
      name,
      path,
      depth,
      parentPath,
      type,
      fallbackLabel: name,
      summary: null,
      domain,
      indexState: "unindexed",
    };
  }

  return {
    repoKey: `${meta.owner}/${meta.repo}@${meta.branch}`,
    repoMeta: meta,
    nodesByPath,
  };
}

/** Mirrors guessDomain() from repoMap.js — kept inline to avoid a client-bundle import. */
function guessDomainFromPath(path, name) {
  const p = path.toLowerCase();
  const n = (name || "").toLowerCase();

  if (
    /(^|\/)(prisma|migrations|seeds|db|database)(\/|$)/.test(p) ||
    /\.(sql|prisma)$/.test(n)
  )
    return "Database";

  if (
    /(^|\/)(api|routes|middleware|handlers|controllers)(\/|$)/.test(p) ||
    n.includes("route.") ||
    n.endsWith("handler.js") ||
    n.endsWith("handler.ts")
  )
    return "API";

  if (
    /(^|\/)(components|ui|styles|css|assets|icons|pages|app)(\/|$)/.test(p) ||
    /\.(jsx|tsx|vue|svelte|css|scss)$/.test(n)
  )
    return "UI";

  if (
    /(^|\/)(test|tests|__tests__|spec|e2e|cypress|playwright)(\/|$)/.test(p) ||
    /\.(test|spec)\.(js|ts|jsx|tsx)$/.test(n)
  )
    return "Validation";

  if (
    /(^|\/)(auth|security|encrypt|crypto)(\/|$)/.test(p) ||
    /security|auth|oauth|jwt|csrf/i.test(n)
  )
    return "Security";

  return "Review";
}

// ─── Git Data API helpers (for push) ──────────────────────────────────────────

/** Create a blob for one file. Returns the blob SHA. */
async function createBlob(owner, repo, content, token) {
  const res = await githubFetch(`/repos/${owner}/${repo}/git/blobs`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: Buffer.from(content, "utf8").toString("base64"),
      encoding: "base64",
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`GitHub createBlob failed ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.sha;
}

/** Get the SHA of the latest commit on a branch. */
async function getLatestCommitSha(owner, repo, branch, token) {
  const res = await githubFetch(
    `/repos/${owner}/${repo}/git/refs/heads/${branch}`,
    token
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`GitHub getRef failed ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.object?.sha ?? null;
}

/** Get the tree SHA of a commit. */
async function getCommitTreeSha(owner, repo, commitSha, token) {
  const res = await githubFetch(
    `/repos/${owner}/${repo}/git/commits/${commitSha}`,
    token
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`GitHub getCommit failed ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.tree?.sha ?? null;
}

/** Create a new tree from blob SHAs. Returns the new tree SHA. */
async function createTree(owner, repo, baseTreeSha, fileEntries, token) {
  const tree = fileEntries.map(({ path, blobSha }) => ({
    path,
    mode: "100644",
    type: "blob",
    sha: blobSha,
  }));

  const res = await githubFetch(`/repos/${owner}/${repo}/git/trees`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base_tree: baseTreeSha, tree }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`GitHub createTree failed ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.sha;
}

/** Create a commit. Returns the new commit SHA. */
async function createCommit(owner, repo, message, treeSha, parentSha, token) {
  const res = await githubFetch(`/repos/${owner}/${repo}/git/commits`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      tree: treeSha,
      parents: [parentSha],
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`GitHub createCommit failed ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.sha;
}

/** Update the branch ref to point to the new commit. */
async function updateRef(owner, repo, branch, commitSha, token) {
  const res = await githubFetch(
    `/repos/${owner}/${repo}/git/refs/heads/${branch}`,
    token,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sha: commitSha, force: false }),
    }
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`GitHub updateRef failed ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

// ─── Public agent functions ────────────────────────────────────────────────────

/**
 * Read an existing GitHub repo, build a compact map snapshot, and load it into ctx.
 *
 * @param {import("../context.js").OrchestratorContext} ctx
 * @param {{ owner: string, repo: string, fetchContent?: boolean }} input
 */
export async function runGithubReadRepo(ctx, input) {
  const { owner, repo, fetchContent = true } = input ?? {};

  if (!owner?.trim() || !repo?.trim()) {
    return {
      ok: false,
      output: null,
      error: "github_read_repo requires both owner and repo.",
    };
  }

  const token = resolveToken(ctx);

  let treeResult;
  try {
    treeResult = await fetchRepoTree(owner, repo, token);
  } catch (err) {
    return { ok: false, output: null, error: err.message };
  }

  const { meta, tree } = treeResult;

  // Optionally fetch a sample of file contents to enrich context
  let contents = {};
  if (fetchContent) {
    // Pick a representative subset: API + UI files, capped at 30
    const filePaths = tree
      .filter((item) => item.type === "blob")
      .map((item) => item.path)
      .filter((p) => {
        const lower = p.toLowerCase();
        return (
          lower.endsWith(".js") ||
          lower.endsWith(".jsx") ||
          lower.endsWith(".ts") ||
          lower.endsWith(".tsx") ||
          lower.endsWith(".json") ||
          lower.endsWith(".md")
        );
      })
      .slice(0, 30);

    try {
      contents = await fetchFileContents(owner, repo, meta.branch, filePaths, token);
    } catch {
      // Content fetch is best-effort — map snapshot is still useful without it
    }
  }

  // Build the compact snapshot the orchestrator uses
  const fullSnapshot = buildCompactFromTree(tree, meta);
  const compact = compactMapSnapshot(fullSnapshot);

  // Load into context — downstream tools (map_parser_load_cache, ui_agent etc.)
  // will read from ctx.mapSnapshot and ctx.mapCompact
  ctx.mapSnapshot = fullSnapshot;
  ctx.mapCompact = compact;
  ctx.repo = ctx.repo ?? {
    name: repo,
    fullName: meta.fullName,
    description: meta.description,
    owner,
    branch: meta.branch,
    private: meta.private,
  };
  ctx.phase = "map_loaded";

  const contentSummary = Object.keys(contents).length
    ? `Fetched content for ${Object.keys(contents).length} files.`
    : "No file contents fetched (tree-only mode).";

  return {
    ok: true,
    output: {
      status: "repo_read",
      repoKey: compact?.repoKey ?? `${owner}/${repo}`,
      fileCount: compact?.fileCount ?? 0,
      domainCounts: compact?.domainCounts ?? {},
      samplePaths: compact?.samplePaths ?? [],
      contentSummary,
      branch: meta.branch,
      private: meta.private,
    },
    error: null,
  };
}

/**
 * Propose creating a new GitHub repository.
 * In auto-approve mode the repo is created immediately.
 * In manual mode a pending action is queued for runGithubConfirmHuman to execute.
 *
 * @param {import("../context.js").OrchestratorContext} ctx
 * @param {{ repoName: string, description?: string, private?: boolean }} input
 */
export async function runGithubProposeInit(ctx, input) {
  const actionId = uid("init");
  const proposal = {
    id: actionId,
    kind: "github_init_repo",
    summary: `Create repo "${input.repoName}"`,
    payload: {
      repoName: input.repoName,
      description: input.description ?? "",
      private: input.private ?? false,
    },
  };
  ctx.pendingHumanActions.push(proposal);
  ctx.phase = "awaiting_init_approval";

  if (ctx.autoApproveHuman) {
    // Execute immediately
    const result = await _executeInitRepo(ctx, proposal.payload);
    if (!result.ok) return result;

    ctx.pendingHumanActions = ctx.pendingHumanActions.filter((a) => a.id !== actionId);
    return {
      ok: true,
      output: {
        status: "repo_created",
        actionId,
        repo: ctx.repo,
        message: "Auto-approved: repo created on GitHub.",
      },
      error: null,
    };
  }

  return {
    ok: true,
    output: {
      status: "pending_approval",
      actionId,
      proposal,
      message:
        "Call github_confirm_human_action with this actionId and approved=true to create the repo.",
    },
    error: null,
  };
}

/**
 * Propose pushing all artifact files to GitHub as a single commit.
 * In auto-approve mode the push executes immediately.
 *
 * @param {import("../context.js").OrchestratorContext} ctx
 * @param {{ commitMessage: string, files?: string[] }} input
 */
export async function runGithubProposePush(ctx, input) {
  const actionId = uid("push");

  // Collect files from artifacts (UI agent and others all store files there)
  const artifactFiles = ctx.artifacts.flatMap((a) => a.files ?? []);
  const fileList = input.files
    ? artifactFiles.filter((f) => input.files.includes(f.path))
    : artifactFiles;

  if (fileList.length === 0) {
    return {
      ok: false,
      output: null,
      error:
        "No artifact files to push. Run ui_agent_generate or api_agent_generate first.",
    };
  }

  const proposal = {
    id: actionId,
    kind: "github_push",
    summary: input.commitMessage ?? "Orchestrator changes",
    payload: {
      commitMessage: input.commitMessage ?? "feat: orchestrator update",
      files: fileList,
    },
  };
  ctx.pendingHumanActions.push(proposal);
  ctx.phase = "awaiting_push_approval";

  if (ctx.autoApproveHuman) {
    const result = await _executePush(ctx, proposal.payload);
    if (!result.ok) return result;

    ctx.pendingHumanActions = ctx.pendingHumanActions.filter((a) => a.id !== actionId);
    ctx.phase = "pushed";
    return {
      ok: true,
      output: {
        status: "pushed",
        actionId,
        ...result.output,
        message: "Auto-approved: changes pushed to GitHub.",
      },
      error: null,
    };
  }

  return {
    ok: true,
    output: {
      status: "pending_approval",
      actionId,
      proposal,
      fileCount: fileList.length,
      message:
        "Call github_confirm_human_action with this actionId and approved=true to push.",
    },
    error: null,
  };
}

/**
 * Resolve a pending human approval action (init repo or push).
 * This is the only entry point for actually executing the GitHub side-effect
 * when autoApproveHuman is false.
 *
 * @param {import("../context.js").OrchestratorContext} ctx
 * @param {{ actionId: string, approved: boolean }} input
 */
export async function runGithubConfirmHuman(ctx, input) {
  const action = ctx.pendingHumanActions.find((a) => a.id === input.actionId);
  if (!action) {
    return {
      ok: false,
      output: null,
      error: `Unknown actionId: ${input.actionId}. Check pending actions in context.`,
    };
  }

  if (!input.approved) {
    ctx.phase = "halted";
    ctx.pendingHumanActions = ctx.pendingHumanActions.filter(
      (a) => a.id !== action.id
    );
    return {
      ok: true,
      output: { status: "rejected", actionId: input.actionId, kind: action.kind },
      error: null,
    };
  }

  ctx.pendingHumanActions = ctx.pendingHumanActions.filter((a) => a.id !== action.id);

  if (action.kind === "github_init_repo") {
    const result = await _executeInitRepo(ctx, action.payload);
    if (!result.ok) return result;
    return {
      ok: true,
      output: { status: "repo_created", repo: ctx.repo },
      error: null,
    };
  }

  if (action.kind === "github_push") {
    const result = await _executePush(ctx, action.payload);
    if (!result.ok) return result;
    ctx.phase = "pushed";
    return {
      ok: true,
      output: { status: "pushed", ...result.output },
      error: null,
    };
  }

  return {
    ok: false,
    output: null,
    error: `Unsupported action kind: ${action.kind}`,
  };
}

// ─── Internal executors ────────────────────────────────────────────────────────

/**
 * Actually call the GitHub API to create a repo.
 * Stores the result in ctx.repo.
 */
async function _executeInitRepo(ctx, payload) {
  const token = resolveToken(ctx);
  if (!token) {
    return {
      ok: false,
      output: null,
      error:
        "No GitHub token available. Sign in with GitHub or set GITHUB_TOKEN in .env.local.",
    };
  }

  let res;
  try {
    res = await githubFetch("/user/repos", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: payload.repoName,
        description: payload.description ?? "",
        private: payload.private ?? false,
        auto_init: true, // creates an initial commit so the repo has a HEAD ref
      }),
    });
  } catch (err) {
    return { ok: false, output: null, error: `GitHub network error: ${err.message}` };
  }

  if (res.status === 422) {
    // Repo already exists — treat as success, just read the existing one
    const data = await res.json().catch(() => ({}));
    const existing = data.errors?.[0]?.message ?? "Repository already exists.";
    // Try to fetch the existing repo instead
    try {
      const meRes = await githubFetch("/user", token);
      const me = await meRes.json();
      const owner = me.login;
      ctx.repo = {
        name: payload.repoName,
        fullName: `${owner}/${payload.repoName}`,
        description: payload.description ?? "",
        owner,
        branch: "main",
        private: payload.private ?? false,
        createdAt: new Date().toISOString(),
        htmlUrl: `https://github.com/${owner}/${payload.repoName}`,
        note: existing,
      };
      ctx.phase = "repo_ready";
      return { ok: true, output: { status: "repo_exists", repo: ctx.repo }, error: null };
    } catch {
      return { ok: false, output: null, error: existing };
    }
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => "(no body)");
    return {
      ok: false,
      output: null,
      error: `GitHub createRepo failed ${res.status}: ${txt.slice(0, 300)}`,
    };
  }

  const data = await res.json();
  ctx.repo = {
    name: data.name,
    fullName: data.full_name,
    description: data.description ?? "",
    owner: data.owner?.login,
    branch: data.default_branch ?? "main",
    private: data.private ?? false,
    createdAt: data.created_at,
    htmlUrl: data.html_url,
  };
  ctx.phase = "repo_ready";
  return { ok: true, output: { status: "repo_created", repo: ctx.repo }, error: null };
}

/**
 * Push artifact files to GitHub via the Git Data API.
 * blob → tree → commit → ref update (one atomic commit).
 */
async function _executePush(ctx, payload) {
  const token = resolveToken(ctx);
  if (!token) {
    return {
      ok: false,
      output: null,
      error:
        "No GitHub token available. Sign in with GitHub or set GITHUB_TOKEN in .env.local.",
    };
  }

  const repo = ctx.repo;
  if (!repo?.owner || !repo?.name) {
    return {
      ok: false,
      output: null,
      error:
        "No repo in context. Run github_propose_init_repo or github_read_repo first.",
    };
  }

  const { owner, name: repoName, branch = "main" } = repo;
  const { commitMessage, files } = payload;

  if (!Array.isArray(files) || files.length === 0) {
    return { ok: false, output: null, error: "No files to push." };
  }

  try {
    // 1. Get the current HEAD commit SHA
    const latestCommitSha = await getLatestCommitSha(owner, repoName, branch, token);
    if (!latestCommitSha) {
      throw new Error(
        `Could not resolve HEAD for ${owner}/${repoName}@${branch}. Does the branch exist?`
      );
    }

    // 2. Get the current tree SHA from that commit
    const baseTreeSha = await getCommitTreeSha(owner, repoName, latestCommitSha, token);

    // 3. Create a blob for each file
    // Strip leading slash — GitHub tree paths must be relative (e.g. "src/App.jsx" not "/src/App.jsx")
    const fileEntries = await Promise.all(
      files.map(async (file) => {
        const cleanPath = (file.path ?? "").replace(/^\/+/, "");
        const blobSha = await createBlob(owner, repoName, file.content, token);
        return { path: cleanPath, blobSha };
      })
    );

    // 4. Create a new tree that layers our blobs on top of the base tree
    const newTreeSha = await createTree(owner, repoName, baseTreeSha, fileEntries, token);

    // 5. Create the commit
    const newCommitSha = await createCommit(
      owner,
      repoName,
      commitMessage,
      newTreeSha,
      latestCommitSha,
      token
    );

    // 6. Update the branch ref
    await updateRef(owner, repoName, branch, newCommitSha, token);

    const commitUrl = `https://github.com/${owner}/${repoName}/commit/${newCommitSha}`;

    return {
      ok: true,
      output: {
        commitSha: newCommitSha,
        commitUrl,
        branch,
        fileCount: files.length,
        pushedPaths: files.map((f) => f.path),
        commitMessage,
      },
      error: null,
    };
  } catch (err) {
    return { ok: false, output: null, error: err.message };
  }
}
