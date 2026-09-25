"use client";

import { useState } from "react";
import { MessageCircleQuestion, Sparkles } from "lucide-react";
import { buildAskIndex } from "@/lib/repoMapAsk";
import { useRepoMapContext } from "@/context/RepoMapContext";

export function RepoMapAskBar({ repoMeta }) {
  const { repoMap, navigateToPath, requestNodeDetail } = useRepoMapContext();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!repoMeta || !repoMap) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    const q = question.trim();
    if (!q || loading) return;

    setLoading(true);
    setError("");
    setAnswer("");

    try {
      const res = await fetch("/api/filemap/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          repoMeta: repoMap.repoMeta,
          nodesByPath: repoMap.nodesByPath,
          index: buildAskIndex(repoMap),
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok && !data.answer) {
        setError("Could not answer that right now — try rephrasing.");
        return;
      }

      setAnswer(data.answer || "");

      const target = data.targetPath;
      if (target != null && target !== "") {
        await navigateToPath(target);
        await requestNodeDetail(target);
      }
    } catch {
      setError("Network error — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="repo-map-ask" aria-label="Ask about this repository">
      <form className="repo-map-ask__form" onSubmit={handleSubmit}>
        <MessageCircleQuestion size={18} className="repo-map-ask__icon" aria-hidden="true" />
        <input
          id="repo-map-ask-input"
          type="search"
          className="repo-map-ask__input"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder='Ask anything — e.g. "Where is the login handler?" or "Which file defines useRepoMap?"'
          aria-label="Ask a question about this repository"
          disabled={loading}
        />
        <button type="submit" className="repo-map-ask__submit" disabled={loading || !question.trim()}>
          <Sparkles size={14} aria-hidden="true" />
          {loading ? "Thinking…" : "Ask"}
        </button>
      </form>
      {answer && (
        <p className="repo-map-ask__answer" role="status">
          {answer}
        </p>
      )}
      {error && (
        <p className="repo-map-ask__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
