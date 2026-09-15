"use client";
import { preloadVideoCall } from "@/lib/video-preload";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CaretDown,
  ChatCircleDots,
  GearSix,
  Heart,
  Lock,
  Microphone,
  SpeakerHigh,
  SpeakerSlash,
  Sparkle,
  VideoCamera,
} from "@phosphor-icons/react";
import type { DemoState, EnvironmentId } from "@/lib/state";
import { environmentForItem } from "@/lib/product-rules";

const environments: Array<{ id: EnvironmentId; label: string; image: string }> = [
  { id: "window-nook", label: "Sunny loft", image: "/assets/mira/loft-morning.png" },
  { id: "rainy-cafe", label: "Rainy café", image: "/assets/mira/rainy-cafe.png" },
  { id: "rooftop", label: "Sunset rooftop", image: "/assets/mira/rooftop-evening.png" },
];

const reactions = [
  "Hey—come look at this sketch with me.",
  "You caught me staring out the window again.",
  "Okay, now I’m curious. What’s that look for?",
  "Sit with me. You can give me the unedited version.",
];

export function HomeView({
  state,
  onChat,
  onCall,
  onVideoCall,
  onMoments,
  onMemory,
  onCompanion,
  onSpendTime,
  onEnvironmentChange,
  onAmbienceChange,
}: {
  state: DemoState;
  onChat: () => void;
  onCall: () => void;
  onVideoCall: () => void;
  onMoments: () => void;
  onMemory: () => void;
  onCompanion: () => void;
  onSpendTime: () => void;
  onEnvironmentChange: (environment: EnvironmentId) => void;
  onAmbienceChange: () => void;
}) {
  const [reactionIndex, setReactionIndex] = useState(-1);
  const [sceneMenuOpen, setSceneMenuOpen] = useState(false);
  const [mountedAt] = useState(() => new Date());
  const environment = environments.find((item) => item.id === state.activeEnvironment) ?? environments[0]!;
  const ownedEnvironments = new Set(state.ownedItems.flatMap((owned) => {
    const item = state.storeItems.find((candidate) => candidate.id === owned.itemId);
    const environmentId = item ? environmentForItem(item) : null;
    return environmentId ? [environmentId] : [];
  }));
  const recentMoment = [...state.moments].sort((left, right) => Date.parse(right.date) - Date.parse(left.date))[0];
  const highlightedMemory = state.memories.find((memory) => {
    if (memory.status !== "active" || !memory.pinned) return false;
    if (memory.type !== "episodic") return true;
    const content = memory.content.toLowerCase();
    return state.futureEvents.some((event) => event.status === "confirmed" && Date.parse(event.eventDate) >= mountedAt.getTime() && event.description.toLowerCase().split(/\s+/).some((word) => word.length > 3 && content.includes(word)));
  });
  const greeting = useMemo(() => {
    const now = mountedAt.getTime();
    const nearbyEvent = [...state.futureEvents]
      .filter((event) => event.status === "confirmed" && Math.abs(Date.parse(event.eventDate) - now) <= 12 * 60 * 60 * 1_000)
      .sort((left, right) => Math.abs(Date.parse(left.eventDate) - now) - Math.abs(Date.parse(right.eventDate) - now))[0];
    if (nearbyEvent) return `I remembered ${nearbyEvent.description}. We can keep today gentle.`;
    if (state.feedbackSignals.at(-1)?.rating === "down") return "No performance today. I can just keep you company.";
    const hour = mountedAt.getHours();
    if (hour < 6) return "Still awake? Come sit with me—no explanation needed yet.";
    if (hour < 12) return "I’m tweaking this sketch. Think it needs more sunlight?";
    if (hour < 18) return "I saved the good chair for you. How’s the real version of today?";
    return "I was about to make tea. Stay for the quiet part of the evening?";
  }, [mountedAt, state.feedbackSignals, state.futureEvents]);

  const react = () => {
    setReactionIndex((current) => (current + 1) % reactions.length);
    window.setTimeout(() => setReactionIndex(-1), 3_400);
  };

  return (
    <section className="mira-home" aria-labelledby="mira-home-title">
      <AnimatePresence mode="wait">
        <motion.img
          key={environment.id}
          className="mira-home__scene"
          src={environment.image}
          alt={`${state.companion.name} in the ${environment.label.toLowerCase()}`}
          initial={{ opacity: 0, scale: 1.025 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
        />
      </AnimatePresence>
      <div className="mira-home__wash" aria-hidden="true" />
      <button type="button" className="mira-home__avatar-hit" onClick={react} aria-label={`Get ${state.companion.name}'s attention`} />

      <header className="mira-home__top">
        <button type="button" className="mira-profile-chip" onClick={onCompanion} aria-label="Open companion profile">
          <img src="/assets/mira/portrait.png" alt="" />
          <span><strong id="mira-home-title">{state.companion.name}<em>AI companion</em></strong><small><i /> Feeling sunny · playful</small></span>
        </button>
        <div className="mira-home__top-actions">
          <button type="button" className="mira-level-chip" onClick={onMoments} aria-label="Open shared moments"><Heart weight="fill" /><span>{state.relationship.stage} · {state.relationship.level}</span></button>
          <button type="button" className="mira-icon-button" onClick={onCompanion} aria-label="Open companion settings"><GearSix /></button>
        </div>
      </header>

      <AnimatePresence mode="wait">
        <motion.button type="button" key={reactionIndex} className="mira-speech-bubble" onClick={react} initial={{ opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8 }}>
          {reactionIndex >= 0 ? reactions[reactionIndex] : greeting}
        </motion.button>
      </AnimatePresence>

      {highlightedMemory ? (
        <button type="button" className="mira-memory-cue" onClick={onMemory}>
          <Sparkle weight="fill" />
          <span><small>I remembered</small><strong>{highlightedMemory.content}</strong><em>Open memory</em></span>
        </button>
      ) : null}

      <div className="mira-home__scene-tools">
        <div className="scene-switcher">
          <button type="button" onClick={() => setSceneMenuOpen((value) => !value)} aria-expanded={sceneMenuOpen}>
            <Sparkle aria-hidden="true" /><span>{environment.label}</span><CaretDown aria-hidden="true" />
          </button>
          {sceneMenuOpen ? (
            <motion.div className="scene-switcher__menu" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              {environments.map((item) => (
                <button type="button" key={item.id} aria-current={state.activeEnvironment === item.id} onClick={() => { if (ownedEnvironments.has(item.id)) onEnvironmentChange(item.id); else onCompanion(); setSceneMenuOpen(false); }}>
                  <img src={item.image} alt="" />
                  <span>{item.label}{!ownedEnvironments.has(item.id) ? <small><Lock aria-hidden="true" /> Unlock in Companion</small> : null}</span>
                </button>
              ))}
            </motion.div>
          ) : null}
        </div>
        <button type="button" className="mira-icon-button" onClick={onAmbienceChange} aria-label={state.ambienceEnabled ? "Turn ambience off" : "Turn ambience on"}>
          {state.ambienceEnabled ? <SpeakerHigh weight="fill" /> : <SpeakerSlash />}
        </button>
      </div>

      <button type="button" className="mira-shared-moment" onClick={onSpendTime}>
        <Sparkle weight="fill" /><span><small>Something for us</small><strong>{recentMoment?.title ?? "Spend time together"}</strong></span>
      </button>

      <div className="mira-home__actions" aria-label="Start a conversation">
        <button type="button" className="mira-home-action" onClick={onChat}><ChatCircleDots /><span>Message</span></button>
        <motion.button type="button" className="mira-home-action mira-home-action--voice" onClick={onCall} whileTap={{ scale: 0.96 }} aria-label={`Start a voice call with ${state.companion.name}`}>
          <Microphone weight="fill" /><span>Talk</span>
        </motion.button>
        <button type="button" className="mira-home-action" onPointerEnter={preloadVideoCall} onFocus={preloadVideoCall} onPointerDown={preloadVideoCall} onClick={onVideoCall}><VideoCamera weight="fill" /><span>Video</span></button>
      </div>

      <small className="mira-home__disclosure">{state.companion.name} is an AI companion · You control memory and privacy</small>
    </section>
  );
}
