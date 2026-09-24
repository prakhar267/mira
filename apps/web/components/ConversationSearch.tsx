"use client";
import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@companion/shared";
import { searchMessages, type SearchOptions } from "@/lib/conversation-search";
import { Modal } from "./Modal";

function Highlight({ text, query }: { text: string; query: string }) {
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (!query || index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  );
}
export function ConversationSearch({
  messages,
  conversationId,
  accountMode,
  companionName,
  onClose,
}: {
  messages: ChatMessage[];
  conversationId: string;
  accountMode: boolean;
  companionName: string;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("all");
  const [role, setRole] = useState("");
  const [from, setFrom] = useState("");
  const [results, setResults] = useState<ChatMessage[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const [context, setContext] = useState<ChatMessage[] | null>(null);
  const [selected, setSelected] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const reset = () => {
    controller.current?.abort();
    setResults([]);
    setCursor(undefined);
    setContext(null);
    setSearched(false);
    setBusy(false);
    setError("");
  };
  const search = async (more = false) => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    setContext(null);
    const options: SearchOptions = {
      query: query.trim(),
      ...(scope === "current" ? { conversationId } : {}),
      ...(role ? { role: role as "user" | "assistant" } : {}),
      ...(from ? { from: new Date(`${from}T00:00:00Z`).toISOString() } : {}),
      ...(more && cursor ? { before: cursor } : {}),
    };
    try {
      let data: { messages: ChatMessage[]; cursor?: string | undefined };
      if (accountMode) {
        const params = new URLSearchParams({
          q: options.query,
          ...(options.conversationId
            ? { conversationId: options.conversationId }
            : {}),
          ...(options.role ? { role: options.role } : {}),
          ...(options.from ? { from: options.from } : {}),
          ...(options.before ? { cursor: options.before } : {}),
        });
        const response = await fetch(`/api/account/search?${params}`, {
          signal: abort.signal,
          cache: "no-store",
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Search failed.");
        data = body;
      } else data = searchMessages(messages, options);
      if (!abort.signal.aborted) {
        setResults((current) =>
          more ? [...current, ...data.messages] : data.messages,
        );
        setCursor(data.cursor);
        setSearched(true);
      }
    } catch (cause) {
      if (!abort.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "Search failed. Please retry.",
        );
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  };
  const open = async (message: ChatMessage) => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    setSelected(message.id);
    try {
      if (accountMode) {
        const response = await fetch(
          `/api/account/search?${new URLSearchParams({ messageId: message.id })}`,
          { signal: abort.signal, cache: "no-store" },
        );
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error ?? "Conversation could not load.");
        if (!abort.signal.aborted) setContext(body.messages);
      } else
        setContext(
          messages.filter(
            (item) => item.conversationId === message.conversationId,
          ),
        );
    } catch (cause) {
      if (!abort.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "Conversation could not load.",
        );
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  };
  return (
    <Modal
      title="Search conversations"
      description={
        accountMode
          ? "Search all saved messages, including older conversations. Deleted and unsaved messages are excluded."
          : "Search the conversations currently saved in this browser."
      }
      onClose={onClose}
    >
      <form
        className="feature-panel"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <label className="field">
          Search text
          <input
            type="search"
            autoFocus
            minLength={2}
            maxLength={120}
            required
            value={query}
            onChange={(event) => {
              reset();
              setQuery(event.target.value);
            }}
            placeholder="A topic, place or phrase…"
          />
        </label>
        <div className="feature-form-grid">
          <label className="field">
            Conversations
            <select
              value={scope}
              onChange={(event) => {
                reset();
                setScope(event.target.value);
              }}
            >
              <option value="all">All conversations</option>
              <option value="current">Current conversation</option>
            </select>
          </label>
          <label className="field">
            Speaker
            <select
              value={role}
              onChange={(event) => {
                reset();
                setRole(event.target.value);
              }}
            >
              <option value="">Everyone</option>
              <option value="user">You</option>
              <option value="assistant">{companionName}</option>
            </select>
          </label>
          <label className="field">
            Since (UTC)
            <input
              type="date"
              value={from}
              onChange={(event) => {
                reset();
                setFrom(event.target.value);
              }}
            />
          </label>
        </div>
        <button
          type="submit"
          className="button button--primary"
          disabled={busy || query.trim().length < 2}
        >
          {busy ? "Loading…" : "Search"}
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {context ? (
        <section className="search-results" aria-label="Conversation context">
          <button
            type="button"
            className="button button--ghost"
            onClick={() => setContext(null)}
          >
            Back to results
          </button>
          <p>Messages around your match</p>
          {context.length ? (
            context.map((message) => (
              <article
                key={message.id}
                className={`search-result${message.id === selected ? " search-result--selected" : ""}`}
              >
                <strong>
                  {message.role === "user" ? "You" : companionName}
                </strong>
                <time>{new Date(message.createdAt).toLocaleString()}</time>
                <p>
                  <Highlight text={message.content} query={query.trim()} />
                </p>
              </article>
            ))
          ) : (
            <p>This conversation was deleted or is no longer saved.</p>
          )}
        </section>
      ) : (
        <section className="search-results" aria-label="Search results">
          <p role="status">
            {searched
              ? `${results.length}${cursor ? "+" : ""} matching messages`
              : "Enter at least two characters to search."}
          </p>
          {results.map((message) => (
            <article key={message.id} className="search-result">
              <strong>{message.role === "user" ? "You" : companionName}</strong>
              <time>{new Date(message.createdAt).toLocaleString()}</time>
              <p>
                <Highlight text={message.content} query={query.trim()} />
              </p>
              <button
                type="button"
                className="button button--ghost"
                disabled={busy}
                onClick={() => void open(message)}
              >
                Read surrounding messages
              </button>
            </article>
          ))}
          {cursor ? (
            <button
              type="button"
              className="button button--ghost"
              disabled={busy}
              onClick={() => void search(true)}
            >
              Load more matches
            </button>
          ) : null}
        </section>
      )}
    </Modal>
  );
}
