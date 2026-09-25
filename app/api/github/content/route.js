import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

/**
 * POST /api/github/content
 *
 * Body: { owner, repo, branch, paths: string[] }
 *
 * Fetches raw file contents for each path in the list using GitHub's
 * raw content API. Returns { contents: { [path]: string } }.
 *
 * Batches requests but caps at MAX_FILES to avoid hammering the API.
 * Uses the signed-in user's OAuth token when available (private repos + 5k/hr),
 * otherwise falls back to GITHUB_TOKEN env var or unauthenticated.
 *
 * We intentionally avoid GitHub's /contents API (base64) for large files —
 * the raw endpoint is faster and doesn't require base64 decode.
 */

const MAX_FILES = 120; // hard cap — dependency parsing only needs source files
const MAX_FILE_SIZE = 150_000; // 150 KB — skip giant generated files

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { owner, repo, branch, paths } = body ?? {};
  if (!owner || !repo || !branch || !Array.isArray(paths) || paths.length === 0) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Resolve best token
  const session = await auth();
  const token = session?.accessToken ?? process.env.GITHUB_TOKEN ?? null;
  const authHeader = token ? { Authorization: `Bearer ${token}` } : {};

  const capped = paths.slice(0, MAX_FILES);
  const contents = {};

  // Fetch all files concurrently, but in chunks of 20 to avoid overwhelming
  // the rate limiter with a burst of 100+ parallel requests.
  const CHUNK = 20;
  for (let i = 0; i < capped.length; i += CHUNK) {
    const chunk = capped.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map(async (filePath) => {
        const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
        try {
          const res = await fetch(url, {
            headers: {
              ...authHeader,
              // Raw content — accept text
              Accept: "text/plain,application/octet-stream",
            },
            // 10-second timeout per file — don't let one slow file stall the batch
            signal: AbortSignal.timeout(10_000),
          });

          if (!res.ok) return; // 404 / 403 — skip silently
          
          // Check content-length header first to skip huge files quickly
          const cl = res.headers.get("content-length");
          if (cl && Number(cl) > MAX_FILE_SIZE) return;

          const text = await res.text();
          if (text.length <= MAX_FILE_SIZE) {
            contents[filePath] = text;
          }
        } catch {
          // Timeout or network error — skip this file
        }
      })
    );
  }

  return NextResponse.json({ contents });
}
