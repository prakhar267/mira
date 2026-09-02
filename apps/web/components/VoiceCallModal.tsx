"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChatCircleDots,
  Heart,
  Microphone,
  MicrophoneSlash,
  PhoneDisconnect,
  SpeakerHigh,
  SpeakerSlash,
  Waveform,
} from "@phosphor-icons/react";
import {
  playCompanionSpeech,
  recognitionLocale,
  speechLanguageOptions,
  type CompanionSpeechPlayback,
  type SpeechLanguage,
} from "@/lib/speech";

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

export function VoiceCallModal({
  companionName,
  userName,
  voiceId,
  onUserTurn,
  onTranscribedTurn,
  onRealtimeConnect,
  onClose,
}: {
  companionName: string;
  userName: string;
  voiceId: string;
  onUserTurn: (content: string) => Promise<string>;
  onTranscribedTurn?: (content: string) => Promise<void> | void;
  onRealtimeConnect?: () => Promise<{ peer: RTCPeerConnection; events: RTCDataChannel; audio: HTMLAudioElement; disconnect(): void }>;
  onClose: (durationSeconds: number) => void;
}) {
  const greeting = `Hey ${userName}. What’s going on?`;
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(true);
  const [captions, setCaptions] = useState(true);
  const [heartSent, setHeartSent] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [phase, setPhase] = useState<CallPhase>("connecting");
  const [heard, setHeard] = useState("");
  const [companionLine, setCompanionLine] = useState(greeting);
  const [speechError, setSpeechError] = useState("");
  const [transport, setTransport] = useState<"connecting" | "realtime" | "fallback">(onRealtimeConnect ? "connecting" : "fallback");
  const [mouthOpen, setMouthOpen] = useState(false);
  const [language, setLanguage] = useState<SpeechLanguage>("auto");
  const realtimeRef = useRef<{ peer: RTCPeerConnection; events: RTCDataChannel; audio: HTMLAudioElement; disconnect(): void } | null>(null);
  const realtimeReplyStarted = useRef(false);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const greetingSpoken = useRef(false);
  const speechTurn = useRef(0);
  const playbackRef = useRef<CompanionSpeechPlayback | null>(null);
  const onTranscribedTurnRef = useRef(onTranscribedTurn);
  const listenTimerRef = useRef<number | null>(null);
  const startListeningRef = useRef<() => void>(() => undefined);
  const mutedRef = useRef(false);
  const activeRef = useRef(true);

  useEffect(() => { onTranscribedTurnRef.current = onTranscribedTurn; }, [onTranscribedTurn]);

  const queueAutoListen = useCallback((delay = 320) => {
    if (listenTimerRef.current) window.clearTimeout(listenTimerRef.current);
    if (transport !== "fallback") return;
    listenTimerRef.current = window.setTimeout(() => {
      if (activeRef.current && !mutedRef.current && !recognitionRef.current) startListeningRef.current();
    }, delay);
  }, [transport]);

  const speak = useCallback((text: string, force = false) => {
    if (transport === "realtime") { setPhase("listening"); return; }
    if (!speaker && !force) {
      setPhase("listening");
      queueAutoListen();
      return;
    }
    speechTurn.current += 1;
    const turn = speechTurn.current;
    playbackRef.current?.cancel();
    playbackRef.current = playCompanionSpeech(text, {
      voiceId,
      language,
      onStart: () => { if (speechTurn.current === turn) setPhase("speaking"); },
      onEnd: () => {
        if (speechTurn.current !== turn || !activeRef.current) return;
        setPhase("listening");
        queueAutoListen();
      },
    });
    window.setTimeout(() => {
      if (speechTurn.current === turn) setPhase((current) => current === "speaking" ? "listening" : current);
    }, Math.max(2_400, text.length * 46));
  }, [language, queueAutoListen, speaker, transport, voiceId]);

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
          if (payload.type === "conversation.item.input_audio_transcription.completed" && payload.transcript) {
            setHeard(payload.transcript);
            void onTranscribedTurnRef.current?.(payload.transcript);
          }
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
    activeRef.current = true;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1_000);
    return () => {
      activeRef.current = false;
      window.clearInterval(timer);
      recognitionRef.current?.abort();
      playbackRef.current?.cancel();
      if (listenTimerRef.current) window.clearTimeout(listenTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const speakingFrame = new Image();
    speakingFrame.src = "/assets/mira/portrait-speaking.png";
    if (phase !== "speaking") { setMouthOpen(false); return; }
    const timer = window.setInterval(() => setMouthOpen((value) => !value), 135);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (greetingSpoken.current) return;
    if (transport !== "fallback") return;
    const connect = window.setTimeout(() => {
      if (greetingSpoken.current) return;
      greetingSpoken.current = true;
      speak(greeting);
    }, 650);
    return () => window.clearTimeout(connect);
  }, [greeting, speak, transport]);

  const submitTurn = useCallback(async (content: string) => {
    const clean = content.trim();
    if (!clean || phase === "thinking") return;
    recognitionRef.current?.stop();
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
      const fallback = "I lost the reply for a second. Try that once more?";
      setCompanionLine(fallback);
      speak(fallback);
    }
  }, [onUserTurn, phase, speak, transport]);

  const beginListening = () => {
    if (listenTimerRef.current) window.clearTimeout(listenTimerRef.current);
    if (mutedRef.current || phase === "thinking") return;
    if (transport === "realtime") { setPhase("listening"); return; }
    if (recognitionRef.current) { setPhase("listening"); return; }
    playbackRef.current?.cancel();
    const Recognition = recognitionConstructor();
    if (!Recognition) {
      setPhase("listening");
      setSpeechError("Voice input is not available in this browser. Use Chrome or Edge and allow microphone access, then try again.");
      return;
    }

    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = recognitionLocale(language, navigator.language);
    let finalTranscript = "";
    let restartAllowed = true;
    recognition.onresult = (event) => {
      const parts = Array.from(event.results).map((result) => result[0]?.transcript ?? "");
      const transcript = parts.join(" ").trim();
      setHeard(transcript);
      finalTranscript = transcript;
    };
    recognition.onerror = (event) => {
      setPhase("listening");
      restartAllowed = event.error !== "not-allowed" && event.error !== "service-not-allowed";
      if (!restartAllowed) setSpeechError("Microphone access is blocked. Allow it in your browser settings, then tap the mic again.");
      else if (event.error !== "no-speech" && event.error !== "aborted") setSpeechError("I couldn’t hear that clearly. I’ll keep listening.");
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      if (finalTranscript) void submitTurn(finalTranscript);
      else {
        setPhase("listening");
        if (restartAllowed) queueAutoListen(450);
      }
    };
    recognitionRef.current = recognition;
    setHeard("");
    setSpeechError("");
    setPhase("listening");
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setSpeechError("The microphone is already busy. Wait a second, then tap again.");
    }
  };
  useEffect(() => { startListeningRef.current = beginListening; });

  const interrupt = () => {
    if (muted) return;
    setPhase("interrupted");
    if (transport === "realtime" && realtimeRef.current?.events.readyState === "open") realtimeRef.current.events.send(JSON.stringify({ type: "response.cancel" }));
    playbackRef.current?.cancel();
    window.setTimeout(beginListening, 180);
  };

  const toggleSpeaker = () => {
    if (speaker) {
      playbackRef.current?.cancel();
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
      <img className="live-call__backdrop" src="/assets/mira/loft-morning.png" alt="" />
      <div className="live-call__veil" />
      <header className="live-call__header"><span><i className="status-dot" /> {transport === "realtime" ? "Realtime voice connected" : transport === "connecting" ? "Connecting secure voice…" : "Browser voice fallback"}</span><strong>{companionName}</strong><time>{time}</time></header>
      <div className="voice-call__portrait">
        <motion.img src={phase === "speaking" && mouthOpen ? "/assets/mira/portrait-speaking.png" : "/assets/mira/portrait.png"} alt={`${companionName}, your AI companion`} animate={phase === "speaking" ? { scale: [1, 1.025, 1], y: [0, -3, 0] } : { scale: 1, y: 0 }} transition={{ duration: 2.4, repeat: phase === "speaking" ? Infinity : 0 }} />
        <i className={phase === "speaking" ? "voice-call__ring voice-call__ring--active" : "voice-call__ring"} />
        <AnimatePresence mode="wait"><motion.span key={phase} initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{phaseCopy[phase]}</motion.span></AnimatePresence>
      </div>

      {captions ? <div className="call-conversation" aria-live="polite">{heard ? <p className="call-conversation__user"><span>You</span>{heard}</p> : null}<p><span>{companionName}</span>{companionLine}</p></div> : null}
      {speechError ? <p className="call-speech-error" role="status">{speechError}</p> : null}

      <label className="call-language-picker"><span>Language</span><select aria-label="Voice call language" value={language} onChange={(event) => { recognitionRef.current?.abort(); playbackRef.current?.cancel(); setLanguage(event.target.value as SpeechLanguage); queueAutoListen(500); }}>{speechLanguageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>

      <button type="button" className="barge-in" onClick={phase === "speaking" ? interrupt : beginListening} disabled={muted || phase === "thinking"}>
        <Waveform aria-hidden="true" /> {phase === "speaking" ? "Speak now to interrupt" : phase === "thinking" ? "Thinking…" : phase === "listening" ? "Listening automatically" : "Start hands-free listening"}
      </button>

      <div className="live-call__controls">
        <button type="button" className={muted ? "call-orb call-orb--active" : "call-orb"} onClick={() => { recognitionRef.current?.abort(); setMuted((value) => { const next = !value; mutedRef.current = next; realtimeRef.current?.peer.getSenders().forEach((sender) => { if (sender.track?.kind === "audio") sender.track.enabled = !next; }); if (!next) queueAutoListen(220); return next; }); }} aria-label={muted ? "Unmute microphone" : "Mute microphone"}>{muted ? <MicrophoneSlash aria-hidden="true" /> : <Microphone aria-hidden="true" />}</button>
        <button type="button" className={speaker ? "call-orb call-orb--active" : "call-orb"} onClick={toggleSpeaker} aria-label={speaker ? "Turn speaker off" : "Turn speaker on"}>{speaker ? <SpeakerHigh aria-hidden="true" /> : <SpeakerSlash aria-hidden="true" />}</button>
        <button type="button" className={captions ? "call-orb call-orb--active" : "call-orb"} onClick={() => setCaptions((value) => !value)} aria-label={captions ? "Hide captions" : "Show captions"}><ChatCircleDots aria-hidden="true" /></button>
        <button type="button" className={heartSent ? "call-orb call-orb--heart" : "call-orb"} onClick={() => { setHeartSent(true); window.setTimeout(() => setHeartSent(false), 1_500); }} aria-label="Send a heart reaction"><Heart aria-hidden="true" weight={heartSent ? "fill" : "regular"} /></button>
        <button type="button" className="call-orb call-orb--end" onClick={() => onClose(seconds)} aria-label="End call"><PhoneDisconnect aria-hidden="true" weight="fill" /></button>
      </div>
      <AnimatePresence>{heartSent ? <motion.div className="call-heart" initial={{ opacity: 0, scale: .5, y: 0 }} animate={{ opacity: 1, scale: 1.3, y: -90 }} exit={{ opacity: 0 }}><Heart weight="fill" /></motion.div> : null}</AnimatePresence>
      <small className="live-call__disclosure">Hands-free listening pauses while {companionName} speaks · raw microphone audio is not retained · {transport === "realtime" ? "secure multilingual audio connected" : transport === "connecting" ? "connecting…" : "English · हिन्दी · Hinglish"}</small>
    </motion.div>
  );
}
