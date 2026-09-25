import { NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { SESSION_OPTIONS } from "@/lib/auth";

/**
 * GET /api/auth/callback?code=…
 * GitHub redirects here after the user authorizes the app.
 * Exchanges the code for an access token, fetches the user profile,
 * stores both in an encrypted iron-session cookie, then redirects to /workspace.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // 1. Exchange code → access token
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id:     process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  if (!tokenRes.ok) {
    return NextResponse.redirect(new URL("/?auth=error", request.url));
  }

  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;

  if (!accessToken) {
    return NextResponse.redirect(new URL("/?auth=error", request.url));
  }

  // 2. Fetch the GitHub user profile
  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
    },
  });

  const userData = userRes.ok ? await userRes.json() : {};

  // 3. Store in session cookie
  const cookieStore = await cookies();
  const session = await getIronSession(cookieStore, SESSION_OPTIONS);

  session.accessToken = accessToken;
  session.user = {
    name:      userData.name  ?? userData.login ?? "GitHub User",
    login:     userData.login ?? "",
    avatarUrl: userData.avatar_url ?? "",
  };

  await session.save();

  // 4. Back to the workspace
  return NextResponse.redirect(new URL("/workspace", request.url));
}
