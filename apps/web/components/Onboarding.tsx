"use client";

import { useEffect, useMemo, useState } from "react";
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
  policyAccepted: boolean;
  aiProcessingConsent: boolean;
  conversationStorageEnabled: boolean;
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
  memoryEnabled: boolean;
}

const initialDraft: Draft = {
  email: "",
  password: "",
  name: "",
  birthday: "",
  pronouns: "she/her",
  adultConfirmed: false,
  policyAccepted: false,
  aiProcessingConsent: false,
  conversationStorageEnabled: true,
  intentions: [],
  interests: [],
  companionName: "Mira",
  companionPronouns: "she/her",
  presentation: "playful and warm",
  voiceId: "mira-natural-01",
  relationshipMode: "organic",
  warmth: 88,
  playfulness: 58,
  energy: 55,
  humor: 54,
  expressiveness: 62,
  affection: 75,
  flirtiness: 20,
  romance: 10,
  sensuality: 0,
  memoryEnabled: false,
};

export function Onboarding({ onComplete }: { onComplete: (draft: Draft) => void | Promise<void> }) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(initialDraft);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const steps = 10;

  useEffect(() => {
    setError("");
  }, [draft]);

  const isAdult = useMemo(() => {
    if (!draft.birthday) return false;
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 18);
    return new Date(`${draft.birthday}T00:00:00`) <= cutoff;
  }, [draft.birthday]);

  const next = async () => {
    setError("");
    if (step === 1 && (!draft.name.trim() || !/^\S+@\S+\.\S+$/.test(draft.email) || draft.password.length < 12)) return setError("Add your name, a valid email, and a password of at least 12 characters.");
    if (step === 2 && (!isAdult || !draft.adultConfirmed)) return setError("Mira is for adults 18+. Add your birthday and confirm eligibility.");
    if (step === 4 && draft.intentions.length === 0) return setError("Choose at least one reason for meeting Mira.");
    if (step === 5 && !draft.companionName.trim()) return setError("Give your companion a name.");
    if (step === 6 && draft.relationshipMode === "romantic" && (!isAdult || !draft.adultConfirmed)) return setError("Romantic mode requires confirmed adult eligibility.");
    if (step === 8 && draft.interests.length === 0) return setError("Choose at least one interest to begin with.");
    if (step === steps - 1) {
      if (!draft.policyAccepted || !draft.aiProcessingConsent) return setError("Review the Terms, Privacy Policy and AI processing disclosure before creating your companion.");
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
              <p>Meet Mira, an original AI companion designed to feel present through voice, expression, shared moments, and memories you can inspect or remove.</p>
              <div className="trust-note"><ShieldCheck aria-hidden="true" /><span>Clearly AI. Adults 18+. Not therapy or emergency care.</span></div>
            </>
          )}

          {step === 1 && (
            <>
              <span className="eyebrow">About you</span>
              <h1>What should Mira call you?</h1>
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
              <p>Your birthday supports eligibility and age-appropriate features. Do not continue unless you are at least 18.</p>
              <label className="field">Birthday<input type="date" max={new Date(new Date().setFullYear(new Date().getFullYear() - 18)).toISOString().slice(0, 10)} value={draft.birthday} onInput={(event) => setDraft({ ...draft, birthday: event.currentTarget.value })} onChange={(event) => setDraft({ ...draft, birthday: event.target.value })} /></label>
              <label className="check-line"><input type="checkbox" checked={draft.adultConfirmed} onChange={(event) => setDraft({ ...draft, adultConfirmed: event.target.checked })} /><span>I confirm I am 18 or older.</span></label>
            </>
          )}

          {step === 3 && (
            <>
              <span className="eyebrow">How we address you</span>
              <h1>What pronouns should Mira use?</h1>
              <p>You can change this at any time in your profile.</p>
              <label className="field">Your pronouns<select value={draft.pronouns} onChange={(event) => setDraft({ ...draft, pronouns: event.target.value as Draft["pronouns"] })}><option>she/her</option><option>he/him</option><option>they/them</option></select></label>
            </>
          )}

          {step === 4 && (
            <>
              <span className="eyebrow">Your intention</span>
              <h1>What are you looking for?</h1>
              <p>Choose as many as fit. Mira supports—never replaces—your real relationships or professional care.</p>
              <div className="choice-grid">
                {intentions.map((item) => <button type="button" key={item} aria-pressed={draft.intentions.includes(item)} className={draft.intentions.includes(item) ? "choice choice--selected" : "choice"} onClick={() => toggle("intentions", item)}>{draft.intentions.includes(item) ? <Check aria-hidden="true" /> : null}{item}</button>)}
              </div>
            </>
          )}

          {step === 5 && (
            <>
              <span className="eyebrow">Create your companion</span>
              <h1>Make the introduction yours.</h1>
              <div className="companion-pick">
                <img src="/assets/mira/portrait.png" alt="Mira, an original AI companion avatar" />
                <span><strong>Playful & warm</strong><small>Original expressive avatar</small></span>
              </div>
              <label className="field">Companion name<input maxLength={40} value={draft.companionName} onChange={(event) => setDraft({ ...draft, companionName: event.target.value })} /></label>
              <label className="field">Companion pronouns<select value={draft.companionPronouns} onChange={(event) => setDraft({ ...draft, companionPronouns: event.target.value as Draft["companionPronouns"] })}><option>she/her</option><option>he/him</option><option>they/them</option></select></label>
              <div className="form-grid"><label className="field">Presentation<select value={draft.presentation} onChange={(event) => setDraft({ ...draft, presentation: event.target.value })}><option value="playful and warm">Playful & warm</option><option value="bright and expressive">Bright & expressive</option><option value="calm and thoughtful">Calm & thoughtful</option></select></label><div className="field"><span>Voice</span><strong>Natural Hinglish · one consistent voice</strong></div></div>
            </>
          )}

          {step === 6 && (
            <>
              <span className="eyebrow">Relationship style</span>
              <h1>Choose a starting shape.</h1>
              <div className="relationship-grid">
                {relationships.map((item) => <button type="button" key={item.id} aria-pressed={draft.relationshipMode === item.id} className={draft.relationshipMode === item.id ? "relationship relationship--selected" : "relationship"} onClick={() => setDraft({ ...draft, relationshipMode: item.id })}><strong>{item.label}</strong><span>{item.description}</span></button>)}
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
              </div>
              <p>These guide conversation style. Priya remains one consistent voice; separate sensuality, flirtiness and voice-tone controls are not available.</p>
            </>
          )}

          {step === 8 && (
            <>
              <span className="eyebrow">A few starting points</span>
              <h1>What could you talk about for hours?</h1>
              <p>These are conversation seeds—not ad targeting. You can remove them later.</p>
              <div className="choice-grid choice-grid--compact">
                {interests.map((item) => <button type="button" key={item} aria-pressed={draft.interests.includes(item)} className={draft.interests.includes(item) ? "choice choice--selected" : "choice"} onClick={() => toggle("interests", item)}>{draft.interests.includes(item) ? <Check aria-hidden="true" /> : null}{item}</button>)}
              </div>
            </>
          )}

          {step === 9 && (
            <>
              <span className="eyebrow">First conversation</span>
              <h1>{draft.companionName || "Mira"} is ready to meet you.</h1>
              <p>Your companion will begin with your chosen relationship style, interests, voice, and personality—without inventing facts about your life.</p>
              <div className="ready-note"><Bot aria-hidden="true" /><span><strong>“Hi {draft.name.trim() || "there"}. I’m {draft.companionName || "Mira"}.”</strong> We can start with whatever feels easy—even a quiet hello.</span></div>
              <label className="check-line"><input type="checkbox" checked={draft.memoryEnabled} onChange={(event) => setDraft({ ...draft, memoryEnabled: event.target.checked })} /><span>Use memories I explicitly add or confirm in conversation. I can inspect, correct, pause, or forget them anytime.</span></label>
              <label className="check-line"><input type="checkbox" checked={draft.conversationStorageEnabled} onChange={event => setDraft({ ...draft, conversationStorageEnabled: event.target.checked })} /><span>Save my chat history in my account. Turning this off means new conversations will not be stored as account history.</span></label>
              <label className="check-line"><input type="checkbox" checked={draft.aiProcessingConsent} onChange={event => setDraft({ ...draft, aiProcessingConsent: event.target.checked })} /><span>I agree to my messages and, when I use voice, audio being processed by Mira’s configured Cloudflare and Inworld services. Mira is AI, can make mistakes and is not emergency or professional care.</span></label>
              <label className="check-line"><input type="checkbox" checked={draft.policyAccepted} onChange={event => setDraft({ ...draft, policyAccepted: event.target.checked })} /><span>I accept the <a href="/terms" target="_blank" rel="noreferrer">Terms</a> and have read the <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a> (disclosure version 2026-09-13). My age declaration is not identity verification.</span></label>
              <div className="trust-note"><ShieldCheck aria-hidden="true" /><span>Memory stays inspectable. You can export or delete everything from Settings.</span></div>
            </>
          )}

          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="onboarding__actions">
            {step > 0 ? <button type="button" className="button button--ghost" onClick={() => { setError(""); setStep((value) => value - 1); }}><ArrowLeft aria-hidden="true" /> Back</button> : <span />}
            <button type="button" className="button button--primary" disabled={submitting} onClick={() => void next()}>{submitting ? "Creating your space…" : step === steps - 1 ? "Meet your companion" : step === 0 ? "Begin setup" : "Continue"}<ArrowRight aria-hidden="true" /></button>
          </div>
        </div>
        <aside className="onboarding__visual" aria-label="Preview of Mira in the companion room">
          <img src="/assets/mira/loft-morning.png" alt="Mira sketching in a sunny loft" />
          <div className="onboarding__visual-card"><span>{draft.memoryEnabled ? "Memory is on because you chose it" : "Memory is off until you choose it"}</span><strong>You stay in control</strong></div>
        </aside>
      </section>
    </main>
  );
}

export type { Draft as OnboardingDraft };
