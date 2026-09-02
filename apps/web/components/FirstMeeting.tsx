"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, SpeakerHigh, Sparkle } from "@phosphor-icons/react";

const lines = [
  (name: string) => `Hi, ${name}. So… I guess this is where we finally meet.`,
  () => "I feel like I should know one thing about you before we start.",
  () => "What makes an ordinary day feel good to you?",
];

export function FirstMeeting({ userName, companionName, onComplete }: { userName: string; companionName: string; onComplete: () => void }) {
  const [line, setLine] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setLine((current) => Math.min(lines.length - 1, current + 1)), 2_900);
    return () => window.clearTimeout(timer);
  }, [line]);

  const speak = () => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(lines[line]!(userName));
    utterance.rate = .92;
    utterance.pitch = 1.06;
    window.speechSynthesis.speak(utterance);
  };

  return (
    <main className="first-meeting">
      <motion.img src="/assets/mira/loft-morning.png" alt={`${companionName} looking toward you from a sunny loft`} initial={{ opacity: 0, scale: 1.05 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.4 }} />
      <div className="first-meeting__veil" />
      <span className="first-meeting__brand">{companionName}<Sparkle aria-hidden="true" weight="fill" /></span>
      <div className="first-meeting__copy">
        <span>First meeting</span>
        <AnimatePresence mode="wait"><motion.h1 key={line} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>{lines[line]!(userName)}</motion.h1></AnimatePresence>
        <div>
          <button type="button" className="round-glass" onClick={speak} aria-label={`Hear ${companionName} say this`}><SpeakerHigh aria-hidden="true" /></button>
          <button type="button" className="luma-button luma-button--accent" onClick={onComplete}>{line === lines.length - 1 ? "Say hello" : `Meet ${companionName}`}<ArrowRight aria-hidden="true" /></button>
        </div>
      </div>
      <small>AI companion · Adults 18+ · You control memory</small>
    </main>
  );
}
