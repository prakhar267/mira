"use client";

import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  Coins,
  Gem,
  Lock,
  Palette,
  Play,
  SlidersHorizontal,
  Sparkles,
  Volume2,
} from "lucide-react";
import type { CompanionProfile, OwnedItemRecord, StoreItemRecord, SubscriptionState, WalletState } from "@companion/shared";
import { canAccessItem } from "@/lib/product-rules";
import { playCompanionSpeech, type CompanionSpeechPlayback } from "@/lib/speech";

const voices = [
  { id: "mira-warm-01", name: "Warm", detail: "Helena · caring and natural" },
  { id: "mira-playful-01", name: "Playful", detail: "Luna · friendly and expressive" },
  { id: "mira-calm-01", name: "Calm", detail: "Cora · smooth and gentle" },
  { id: "mira-confident-01", name: "Confident", detail: "Thalia · clear and energetic" },
];

export function CompanionView({ companion, backstory, storeItems, ownedItems, wallet, subscription, onChange, onBackstoryChange, onPurchase, onEquip, onUpgrade }: {
  companion: CompanionProfile;
  backstory: string;
  storeItems: StoreItemRecord[];
  ownedItems: OwnedItemRecord[];
  wallet: WalletState;
  subscription: SubscriptionState;
  onChange: (companion: CompanionProfile) => void;
  onBackstoryChange: (backstory: string) => void;
  onPurchase: (item: StoreItemRecord) => string | null | Promise<string | null>;
  onEquip: (item: StoreItemRecord) => void | Promise<void>;
  onUpgrade: () => void;
}) {
  const [tab, setTab] = useState<"appearance" | "personality" | "backstory" | "voice">("appearance");
  const [notice, setNotice] = useState("");
  const playbackRef = useRef<CompanionSpeechPlayback | null>(null);
  const equipped = ownedItems.find((item) => item.equipped && storeItems.find((candidate) => candidate.id === item.itemId)?.metadata.slot === "outfit");
  const preview = storeItems.find((item) => item.id === equipped?.itemId)?.assetUrl ?? "/assets/mira/loft-morning.png";

  useEffect(() => () => playbackRef.current?.cancel(), []);

  const previewVoice = (voice: typeof voices[number]) => {
    playbackRef.current?.cancel();
    playbackRef.current = playCompanionSpeech("Hey… nice to meet you. I was hoping you’d show up.", { voiceId: voice.id });
    setNotice(`Playing ${voice.detail}.`);
  };

  return (
    <section className="luma-workspace companion-view companion-studio" aria-labelledby="companion-title">
      <header className="luma-page-header">
        <div><span className="luma-kicker">Her look, voice, and energy</span><h1 id="companion-title">{companion.name}</h1><p>Change the styling without erasing the personality and shared history underneath it.</p></div>
        <div className="wallet-pill"><Coins aria-hidden="true" /><strong>{wallet.coins}</strong><Gem aria-hidden="true" /><strong>{wallet.gems}</strong></div>
      </header>

      <div className="luma-tabs companion-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "appearance"} onClick={() => setTab("appearance")}><Palette aria-hidden="true" /> Wardrobe & room</button>
        <button type="button" role="tab" aria-selected={tab === "personality"} onClick={() => setTab("personality")}><SlidersHorizontal aria-hidden="true" /> Personality</button>
        <button type="button" role="tab" aria-selected={tab === "backstory"} onClick={() => setTab("backstory")}><BookOpen aria-hidden="true" /> Backstory</button>
        <button type="button" role="tab" aria-selected={tab === "voice"} onClick={() => setTab("voice")}><Volume2 aria-hidden="true" /> Voice</button>
      </div>

      <div className="companion-editor">
        <div className="companion-preview">
          <img className="companion-preview__image" src={preview} alt={`${companion.name} appearance preview`} />
          <div className="companion-preview__label"><span><i className="status-dot" /> {companion.mood}</span><strong>{companion.name}</strong><small>{subscription.planId.toUpperCase()} · prototype avatar renderer</small></div>
        </div>

        <div className="companion-controls">
          {notice ? <p className="inline-notice" role="status">{notice}</p> : null}

          {tab === "appearance" ? <>
            <div className="section-heading"><div><span className="luma-kicker">Instant preview</span><h2>Wardrobe & places</h2><p>Outfits and scenes change the mood of time spent together.</p></div></div>
            <div className="catalog-grid">
              {storeItems.map((item) => {
                const owned = ownedItems.find((entry) => entry.itemId === item.id);
                return (
                  <article key={item.id} className={owned ? "catalog-item catalog-item--owned" : "catalog-item"}>
                    <img src={item.assetUrl} alt="" />
                    <div><span>{item.metadata.slot === "room" ? "Environment" : item.category}</span><strong>{item.name}</strong><small>{item.description}</small></div>
                    <footer><small className="catalog-price">{item.currency === "free" ? "Included" : `${item.price} ${item.currency}`}</small>{owned ? <button type="button" disabled={owned.equipped} onClick={() => { void Promise.resolve(onEquip(item)).then(() => setNotice(`${item.name} equipped.`)).catch((cause) => setNotice(cause instanceof Error ? cause.message : "That item could not be equipped.")); }}>{owned.equipped ? <><Check aria-hidden="true" /> Equipped</> : "Equip"}</button> : <button type="button" onClick={() => { void Promise.resolve(onPurchase(item)).then((message) => setNotice(message ?? `${item.name} added to your collection.`)).catch((cause) => setNotice(cause instanceof Error ? cause.message : "That item could not be purchased.")); }}>{!canAccessItem(subscription.planId, item) ? <Lock aria-hidden="true" /> : null} Buy</button>}</footer>
                  </article>
                );
              })}
            </div>
            <button type="button" className="luma-button store-upgrade" onClick={onUpgrade}><Sparkles aria-hidden="true" /> See plan benefits</button>
          </> : null}

          {tab === "personality" ? <>
            <div className="section-heading"><div><span className="luma-kicker">Stable, but yours</span><h2>Personality</h2><p>These traits shape how {companion.name} responds over time. One conversation never rewrites them.</p></div></div>
            <div className="trait-list">{(["warmth", "humor", "curiosity", "assertiveness", "optimism", "energy", "verbosity", "playfulness", "empathy"] as const).map((trait) => <label key={trait}><span><strong>{trait}</strong><small>{Math.round(companion.personality[trait] * 100)}%</small></span><input type="range" min="0" max="100" value={companion.personality[trait] * 100} onChange={(event) => onChange({ ...companion, personality: { ...companion.personality, [trait]: Number(event.target.value) / 100 } })} /></label>)}</div>
          </> : null}

          {tab === "backstory" ? <>
            <div className="section-heading"><div><span className="luma-kicker">A life beyond the prompt</span><h2>Backstory</h2><p>Give {companion.name} tastes, quirks, and a point of view. This shapes her voice without changing your memories.</p></div></div>
            <div className="backstory-editor">
              <label htmlFor="companion-backstory">Who is {companion.name}?</label>
              <textarea id="companion-backstory" value={backstory} maxLength={900} rows={10} onChange={(event) => onBackstoryChange(event.target.value)} placeholder={`${companion.name} loves late-night city lights, old films, and terrible jokes…`} />
              <footer><span>Write in third person. Avoid rules; describe a person.</span><strong>{backstory.length}/900</strong></footer>
            </div>
            <div className="backstory-notes"><strong>Used naturally</strong><p>Backstory influences tone and banter. It will not be repeated verbatim or treated as a memory about you.</p></div>
          </> : null}

          {tab === "voice" ? <>
            <div className="section-heading"><div><span className="luma-kicker">How she sounds</span><h2>Voice</h2><p>Natural neural voices for English, with हिन्दी and Hinglish support during calls.</p></div></div>
            <div className="voice-list">{voices.map((voice) => <button type="button" key={voice.id} className={companion.voiceId === voice.id ? "voice-option voice-option--selected" : "voice-option"} onClick={() => { onChange({ ...companion, voiceId: voice.id }); previewVoice(voice); }}><span><Play aria-hidden="true" /></span><strong>{voice.name}</strong><small>{voice.detail}</small><Volume2 aria-hidden="true" /></button>)}</div>
          </> : null}
        </div>
      </div>
    </section>
  );
}
