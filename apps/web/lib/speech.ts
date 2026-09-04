import { companionVoiceMode } from "./voice-profiles";

export type SpeechLanguage = "auto" | "en" | "hi" | "hinglish";

export const speechLanguageOptions: Array<{ value: SpeechLanguage; label: string }> = [
  { value: "auto", label: "Auto · English first" },
  { value: "en", label: "English" },
  { value: "hi", label: "हिन्दी" },
  { value: "hinglish", label: "Hinglish" },
];

const devanagari = /[\u0900-\u097f]/;
const hinglishWords = /\b(?:aaj|accha|acha|arey|aur|bahut|bas|bolo|chal|haan|hai|hoon|kaisa|kaisi|kaise|kar|karo|kya|kyun|matlab|mera|meri|mere|mujhe|nahi|nhi|par|sach|samajh|theek|thik|thoda|tum|tumhara|yaar)\b/i;
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
  if (language === "en" || language === "hinglish" || language === "auto") return "en-IN";
  return /^hi(?:-|$)/i.test(browserLanguage) ? "hi-IN" : "en-IN";
}

export function synthesisLanguageCode(text: string, requested: SpeechLanguage = "auto") {
  const detected = detectSpeechLanguage(text, requested);
  if (detected === "hi") return "hi";
  if (detected === "hinglish") return "auto";
  return "en";
}

export function adaptiveRecognitionLocale(text: string, requested: SpeechLanguage = "auto") {
  return recognitionLocale(requested === "auto" ? detectSpeechLanguage(text) : requested);
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

export function mouthPoseForText(text: string, charIndex: number): 0 | 1 | 2 | 3 {
  const sample = text.slice(Math.max(0, charIndex), Math.max(0, charIndex) + 8).toLowerCase();
  if (!sample.trim()) return 0;
  const firstVowel = sample.match(/[aeiouअआइईउऊएऐओऔािीुूेैोौ]/u)?.[0] ?? "";
  if (/[ouउऊओऔुूोौ]/u.test(firstVowel)) return 3;
  if (/[aअआा]/u.test(firstVowel)) return 2;
  if (/[eiइईएऐिीेै]/u.test(firstVowel)) return 1;
  return charIndex % 3 === 0 ? 2 : 1;
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
}

export function playCompanionSpeech(text: string, options: {
  voiceId?: string;
  language?: SpeechLanguage;
  onStart?: () => void;
  onBoundary?: (boundary: { charIndex: number; charLength: number; elapsedTime: number; name: string }) => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
} = {}): CompanionSpeechPlayback {
  stopCompanionSpeech();
  const voiceId = options.voiceId ?? "mira-natural-01";
  const language = options.language ?? "auto";
  const profile = voiceProfile(voiceId);
  const abortController = new AbortController();
  let canceled = false;
  let finished = false;
  let playbackStarted = false;
  let audio: HTMLAudioElement | null = null;
  let objectUrl: string | null = null;
  let boundaryTimer: number | null = null;
  let requestTimer: number | null = null;

  const end = (notify = true) => {
    if (finished) return;
    finished = true;
    if (requestTimer) window.clearTimeout(requestTimer);
    if (boundaryTimer) window.clearInterval(boundaryTimer);
    if (objectUrl) window.URL.revokeObjectURL(objectUrl);
    if (activePlayback === playback) activePlayback = null;
    if (notify) options.onEnd?.();
  };

  const notifyStart = () => {
    if (playbackStarted || canceled || finished) return;
    playbackStarted = true;
    options.onStart?.();
  };

  const playback: CompanionSpeechPlayback = {
    cancel() {
      if (canceled) return;
      canceled = true;
      abortController.abort();
      audio?.pause();
      end(false);
    },
  };
  activePlayback = playback;

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
      options.onError?.("Ara voice playback failed. Please try again.");
      end();
    };
    await audio.play();
    notifyStart();
  };

  // Ara is always generated on the server. Browser/system speech synthesis is
  // intentionally never used, so the companion keeps one identity on every device.
  void playNeuralVoice().catch((error) => {
    if (!canceled && !finished) {
      options.onError?.(error instanceof Error ? error.message : "Ara voice is temporarily unavailable.");
      end();
    }
  });

  return playback;
}
