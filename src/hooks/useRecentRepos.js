"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "sprout-recent-repos";
const MAX_RECENT = 5;

function readStorage() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    } catch {
        return [];
    }
}

/**
 * Persists up to MAX_RECENT recently-loaded repos in localStorage.
 *
 * Returns:
 *   recents     — array of { fullName, owner, repo, branch, url }
 *   addRecent   — call with a repoMeta object after a successful load
 *   clearRecent — wipe the list
 */
export function useRecentRepos() {
    const [recents, setRecents] = useState([]);

    // Hydrate from localStorage after mount (avoids SSR mismatch)
    useEffect(() => {
        setRecents(readStorage());
    }, []);

    const addRecent = useCallback((meta) => {
        if (!meta?.owner || !meta?.repo) return;
        const entry = {
            fullName: meta.fullName ?? `${meta.owner}/${meta.repo}`,
            owner: meta.owner,
            repo: meta.repo,
            branch: meta.branch ?? "main",
            url: `https://github.com/${meta.owner}/${meta.repo}`,
        };
        setRecents((prev) => {
            const filtered = prev.filter(
                (r) => r.fullName !== entry.fullName
            );
            const next = [entry, ...filtered].slice(0, MAX_RECENT);
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { }
            return next;
        });
    }, []);

    const clearRecent = useCallback(() => {
        try { localStorage.removeItem(STORAGE_KEY); } catch { }
        setRecents([]);
    }, []);

    return { recents, addRecent, clearRecent };
}
