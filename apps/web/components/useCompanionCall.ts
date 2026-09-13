"use client";
import { useEffect, useRef, useState } from "react";
import { CallSession, type CallSnapshot } from "@/lib/call-session";
import { startCallListening } from "@/lib/call-listening";
import { mouthPoseForText, playCompanionSpeech } from "@/lib/speech";
import { trackEvent } from "@/lib/analytics";
import type { TurnContext } from "@/lib/conversation-turn";

export function useCompanionCall(userName: string, onUserTurn: (text: string, context: TurnContext) => Promise<string>) {
  const greeting = `Hey ${userName}, you made it. What’s going on?`;
  const [state, setState] = useState<CallSnapshot>({ phase: "idle", companionLine: greeting, userLine: "", error: "", muted: false, speaker: true, talkOver: false });
  const [mouthPose, setMouthPose] = useState<0 | 1 | 2 | 3>(0);
  const [seconds, setSeconds] = useState(0);
  const call = useRef<CallSession | null>(null);
  const respond = useRef(onUserTurn);
  useEffect(() => { respond.current = onUserTurn; }, [onUserTurn]);
  useEffect(() => {
    let level = 0, expected: 0 | 1 | 2 | 3 = 0;
    const session = new CallSession({
      listen: startCallListening,
      speak: playCompanionSpeech,
      respond: (text, context) => respond.current(text, context),
      update: setState,
      onAudioLevel: value => { level = value; setMouthPose(level > .05 ? expected : 0); },
      onBoundary: ({charIndex}) => { expected = mouthPoseForText(session.state.companionLine, charIndex); setMouthPose(level > .05 ? expected : 0); },
      onTiming: (name, ms) => trackEvent(name, ms),
    }, greeting);
    call.current = session;
    const start = window.setTimeout(() => session.start(), 150);
    const timer = window.setInterval(() => setSeconds(value => value + 1), 1000);
    const visibility = () => { if (document.hidden) { session.setMuted(true); session.setSpeaker(false); } };
    document.addEventListener("visibilitychange", visibility);
    return () => { document.removeEventListener("visibilitychange", visibility); window.clearTimeout(start); window.clearInterval(timer); session.close(); if (call.current === session) call.current = null; };
  }, [greeting]);
  return { ...state, mouthPose, seconds, call };
}
