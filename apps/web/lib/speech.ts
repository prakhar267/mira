import { companionVoiceProfile } from "./voice-profiles";

export type SpeechLanguage = "auto" | "en" | "hi" | "hinglish";

export const speechLanguageOptions: Array<{ value: SpeechLanguage; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "en", label: "English" },
  { value: "hi", label: "हिन्दी" },
  { value: "hinglish", label: "Hinglish" },
];

const devanagari = /[\u0900-\u097f]/;
const hinglishWords = /\b(?:aaj|accha|acha|arey|aur|bahut|bas|bolo|chal|haan|hai|hoon|kaisa|kaisi|kaise|kar|karo|kya|kyun|matlab|mera|meri|mere|mujhe|nahi|nhi|par|sach|samajh|theek|thik|thoda|tum|tumhara|yaar)\b/i;
const femaleHindiNames = /aditi|heera|kavya|lekha|swara|veena|google.*(?:hindi|हिन्दी)|female/i;
const femaleIndianEnglishNames = /aditi|kavya|neerja|swara|tara|veena|google.*(?:india|indian)|female/i;
const naturalEnglishNames = /andromeda|aria|ava|cora|flo|helena|jenny|juno|karen|luna|moira|nova|samantha|sandy|serena|shelley|shimmer|tara|tessa|thalia|vesta|zira|google.*english.*female/i;
const enhancedNames = /enhanced|natural|neural|online|premium/i;
const noveltyOrMaleNames = /albert|aman|bad news|bahh|bells|boing|bubbles|cellos|daniel|eddy|fred|grandpa|jester|junior|organ|ralph|reed|rishi|rocko|superstar|trinoids|whisper|zarvox/i;
const companionIdentityNames = [/^tara\b/i, /^samantha\b/i, /^karen\b/i, /^tessa\b/i, /^moira\b/i, /^flo\b/i, /^shelley\b/i, /^sandy\b/i, /google.*english.*female/i];

export function detectSpeechLanguage(text: string, requested: SpeechLanguage = "auto"): Exclude<SpeechLanguage, "auto"> {
  if (requested !== "auto") return requested;
  if (devanagari.test(text)) return "hi";
  if (hinglishWords.test(text)) return "hinglish";
  return "en";
}

export function recognitionLocale(language: SpeechLanguage, browserLanguage = "en-IN") {
  if (language === "hi") return "hi-IN";
  if (language === "en" || language === "hinglish") return "en-IN";
  return /^hi(?:-|$)/i.test(browserLanguage) ? "hi-IN" : "en-IN";
}

export function cloudSpeakerForVoice(voiceId: string) {
  return companionVoiceProfile(voiceId).speaker;
}

export function selectPreferredVoice<T extends { name: string; lang: string; default?: boolean; localService?: boolean }>(
  voices: T[],
  text: string,
  _voiceId: string,
  language: SpeechLanguage = "auto",
) {
  const detected = detectSpeechLanguage(text, language);
  const targetLocale = detected === "hi" ? "hi-IN" : detected === "hinglish" ? "en-IN" : "en-US";

  return [...voices].sort((left, right) => {
    const score = (voice: T) => {
      const exactLocale = voice.lang.replace("_", "-").toLowerCase() === targetLocale.toLowerCase();
      const sameLanguage = voice.lang.toLowerCase().startsWith(`${targetLocale.slice(0, 2).toLowerCase()}-`);
      const regional = detected === "hinglish" ? /en[-_]in/i.test(voice.lang) : detected === "hi" ? /hi[-_]in/i.test(voice.lang) : /^en[-_]/i.test(voice.lang);
      const namedFemale = detected === "hi" ? femaleHindiNames.test(voice.name) : detected === "hinglish" ? femaleIndianEnglishNames.test(voice.name) || naturalEnglishNames.test(voice.name) : naturalEnglishNames.test(voice.name);
      const identityRank = companionIdentityNames.findIndex((pattern) => pattern.test(voice.name));
      const identityScore = identityRank >= 0 ? 720 - identityRank * 70 : 0;
      const languageVoiceScore = detected === "hi" || detected === "hinglish" ? (namedFemale ? 140 : 0) : (namedFemale ? 70 : 0);
      return identityScore + (exactLocale ? (detected === "en" ? 55 : 110) : 0) + (sameLanguage ? 35 : 0) + (regional ? (detected === "en" ? 25 : 50) : 0) + languageVoiceScore + (enhancedNames.test(voice.name) ? 36 : 0) + (voice.default ? 2 : 0) + (voice.localService === false ? 6 : 0) - (noveltyOrMaleNames.test(voice.name) ? 260 : 0);
    };
    return score(right) - score(left);
  })[0];
}

function voiceProfile(voiceId: string) {
  const profile = companionVoiceProfile(voiceId);
  return { rate: profile.rate, pitch: profile.pitch };
}

export interface CompanionSpeechPlayback {
  cancel(): void;
}

let activePlayback: CompanionSpeechPlayback | null = null;

export function stopCompanionSpeech() {
  activePlayback?.cancel();
  activePlayback = null;
  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
}

export function playCompanionSpeech(text: string, options: {
  voiceId?: string;
  language?: SpeechLanguage;
  onStart?: () => void;
  onEnd?: () => void;
} = {}): CompanionSpeechPlayback {
  stopCompanionSpeech();
  const voiceId = options.voiceId ?? "mira-playful-01";
  const language = options.language ?? "auto";
  const detected = detectSpeechLanguage(text, language);
  let canceled = false;
  let finished = false;
  let speechStarted = false;
  let voiceTimer: number | null = null;
  let voicesChanged: (() => void) | null = null;

  const end = () => {
    if (finished) return;
    finished = true;
    if (voiceTimer) window.clearTimeout(voiceTimer);
    if (voicesChanged) window.speechSynthesis?.removeEventListener("voiceschanged", voicesChanged);
    options.onEnd?.();
  };

  const speakWithCompanionVoice = () => {
    if (speechStarted || canceled) return;
    speechStarted = true;
    if (!("speechSynthesis" in window)) return end();
    const utterance = new SpeechSynthesisUtterance(text);
    const selected = selectPreferredVoice(window.speechSynthesis.getVoices(), text, voiceId, language);
    const profile = voiceProfile(voiceId);
    if (selected) utterance.voice = selected;
    utterance.lang = selected?.lang ?? (detected === "hi" ? "hi-IN" : "en-IN");
    utterance.rate = profile.rate;
    utterance.pitch = profile.pitch;
    utterance.onstart = () => options.onStart?.();
    utterance.onend = end;
    utterance.onerror = end;
    window.speechSynthesis.speak(utterance);
  };

  const playback: CompanionSpeechPlayback = {
    cancel() {
      if (canceled) return;
      canceled = true;
      window.speechSynthesis?.cancel();
      end();
    },
  };
  activePlayback = playback;

  if (!("speechSynthesis" in window) || window.speechSynthesis.getVoices().length > 0) {
    speakWithCompanionVoice();
  } else {
    voicesChanged = speakWithCompanionVoice;
    window.speechSynthesis.addEventListener("voiceschanged", voicesChanged, { once: true });
    voiceTimer = window.setTimeout(speakWithCompanionVoice, 350);
  }

  return playback;
}
