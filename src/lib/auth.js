import { getIronSession } from "iron-session";
import { cookies } from "next/headers";

export const SESSION_OPTIONS = {
  password: process.env.AUTH_SECRET ?? "fallback-dev-secret-change-in-production",
  cookieName: "sprout_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
};

/**
 * Read the current iron-session from the request cookies.
 * Shape: { accessToken, user: { name, login, avatarUrl } } | {}
 */
export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession(cookieStore, SESSION_OPTIONS);
}
