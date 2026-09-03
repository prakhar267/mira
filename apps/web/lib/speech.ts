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
const blockedVoiceNames = /\blekha\b|bad news|bahh|bells|boing|bubbles|cellos|grandpa|jester|junior|organ|ralph|rocko|superstar|trinoids|whisper|zarvox/i;
const femaleHindiNames = /aditi|heera|kavya|swara|veena|google.*(?:hindi|हिन्दी)|female/i;
const femaleIndianEnglishNames = /aditi|kavya|neerja|swara|tara|veena|google.*(?:india|indian)|female/i;
const naturalEnglishNames = /andromeda|aria|ava|cora|flo|helena|jenny|juno|karen|luna|moira|nova|samantha|sandy|serena|shelley|shimmer|tara|tessa|thalia|vesta|zira|google.*english.*female/i;
const enhancedNames = /enhanced|natural|neural|online|premium/i;
const noveltyOrMaleNames = /albert|\baman\b|daniel|eddy|fred|reed|rishi/i;
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

export function synthesisLanguageCode(text: string, requested: SpeechLanguage = "auto") {
  return detectSpeechLanguage(text, requested) === "en" ? "en-IN" : "hi-IN";
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
  text: string,
  _voiceId: string,
  language: SpeechLanguage = "auto",
) {
  void _voiceId;
  const requestedLanguage = detectSpeechLanguage(text, language);
  return [...voices].sort((left, right) => {
    const score = (voice: T) => {
      const locale = voice.lang.replace("_", "-").toLowerCase();
      const isHindi = /^hi(?:-|$)/i.test(locale);
      const isIndianEnglish = /^en-in$/i.test(locale);
      const namedHindiFemale = femaleHindiNames.test(voice.name);
      const namedIndianFemale = femaleIndianEnglishNames.test(voice.name);
      const namedEnglishFemale = naturalEnglishNames.test(voice.name);
      const fallbackRank = companionFallbackNames.findIndex((pattern) => pattern.test(voice.name));
      const fallbackScore = fallbackRank >= 0 ? 180 - fallbackRank * 12 : 0;

      if (blockedVoiceNames.test(voice.name)) return -100_000;
      return (requestedLanguage === "hi" && isHindi && namedHindiFemale ? 6_000 : 0)
        + (requestedLanguage === "hi" && isHindi ? 3_000 : 0)
        + (requestedLanguage === "hinglish" && isIndianEnglish && namedIndianFemale ? 5_000 : 0)
        + (requestedLanguage === "hinglish" && isHindi && namedHindiFemale ? 3_500 : 0)
        + (requestedLanguage === "en" && isIndianEnglish && namedIndianFemale ? 2_000 : 0)
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
  const profile = voiceProfile(voiceId);
  const abortController = new AbortController();
  let canceled = false;
  let finished = false;
  let browserStarted = false;
  let playbackStarted = false;
  let audio: HTMLAudioElement | null = null;
  let objectUrl: string | null = null;
  let boundaryTimer: number | null = null;
  let requestTimer: number | null = null;
  let voiceTimer: number | null = null;
  let voicesChanged: (() => void) | null = null;

  const end = (notify = true) => {
    if (finished) return;
    finished = true;
    if (requestTimer) window.clearTimeout(requestTimer);
    if (boundaryTimer) window.clearInterval(boundaryTimer);
    if (voiceTimer) window.clearTimeout(voiceTimer);
    if (voicesChanged) window.speechSynthesis?.removeEventListener("voiceschanged", voicesChanged);
    if (objectUrl) window.URL.revokeObjectURL(objectUrl);
    if (activePlayback === playback) activePlayback = null;
    if (notify) options.onEnd?.();
  };

  const notifyStart = () => {
    if (playbackStarted || canceled || finished) return;
    playbackStarted = true;
    options.onStart?.();
  };

  const speakWithBrowserFallback = () => {
    if (browserStarted || canceled || finished) return;
    browserStarted = true;
    if (!("speechSynthesis" in window)) return end();
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
      utterance.lang = selectedVoice?.lang ?? recognitionLocale(segment.language);
      utterance.rate = profile.rate;
      utterance.pitch = profile.pitch;
      utterance.volume = profile.volume;
      utterance.onstart = notifyStart;
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
      abortController.abort();
      audio?.pause();
      window.speechSynthesis?.cancel();
      end(false);
    },
  };
  activePlayback = playback;

  const queueBrowserFallback = () => {
    if (canceled || finished || browserStarted) return;
    if (!("speechSynthesis" in window) || window.speechSynthesis.getVoices().length > 0) {
      speakWithBrowserFallback();
      return;
    }
    voicesChanged = speakWithBrowserFallback;
    window.speechSynthesis.addEventListener("voiceschanged", voicesChanged, { once: true });
    voiceTimer = window.setTimeout(speakWithBrowserFallback, 350);
  };

  const playNeuralVoice = async () => {
    requestTimer = window.setTimeout(() => abortController.abort(), 12_000);
    const response = await fetch("/api/companion-speech", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, voiceId, language }),
      signal: abortController.signal,
    });
    if (requestTimer) {
      window.clearTimeout(requestTimer);
      requestTimer = null;
    }
    if (!response.ok) throw new Error(`Neural speech returned ${response.status}.`);
    const blob = await response.blob();
    if (!blob.size || !/^audio\//i.test(blob.type)) throw new Error("Neural speech returned invalid audio.");
    if (canceled || finished) return;

    objectUrl = window.URL.createObjectURL(blob);
    audio = new Audio(objectUrl);
    audio.preload = "auto";
    audio.volume = profile.volume;
    audio.preservesPitch = true;
    if (response.headers.get("x-companion-voice-provider") !== "sarvam-bulbul-v3") {
      audio.playbackRate = profile.rate;
    }
    audio.onplaying = () => {
      notifyStart();
      let lastBoundary = -1;
      boundaryTimer = window.setInterval(() => {
        if (!audio || canceled || finished) return;
        const ratio = Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.currentTime / audio.duration
          : Math.min(1, audio.currentTime / Math.max(1, text.length / 13));
        const charIndex = Math.max(0, Math.min(text.length - 1, Math.floor(ratio * text.length)));
        if (charIndex === lastBoundary) return;
        lastBoundary = charIndex;
        options.onBoundary?.({ charIndex, charLength: 1, elapsedTime: audio.currentTime * 1_000, name: "word" });
      }, 120);
    };
    audio.onended = () => end();
    audio.onerror = () => {
      if (playbackStarted) end();
      else queueBrowserFallback();
    };
    await audio.play();
    notifyStart();
  };

  void playNeuralVoice().catch(() => {
    if (!canceled && !finished) queueBrowserFallback();
  });

  return playback;
}
