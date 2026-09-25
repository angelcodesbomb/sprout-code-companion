import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

/**
 * GET /api/github/tree?owner=x&repo=y
 *
 * Server-side proxy for GitHub's repo metadata + recursive tree API.
 * Uses the signed-in user's OAuth access token when available (5 000 req/hr),
 * or the server-side GITHUB_TOKEN env var as a fallback (also 5 000 req/hr),
 * or unauthenticated (60 req/hr) as a last resort.
 *
 * Having GitHub calls happen server-side keeps the token out of the browser
 * and lets private repos work transparently.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const owner = searchParams.get("owner");
  const repo = searchParams.get("repo");

  if (!owner || !repo) {
    return NextResponse.json({ error: "Missing owner or repo" }, { status: 400 });
  }

  // Resolve the best available token:
  // 1. The signed-in user's OAuth token (has private repo access)
  // 2. A server-side personal access token (public repos, higher rate limit)
  // 3. Unauthenticated (60 req/hr)
  const session = await getSession();
  const token = session?.accessToken ?? process.env.GITHUB_TOKEN ?? null;

  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  try {
    // Step 1 — repo metadata (default branch, description, visibility)
    const repoRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      { headers, next: { revalidate: 60 } }
    );

    if (repoRes.status === 404) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (repoRes.status === 401 || repoRes.status === 403) {
      // If the user isn't signed in and the repo is private, tell the client
      const isAuthed = Boolean(session?.accessToken);
      return NextResponse.json(
        { error: isAuthed ? "forbidden" : "auth_required" },
        { status: 403 }
      );
    }
    if (!repoRes.ok) {
      return NextResponse.json({ error: "github_error" }, { status: repoRes.status });
    }

    const repoData = await repoRes.json();
    const defaultBranch = repoData.default_branch ?? "main";

    // Step 2 — recursive file tree
    const treeRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`,
      { headers, next: { revalidate: 60 } }
    );

    if (!treeRes.ok) {
      return NextResponse.json({ error: "tree_fetch_failed" }, { status: treeRes.status });
    }

    const treeData = await treeRes.json();

    // Surface rate-limit info in response headers so the client can warn the user
    const remaining = repoRes.headers.get("x-ratelimit-remaining");
    const limit = repoRes.headers.get("x-ratelimit-limit");

    const responseHeaders = {};
    if (remaining !== null) responseHeaders["x-ratelimit-remaining"] = remaining;
    if (limit !== null) responseHeaders["x-ratelimit-limit"] = limit;

    return NextResponse.json(
      {
        meta: {
          owner,
          repo,
          branch: defaultBranch,
          fullName: repoData.full_name,
          description: repoData.description ?? null,
          truncated: treeData.truncated ?? false,
          private: repoData.private ?? false,
          isAuthenticated: Boolean(session?.accessToken),
        },
        tree: treeData.tree ?? [],
      },
      { headers: responseHeaders }
    );
  } catch (err) {
    console.error("github/tree proxy error:", err);
    return NextResponse.json({ error: "proxy_error" }, { status: 500 });
  }
}
