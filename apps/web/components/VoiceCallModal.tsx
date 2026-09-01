"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChatCircleDots,
  Heart,
  Microphone,
  MicrophoneSlash,
  PaperPlaneTilt,
  PhoneDisconnect,
  SpeakerHigh,
  SpeakerSlash,
  Waveform,
} from "@phosphor-icons/react";

type CallPhase = "connecting" | "listening" | "thinking" | "speaking" | "interrupted";

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: { results: ArrayLike<{ 0?: { transcript?: string }; isFinal?: boolean }> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionWindow = Window & typeof globalThis & {
  SpeechRecognition?: new () => BrowserSpeechRecognition;
  webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
};

function recognitionConstructor() {
  if (typeof window === "undefined") return undefined;
  const speechWindow = window as SpeechRecognitionWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
}

function voiceProfile(voiceId: string) {
  if (voiceId.includes("calm")) return { rate: .88, pitch: .98, names: /serena|samantha|ava|google uk english female/i };
  if (voiceId.includes("confident")) return { rate: .97, pitch: 1, names: /ava|aria|samantha|zira/i };
  if (voiceId.includes("warm")) return { rate: .91, pitch: 1.01, names: /samantha|serena|ava|google uk english female/i };
  return { rate: .98, pitch: 1.04, names: /ava|samantha|aria|serena|zira|google uk english female/i };
}

function preferredVoice(voiceId: string) {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  const profile = voiceProfile(voiceId);
  return voices.find((voice) => /^en[-_]/i.test(voice.lang) && profile.names.test(voice.name) && /premium|enhanced|natural|neural/i.test(voice.name))
    ?? voices.find((voice) => /^en[-_]/i.test(voice.lang) && profile.names.test(voice.name))
    ?? voices.find((voice) => /^en[-_]/i.test(voice.lang));
}

export function VoiceCallModal({
  companionName,
  userName,
  voiceId,
  onUserTurn,
  onRealtimeConnect,
  onClose,
}: {
  companionName: string;
  userName: string;
  voiceId: string;
  onUserTurn: (content: string) => Promise<string>;
  onRealtimeConnect?: () => Promise<{ peer: RTCPeerConnection; events: RTCDataChannel; audio: HTMLAudioElement; disconnect(): void }>;
  onClose: (durationSeconds: number) => void;
}) {
  const greeting = `Hey ${userName}. There you are. I’m here—take your time.`;
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(true);
  const [captions, setCaptions] = useState(true);
  const [heartSent, setHeartSent] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [phase, setPhase] = useState<CallPhase>("connecting");
  const [draft, setDraft] = useState("");
  const [heard, setHeard] = useState("");
  const [companionLine, setCompanionLine] = useState(greeting);
  const [speechError, setSpeechError] = useState("");
  const [transport, setTransport] = useState<"connecting" | "realtime" | "fallback">(onRealtimeConnect ? "connecting" : "fallback");
  const [mouthOpen, setMouthOpen] = useState(false);
  const realtimeRef = useRef<{ peer: RTCPeerConnection; events: RTCDataChannel; audio: HTMLAudioElement; disconnect(): void } | null>(null);
  const realtimeReplyStarted = useRef(false);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const greetingSpoken = useRef(false);
  const speechTurn = useRef(0);

  const speak = useCallback((text: string, force = false) => {
    if (transport === "realtime") { setPhase("listening"); return; }
    if ((!speaker && !force) || !("speechSynthesis" in window)) {
      setPhase("listening");
      return;
    }
    window.speechSynthesis.cancel();
    speechTurn.current += 1;
    const turn = speechTurn.current;
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = preferredVoice(voiceId);
    const profile = voiceProfile(voiceId);
    if (voice) utterance.voice = voice;
    utterance.rate = profile.rate;
    utterance.pitch = profile.pitch;
    setPhase("speaking");
    utterance.onend = () => { if (speechTurn.current === turn) setPhase("listening"); };
    utterance.onerror = () => { if (speechTurn.current === turn) setPhase("listening"); };
    window.speechSynthesis.speak(utterance);
    window.setTimeout(() => {
      if (speechTurn.current === turn) setPhase((current) => current === "speaking" ? "listening" : current);
    }, Math.max(2_400, text.length * 46));
  }, [speaker, transport, voiceId]);

  useEffect(() => {
    if (!onRealtimeConnect) return;
    let active = true;
    void onRealtimeConnect().then((connection) => {
      if (!active) { connection.disconnect(); return; }
      realtimeRef.current = connection;
      setTransport("realtime");
      setPhase("listening");
      connection.events.addEventListener("open", () => connection.events.send(JSON.stringify({ type: "response.create", response: { instructions: `Greet ${userName} warmly in one short sentence, then listen.` } })));
      connection.events.addEventListener("message", (event) => {
        try {
          const payload = JSON.parse(String(event.data)) as { type?: string; delta?: string; transcript?: string };
          if (payload.type === "response.output_audio_transcript.delta" && payload.delta) { setPhase("speaking"); setCompanionLine((line) => { const next = realtimeReplyStarted.current ? `${line}${payload.delta}` : payload.delta!; realtimeReplyStarted.current = true; return next; }); }
          if (payload.type === "response.output_audio_transcript.done") { realtimeReplyStarted.current = false; setPhase("listening"); }
          if (payload.type === "conversation.item.input_audio_transcription.completed" && payload.transcript) setHeard(payload.transcript);
          if (payload.type === "input_audio_buffer.speech_started") setPhase("listening");
        } catch { /* Ignore unknown provider events. */ }
      });
    }).catch((cause) => {
      if (!active) return;
      setTransport("fallback");
      setSpeechError(cause instanceof Error ? `${cause.message} Using browser voice fallback.` : "Using browser voice fallback.");
    });
    return () => { active = false; realtimeRef.current?.disconnect(); realtimeRef.current = null; };
  }, [onRealtimeConnect, userName]);

  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1_000);
    return () => {
      window.clearInterval(timer);
      recognitionRef.current?.abort();
      window.speechSynthesis?.cancel();
    };
  }, []);

  useEffect(() => {
    const speakingFrame = new Image();
    speakingFrame.src = "/assets/luma/portrait-speaking-v2.png";
    if (phase !== "speaking") { setMouthOpen(false); return; }
    const timer = window.setInterval(() => setMouthOpen((value) => !value), 135);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (greetingSpoken.current) return;
    greetingSpoken.current = true;
    if (transport !== "fallback") return;
    const connect = window.setTimeout(() => speak(greeting), 650);
    return () => window.clearTimeout(connect);
  }, [greeting, speak, transport]);

  const submitTurn = useCallback(async (content: string) => {
    const clean = content.trim();
    if (!clean || phase === "thinking") return;
    recognitionRef.current?.stop();
    setDraft("");
    setHeard(clean);
    setSpeechError("");
    setPhase("thinking");
    if (transport === "realtime" && realtimeRef.current?.events.readyState === "open") {
      realtimeRef.current.events.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: clean }] } }));
      realtimeRef.current.events.send(JSON.stringify({ type: "response.create" }));
      return;
    }
    try {
      const reply = await onUserTurn(clean);
      setCompanionLine(reply);
      speak(reply);
    } catch {
      const fallback = "I’m still here. I lost that reply for a second—tell me again in your own words?";
      setCompanionLine(fallback);
      speak(fallback);
    }
  }, [onUserTurn, phase, speak, transport]);

  const beginListening = () => {
    if (muted || phase === "thinking") return;
    if (transport === "realtime") { setPhase("listening"); return; }
    window.speechSynthesis?.cancel();
    const Recognition = recognitionConstructor();
    if (!Recognition) {
      setPhase("listening");
      setSpeechError("Live transcription is not available in this browser. Type below instead.");
      inputRef.current?.focus();
      return;
    }

    recognitionRef.current?.abort();
    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-IN";
    let finalTranscript = "";
    recognition.onresult = (event) => {
      const parts = Array.from(event.results).map((result) => result[0]?.transcript ?? "");
      const transcript = parts.join(" ").trim();
      setHeard(transcript);
      finalTranscript = transcript;
    };
    recognition.onerror = (event) => {
      setPhase("listening");
      setSpeechError(event.error === "not-allowed" ? "Microphone permission was not granted. Type below instead." : "I couldn’t hear that clearly. Try again or type below.");
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      if (finalTranscript) void submitTurn(finalTranscript);
      else setPhase("listening");
    };
    recognitionRef.current = recognition;
    setHeard("");
    setSpeechError("");
    setPhase("listening");
    recognition.start();
  };

  const interrupt = () => {
    if (muted) return;
    setPhase("interrupted");
    if (transport === "realtime" && realtimeRef.current?.events.readyState === "open") realtimeRef.current.events.send(JSON.stringify({ type: "response.cancel" }));
    window.speechSynthesis?.cancel();
    window.setTimeout(beginListening, 180);
  };

  const toggleSpeaker = () => {
    if (speaker) {
      window.speechSynthesis?.cancel();
      if (realtimeRef.current) realtimeRef.current.audio.muted = true;
      setSpeaker(false);
      setPhase("listening");
    } else {
      setSpeaker(true);
      if (realtimeRef.current) realtimeRef.current.audio.muted = false;
      window.setTimeout(() => speak(companionLine, true), 0);
    }
  };

  const time = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const phaseCopy: Record<CallPhase, string> = {
    connecting: "Calling…",
    listening: "Listening to you",
    thinking: "Thinking about that",
    speaking: "Talking with you",
    interrupted: "Stopped · listening",
  };

  return (
    <motion.div className="live-call live-call--voice" role="dialog" aria-modal="true" aria-label={`Voice call with ${companionName}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <img className="live-call__backdrop" src="/assets/luma/window-nook.png" alt="" />
      <div className="live-call__veil" />
      <header className="live-call__header"><span><i className="status-dot" /> {transport === "realtime" ? "Realtime voice connected" : transport === "connecting" ? "Connecting secure voice…" : "Browser voice fallback"}</span><strong>{companionName}</strong><time>{time}</time></header>
      <div className="voice-call__portrait">
        <motion.img src={phase === "speaking" && mouthOpen ? "/assets/luma/portrait-speaking-v2.png" : "/assets/luma/portrait.png"} alt={`${companionName}, your AI companion`} animate={phase === "speaking" ? { scale: [1, 1.025, 1], y: [0, -3, 0] } : { scale: 1, y: 0 }} transition={{ duration: 2.4, repeat: phase === "speaking" ? Infinity : 0 }} />
        <i className={phase === "speaking" ? "voice-call__ring voice-call__ring--active" : "voice-call__ring"} />
        <AnimatePresence mode="wait"><motion.span key={phase} initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{phaseCopy[phase]}</motion.span></AnimatePresence>
      </div>

      {captions ? <div className="call-conversation" aria-live="polite">{heard ? <p className="call-conversation__user"><span>You</span>{heard}</p> : null}<p><span>{companionName}</span>{companionLine}</p></div> : null}
      {speechError ? <p className="call-speech-error" role="status">{speechError}</p> : null}

      <button type="button" className="barge-in" onClick={phase === "speaking" ? interrupt : beginListening} disabled={muted || phase === "thinking"}>
        <Waveform aria-hidden="true" /> {phase === "speaking" ? "Speak now to interrupt" : phase === "thinking" ? "Thinking…" : "Tap and talk"}
      </button>

      <form className="call-reply" onSubmit={(event) => { event.preventDefault(); void submitTurn(draft); }}>
        <input ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Or type what you want to say…" aria-label={`Type to ${companionName}`} />
        <button type="submit" disabled={!draft.trim() || phase === "thinking"} aria-label="Send typed call reply"><PaperPlaneTilt aria-hidden="true" weight="fill" /></button>
      </form>

      <div className="live-call__controls">
        <button type="button" className={muted ? "call-orb call-orb--active" : "call-orb"} onClick={() => { recognitionRef.current?.abort(); setMuted((value) => { const next = !value; realtimeRef.current?.peer.getSenders().forEach((sender) => { if (sender.track?.kind === "audio") sender.track.enabled = !next; }); return next; }); }} aria-label={muted ? "Unmute microphone" : "Mute microphone"}>{muted ? <MicrophoneSlash aria-hidden="true" /> : <Microphone aria-hidden="true" />}</button>
        <button type="button" className={speaker ? "call-orb call-orb--active" : "call-orb"} onClick={toggleSpeaker} aria-label={speaker ? "Turn speaker off" : "Turn speaker on"}>{speaker ? <SpeakerHigh aria-hidden="true" /> : <SpeakerSlash aria-hidden="true" />}</button>
        <button type="button" className={captions ? "call-orb call-orb--active" : "call-orb"} onClick={() => setCaptions((value) => !value)} aria-label={captions ? "Hide captions" : "Show captions"}><ChatCircleDots aria-hidden="true" /></button>
        <button type="button" className={heartSent ? "call-orb call-orb--heart" : "call-orb"} onClick={() => { setHeartSent(true); window.setTimeout(() => setHeartSent(false), 1_500); }} aria-label="Send a heart reaction"><Heart aria-hidden="true" weight={heartSent ? "fill" : "regular"} /></button>
        <button type="button" className="call-orb call-orb--end" onClick={() => onClose(seconds)} aria-label="End call"><PhoneDisconnect aria-hidden="true" weight="fill" /></button>
      </div>
      <AnimatePresence>{heartSent ? <motion.div className="call-heart" initial={{ opacity: 0, scale: .5, y: 0 }} animate={{ opacity: 1, scale: 1.3, y: -90 }} exit={{ opacity: 0 }}><Heart weight="fill" /></motion.div> : null}</AnimatePresence>
      <small className="live-call__disclosure">Raw microphone audio is not retained · {transport === "realtime" ? "secure realtime audio connected" : transport === "connecting" ? "connecting…" : "browser voice fallback"}</small>
    </motion.div>
  );
}
