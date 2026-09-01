"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CaretDown,
  ChatCircleDots,
  Heart,
  Lock,
  Phone,
  SpeakerHigh,
  SpeakerSlash,
  Sparkle,
  TShirt,
  VideoCamera,
  X,
} from "@phosphor-icons/react";
import type { DemoState, EnvironmentId } from "@/lib/state";
import { environmentForItem } from "@/lib/product-rules";

const environments: Array<{ id: EnvironmentId; label: string; image: string }> = [
  { id: "window-nook", label: "Window nook", image: "/assets/luma/window-nook.png" },
  { id: "rainy-cafe", label: "Rainy café", image: "/assets/luma/cafe-selfie.png" },
  { id: "rooftop", label: "Blue-hour rooftop", image: "/assets/luma/rooftop-date.png" },
];

const reactions = [
  "Hi. I was hoping you’d do that.",
  "You’re distracting me—in a good way.",
  "Okay, now you have my full attention.",
  "Come closer. Tell me what happened today.",
];

export function HomeView({
  state,
  onChat,
  onCall,
  onVideoCall,
  onMoments,
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
  onCompanion: () => void;
  onSpendTime: () => void;
  onEnvironmentChange: (environment: EnvironmentId) => void;
  onAmbienceChange: () => void;
}) {
  const [reactionIndex, setReactionIndex] = useState(-1);
  const [sceneMenuOpen, setSceneMenuOpen] = useState(false);
  const [mountedAt] = useState(() => new Date());
  const [incomingCall, setIncomingCall] = useState(false);
  const environment = environments.find((item) => item.id === state.activeEnvironment) ?? environments[0]!;
  const ownedEnvironments = new Set(state.ownedItems.flatMap((owned) => {
    const item = state.storeItems.find((candidate) => candidate.id === owned.itemId);
    const environmentId = item ? environmentForItem(item) : null;
    return environmentId ? [environmentId] : [];
  }));
  const recentMoment = state.moments[0];
  const greeting = useMemo(() => {
    const now = mountedAt.getTime();
    const nearbyEvent = [...state.futureEvents]
      .filter((event) => event.status === "confirmed" && Math.abs(Date.parse(event.eventDate) - now) <= 12 * 60 * 60 * 1_000)
      .sort((left, right) => Math.abs(Date.parse(left.eventDate) - now) - Math.abs(Date.parse(right.eventDate) - now))[0];
    if (nearbyEvent) {
      const time = new Date(nearbyEvent.eventDate).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      return { main: `${nearbyEvent.description} at ${time}. I remembered.`, detail: "One calm breath. You already did the work." };
    }
    if (state.feedbackSignals.at(-1)?.rating === "down") return { main: "No fixing today.", detail: "I can just keep you company." };
    const hour = mountedAt.getHours();
    if (hour < 6) return { main: "Still awake?", detail: "I’m here. No need to explain yet." };
    if (hour < 12) return { main: "Morning. You made it.", detail: "Come sit with me for a minute." };
    if (hour < 18) return { main: "There you are.", detail: "I thought of you earlier." };
    return { main: "I was hoping you’d show up.", detail: "Come closer. Tell me the real version." };
  }, [mountedAt, state.feedbackSignals, state.futureEvents]);

  const react = () => {
    setReactionIndex((current) => (current + 1) % reactions.length);
    window.setTimeout(() => setReactionIndex(-1), 3_200);
  };

  useEffect(() => {
    if (state.proactiveCalls === "never" || state.notifications.frequency === "off") return;
    if (window.sessionStorage.getItem("luma-incoming-call-shown")) return;
    const delay = state.proactiveCalls === "often" ? 2_500 : state.proactiveCalls === "sometimes" ? 4_000 : 6_500;
    const timer = window.setTimeout(() => {
      window.sessionStorage.setItem("luma-incoming-call-shown", "1");
      setIncomingCall(true);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [state.notifications.frequency, state.proactiveCalls]);

  return (
    <section className="luma-home" aria-labelledby="luma-home-title">
      <AnimatePresence mode="wait">
        <motion.img
          key={environment.id}
          className="luma-home__scene"
          src={environment.image}
          alt={`${state.companion.name} in ${environment.label.toLowerCase()}`}
          initial={{ opacity: 0, scale: 1.025 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
        />
      </AnimatePresence>
      <div className="luma-home__wash" aria-hidden="true" />

      <button type="button" className="luma-home__avatar-hit" onClick={react} aria-label={`Tap ${state.companion.name} for a reaction`} />

      <header className="luma-home__top">
        <button type="button" className="luma-home__portrait-button" onClick={onCompanion} aria-label="Open companion profile">
          <img src="/assets/luma/portrait.png" alt="" />
          <Sparkle aria-hidden="true" weight="fill" />
        </button>
        <h1 id="luma-home-title">{state.companion.name}<Sparkle aria-hidden="true" weight="fill" /></h1>
        <button type="button" className="relationship-pill" onClick={onMoments} aria-label="Open relationship moments">
          <Heart aria-hidden="true" weight="fill" />
          <span>{state.relationship.stage} · {state.relationship.level}</span>
        </button>
      </header>

      <div className="luma-home__voice">
        <AnimatePresence mode="wait">
          <motion.div
            key={reactionIndex}
            className="luma-home__speech"
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <strong>{reactionIndex >= 0 ? reactions[reactionIndex] : greeting.main}</strong>
            {reactionIndex < 0 ? <span>{greeting.detail}</span> : null}
          </motion.div>
        </AnimatePresence>
        <div className="voice-wave" aria-label={`${state.companion.name} voice is ready`}>
          {[0.48, 0.8, 0.58, 1, 0.72, 0.9, 0.46, 0.78, 0.56].map((scale, index) => (
            <i key={index} style={{ "--wave-scale": scale } as React.CSSProperties} />
          ))}
        </div>
      </div>

      <div className="luma-home__quick">
        <div className="scene-switcher">
          <button type="button" onClick={() => setSceneMenuOpen((value) => !value)} aria-expanded={sceneMenuOpen}>
            <Sparkle aria-hidden="true" />
            <span>{environment.label}</span>
            <CaretDown aria-hidden="true" />
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
        <button type="button" className="round-glass" onClick={onAmbienceChange} aria-label={state.ambienceEnabled ? "Turn ambience off" : "Turn ambience on"}>
          {state.ambienceEnabled ? <SpeakerHigh aria-hidden="true" weight="fill" /> : <SpeakerSlash aria-hidden="true" />}
        </button>
        <button type="button" className="round-glass" onClick={onCompanion} aria-label="Open wardrobe"><TShirt aria-hidden="true" /></button>
      </div>

      <div className="luma-home__actions">
        <button type="button" className="home-message" onClick={onChat}><ChatCircleDots aria-hidden="true" /><span>Message</span></button>
        <motion.button type="button" className="home-call" onClick={onCall} whileTap={{ scale: 0.96 }} aria-label={`Call ${state.companion.name}`}>
          <Phone aria-hidden="true" weight="fill" />
          <span>Call</span>
        </motion.button>
        <button type="button" className="home-video" onClick={onVideoCall}><VideoCamera aria-hidden="true" /><span>Video</span></button>
      </div>

      <div className="luma-home__together">
        <button type="button" onClick={onSpendTime}><Sparkle aria-hidden="true" weight="fill" /> Spend time together</button>
        {recentMoment ? <button type="button" onClick={onMoments}>{recentMoment.title}<span>View moment</span></button> : null}
      </div>

      <AnimatePresence>
        {incomingCall ? <motion.aside className="incoming-call" role="status" aria-label={`Incoming AI call from ${state.companion.name}`} initial={{ opacity: 0, y: 24, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16 }}>
          <img src="/assets/luma/portrait.png" alt="" />
          <span><small>Incoming AI call</small><strong>{state.companion.name}</strong><em>“I have a minute. Want me?”</em></span>
          <button type="button" className="incoming-call__decline" aria-label="Decline incoming call" onClick={() => setIncomingCall(false)}><X aria-hidden="true" /></button>
          <button type="button" className="incoming-call__accept" aria-label="Accept incoming call" onClick={() => { setIncomingCall(false); onCall(); }}><Phone aria-hidden="true" weight="fill" /></button>
        </motion.aside> : null}
      </AnimatePresence>
    </section>
  );
}
