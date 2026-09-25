"use client";

import { useState, useEffect, useCallback } from "react";

/**
 * Minimal drop-in replacement for next-auth's useSession hook.
 * Fetches /api/auth/session and returns { data, status }.
 *
 * status: "loading" | "authenticated" | "unauthenticated"
 * data:   { user: { name, login, avatarUrl } } | null
 */
export function useSession() {
  const [data, setData]     = useState(null);
  const [status, setStatus] = useState("loading");

  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/session");
      const json = await res.json();
      if (json?.user) {
        setData({ user: json.user });
        setStatus("authenticated");
      } else {
        setData(null);
        setStatus("unauthenticated");
      }
    } catch {
      setData(null);
      setStatus("unauthenticated");
    }
  }, []);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  return { data, status };
}

/** Redirect to the GitHub OAuth login flow. */
export function signIn() {
  window.location.href = "/api/auth/login";
}

/** Redirect to the logout endpoint which clears the cookie. */
export function signOut() {
  window.location.href = "/api/auth/logout";
}
