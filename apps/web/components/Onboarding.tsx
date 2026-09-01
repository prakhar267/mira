"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Bot, Check, ShieldCheck, Sparkles } from "lucide-react";
import type { DemoState } from "@/lib/state";
import { BrandMark } from "./BrandMark";

const intentions = ["Someone to talk to", "Friendship", "Personal growth", "Motivation", "Emotional support", "Relationship advice", "Fun conversations", "Explore AI"];
const interests = ["Technology", "Startups", "Movies", "Gaming", "Fitness", "Music", "Travel", "Relationships", "Books", "Career", "Sports", "Food", "Art", "Finance", "Science"];
const relationships = [
  { id: "friend", label: "Friend", description: "Warm, curious, and grounded." },
  { id: "mentor", label: "Mentor", description: "Encouraging, honest, and goal-aware." },
  { id: "sibling", label: "Sibling-like", description: "Familiar, playful, and supportive." },
  { id: "romantic", label: "Romantic partner", description: "Affectionate and adult-only, with healthy boundaries." },
  { id: "organic", label: "Let it develop", description: "Start neutral and adjust over time." },
] as const;

interface Draft {
  email: string;
  password: string;
  name: string;
  birthday: string;
  pronouns: DemoState["user"]["pronouns"];
  adultConfirmed: boolean;
  intentions: string[];
  interests: string[];
  companionName: string;
  companionPronouns: DemoState["companion"]["pronouns"];
  presentation: string;
  voiceId: string;
  relationshipMode: DemoState["companion"]["relationshipMode"];
  warmth: number;
  playfulness: number;
  energy: number;
  humor: number;
  expressiveness: number;
  affection: number;
  flirtiness: number;
  romance: number;
  sensuality: number;
}

const initialDraft: Draft = {
  email: "",
  password: "",
  name: "",
  birthday: "",
  pronouns: "she/her",
  adultConfirmed: false,
  intentions: [],
  interests: [],
  companionName: "Luma",
  companionPronouns: "she/her",
  presentation: "playful and warm",
  voiceId: "luma-playful-01",
  relationshipMode: "romantic",
  warmth: 88,
  playfulness: 58,
  energy: 55,
  humor: 54,
  expressiveness: 62,
  affection: 75,
  flirtiness: 65,
  romance: 62,
  sensuality: 20,
};

