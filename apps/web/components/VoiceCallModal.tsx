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
  collectRecognitionTranscript,
  detectSpeechLanguage,
  playCompanionSpeech,
  recognitionLocale,
  speechLanguageOptions,
  type CompanionSpeechPlayback,
  type SpeechLanguage,
} from "@/lib/speech";
import { companionVoiceMode, companionVoiceModes } from "@/lib/voice-profiles";

type CallPhase = "connecting" | "listening" | "thinking" | "speaking" | "interrupted";

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: { resultIndex?: number; results: ArrayLike<ArrayLike<{ transcript?: string; confidence?: number }> & { isFinal?: boolean }> }) => void) | null;
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
  onVoiceChange,
  onRealtimeConnect,
  onClose,
}: {
  companionName: string;
  userName: string;
  voiceId: string;
  onUserTurn: (content: string) => Promise<string>;
  onTranscribedTurn?: (content: string) => Promise<void> | void;
  onVoiceChange?: (voiceId: string) => void;
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
  const [language, setLanguage] = useState<SpeechLanguage>("auto");
  const [activeVoiceId, setActiveVoiceId] = useState(voiceId);
  const realtimeRef = useRef<{ peer: RTCPeerConnection; events: RTCDataChannel; audio: HTMLAudioElement; disconnect(): void } | null>(null);
  const realtimeReplyStarted = useRef(false);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const greetingSpoken = useRef(false);
  const speechTurn = useRef(0);
  const playbackRef = useRef<CompanionSpeechPlayback | null>(null);
  const onTranscribedTurnRef = useRef(onTranscribedTurn);
  const listenTimerRef = useRef<number | null>(null);
  const commitTimerRef = useRef<number | null>(null);
  const startListeningRef = useRef<() => void>(() => undefined);
  const mutedRef = useRef(false);
  const activeRef = useRef(true);
  const phaseRef = useRef<CallPhase>("connecting");
  const ignoredRecognitionsRef = useRef(new WeakSet<BrowserSpeechRecognition>());
  const adaptiveLocaleRef = useRef("en-IN");

  useEffect(() => { onTranscribedTurnRef.current = onTranscribedTurn; }, [onTranscribedTurn]);
  useEffect(() => { setActiveVoiceId(companionVoiceMode(voiceId).id); }, [voiceId]);

  const changePhase = useCallback((next: CallPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const stopRecognition = useCallback((ignoreTranscript = true) => {
    if (commitTimerRef.current) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    const recognition = recognitionRef.current;
    if (!recognition) return;
    if (ignoreTranscript) ignoredRecognitionsRef.current.add(recognition);
    recognitionRef.current = null;
    recognition.abort();
  }, []);

  const queueAutoListen = useCallback((delay = 650) => {
    if (listenTimerRef.current) window.clearTimeout(listenTimerRef.current);
    if (transport !== "fallback") return;
    listenTimerRef.current = window.setTimeout(() => {
      listenTimerRef.current = null;
      if (
        activeRef.current
        && !mutedRef.current
        && !recognitionRef.current
        && phaseRef.current !== "speaking"
        && phaseRef.current !== "thinking"
      ) startListeningRef.current();
    }, delay);
  }, [transport]);

  const speak = useCallback((text: string, force = false, selectedVoiceId = activeVoiceId) => {
    if (transport === "realtime") { changePhase("listening"); return; }
    if (!speaker && !force) {
      changePhase("listening");
      queueAutoListen();
      return;
    }
    if (listenTimerRef.current) {
      window.clearTimeout(listenTimerRef.current);
      listenTimerRef.current = null;
    }
    stopRecognition();
    speechTurn.current += 1;
    const turn = speechTurn.current;
    playbackRef.current?.cancel();
    changePhase("connecting");
    playbackRef.current = playCompanionSpeech(text, {
      voiceId: selectedVoiceId,
      language,
      onStart: () => { if (speechTurn.current === turn) changePhase("speaking"); },
      onEnd: () => {
        if (speechTurn.current !== turn || !activeRef.current) return;
        changePhase("listening");
        queueAutoListen();
      },
    });
  }, [activeVoiceId, changePhase, language, queueAutoListen, speaker, stopRecognition, transport]);

  useEffect(() => {
    if (!onRealtimeConnect) return;
    let active = true;
    void onRealtimeConnect().then((connection) => {
      if (!active) { connection.disconnect(); return; }
      realtimeRef.current = connection;
      setTransport("realtime");
      changePhase("listening");
      connection.events.addEventListener("open", () => connection.events.send(JSON.stringify({ type: "response.create", response: { instructions: `Greet ${userName} warmly in one short sentence, then listen.` } })));
      connection.events.addEventListener("message", (event) => {
        try {
          const payload = JSON.parse(String(event.data)) as { type?: string; delta?: string; transcript?: string };
          if (payload.type === "response.output_audio_transcript.delta" && payload.delta) { changePhase("speaking"); setCompanionLine((line) => { const next = realtimeReplyStarted.current ? `${line}${payload.delta}` : payload.delta!; realtimeReplyStarted.current = true; return next; }); }
          if (payload.type === "response.output_audio_transcript.done") { realtimeReplyStarted.current = false; changePhase("listening"); }
          if (payload.type === "conversation.item.input_audio_transcription.completed" && payload.transcript) {
            setHeard(payload.transcript);
            void onTranscribedTurnRef.current?.(payload.transcript);
          }
          if (payload.type === "input_audio_buffer.speech_started") changePhase("listening");
        } catch { /* Ignore unknown provider events. */ }
      });
    }).catch((cause) => {
      if (!active) return;
      setTransport("fallback");
      setSpeechError(cause instanceof Error ? `${cause.message} Using browser voice fallback.` : "Using browser voice fallback.");
    });
    return () => { active = false; realtimeRef.current?.disconnect(); realtimeRef.current = null; };
  }, [changePhase, onRealtimeConnect, userName]);

  useEffect(() => {
    activeRef.current = true;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1_000);
    return () => {
      activeRef.current = false;
      window.clearInterval(timer);
      stopRecognition();
      playbackRef.current?.cancel();
      if (listenTimerRef.current) window.clearTimeout(listenTimerRef.current);
      if (commitTimerRef.current) window.clearTimeout(commitTimerRef.current);
    };
  }, [stopRecognition]);

  useEffect(() => {
    const speakingFrame = new Image();
    speakingFrame.src = "/assets/mira/portrait-speaking.png";
  }, []);

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
    if (!clean || phaseRef.current === "thinking") return;
    recognitionRef.current?.stop();
    setHeard(clean);
    setSpeechError("");
    changePhase("thinking");
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
  }, [changePhase, onUserTurn, speak, transport]);

  const beginListening = () => {
    if (listenTimerRef.current) {
      window.clearTimeout(listenTimerRef.current);
      listenTimerRef.current = null;
    }
    if (mutedRef.current || phaseRef.current === "thinking" || phaseRef.current === "speaking") return;
    if (transport === "realtime") { changePhase("listening"); return; }
    if (recognitionRef.current) { changePhase("listening"); return; }
    const Recognition = recognitionConstructor();
    if (!Recognition) {
      changePhase("listening");
      setSpeechError("Voice input is not available in this browser. Use Chrome or Edge and allow microphone access, then try again.");
      return;
    }

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;
    recognition.lang = language === "auto" ? adaptiveLocaleRef.current : recognitionLocale(language, navigator.language);
    const transcriptSegments = new Map<number, string>();
    let finalTranscript = "";
    let restartAllowed = true;
    let submitted = false;

    const commitTranscript = () => {
      if (submitted || !finalTranscript || recognitionRef.current !== recognition) return;
      submitted = true;
      if (commitTimerRef.current) window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
      ignoredRecognitionsRef.current.add(recognition);
      recognitionRef.current = null;
      recognition.stop();
      void submitTurn(finalTranscript);
    };

    recognition.onresult = (event) => {
      const transcript = collectRecognitionTranscript(transcriptSegments, event);
      if (!transcript.text) return;
      setHeard(transcript.text);
      finalTranscript = transcript.text;
      if (language === "auto") adaptiveLocaleRef.current = recognitionLocale(detectSpeechLanguage(transcript.text), navigator.language);
      if (commitTimerRef.current) window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = window.setTimeout(commitTranscript, transcript.hasFinalResult ? 1_350 : 2_200);
    };
    recognition.onerror = (event) => {
      changePhase("listening");
      restartAllowed = event.error !== "not-allowed" && event.error !== "service-not-allowed";
      if (!restartAllowed) setSpeechError("Microphone access is blocked. Allow it in your browser settings, then tap the mic again.");
      else if (event.error !== "no-speech" && event.error !== "aborted") setSpeechError("I couldn’t hear that clearly. I’ll keep listening.");
    };
    recognition.onend = () => {
      if (commitTimerRef.current) {
        window.clearTimeout(commitTimerRef.current);
        commitTimerRef.current = null;
      }
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      if (ignoredRecognitionsRef.current.has(recognition) || !activeRef.current) return;
      if (finalTranscript && !submitted) {
        submitted = true;
        void submitTurn(finalTranscript);
      }
      else {
        changePhase("listening");
        if (restartAllowed) queueAutoListen(900);
      }
    };
    recognitionRef.current = recognition;
    setHeard("");
    setSpeechError("");
    changePhase("listening");
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setSpeechError("The microphone is already busy. Wait a second, then tap again.");
      queueAutoListen(900);
    }
  };
  useEffect(() => { startListeningRef.current = beginListening; });

  const interrupt = () => {
    if (muted) return;
    speechTurn.current += 1;
    changePhase("interrupted");
    if (transport === "realtime" && realtimeRef.current?.events.readyState === "open") realtimeRef.current.events.send(JSON.stringify({ type: "response.cancel" }));
    playbackRef.current?.cancel();
    window.setTimeout(beginListening, 180);
  };

  const toggleSpeaker = () => {
    if (speaker) {
      playbackRef.current?.cancel();
      if (realtimeRef.current) realtimeRef.current.audio.muted = true;
      setSpeaker(false);
      changePhase("listening");
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
      <header className="live-call__header"><span><i className="status-dot" /> {transport === "realtime" ? "Mira Aster · live neural" : transport === "connecting" ? "Connecting secure voice…" : "Mira Aster · adaptive multilingual"}</span><strong>{companionName}</strong><time>{time}</time></header>
      <div className="voice-call__portrait">
        <motion.img src={phase === "speaking" ? "/assets/mira/portrait-speaking.png" : "/assets/mira/portrait.png"} alt={`${companionName}, your AI companion`} animate={phase === "speaking" ? { scale: [1, 1.012, 1], y: [0, -1, 0] } : { scale: 1, y: 0 }} transition={{ duration: 3.2, repeat: phase === "speaking" ? Infinity : 0 }} />
        <i className={phase === "speaking" ? "voice-call__ring voice-call__ring--active" : "voice-call__ring"} />
        <AnimatePresence mode="wait"><motion.span key={phase} initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{phaseCopy[phase]}</motion.span></AnimatePresence>
      </div>

      {captions ? <div className="call-conversation" aria-live="polite">{heard ? <p className="call-conversation__user"><span>You</span><strong>{heard}</strong></p> : null}<p><span>{companionName}</span><strong>{companionLine}</strong></p></div> : null}
      {speechError ? <p className="call-speech-error" role="status">{speechError}</p> : null}

      <div className="call-pickers">
        <label className="call-language-picker"><span>Language</span><select aria-label="Voice call language" value={language} onChange={(event) => { stopRecognition(); playbackRef.current?.cancel(); changePhase("listening"); setLanguage(event.target.value as SpeechLanguage); queueAutoListen(); }}>{speechLanguageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label className="call-language-picker"><span>Mood</span><select aria-label="Mira voice mood" value={activeVoiceId} onChange={(event) => { const next = event.target.value; const mode = companionVoiceMode(next); setActiveVoiceId(next); onVoiceChange?.(next); if (transport === "realtime") setCompanionLine(`${mode.name} delivery will start on your next call.`); else { setCompanionLine(`${mode.name} mood selected.`); speak(`Okay… I’ll sound ${mode.name.toLowerCase()} now.`, true, next); } }}>{companionVoiceModes.map((mode) => <option key={mode.id} value={mode.id}>{mode.name}</option>)}</select></label>
      </div>

      <button type="button" className="barge-in" onClick={phase === "speaking" ? interrupt : beginListening} disabled={muted || phase === "thinking"}>
        <Waveform aria-hidden="true" /> {phase === "speaking" ? "Speak now to interrupt" : phase === "thinking" ? "Thinking…" : phase === "listening" ? "Listening automatically" : "Start hands-free listening"}
      </button>

      <div className="live-call__controls">
        <button type="button" className={muted ? "call-orb call-orb--active" : "call-orb"} onClick={() => { const next = !muted; mutedRef.current = next; setMuted(next); if (next) stopRecognition(); realtimeRef.current?.peer.getSenders().forEach((sender) => { if (sender.track?.kind === "audio") sender.track.enabled = !next; }); if (!next) { changePhase("listening"); queueAutoListen(220); } }} aria-label={muted ? "Unmute microphone" : "Mute microphone"}>{muted ? <MicrophoneSlash aria-hidden="true" /> : <Microphone aria-hidden="true" />}</button>
        <button type="button" className={speaker ? "call-orb call-orb--active" : "call-orb"} onClick={toggleSpeaker} aria-label={speaker ? "Turn speaker off" : "Turn speaker on"}>{speaker ? <SpeakerHigh aria-hidden="true" /> : <SpeakerSlash aria-hidden="true" />}</button>
        <button type="button" className={captions ? "call-orb call-orb--active" : "call-orb"} onClick={() => setCaptions((value) => !value)} aria-label={captions ? "Hide captions" : "Show captions"}><ChatCircleDots aria-hidden="true" /></button>
        <button type="button" className={heartSent ? "call-orb call-orb--heart" : "call-orb"} onClick={() => { setHeartSent(true); window.setTimeout(() => setHeartSent(false), 1_500); }} aria-label="Send a heart reaction"><Heart aria-hidden="true" weight={heartSent ? "fill" : "regular"} /></button>
        <button type="button" className="call-orb call-orb--end" onClick={() => onClose(seconds)} aria-label="End call"><PhoneDisconnect aria-hidden="true" weight="fill" /></button>
      </div>
      <AnimatePresence>{heartSent ? <motion.div className="call-heart" initial={{ opacity: 0, scale: .5, y: 0 }} animate={{ opacity: 1, scale: 1.3, y: -90 }} exit={{ opacity: 0 }}><Heart weight="fill" /></motion.div> : null}</AnimatePresence>
      <small className="live-call__disclosure">Hands-free listening pauses while {companionName} speaks · Companaro does not save a call recording · {transport === "realtime" ? "secure multilingual audio connected" : transport === "connecting" ? "connecting…" : "English · हिन्दी · Hinglish"}</small>
    </motion.div>
  );
}
