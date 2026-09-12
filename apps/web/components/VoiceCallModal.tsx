"use client";

import { useState } from "react";
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
import { useCompanionCall } from "./useCompanionCall";

export function VoiceCallModal({
  companionName,
  userName,
  onUserTurn,
  onClose,
}: {
  companionName: string;
  userName: string;
  onUserTurn: (content: string) => Promise<string>;
  onClose: (durationSeconds: number) => void;
}) {
  const { phase, userLine: heard, companionLine, error: speechError, muted, speaker, talkOver, seconds, call } = useCompanionCall(userName, onUserTurn);
  const [captions, setCaptions] = useState(true);
  const [heartSent, setHeartSent] = useState(false);
  const phaseCopy: Record<typeof phase, string> = {
    idle: muted ? "Microphone muted" : "Ready to listen",
    "opening-mic": "Opening microphone…",
    listening: "Listening to you",
    transcribing: "Understanding your words…",
    thinking: "Thinking about that",
    preparing: "Preparing Mira’s voice…",
    speaking: "Talking with you",
    error: "Call needs attention",
    closed: "Call ended",
  };
  const interrupt = () => call.current?.interrupt();
  const beginListening = () => call.current?.retry();
  const toggleSpeaker = () => call.current?.setSpeaker(!speaker);

  const time = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <motion.div className="live-call live-call--voice" role="dialog" aria-modal="true" aria-label={`Voice call with ${companionName}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <img className="live-call__backdrop" src="/assets/mira/loft-morning.png" alt="" />
      <div className="live-call__veil" />
      <header className="live-call__header"><span><i className="status-dot" /> {companionName} · Hinglish voice</span><strong>{companionName}</strong><time>{time}</time></header>
      <div className="voice-call__portrait">
        <motion.img src={phase === "speaking" ? "/assets/mira/portrait-speaking.png" : "/assets/mira/portrait.png"} alt={`${companionName}, your AI companion`} animate={phase === "speaking" ? { scale: [1, 1.012, 1], y: [0, -1, 0] } : { scale: 1, y: 0 }} transition={{ duration: 3.2, repeat: phase === "speaking" ? Infinity : 0 }} />
        <i className={phase === "speaking" ? "voice-call__ring voice-call__ring--active" : "voice-call__ring"} />
        <AnimatePresence mode="wait"><motion.span key={phase} initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{phaseCopy[phase]}</motion.span></AnimatePresence>
      </div>

      {captions ? <div className="call-conversation" aria-live="polite">{heard ? <p className="call-conversation__user"><span>You</span><strong>{heard}</strong></p> : null}<p><span>{companionName}</span><strong>{companionLine}</strong></p></div> : null}
      {speechError ? <p className="call-speech-error" role="status">{speechError}</p> : null}

      <div className="call-pickers">
        <div className="call-language-picker"><span>English · Hindi · Hinglish · Priya</span></div>
        <button type="button" className="call-language-picker" aria-pressed={talkOver} onClick={() => call.current?.setTalkOver(!talkOver)}>Talk-over · headphones beta · {talkOver ? "On" : "Off"}</button>
      </div>

      <button type="button" className="barge-in" onClick={phase === "speaking" || phase === "preparing" ? interrupt : beginListening} disabled={muted || ["thinking", "transcribing", "opening-mic"].includes(phase)}>
        <Waveform aria-hidden="true" /> {phase === "speaking" ? talkOver ? "Speak to interrupt · headphones" : "Tap to interrupt" : phase === "preparing" ? "Cancel voice & listen" : phase === "error" ? "Retry" : phase === "listening" ? "Listening automatically" : phaseCopy[phase]}
      </button>

      <div className="live-call__controls">
        <button type="button" className={muted ? "call-orb call-orb--active" : "call-orb"} onClick={() => call.current?.setMuted(!muted)} aria-label={muted ? "Unmute microphone" : "Mute microphone"}>{muted ? <MicrophoneSlash aria-hidden="true" /> : <Microphone aria-hidden="true" />}</button>
        <button type="button" className={speaker ? "call-orb call-orb--active" : "call-orb"} onClick={toggleSpeaker} aria-label={speaker ? "Turn speaker off" : "Turn speaker on"}>{speaker ? <SpeakerHigh aria-hidden="true" /> : <SpeakerSlash aria-hidden="true" />}</button>
        <button type="button" className={captions ? "call-orb call-orb--active" : "call-orb"} onClick={() => setCaptions((value) => !value)} aria-label={captions ? "Hide captions" : "Show captions"}><ChatCircleDots aria-hidden="true" /></button>
        <button type="button" className={heartSent ? "call-orb call-orb--heart" : "call-orb"} onClick={() => { setHeartSent(true); window.setTimeout(() => setHeartSent(false), 1_500); }} aria-label="Send a heart reaction"><Heart aria-hidden="true" weight={heartSent ? "fill" : "regular"} /></button>
        <button type="button" className="call-orb call-orb--end" onClick={() => { call.current?.close(); onClose(seconds); }} aria-label="End call"><PhoneDisconnect aria-hidden="true" weight="fill" /></button>
      </div>
      <AnimatePresence>{heartSent ? <motion.div className="call-heart" initial={{ opacity: 0, scale: .5, y: 0 }} animate={{ opacity: 1, scale: 1.3, y: -90 }} exit={{ opacity: 0 }}><Heart weight="fill" /></motion.div> : null}</AnimatePresence>
      <small className="live-call__disclosure">Hands-free listening resumes after every reply · voice input uses Inworld STT with browser and Cloudflare fallback · conversation replies use Cloudflare AI · speech uses Inworld Priya · talk-over is experimental and needs headphones · no call recording is saved</small>
    </motion.div>
  );
}
