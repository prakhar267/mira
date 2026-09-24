"use client";
import { useEffect, useRef, useState } from "react";
import type { JournalEntryRecord } from "@companion/shared";
import type {
  JournalReflection,
  ReflectionLanguage,
} from "@/lib/journal-reflection";

export function WeeklyReflection({
  entries,
  saved,
  enabled,
  accountMode,
  beforeGenerate,
  onSave,
  onDelete,
}: {
  entries: JournalEntryRecord[];
  saved: JournalReflection[];
  enabled: boolean;
  accountMode: boolean;
  beforeGenerate: () => Promise<void>;
  onSave: (reflection: JournalReflection) => void;
  onDelete: (id: string) => void;
}) {
  const [openedAt] = useState(() => Date.now());
  const [selected, setSelected] = useState<string[]>([]);
  const [language, setLanguage] = useState<ReflectionLanguage>("English");
  const [days, setDays] = useState("7");
  const [draftFingerprint, setDraftFingerprint] = useState("");
  const [draft, setDraft] = useState<JournalReflection | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const request = useRef<AbortController | null>(null);
  const selection = entries.filter((entry) => selected.includes(entry.id));
  const fingerprint = JSON.stringify(selection);
  useEffect(() => {
    request.current?.abort();
  }, [fingerprint, enabled]);
  useEffect(() => () => request.current?.abort(), []);
  const clearDraft = () => {
    request.current?.abort();
    setBusy(false);
    setDraft(null);
    setNotice("");
    setError("");
  };
  const generate = async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setDraft(null);
    setError("");
    setNotice("");
    try {
      await beforeGenerate();
      controller.signal.throwIfAborted();
      const response = await fetch("/api/journal-reflection", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          entryIds: selection.map((entry) => entry.id),
          language,
          ...(!accountMode
            ? {
                entries: selection.map(
                  ({ id, title, content, mood, createdAt }) => ({
                    id,
                    title,
                    content,
                    mood,
                    createdAt,
                  }),
                ),
              }
            : {}),
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Your reflection could not be created.");
      if (!controller.signal.aborted) {
        setDraftFingerprint(fingerprint);
        setDraft({
          id: crypto.randomUUID(),
          entryIds: body.entryIds,
          summary: body.summary,
          language: body.language,
          createdAt: new Date().toISOString(),
        });
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "Reflection unavailable. Try again.",
        );
    } finally {
      if (request.current === controller) setBusy(false);
    }
  };
  const exportReflection = (reflection: JournalReflection) => {
    const url = URL.createObjectURL(
      new Blob(
        [
          `Mira · Weekly reflection\n${new Date(reflection.createdAt).toLocaleString()}\nBased on ${reflection.entryIds.length} selected journal entries\n\n${reflection.summary}\n\nAI-generated; review for accuracy.`,
        ],
        { type: "text/plain;charset=utf-8" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `mira-reflection-${reflection.createdAt.slice(0, 10)}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const visible = entries.filter(
    (entry) =>
      days === "all" ||
      Date.parse(entry.createdAt) >= openedAt - Number(days) * 86400000,
  );
  const validDraft =
    draft &&
    draftFingerprint === fingerprint &&
    enabled &&
    draft.entryIds.every((id) => entries.some((entry) => entry.id === id))
      ? draft
      : null;
  return (
    <section
      className="feature-panel weekly-reflection"
      aria-label="Weekly reflection"
    >
      <div className="section-heading">
        <div>
          <h2>Your week, in your words</h2>
          <p>
            Select the entries you want Mira to reflect on. Only your selection
            is shared with the AI. Nothing is added to chat or memory.
          </p>
        </div>
      </div>
      <div className="feature-form-grid">
        <label className="field">
          Entries from
          <select
            value={days}
            onChange={(event) => {
              clearDraft();
              setSelected([]);
              setDays(event.target.value);
            }}
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="all">All saved entries</option>
          </select>
        </label>
        <label className="field">
          Reflection language
          <select
            value={language}
            onChange={(event) => {
              clearDraft();
              setLanguage(event.target.value as ReflectionLanguage);
            }}
          >
            <option>English</option>
            <option>Hindi</option>
            <option>Hinglish</option>
          </select>
        </label>
      </div>
      <fieldset className="reflection-entry-list">
        <legend>Choose up to 14 entries</legend>
        {visible.length ? (
          visible.map((entry) => (
            <label className="reflection-entry" key={entry.id}>
              <input
                type="checkbox"
                checked={selected.includes(entry.id)}
                disabled={
                  busy ||
                  !enabled ||
                  (selected.length >= 14 && !selected.includes(entry.id))
                }
                onChange={(event) => {
                  clearDraft();
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, entry.id]
                      : current.filter((id) => id !== entry.id),
                  );
                }}
              />
              <span>
                <strong>{entry.title}</strong>
                <small>
                  {new Date(entry.createdAt).toLocaleDateString()} ·{" "}
                  {entry.mood}
                </small>
                <span>
                  {entry.content.slice(0, 160)}
                  {entry.content.length > 160 ? "…" : ""}
                </span>
              </span>
            </label>
          ))
        ) : (
          <p>
            No entries in this period. Save a journal entry or choose a wider
            range.
          </p>
        )}
      </fieldset>
      <p>
        {selection.length} selected ·{" "}
        {selection
          .reduce(
            (sum, entry) => sum + entry.content.length + entry.title.length,
            0,
          )
          .toLocaleString()}{" "}
        / 24,000 characters
      </p>
      <div className="feature-actions">
        <button
          className="button button--primary"
          disabled={
            !enabled ||
            busy ||
            !selection.length ||
            selection.reduce(
              (sum, e) => sum + e.content.length + e.title.length,
              0,
            ) > 24000
          }
          onClick={() => void generate()}
        >
          {busy ? "Reflecting…" : "Generate selected reflection"}
        </button>
        {busy ? (
          <button className="button button--ghost" onClick={clearDraft}>
            Cancel
          </button>
        ) : null}
      </div>
      {!enabled ? (
        <p role="status">
          Enable AI processing to generate a reflection. Your journal stays
          available.
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {validDraft ? (
        <article className="reflection-output">
          <h3>Your reflection · unsaved</h3>
          <p>{validDraft.summary}</p>
          <small>
            AI-generated from your selection. Check that it represents your
            experience.
          </small>
          <div className="feature-actions">
            <button
              className="button button--primary"
              disabled={saved.length >= 30}
              onClick={() => {
                onSave(validDraft);
                setDraft(null);
                setNotice("Reflection saved.");
              }}
            >
              Save reflection
            </button>
            <button
              className="button button--ghost"
              onClick={() => exportReflection(validDraft)}
            >
              Download text
            </button>
            <button className="button button--ghost" onClick={clearDraft}>
              Discard
            </button>
          </div>
          {saved.length >= 30 ? (
            <p>
              30 reflections saved. Delete an older reflection before saving
              another.
            </p>
          ) : null}
        </article>
      ) : null}
      {saved.length ? (
        <div className="saved-reflections">
          <h3>Saved reflections</h3>
          {saved.map((reflection) => (
            <details key={reflection.id}>
              <summary>
                {new Date(reflection.createdAt).toLocaleDateString()} ·{" "}
                {reflection.entryIds.length} entries · {reflection.language}
              </summary>
              <p>{reflection.summary}</p>
              <small>
                AI-generated. Deleting a source entry also removes this saved
                reflection.
              </small>
              <div className="feature-actions">
                <button
                  className="button button--ghost"
                  onClick={() => exportReflection(reflection)}
                >
                  Download text
                </button>
                <button
                  className="button button--ghost"
                  onClick={() => onDelete(reflection.id)}
                >
                  Delete reflection
                </button>
              </div>
            </details>
          ))}
        </div>
      ) : null}
    </section>
  );
}