export function Onboarding({ onComplete }: { onComplete: (draft: Draft) => void | Promise<void> }) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(initialDraft);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const steps = 10;

  const isAdult = useMemo(() => {
    if (!draft.birthday) return false;
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 18);
    return new Date(`${draft.birthday}T00:00:00`) <= cutoff;
  }, [draft.birthday]);

  const next = async () => {
    setError("");
    if (step === 1 && (!draft.name.trim() || !/^\S+@\S+\.\S+$/.test(draft.email) || draft.password.length < 12)) return setError("Add your name, a valid email, and a password of at least 12 characters.");
    if (step === 2 && (!isAdult || !draft.adultConfirmed)) return setError("Luma is for adults 18+. Add your birthday and confirm eligibility.");
    if (step === 4 && draft.intentions.length === 0) return setError("Choose at least one reason for meeting Luma.");
    if (step === 5 && !draft.companionName.trim()) return setError("Give your companion a name.");
    if (step === 6 && draft.relationshipMode === "romantic" && (!isAdult || !draft.adultConfirmed)) return setError("Romantic mode requires confirmed adult eligibility.");
    if (step === 8 && draft.interests.length === 0) return setError("Choose at least one interest to begin with.");
    if (step === steps - 1) {
      setSubmitting(true);
      try { await onComplete(draft); } catch (cause) { setError(cause instanceof Error ? cause.message : "Account setup could not be completed."); } finally { setSubmitting(false); }
      return;
    }
    setStep((value) => Math.min(steps - 1, value + 1));
  };

  const toggle = (key: "intentions" | "interests", value: string) => {
    setDraft((current) => ({
      ...current,
      [key]: current[key].includes(value) ? current[key].filter((item) => item !== value) : [...current[key], value],
    }));
  };

  return (
    <main className="onboarding">
      <header className="onboarding__header">
        <BrandMark />
        <span>Private setup · about 2 minutes</span>
      </header>
      <div className="onboarding__progress" role="progressbar" aria-label="Setup progress" aria-valuemin={1} aria-valuemax={steps} aria-valuenow={step + 1}>
        <span style={{ width: `${((step + 1) / steps) * 100}%` }} />
      </div>

      <section className="onboarding__stage">
        <div className="onboarding__copy">
          <span className="eyebrow">Step {step + 1} of {steps}</span>
          {step === 0 && (
            <>
              <div className="onboarding__icon"><Sparkles aria-hidden="true" /></div>
              <h1>A companion that grows from what you choose to share.</h1>
              <p>Meet Luma, an AI companion designed to feel present through voice, expression, shared moments, and memories you can inspect or remove.</p>
              <div className="trust-note"><ShieldCheck aria-hidden="true" /><span>Clearly AI. Adults 18+. Not therapy or emergency care.</span></div>
            </>
          )}

          {step === 1 && (
            <>
              <span className="eyebrow">About you</span>
              <h1>What should Luma call you?</h1>
              <p>Your email signs you in securely. Your name stays editable in your profile.</p>
              <label className="field">First name<input autoFocus maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Your first name" /></label>
              <label className="field">Email<input type="email" autoComplete="email" maxLength={200} value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} placeholder="you@example.com" /></label>
              <label className="field">Password<input type="password" autoComplete="new-password" minLength={12} maxLength={200} value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} placeholder="At least 12 characters" /></label>
            </>
          )}

          {step === 2 && (
            <>
              <span className="eyebrow">Adults only</span>
              <h1>Confirm you’re 18 or older.</h1>
              <p>Your birthday supports eligibility and age-appropriate features. A production launch will require stronger age assurance.</p>
              <label className="field">Birthday<input type="text" inputMode="numeric" pattern="\d{4}-\d{2}-\d{2}" placeholder="YYYY-MM-DD" value={draft.birthday} onChange={(event) => setDraft({ ...draft, birthday: event.target.value })} /></label>
              <label className="check-line"><input type="checkbox" checked={draft.adultConfirmed} onChange={(event) => setDraft({ ...draft, adultConfirmed: event.target.checked })} /><span>I confirm I am 18 or older.</span></label>
            </>
          )}

          {step === 3 && (
            <>
              <span className="eyebrow">How we address you</span>
              <h1>What pronouns should Luma use?</h1>
              <p>You can change this at any time in your profile.</p>
              <label className="field">Your pronouns<select value={draft.pronouns} onChange={(event) => setDraft({ ...draft, pronouns: event.target.value as Draft["pronouns"] })}><option>she/her</option><option>he/him</option><option>they/them</option></select></label>
            </>
          )}

          {step === 4 && (
            <>
              <span className="eyebrow">Your intention</span>
              <h1>What are you looking for?</h1>
              <p>Choose as many as fit. Luma supports—never replaces—your real relationships or professional care.</p>
              <div className="choice-grid">
                {intentions.map((item) => <button type="button" key={item} className={draft.intentions.includes(item) ? "choice choice--selected" : "choice"} onClick={() => toggle("intentions", item)}>{draft.intentions.includes(item) ? <Check aria-hidden="true" /> : null}{item}</button>)}
              </div>
            </>
          )}

          {step === 5 && (
            <>
              <span className="eyebrow">Create your companion</span>
              <h1>Make the introduction yours.</h1>
              <div className="companion-pick">
                <img src="/assets/luma/portrait.png" alt="Luma, an original AI companion avatar" />
                <span><strong>Playful & warm</strong><small>Original prototype avatar</small></span>
              </div>
              <label className="field">Companion name<input maxLength={40} value={draft.companionName} onChange={(event) => setDraft({ ...draft, companionName: event.target.value })} /></label>
              <label className="field">Companion pronouns<select value={draft.companionPronouns} onChange={(event) => setDraft({ ...draft, companionPronouns: event.target.value as Draft["companionPronouns"] })}><option>she/her</option><option>he/him</option><option>they/them</option></select></label>
              <div className="form-grid"><label className="field">Presentation<select value={draft.presentation} onChange={(event) => setDraft({ ...draft, presentation: event.target.value })}><option value="playful and warm">Playful & warm</option><option value="bright and expressive">Bright & expressive</option><option value="calm and thoughtful">Calm & thoughtful</option></select></label><label className="field">Voice<select value={draft.voiceId} onChange={(event) => setDraft({ ...draft, voiceId: event.target.value })}><option value="luma-playful-01">Luma · Playful</option><option value="luma-warm-01">Luma · Warm</option><option value="luma-calm-01">Luma · Calm</option></select></label></div>
            </>
          )}

          {step === 6 && (
            <>
              <span className="eyebrow">Relationship style</span>
              <h1>Choose a starting shape.</h1>
              <div className="relationship-grid">
                {relationships.map((item) => <button type="button" key={item.id} className={draft.relationshipMode === item.id ? "relationship relationship--selected" : "relationship"} onClick={() => setDraft({ ...draft, relationshipMode: item.id })}><strong>{item.label}</strong><span>{item.description}</span></button>)}
              </div>
              {draft.relationshipMode === "romantic" ? <div className="trust-note"><ShieldCheck aria-hidden="true" /><span>Romantic mode is for confirmed adults and never discourages real-world relationships.</span></div> : null}
            </>
          )}

          {step === 7 && (
            <>
              <span className="eyebrow">Personality setup</span>
              <h1>Choose a starting energy.</h1>
              <div className="slider-stack">
                <label>Warm <input type="range" min="0" max="100" value={draft.warmth} onChange={(event) => setDraft({ ...draft, warmth: Number(event.target.value) })} /> Playful</label>
                <label>Calm <input type="range" min="0" max="100" value={draft.energy} onChange={(event) => setDraft({ ...draft, energy: Number(event.target.value) })} /> Energetic</label>
                <label>Thoughtful <input type="range" min="0" max="100" value={draft.playfulness} onChange={(event) => setDraft({ ...draft, playfulness: Number(event.target.value) })} /> Spontaneous</label>
                <label>Serious <input type="range" min="0" max="100" value={draft.humor} onChange={(event) => setDraft({ ...draft, humor: Number(event.target.value) })} /> Humorous</label>
                <label>Reserved <input type="range" min="0" max="100" value={draft.expressiveness} onChange={(event) => setDraft({ ...draft, expressiveness: Number(event.target.value) })} /> Expressive</label>
                <label>Low affection <input type="range" min="0" max="100" value={draft.affection} onChange={(event) => setDraft({ ...draft, affection: Number(event.target.value) })} /> Very affectionate</label>
                <label>Not flirty <input type="range" min="0" max="100" value={draft.flirtiness} onChange={(event) => setDraft({ ...draft, flirtiness: Number(event.target.value) })} /> Very flirty</label>
                <label>Friendly <input type="range" min="0" max="100" value={draft.romance} onChange={(event) => setDraft({ ...draft, romance: Number(event.target.value) })} /> Romantic</label>
              </div>
              {draft.relationshipMode === "romantic" ? <label className="check-line"><input type="checkbox" checked={draft.sensuality > 0} onChange={(event) => setDraft({ ...draft, sensuality: event.target.checked ? 20 : 0 })} /><span>I’m an adult and explicitly opt into a lightly sensual/flirty tone. This never overrides safety or boundaries.</span></label> : null}
            </>
          )}

          {step === 8 && (
            <>
              <span className="eyebrow">A few starting points</span>
              <h1>What could you talk about for hours?</h1>
              <p>These are conversation seeds—not ad targeting. You can remove them later.</p>
              <div className="choice-grid choice-grid--compact">
                {interests.map((item) => <button type="button" key={item} className={draft.interests.includes(item) ? "choice choice--selected" : "choice"} onClick={() => toggle("interests", item)}>{draft.interests.includes(item) ? <Check aria-hidden="true" /> : null}{item}</button>)}
              </div>
            </>
          )}

          {step === 9 && (
            <>
              <span className="eyebrow">First conversation</span>
              <h1>{draft.companionName || "Luma"} is ready to meet you.</h1>
              <p>Your companion will begin with your chosen relationship style, interests, voice, and personality—without inventing facts about your life.</p>
              <div className="ready-note"><Bot aria-hidden="true" /><span><strong>“Hi {draft.name.trim() || "there"}. I’m {draft.companionName || "Luma"}.”</strong> I feel like I should know one thing about you before we start.</span></div>
              <div className="trust-note"><ShieldCheck aria-hidden="true" /><span>Memory stays inspectable. You can export or delete everything from Settings.</span></div>
            </>
          )}

          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="onboarding__actions">
            {step > 0 ? <button type="button" className="button button--ghost" onClick={() => { setError(""); setStep((value) => value - 1); }}><ArrowLeft aria-hidden="true" /> Back</button> : <span />}
            <button type="button" className="button button--primary" disabled={submitting} onClick={() => void next()}>{submitting ? "Creating your space…" : step === steps - 1 ? "Meet your companion" : step === 0 ? "Begin setup" : "Continue"}<ArrowRight aria-hidden="true" /></button>
          </div>
        </div>
        <aside className="onboarding__visual" aria-label="Preview of Luma in the companion room">
          <img src="/assets/luma/window-nook.png" alt="Luma sitting in a moonlit window nook" />
          <div className="onboarding__visual-card"><span>Memory is off until you choose it</span><strong>You stay in control</strong></div>
        </aside>
      </section>
    </main>
  );
}

export type { Draft as OnboardingDraft };
