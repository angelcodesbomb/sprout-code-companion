import { redirect } from "next/navigation";

/**
 * GET /api/auth/login
 * Kicks off the GitHub OAuth flow by redirecting to GitHub's authorize URL.
 */
export async function GET() {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return new Response("GITHUB_CLIENT_ID not configured", { status: 500 });
  }

  const params = new URLSearchParams({
    client_id: clientId,
    scope: "read:user user:email repo",
    // GitHub sends the user back to /api/auth/callback after authorization
  });

  redirect(`https://github.com/login/oauth/authorize?${params}`);
}
