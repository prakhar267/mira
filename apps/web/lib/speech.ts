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
const femaleIndianEnglishNames = /aditi|kavya|neerja|swara|veena|google.*(?:india|indian)|female/i;
const naturalEnglishNames = /andromeda|aria|ava|cora|helena|jenny|juno|karen|luna|moira|nova|samantha|serena|shimmer|tessa|thalia|vesta|zira|google uk english female/i;
const enhancedNames = /enhanced|natural|neural|online|premium/i;

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
  if (voiceId.includes("calm")) return "cora";
  if (voiceId.includes("confident")) return "thalia";
  if (voiceId.includes("warm")) return "helena";
  return "luna";
}

export function selectPreferredVoice<T extends { name: string; lang: string; default?: boolean; localService?: boolean }>(
  voices: T[],
  text: string,
  voiceId: string,
  language: SpeechLanguage = "auto",
) {
  const detected = detectSpeechLanguage(text, language);
  const targetLocale = detected === "hi" ? "hi-IN" : detected === "hinglish" ? "en-IN" : "en-US";
  const profileNames = voiceId.includes("calm")
    ? /cora|athena|serena|samantha|ava/i
    : voiceId.includes("confident")
      ? /thalia|aria|ava|jenny|zira/i
      : voiceId.includes("warm")
        ? /helena|cora|samantha|serena|ava/i
        : /luna|andromeda|aria|ava|samantha|juno/i;

  return [...voices].sort((left, right) => {
    const score = (voice: T) => {
      const exactLocale = voice.lang.replace("_", "-").toLowerCase() === targetLocale.toLowerCase();
      const sameLanguage = voice.lang.toLowerCase().startsWith(`${targetLocale.slice(0, 2).toLowerCase()}-`);
      const regional = detected === "hinglish" ? /en[-_]in/i.test(voice.lang) : detected === "hi" ? /hi[-_]in/i.test(voice.lang) : /^en[-_]/i.test(voice.lang);
      const namedFemale = detected === "hi" ? femaleHindiNames.test(voice.name) : detected === "hinglish" ? femaleIndianEnglishNames.test(voice.name) || naturalEnglishNames.test(voice.name) : naturalEnglishNames.test(voice.name);
      return (exactLocale ? 70 : 0) + (sameLanguage ? 38 : 0) + (regional ? 28 : 0) + (namedFemale ? 65 : 0) + (enhancedNames.test(voice.name) ? 32 : 0) + (profileNames.test(voice.name) ? 15 : 0) + (voice.default ? 2 : 0) + (voice.localService === false ? 4 : 0);
    };
    return score(right) - score(left);
  })[0];
}

function voiceProfile(voiceId: string) {
  if (voiceId.includes("calm")) return { rate: .9, pitch: .98 };
  if (voiceId.includes("confident")) return { rate: .98, pitch: 1 };
  if (voiceId.includes("warm")) return { rate: .94, pitch: 1 };
  return { rate: .97, pitch: 1.01 };
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
  const controller = new AbortController();
  let audio: HTMLAudioElement | null = null;
  let objectUrl = "";
  let canceled = false;
  let finished = false;
  let fallbackStarted = false;

  const end = () => {
    if (finished) return;
    finished = true;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    options.onEnd?.();
  };

  const browserFallback = () => {
    if (fallbackStarted) return;
    fallbackStarted = true;
    if (canceled || !("speechSynthesis" in window)) return end();
    const utterance = new SpeechSynthesisUtterance(text);
    const selected = selectPreferredVoice(window.speechSynthesis.getVoices(), text, voiceId, language);
    const profile = voiceProfile(voiceId);
    if (selected) utterance.voice = selected;
    utterance.lang = detected === "hi" ? "hi-IN" : "en-IN";
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
      controller.abort();
      audio?.pause();
      window.speechSynthesis?.cancel();
      end();
    },
  };
  activePlayback = playback;

  void (async () => {
    if (detected !== "en") return browserFallback();
    try {
      const response = await fetch("/api/companion-speech", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, voiceId }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Cloud speech unavailable");
      objectUrl = URL.createObjectURL(await response.blob());
      if (canceled) return end();
      audio = new Audio(objectUrl);
      audio.onended = end;
      audio.onerror = () => { if (!canceled) browserFallback(); };
      await audio.play();
      if (!canceled) options.onStart?.();
    } catch {
      if (!canceled) browserFallback();
    }
  })();

  return playback;
}
