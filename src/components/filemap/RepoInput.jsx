"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { ArrowRight, AlertCircle, History, Github, Lock } from "lucide-react";
import { useSession, signIn } from "@/hooks/useSession";
import { useRecentRepos } from "@/hooks/useRecentRepos";

/**
 * Parses a GitHub URL into { owner, repo } or returns null if invalid.
 *
 * Handles:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo.git
 *   https://github.com/owner/repo/tree/main
 *   github.com/owner/repo  (no protocol)
 */
export function parseGithubUrl(raw) {
  try {
    const url = raw.trim().replace(/\.git$/, "");
    const full = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const parsed = new URL(full);

    if (!parsed.hostname.endsWith("github.com")) return null;

    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;

    return { owner: parts[0], repo: parts[1] };
  } catch {
    return null;
  }
}

const ERROR_MESSAGES = {
  invalid_url:
    "That doesn't look like a valid GitHub URL. Try something like https://github.com/facebook/react",
  not_found:
    "Repo not found. Double-check the URL — it might be private or the name could have changed.",
  rate_limit:
    "GitHub API rate limit reached. Sign in with GitHub above to get 5,000 requests/hour.",
  auth_required:
    "This repo is private. Sign in with GitHub above to access your private repos.",
  forbidden:
    "Access denied. Make sure you have permission to view this repo.",
  unknown:
    "Something went wrong fetching the repo. Check the URL and try again.",
};

/**
 * RepoInput
 *
 * Props:
 *   onLoad(tree, repoMeta)  — called when the GitHub tree is successfully fetched
 *   onLoadStart()           — called the moment the fetch begins
 *   isLoading               — controlled loading flag from parent
 */
export function RepoInput({ onLoad, onLoadStart, isLoading }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState(null);
  const { recents, addRecent } = useRecentRepos();
  const { data: session } = useSession();

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    const parsed = parseGithubUrl(value);
    if (!parsed) {
      setError("invalid_url");
      return;
    }

    onLoadStart?.();

    try {
      // All GitHub API calls go through our server-side proxy.
      // The proxy uses the user's OAuth token (private repos) or falls back
      // to GITHUB_TOKEN env var / unauthenticated (public repos only).
      const res = await fetch(
        `/api/github/tree?owner=${encodeURIComponent(parsed.owner)}&repo=${encodeURIComponent(parsed.repo)}`
      );

      const data = await res.json();

      if (!res.ok) {
        switch (data.error) {
          case "not_found":
            setError("not_found");
            break;
          case "auth_required":
            setError("auth_required");
            break;
          case "forbidden":
            setError("forbidden");
            break;
          default:
            setError("unknown");
        }
        return;
      }

      // Check rate-limit headers surfaced by the proxy
      const remaining = res.headers.get("x-ratelimit-remaining");
      if (remaining !== null && Number(remaining) === 0) {
        setError("rate_limit");
        return;
      }

      onLoad(data.tree ?? [], data.meta);
      addRecent({ ...data.meta, url: value.trim() });
    } catch {
      setError("unknown");
    }
  }

  return (
    <div>
      {recents.length > 0 && !value && (
        <motion.div
          className="repo-recent-wrap"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="repo-recent-head">
            <History size={13} style={{ color: "var(--muted-foreground)" }} />
            <span className="mono-label" style={{ margin: 0 }}>JUMP BACK IN</span>
          </div>
          <div className="repo-recent-grid">
            {recents.map((r) => (
              <button
                key={r.fullName}
                type="button"
                className="repo-recent-card"
                onClick={() => {
                  setValue(r.url ?? `https://github.com/${r.owner}/${r.repo}`);
                  setTimeout(() => {
                    document.getElementById("repo-submit-btn")?.click();
                  }, 50);
                }}
              >
                <Github size={16} className="repo-recent-card__icon" />
                <div className="repo-recent-card__text">
                  <span className="rr-owner">{r.owner}/</span>
                  <strong className="rr-repo">{r.repo}</strong>
                  {r.private && (
                    <Lock size={11} style={{ marginLeft: 4, opacity: 0.6 }} aria-label="private" />
                  )}
                </div>
              </button>
            ))}
          </div>
        </motion.div>
      )}

      <form className="repo-input-bar" onSubmit={handleSubmit} role="search" aria-label="Load GitHub repository">
        <input
          className="repo-input-bar__field"
          type="url"
          inputMode="url"
          placeholder={
            session
              ? "https://github.com/owner/repo  (private repos supported)"
              : "https://github.com/owner/repo"
          }
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(null); }}
          disabled={isLoading}
          aria-label="GitHub repository URL"
          aria-describedby={error ? "repo-input-error" : undefined}
          autoComplete="off"
          spellCheck={false}
        />

        <motion.span
          className="action-button action-button--mint"
          whileHover={isLoading ? {} : { scale: 1.035, y: -2 }}
          whileTap={isLoading ? {} : { scale: 0.98 }}
          transition={{ type: "spring", stiffness: 420, damping: 22 }}
        >
          <button
            id="repo-submit-btn"
            type="submit"
            disabled={isLoading || !value.trim()}
            aria-busy={isLoading}
          >
            <span>{isLoading ? "Loading…" : "Load Repo"}</span>
            <span className="action-button__arrow" aria-hidden="true">
              <ArrowRight size={16} />
            </span>
          </button>
        </motion.span>
      </form>

      {/* Private repo nudge when not signed in */}
      {!session && !error && (
        <p className="repo-input-hint">
          <Lock size={11} aria-hidden="true" />
          <span>
            For private repos,{" "}
            <button
              type="button"
              className="repo-input-hint__link"
              onClick={() => signIn("github")}
            >
              sign in with GitHub
            </button>
            .
          </span>
        </p>
      )}

      {error && (
        <div
          className="repo-error"
          id="repo-input-error"
          role="alert"
          aria-live="assertive"
        >
          <span className="repo-error__icon" aria-hidden="true">
            <AlertCircle size={14} />
          </span>
          <div className="repo-error__body">
            <p className="repo-error__title">
              {error === "invalid_url"
                ? "Invalid URL"
                : error === "not_found"
                  ? "Repo not found"
                  : error === "rate_limit"
                    ? "Rate limit reached"
                    : error === "auth_required"
                      ? "Sign in required"
                      : error === "forbidden"
                        ? "Access denied"
                        : "Something went wrong"}
            </p>
            <p className="repo-error__message">{ERROR_MESSAGES[error]}</p>
            {(error === "auth_required" || error === "rate_limit") && !session && (
              <button
                type="button"
                className="repo-error__signin-btn"
                onClick={() => signIn("github")}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor" width={13} height={13}>
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
                </svg>
                Sign in with GitHub
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
