import { companionVoiceMode } from "./voice-profiles";

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
const noveltyOrMaleNames = /albert|\baman\b|bad news|bahh|bells|boing|bubbles|cellos|daniel|eddy|fred|grandpa|jester|junior|organ|ralph|reed|rishi|rocko|superstar|trinoids|whisper|zarvox/i;
const companionFallbackNames = [/^tara\b/i, /^samantha\b/i, /^karen\b/i, /^tessa\b/i, /^moira\b/i, /^flo\b/i, /^shelley\b/i, /^sandy\b/i, /google.*english.*female/i];

export interface RecognitionResultLike extends ArrayLike<{ transcript?: string; confidence?: number }> {
  isFinal?: boolean;
}

export interface RecognitionEventLike {
  resultIndex?: number;
  results: ArrayLike<RecognitionResultLike>;
}

export interface RecognitionTranscript {
  text: string;
  hasFinalResult: boolean;
}

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

function bestRecognitionAlternative(result: RecognitionResultLike) {
  const alternatives = Array.from({ length: Math.max(1, result.length) }, (_, index) => result[index]).filter((item): item is { transcript?: string; confidence?: number } => Boolean(item?.transcript?.trim()));
  return alternatives.sort((left, right) => (right.confidence ?? 0) - (left.confidence ?? 0))[0]?.transcript?.trim() ?? "";
}

export function collectRecognitionTranscript(segments: Map<number, string>, event: RecognitionEventLike): RecognitionTranscript {
  let hasFinalResult = false;
  const start = Math.max(0, event.resultIndex ?? 0);
  for (let index = start; index < event.results.length; index += 1) {
    const result = event.results[index];
    if (!result) continue;
    const text = bestRecognitionAlternative(result).replace(/\s+/g, " ").trim();
    if (text) segments.set(index, text);
    else segments.delete(index);
    if (result.isFinal) hasFinalResult = true;
  }
  return {
    text: [...segments.entries()].sort(([left], [right]) => left - right).map(([, text]) => text).join(" ").replace(/\s+/g, " ").trim(),
    hasFinalResult,
  };
}

export function splitSpeechSegments(text: string, maximumLength = 170) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const phrases = clean.match(/[^.!?…।]+[.!?…।]?/g)?.map((part) => part.trim()).filter(Boolean) ?? [clean];
  const segments: string[] = [];
  for (const phrase of phrases) {
    if (phrase.length <= maximumLength) {
      segments.push(phrase);
      continue;
    }
    let current = "";
    for (const word of phrase.split(" ")) {
      if (!current || `${current} ${word}`.length <= maximumLength) current = current ? `${current} ${word}` : word;
      else {
        segments.push(current);
        current = word;
      }
    }
    if (current) segments.push(current);
  }
  return segments;
}

export interface MultilingualSpeechSegment {
  text: string;
  language: Exclude<SpeechLanguage, "auto">;
}

