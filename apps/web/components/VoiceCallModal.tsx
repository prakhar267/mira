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
  speechLanguageOptions,
  type CompanionSpeechPlayback,
  type SpeechLanguage,
} from "@/lib/speech";
import { companionVoiceMode, companionVoiceModes } from "@/lib/voice-profiles";
import { startVoiceActivityMonitor } from "@/lib/voice-activity";
import { startCallListening, type CallListeningSession } from "@/lib/call-listening";

type CallPhase = "connecting" | "listening" | "thinking" | "speaking" | "interrupted";

export function VoiceCallModal({
  companionName,
  userName,
  voiceId,
  onUserTurn,
  onVoiceChange,
  onClose,
}: {
  companionName: string;
  userName: string;
  voiceId: string;
  onUserTurn: (content: string) => Promise<string>;
  onVoiceChange?: (voiceId: string) => void;
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
  const [language, setLanguage] = useState<SpeechLanguage>("auto");
  const [activeVoiceId, setActiveVoiceId] = useState(voiceId);
  const [bargeInReady, setBargeInReady] = useState(false);
  const recognitionRef = useRef<CallListeningSession | null>(null);
  const greetingSpoken = useRef(false);
  const speechTurn = useRef(0);
  const playbackRef = useRef<CompanionSpeechPlayback | null>(null);
  const listenTimerRef = useRef<number | null>(null);
  const startListeningRef = useRef<() => void>(() => undefined);
  const mutedRef = useRef(false);
  const activeRef = useRef(true);
  const phaseRef = useRef<CallPhase>("connecting");
  const listeningAttemptRef = useRef(0);
  const interruptRef = useRef<() => void>(() => undefined);

  useEffect(() => { setActiveVoiceId(companionVoiceMode(voiceId).id); }, [voiceId]);

  const changePhase = useCallback((next: CallPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const stopRecognition = useCallback(() => {
    listeningAttemptRef.current += 1;
    const recognition = recognitionRef.current;
    if (!recognition) return;
    recognitionRef.current = null;
    recognition.cancel();
  }, []);

  const queueAutoListen = useCallback((delay = 650) => {
    if (listenTimerRef.current) window.clearTimeout(listenTimerRef.current);
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
  }, []);

  const speak = useCallback((text: string, force = false, selectedVoiceId = activeVoiceId) => {
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
      onError: (message) => setSpeechError(message),
    });
  }, [activeVoiceId, changePhase, language, queueAutoListen, speaker, stopRecognition]);

  useEffect(() => {
    activeRef.current = true;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1_000);
    return () => {
      activeRef.current = false;
      window.clearInterval(timer);
      stopRecognition();
      playbackRef.current?.cancel();
      if (listenTimerRef.current) window.clearTimeout(listenTimerRef.current);
    };
  }, [stopRecognition]);

  useEffect(() => {
    let disposed = false;
    let monitor: Awaited<ReturnType<typeof startVoiceActivityMonitor>> | null = null;
    void startVoiceActivityMonitor({
      shouldDetect: () => activeRef.current && !mutedRef.current && phaseRef.current === "speaking",
      onSpeech: () => interruptRef.current(),
    }).then((created) => {
      if (disposed) created.stop();
      else {
        monitor = created;
        setBargeInReady(true);
      }
    }).catch(() => setBargeInReady(false));
    return () => {
      disposed = true;
      monitor?.stop();
      setBargeInReady(false);
    };
  }, []);

  useEffect(() => {
    const speakingFrame = new Image();
    speakingFrame.src = "/assets/mira/portrait-speaking.png";
  }, []);

  useEffect(() => {
    if (greetingSpoken.current) return;
    const connect = window.setTimeout(() => {
      if (greetingSpoken.current) return;
      greetingSpoken.current = true;
      speak(greeting);
    }, 650);
    return () => window.clearTimeout(connect);
  }, [greeting, speak]);

  const submitTurn = useCallback(async (content: string) => {
    const clean = content.trim();
    if (!clean || phaseRef.current === "thinking") return;
    setHeard(clean);
    setSpeechError("");
    changePhase("thinking");
    try {
      const reply = await onUserTurn(clean);
      setCompanionLine(reply);
      speak(reply);
    } catch {
      const fallback = "I lost the reply for a second. Try that once more?";
      setCompanionLine(fallback);
      speak(fallback);
    }
  }, [changePhase, onUserTurn, speak]);

  const beginListening = useCallback(() => {
    if (listenTimerRef.current) {
      window.clearTimeout(listenTimerRef.current);
      listenTimerRef.current = null;
    }
    if (mutedRef.current || phaseRef.current === "thinking" || phaseRef.current === "speaking") return;
    if (recognitionRef.current) { changePhase("listening"); return; }
    const attempt = listeningAttemptRef.current + 1;
    listeningAttemptRef.current = attempt;
    setHeard("");
    setSpeechError("");
    changePhase("listening");
    void startCallListening({
      language,
      onSpeechStart: () => { if (listeningAttemptRef.current === attempt) setHeard("Hearing you…"); },
      onTranscript: (transcript) => {
        if (listeningAttemptRef.current !== attempt || !activeRef.current) return;
        recognitionRef.current = null;
        void submitTurn(transcript);
      },
      onSilence: () => {
        if (listeningAttemptRef.current !== attempt || !activeRef.current) return;
        recognitionRef.current = null;
        setHeard("");
        queueAutoListen(250);
      },
      onError: (message) => {
        if (listeningAttemptRef.current !== attempt || !activeRef.current) return;
        recognitionRef.current = null;
        setHeard("");
        setSpeechError(message);
        changePhase("listening");
        queueAutoListen(900);
      },
    }).then((session) => {
      if (listeningAttemptRef.current !== attempt || !activeRef.current) session.cancel();
      else recognitionRef.current = session;
    }).catch((cause) => {
      if (listeningAttemptRef.current !== attempt || !activeRef.current) return;
      recognitionRef.current = null;
      setSpeechError(cause instanceof Error ? cause.message : "Microphone access is unavailable.");
      changePhase("listening");
    });
  }, [changePhase, language, queueAutoListen, submitTurn]);
  useEffect(() => { startListeningRef.current = beginListening; }, [beginListening]);

  const interrupt = useCallback(() => {
    if (muted) return;
    speechTurn.current += 1;
    changePhase("interrupted");
    playbackRef.current?.cancel();
    window.setTimeout(beginListening, 180);
  }, [beginListening, changePhase, muted]);
  useEffect(() => { interruptRef.current = interrupt; }, [interrupt]);

  const toggleSpeaker = () => {
    if (speaker) {
      playbackRef.current?.cancel();
      setSpeaker(false);
      changePhase("listening");
    } else {
      setSpeaker(true);
      window.setTimeout(() => speak(companionLine, true), 0);
    }
  };

  const time = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const phaseCopy: Record<CallPhase, string> = {
    connecting: "Preparing private voice…",
    listening: "Listening to you",
    thinking: "Thinking about that",
    speaking: "Talking with you",
    interrupted: "Stopped · listening",
  };

  return (
    <motion.div className="live-call live-call--voice" role="dialog" aria-modal="true" aria-label={`Voice call with ${companionName}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <img className="live-call__backdrop" src="/assets/mira/loft-morning.png" alt="" />
      <div className="live-call__veil" />
      <header className="live-call__header"><span><i className="status-dot" /> {companionName} · multilingual neural voice</span><strong>{companionName}</strong><time>{time}</time></header>
      <div className="voice-call__portrait">
        <motion.img src={phase === "speaking" ? "/assets/mira/portrait-speaking.png" : "/assets/mira/portrait.png"} alt={`${companionName}, your AI companion`} animate={phase === "speaking" ? { scale: [1, 1.012, 1], y: [0, -1, 0] } : { scale: 1, y: 0 }} transition={{ duration: 3.2, repeat: phase === "speaking" ? Infinity : 0 }} />
        <i className={phase === "speaking" ? "voice-call__ring voice-call__ring--active" : "voice-call__ring"} />
        <AnimatePresence mode="wait"><motion.span key={phase} initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{phaseCopy[phase]}</motion.span></AnimatePresence>
      </div>

      {captions ? <div className="call-conversation" aria-live="polite">{heard ? <p className="call-conversation__user"><span>You</span><strong>{heard}</strong></p> : null}<p><span>{companionName}</span><strong>{companionLine}</strong></p></div> : null}
      {speechError ? <p className="call-speech-error" role="status">{speechError}</p> : null}

      <div className="call-pickers">
        <label className="call-language-picker"><span>Language</span><select aria-label="Voice call language" value={language} onChange={(event) => { stopRecognition(); playbackRef.current?.cancel(); changePhase("listening"); setLanguage(event.target.value as SpeechLanguage); queueAutoListen(); }}>{speechLanguageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label className="call-language-picker"><span>Mood</span><select aria-label="Mira voice mood" value={activeVoiceId} onChange={(event) => { const next = event.target.value; const mode = companionVoiceMode(next); setActiveVoiceId(next); onVoiceChange?.(next); setCompanionLine(`${mode.name} mood selected.`); speak(`Okay… I’ll sound ${mode.name.toLowerCase()} now.`, true, next); }}>{companionVoiceModes.map((mode) => <option key={mode.id} value={mode.id}>{mode.name}</option>)}</select></label>
      </div>

      <button type="button" className="barge-in" onClick={phase === "speaking" ? interrupt : beginListening} disabled={muted || phase === "thinking" || phase === "connecting"}>
        <Waveform aria-hidden="true" /> {phase === "speaking" ? bargeInReady ? "Just speak · auto-interrupt is on" : "Speak now to interrupt" : phase === "thinking" ? "Thinking…" : phase === "connecting" ? "Preparing voice…" : phase === "listening" ? "Listening automatically" : "Start hands-free listening"}
      </button>

      <div className="live-call__controls">
        <button type="button" className={muted ? "call-orb call-orb--active" : "call-orb"} onClick={() => { const next = !muted; mutedRef.current = next; setMuted(next); if (next) stopRecognition(); if (!next) { changePhase("listening"); queueAutoListen(220); } }} aria-label={muted ? "Unmute microphone" : "Mute microphone"}>{muted ? <MicrophoneSlash aria-hidden="true" /> : <Microphone aria-hidden="true" />}</button>
        <button type="button" className={speaker ? "call-orb call-orb--active" : "call-orb"} onClick={toggleSpeaker} aria-label={speaker ? "Turn speaker off" : "Turn speaker on"}>{speaker ? <SpeakerHigh aria-hidden="true" /> : <SpeakerSlash aria-hidden="true" />}</button>
        <button type="button" className={captions ? "call-orb call-orb--active" : "call-orb"} onClick={() => setCaptions((value) => !value)} aria-label={captions ? "Hide captions" : "Show captions"}><ChatCircleDots aria-hidden="true" /></button>
        <button type="button" className={heartSent ? "call-orb call-orb--heart" : "call-orb"} onClick={() => { setHeartSent(true); window.setTimeout(() => setHeartSent(false), 1_500); }} aria-label="Send a heart reaction"><Heart aria-hidden="true" weight={heartSent ? "fill" : "regular"} /></button>
        <button type="button" className="call-orb call-orb--end" onClick={() => onClose(seconds)} aria-label="End call"><PhoneDisconnect aria-hidden="true" weight="fill" /></button>
      </div>
      <AnimatePresence>{heartSent ? <motion.div className="call-heart" initial={{ opacity: 0, scale: .5, y: 0 }} animate={{ opacity: 1, scale: 1.3, y: -90 }} exit={{ opacity: 0 }}><Heart weight="fill" /></motion.div> : null}</AnimatePresence>
      <small className="live-call__disclosure">{bargeInReady ? "Automatic interruption is on" : "Hands-free listening resumes after speech"} · private voice model downloads once, then stays cached · language automatically follows English, हिन्दी and Hinglish · no browser/system voice · Companaro does not save a call recording</small>
    </motion.div>
  );
}
