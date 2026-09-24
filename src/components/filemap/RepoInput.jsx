"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { ArrowRight, AlertCircle, History, Github } from "lucide-react";
import { useRecentRepos } from "@/hooks/useRecentRepos";

/**
 * Parses a GitHub URL into { owner, repo } or returns null if invalid.
 *
 * Handles:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo.git
 *   https://github.com/owner/repo/tree/main
 *   https://github.com/owner/repo/blob/main/file.js
 *   github.com/owner/repo  (no protocol)
 */
export function parseGithubUrl(raw) {
  try {
    const url = raw.trim().replace(/\.git$/, "");
    // Normalise — add https:// if missing so URL() can parse it
    const full = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const parsed = new URL(full);

    if (!parsed.hostname.endsWith("github.com")) return null;

    // pathname is like /owner/repo or /owner/repo/tree/branch/...
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
    "GitHub API rate limit reached (60 requests/hour for unauthenticated calls). Wait a minute or add a GITHUB_TOKEN env var to increase the limit.",
  private:
    "This repo is private or inaccessible. Only public repos are supported without an access token.",
  unknown:
    "Something went wrong fetching the repo. Check the URL and try again.",
};

/**
 * RepoInput
 *
 * Props:
 *   onLoad(tree, repoMeta)  — called when the GitHub tree is successfully fetched and parsed
 *   onLoadStart()           — called the moment the fetch begins (for parent loading state)
 *   isLoading               — controlled loading flag from parent
 */
export function RepoInput({ onLoad, onLoadStart, isLoading }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState(null); // null | keyof ERROR_MESSAGES
  const { recents, addRecent } = useRecentRepos();

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
      const headers = {};
      // Use NEXT_PUBLIC_GITHUB_TOKEN if available (set in .env.local).
      // For server-side usage the plain GITHUB_TOKEN is preferred and
      // handled in a Route Handler — this covers client-side demos.
      if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_GITHUB_TOKEN) {
        headers["Authorization"] = `Bearer ${process.env.NEXT_PUBLIC_GITHUB_TOKEN}`;
      }

      // 1. Fetch the repo metadata to get the default branch name.
      const repoRes = await fetch(
        `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`,
        { headers }
      );

      if (repoRes.status === 404) { setError("not_found"); return; }
      if (repoRes.status === 403 || repoRes.status === 401) { setError("private"); return; }
      if (repoRes.status === 429 || repoRes.headers.get("x-ratelimit-remaining") === "0") {
        setError("rate_limit");
        return;
      }
      if (!repoRes.ok) { setError("unknown"); return; }

      const repoData = await repoRes.json();
      const defaultBranch = repoData.default_branch ?? "main";

      // 2. Fetch the full recursive tree using the default branch SHA.
      const treeRes = await fetch(
        `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/git/trees/${defaultBranch}?recursive=1`,
        { headers }
      );

      if (treeRes.status === 404) { setError("not_found"); return; }
      if (treeRes.status === 403 || treeRes.status === 401) { setError("private"); return; }
      if (treeRes.status === 429 || treeRes.headers.get("x-ratelimit-remaining") === "0") {
        setError("rate_limit");
        return;
      }
      if (!treeRes.ok) { setError("unknown"); return; }

      const treeData = await treeRes.json();

      // GitHub returns { tree: [...], truncated: bool }.
      // When truncated is true the repo is very large and the tree is partial.
      const meta = {
        owner: parsed.owner,
        repo: parsed.repo,
        branch: defaultBranch,
        fullName: repoData.full_name,
        description: repoData.description,
        truncated: treeData.truncated ?? false,
      };

      onLoad(treeData.tree ?? [], meta);
      addRecent(meta);
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
                  setValue(r.url);
                  setTimeout(() => {
                    document.getElementById("repo-submit-btn")?.click();
                  }, 50);
                }}
              >
                <Github size={16} className="repo-recent-card__icon" />
                <div className="repo-recent-card__text">
                  <span className="rr-owner">{r.owner}/</span>
                  <strong className="rr-repo">{r.repo}</strong>
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
          placeholder="https://github.com/owner/repo"
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(null); }}
          disabled={isLoading}
          aria-label="GitHub repository URL"
          aria-describedby={error ? "repo-input-error" : undefined}
          autoComplete="off"
          spellCheck={false}
        />

        {/* Reuses the same pill-button pattern as ActionButton */}
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
                    : error === "private"
                      ? "Access denied"
                      : "Something went wrong"}
            </p>
            <p className="repo-error__message">{ERROR_MESSAGES[error]}</p>
          </div>
        </div>
      )}
    </div>
  );
}
