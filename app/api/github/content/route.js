import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

const MAX_FILES = 120;
const MAX_FILE_SIZE = 150_000;

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

  const session = await getSession();
  const token = session?.accessToken ?? process.env.GITHUB_TOKEN ?? null;
  const authHeader = token ? { Authorization: `Bearer ${token}` } : {};

  const capped = paths.slice(0, MAX_FILES);
  const contents = {};

  const CHUNK = 20;
  for (let i = 0; i < capped.length; i += CHUNK) {
    const chunk = capped.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map(async (filePath) => {
        const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
        try {
          const res = await fetch(url, {
            headers: { ...authHeader, Accept: "text/plain,application/octet-stream" },
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) return;
          const cl = res.headers.get("content-length");
          if (cl && Number(cl) > MAX_FILE_SIZE) return;
          const text = await res.text();
          if (text.length <= MAX_FILE_SIZE) contents[filePath] = text;
        } catch { /* timeout or network error — skip */ }
      })
    );
  }

  return NextResponse.json({ contents });
}
