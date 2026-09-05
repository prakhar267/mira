const devanagariIndependentVowels: Record<string, string> = {
  "अ": "a", "आ": "aa", "इ": "i", "ई": "ee", "उ": "u", "ऊ": "oo", "ऋ": "ri",
  "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au", "ऑ": "o",
};

const devanagariVowelMarks: Record<string, string> = {
  "ा": "aa", "ि": "i", "ी": "ee", "ु": "u", "ू": "oo", "ृ": "ri",
  "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ॉ": "o",
};

const devanagariConsonants: Record<string, string> = {
  "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n",
  "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "ny",
  "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n",
  "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
  "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m",
  "य": "y", "र": "r", "ल": "l", "व": "v", "श": "sh", "ष": "sh", "स": "s", "ह": "h", "ळ": "l",
  "क़": "k", "ख़": "kh", "ग़": "g", "ज़": "z", "ड़": "d", "ढ़": "dh", "फ़": "f", "य़": "y",
};

const devanagariDigits: Record<string, string> = {
  "०": "0", "१": "1", "२": "2", "३": "3", "४": "4",
  "५": "5", "६": "6", "७": "7", "८": "8", "९": "9",
};

/** Convert Hindi script to Roman text so one Hinglish voice stays consistent. */
export function romanizeHindiForEnglishTts(value: string) {
  const characters = [...value.normalize("NFC")];
  let result = "";
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index]!;
    const consonant = devanagariConsonants[character];
    if (consonant) {
      result += consonant;
      if (characters[index + 1] === "़") index += 1;
      const next = characters[index + 1];
      if (next && devanagariVowelMarks[next] !== undefined) {
        result += devanagariVowelMarks[next];
        index += 1;
      } else if (next === "्") index += 1;
      else result += "a";
      continue;
    }
    if (devanagariIndependentVowels[character]) result += devanagariIndependentVowels[character];
    else if (character === "ं" || character === "ँ") result += "n";
    else if (character === "ः") result += "h";
    else if (character === "।" || character === "॥") result += ".";
    else if (devanagariDigits[character]) result += devanagariDigits[character];
    else if (character !== "़" && character !== "्") result += character;
  }
  return result
    .replace(/([bcdfghjklmnpqrstvwxyz])a(?=\s|[,.!?]|$)/gi, "$1")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeHinglishText(value: string) {
  const clean = value.replace(/\s+/g, " ").trim();
  return /\p{Script=Devanagari}/u.test(clean) ? romanizeHindiForEnglishTts(clean) : clean;
}

export function mouthPoseForText(text: string, charIndex: number): 0 | 1 | 2 | 3 {
  const sample = text.slice(Math.max(0, charIndex), Math.max(0, charIndex) + 8).toLowerCase();
  if (!sample.trim()) return 0;
  const firstVowel = sample.match(/[aeiou]/)?.[0] ?? "";
  if (/[ou]/.test(firstVowel)) return 3;
  if (/a/.test(firstVowel)) return 2;
  if (/[ei]/.test(firstVowel)) return 1;
  return charIndex % 3 === 0 ? 2 : 1;
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
  onStart?: () => void;
  onBoundary?: (boundary: { charIndex: number; charLength: number; elapsedTime: number; name: string }) => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
} = {}): CompanionSpeechPlayback {
  stopCompanionSpeech();
  const abortController = new AbortController();
  let audio: HTMLAudioElement | null = null;
  let objectUrl: string | null = null;
  let boundaryTimer: number | null = null;
  let canceled = false;
  let finished = false;
  let started = false;

  const finish = (notify = true) => {
    if (finished) return;
    finished = true;
    if (boundaryTimer !== null) window.clearInterval(boundaryTimer);
    if (objectUrl) window.URL.revokeObjectURL(objectUrl);
    if (activePlayback === playback) activePlayback = null;
    if (notify) options.onEnd?.();
  };

  const playback: CompanionSpeechPlayback = {
    cancel() {
      if (canceled) return;
      canceled = true;
      abortController.abort();
      audio?.pause();
      finish(false);
    },
  };
  activePlayback = playback;

  void (async () => {
    let response: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await fetch("/api/companion-speech", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: normalizeHinglishText(text) }),
        signal: abortController.signal,
      });
      if (response.ok || ![429, 502, 503, 504].includes(response.status) || attempt === 2) break;
      await new Promise((resolve) => window.setTimeout(resolve, 180 * (attempt + 1)));
    }
    if (!response) throw new Error("Mira’s voice is temporarily unavailable.");
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(body?.error ?? "Mira’s voice is temporarily unavailable.");
    }
    const blob = await response.blob();
    if (!blob.size || !/^audio\//i.test(blob.type)) throw new Error("Mira’s voice returned invalid audio.");
    if (canceled || finished) return;
    objectUrl = window.URL.createObjectURL(blob);
    audio = new Audio(objectUrl);
    audio.preload = "auto";
    audio.onplaying = () => {
      if (!started) {
        started = true;
        options.onStart?.();
      }
      let previous = -1;
      boundaryTimer = window.setInterval(() => {
        if (!audio || canceled || finished) return;
        const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Math.max(1, text.length / 13);
        const charIndex = Math.max(0, Math.min(text.length - 1, Math.floor((audio.currentTime / duration) * text.length)));
        if (charIndex === previous) return;
        previous = charIndex;
        options.onBoundary?.({ charIndex, charLength: 1, elapsedTime: audio.currentTime * 1_000, name: "word" });
      }, 110);
    };
    audio.onended = () => finish();
    audio.onerror = () => {
      options.onError?.("Mira’s voice could not play. Please try again.");
      finish();
    };
    await audio.play();
  })().catch((cause) => {
    if (canceled || finished) return;
    options.onError?.(cause instanceof Error ? cause.message : "Mira’s voice is temporarily unavailable.");
    finish();
  });

  return playback;
}
