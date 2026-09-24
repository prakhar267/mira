"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Play, Square, Volume2 } from "lucide-react";
import type { VoiceChoice } from "@/lib/voice-catalog";

export function VoicePicker({
  selected,
  enabled,
  onSelect,
}: {
  selected: string;
  enabled: boolean;
  onSelect: (id: string) => void;
}) {
  const [voices, setVoices] = useState<VoiceChoice[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [playing, setPlaying] = useState("");
  const player = useRef<HTMLAudioElement | null>(null);
  const pending = useRef<AbortController | null>(null);
  const url = useRef<string | null>(null);
  const stop = () => {
    pending.current?.abort();
    pending.current = null;
    if (player.current) {
      player.current.pause();
      player.current.removeAttribute("src");
      player.current = null;
    }
    if (url.current) {
      URL.revokeObjectURL(url.current);
      url.current = null;
    }
  };
  useEffect(() => {
    if (!enabled) {
      stop();
      return;
    }
    const controller = new AbortController();
    void fetch("/api/voices", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error ?? "Voice choices could not load.");
        if (!controller.signal.aborted) {
          setVoices(body.voices);
          setError("");
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Voice choices could not load.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      stop();
    };
  }, [enabled, retry]);
  const preview = async (id: string) => {
    stop();
    if (playing === id) {
      setPlaying("");
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setPlaying(id);
    setError("");
    try {
      const response = await fetch(
        `/api/voices/preview?${new URLSearchParams({ voiceId: id })}`,
        { signal: controller.signal },
      );
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error ?? "Preview unavailable.");
      }
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      url.current = URL.createObjectURL(blob);
      const audio = new Audio(url.current);
      player.current = audio;
      audio.onended = () => {
        if (controller.signal.aborted) return;
        stop();
        setPlaying("");
      };
      audio.onerror = () => {
        if (controller.signal.aborted) return;
        stop();
        setPlaying("");
        setError("This preview could not play. Try another voice.");
      };
      await audio.play();
    } catch (cause) {
      if (!controller.signal.aborted) {
        stop();
        setPlaying("");
        setError(
          cause instanceof Error ? cause.message : "Preview unavailable.",
        );
      }
    }
  };
  const chosen = selected === "mira-natural-01" ? "Priya" : selected;
  return (
    <section className="feature-panel" aria-label="Voice library">
      <div className="section-heading">
        <div>
          <h2>Choose a voice</h2>
          <p>
            Preview a sample, then choose the voice for read-aloud, voice calls
            and avatar calls. Priya remains the default.
          </p>
        </div>
      </div>
      <p className="settings-note">
        Samples use the provider’s preset text and do not use synthesis credits.
        Conversations use your usual speech allowance. Try Hindi and Hinglish in
        a call to hear how your chosen voice handles them.
      </p>
      {!enabled ? (
        <p role="status">
          Enable AI processing in Privacy settings to browse and preview voices.
        </p>
      ) : (
        <>
          <label className="field">
            Search voices
            <input
              type="search"
              value={filter}
              maxLength={80}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Name, language or description"
            />
          </label>
          {loading ? <p role="status">Loading voices…</p> : null}
          {error ? (
            <div role="alert">
              <p>{error}</p>
              <button
                className="button button--ghost"
                onClick={() => {
                  setLoading(true);
                  setRetry((value) => value + 1);
                }}
              >
                Retry voice library
              </button>
            </div>
          ) : null}
          <div className="voice-catalog">
            {voices
              .filter((voice) =>
                `${voice.name} ${voice.language} ${voice.description}`
                  .toLowerCase()
                  .includes(filter.toLowerCase()),
              )
              .map((voice) => (
                <article
                  className={`voice-card${chosen === voice.id ? " voice-card--selected" : ""}`}
                  key={voice.id}
                >
                  <div>
                    <h3>
                      {voice.name}
                      {voice.id === "Priya" ? " · Default" : ""}
                    </h3>
                    <span>{voice.language}</span>
                    <p>
                      {voice.description ||
                        "A voice from Inworld’s system library."}
                    </p>
                  </div>
                  <div className="feature-actions">
                    <button
                      type="button"
                      className="button button--ghost"
                      aria-label={`${playing === voice.id ? "Stop" : "Preview"} ${voice.name}`}
                      onClick={() => void preview(voice.id)}
                    >
                      {playing === voice.id ? (
                        <Square aria-hidden="true" />
                      ) : (
                        <Play aria-hidden="true" />
                      )}{" "}
                      {playing === voice.id ? "Stop" : "Preview"}
                    </button>
                    <button
                      type="button"
                      className="button button--primary"
                      aria-pressed={chosen === voice.id}
                      onClick={() => {
                        stop();
                        setPlaying("");
                        onSelect(voice.id);
                      }}
                    >
                      {chosen === voice.id ? (
                        <Check aria-hidden="true" />
                      ) : (
                        <Volume2 aria-hidden="true" />
                      )}
                      {chosen === voice.id ? "Selected" : `Use ${voice.name}`}
                    </button>
                  </div>
                </article>
              ))}
          </div>
          {!loading &&
          voices.length > 0 &&
          !voices.some((voice) =>
            `${voice.name} ${voice.language} ${voice.description}`
              .toLowerCase()
              .includes(filter.toLowerCase()),
          ) ? (
            <p role="status">No voices match that search.</p>
          ) : null}
        </>
      )}
    </section>
  );
}