export function splitMultilingualSpeechSegments(
  text: string,
  language: SpeechLanguage = "auto",
  maximumLength = 170,
): MultilingualSpeechSegment[] {
  if (language !== "auto") {
    return splitSpeechSegments(text, maximumLength).map((segment) => ({ text: segment, language }));
  }

  const runs = text
    .replace(/\s+/g, " ")
    .trim()
    .match(/[\u0900-\u097f][\u0900-\u097f\s।!?…,'’-]*|[^\u0900-\u097f]+/g)
    ?.map((part) => part.trim())
    .filter(Boolean) ?? [];

  return runs.flatMap((run) => {
    const detected = devanagari.test(run) ? "hi" : detectSpeechLanguage(run);
    return splitSpeechSegments(run, maximumLength).map((segment) => ({ text: segment, language: detected }));
  });
}

export function cloudSpeakerForVoice(voiceId: string) {
  return companionVoiceMode(voiceId).speaker;
}

export function selectPreferredVoice<T extends { name: string; lang: string; default?: boolean; localService?: boolean }>(
  voices: T[],
  _text: string,
  _voiceId: string,
  _language?: SpeechLanguage,
) {
  void _text;
  void _voiceId;
  void _language;
  return [...voices].sort((left, right) => {
    const score = (voice: T) => {
      const locale = voice.lang.replace("_", "-").toLowerCase();
      const isHindi = /^hi(?:-|$)/i.test(locale);
      const isIndianEnglish = /^en-in$/i.test(locale);
      const isLekha = /^lekha\b/i.test(voice.name);
      const namedHindiFemale = femaleHindiNames.test(voice.name);
      const namedIndianFemale = femaleIndianEnglishNames.test(voice.name);
      const namedEnglishFemale = naturalEnglishNames.test(voice.name);
      const fallbackRank = companionFallbackNames.findIndex((pattern) => pattern.test(voice.name));
      const fallbackScore = fallbackRank >= 0 ? 180 - fallbackRank * 12 : 0;

      // Lekha is Mira's on-device identity. Keep it for English, Hindi, and
      // Hinglish so a language switch never sounds like a different person.
      return (isLekha ? 8_000 : 0)
        + (isHindi && namedHindiFemale ? 5_000 : 0)
        + (isHindi ? 1_600 : 0)
        + (isIndianEnglish && namedIndianFemale ? 1_250 : 0)
        + (namedEnglishFemale ? 800 : 0)
        + fallbackScore
        + (enhancedNames.test(voice.name) ? 100 : 0)
        + (voice.default ? 2 : 0)
        + (voice.localService === false ? 6 : 0)
        - (noveltyOrMaleNames.test(voice.name) ? 2_400 : 0);
    };
    return score(right) - score(left);
  })[0];
}

function voiceProfile(voiceId: string) {
  const mode = companionVoiceMode(voiceId);
  return { rate: mode.rate, pitch: mode.pitch, volume: mode.volume };
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
  onBoundary?: (boundary: { charIndex: number; charLength: number; elapsedTime: number; name: string }) => void;
  onEnd?: () => void;
} = {}): CompanionSpeechPlayback {
  stopCompanionSpeech();
  const voiceId = options.voiceId ?? "mira-natural-01";
  const language = options.language ?? "auto";
  let canceled = false;
  let finished = false;
  let speechStarted = false;
  let voiceTimer: number | null = null;
  let voicesChanged: (() => void) | null = null;

  const end = (notify = true) => {
    if (finished) return;
    finished = true;
    if (voiceTimer) window.clearTimeout(voiceTimer);
    if (voicesChanged) window.speechSynthesis?.removeEventListener("voiceschanged", voicesChanged);
    if (activePlayback === playback) activePlayback = null;
    if (notify) options.onEnd?.();
  };

  const speakWithCompanionVoice = () => {
    if (speechStarted || canceled) return;
    speechStarted = true;
    if (!("speechSynthesis" in window)) return end();
    const profile = voiceProfile(voiceId);
    const segments = splitMultilingualSpeechSegments(text, language);
    const selectedVoice = selectPreferredVoice(window.speechSynthesis.getVoices(), text, voiceId, language);
    let segmentIndex = 0;
    let characterOffset = 0;

    const speakNext = () => {
      if (canceled || finished) return;
      const segment = segments[segmentIndex];
      if (!segment) return end();
      const utterance = new SpeechSynthesisUtterance(segment.text);
      if (selectedVoice) utterance.voice = selectedVoice;
      utterance.lang = selectedVoice?.lang ?? "hi-IN";
      utterance.rate = profile.rate;
      utterance.pitch = profile.pitch;
      utterance.volume = profile.volume;
      utterance.onstart = () => {
        if (segmentIndex === 0) options.onStart?.();
      };
      utterance.onboundary = (event) => options.onBoundary?.({
        charIndex: characterOffset + event.charIndex,
        charLength: event.charLength,
        elapsedTime: event.elapsedTime,
        name: event.name,
      });
      utterance.onend = () => {
        characterOffset += segment.text.length + 1;
        segmentIndex += 1;
        speakNext();
      };
      utterance.onerror = () => end();
      window.speechSynthesis.speak(utterance);
    };

    speakNext();
  };

  const playback: CompanionSpeechPlayback = {
    cancel() {
      if (canceled) return;
      canceled = true;
      window.speechSynthesis?.cancel();
      end(false);
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
