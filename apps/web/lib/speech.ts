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

type SpeechOptions = {
  onStart?: () => void;
  onBoundary?: (boundary: { charIndex: number; charLength: number; elapsedTime: number; name: string }) => void;
  onAudioLevel?: (level:number) => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
};

export function speechChunks(text: string, limit = 500): string[] {
  let remainder = text.replace(/\s+/g, " ").trim();
  const chunks: string[] = [];
  while (remainder.length > limit) {
    const prefix = remainder.slice(0, limit);
    const sentence = Math.max(prefix.lastIndexOf(". "), prefix.lastIndexOf("? "), prefix.lastIndexOf("! "), prefix.lastIndexOf("। "));
    const word = prefix.lastIndexOf(" ");
    const end = sentence >= limit / 2 ? sentence + 1 : word >= limit / 2 ? word : limit;
    chunks.push(remainder.slice(0, end));
    remainder = remainder.slice(end).trimStart();
  }
  if (remainder) chunks.push(remainder);
  return chunks;
}

/** Preserve the same Priya voice while respecting each provider request bound. */
export function playCompanionSpeech(text: string, options: SpeechOptions = {}): CompanionSpeechPlayback {
  const chunks = speechChunks(text);
  if (chunks.length <= 1) return playSpeechChunk(chunks[0] ?? "", options);
  let index = 0, offset = 0;
  let cancelled = false;
  let chunk: CompanionSpeechPlayback | null = null;
  const next = () => {
    if (cancelled) return;
    const value = chunks[index]!;
    chunk = playSpeechChunk(value, {
      ...options,
      onStart: () => { if (index === 0) options.onStart?.(); },
      onBoundary: boundary => options.onBoundary?.({ ...boundary, charIndex: offset + boundary.charIndex }),
      onError: message => { cancelled = true; options.onError?.(message); },
      onEnd: () => { if (cancelled) return; offset += value.length + 1; index++; if (index < chunks.length) next(); else options.onEnd?.(); },
    });
  };
  next();
  return { cancel: () => { cancelled = true; chunk?.cancel(); } };
}

function playSpeechChunk(text: string, options: SpeechOptions = {}): CompanionSpeechPlayback {
  stopCompanionSpeech();
  const abortController = new AbortController();
  let audio: HTMLAudioElement | null = null;
  let objectUrl: string | null = null;
  let boundaryTimer: number | null = null;
  let retryDelay: { timer: number; resolve: () => void } | null = null;
  let decodedAudio: AudioBuffer | null = null;
  let canceled = false;
  let finished = false;
  let started = false;

  const finish = (notify = true) => {
    if (finished) return;
    finished = true;
    if (boundaryTimer !== null) window.clearInterval(boundaryTimer);
    boundaryTimer = null;
    if (retryDelay) {
      window.clearTimeout(retryDelay.timer);
      retryDelay.resolve();
      retryDelay = null;
    }
    if (audio) {
      audio.onplaying = audio.onwaiting = audio.onpause = audio.onended = audio.onerror = null;
      audio = null;
    }
    decodedAudio=null;
    options.onAudioLevel?.(0);
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
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (canceled || finished) return;
      response = await fetch("/api/companion-speech", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: text.replace(/\s+/g, " ").trim() }),
        signal: AbortSignal.any([abortController.signal, AbortSignal.timeout(12_000)]),
      });
      if (canceled || finished) return;
      if (response.ok || ![502, 504].includes(response.status) || attempt === 1) break;
      await new Promise<void>(resolve => {
        retryDelay = {
          timer: window.setTimeout(() => { retryDelay = null; resolve(); }, 180 * (attempt + 1)),
          resolve,
        };
      });
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
    // Decode a separate copy for animation; never route audible playback through
    // a new AudioContext (which can silently suspend audio on mobile Safari).
    if(options.onAudioLevel && typeof OfflineAudioContext!=="undefined") {
      void blob.arrayBuffer().then(data=>new OfflineAudioContext(1,1,44100).decodeAudioData(data)).then(buffer=>{if(!finished&&!canceled)decodedAudio=buffer;}).catch(()=>undefined);
    }
    audio.preload = "auto";
    audio.onplaying = () => {
      // A browser event may already be queued when cancel detaches handlers.
      if (canceled || finished) return;
      if (boundaryTimer !== null) window.clearInterval(boundaryTimer);
      if (!started) {
        started = true;
        options.onStart?.();
      }
      if (canceled || finished) return;
      let previous = -1;
      boundaryTimer = window.setInterval(() => {
        if (!audio || canceled || finished) return;
        if(decodedAudio){const samples=decodedAudio.getChannelData(0);const offset=Math.floor(audio.currentTime*decodedAudio.sampleRate);const end=Math.min(samples.length,offset+2048);let sum=0;for(let i=offset;i<end;i++)sum+=samples[i]!**2;options.onAudioLevel?.(audio.paused?0:Math.min(1,Math.sqrt(sum/Math.max(1,end-offset))*5));}
        // Consumer callbacks may synchronously hang up and release this audio.
        if (!audio || canceled || finished) return;
        const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Math.max(1, text.length / 13);
        const charIndex = Math.max(0, Math.min(text.length - 1, Math.floor((audio.currentTime / duration) * text.length)));
        if (charIndex === previous) return;
        previous = charIndex;
        options.onBoundary?.({ charIndex, charLength: 1, elapsedTime: audio.currentTime * 1_000, name: "word" });
      }, 80);
    };
    audio.onwaiting=()=>{if(canceled||finished)return;if(boundaryTimer!==null)window.clearInterval(boundaryTimer);boundaryTimer=null;options.onAudioLevel?.(0);};
    audio.onpause=()=>{if(!canceled&&!finished)options.onAudioLevel?.(0);};
    audio.onended = () => finish();
    audio.onerror = () => {
      if (canceled || finished) return;
      options.onError?.("Mira’s voice could not play. Please try again.");
      finish(false);
    };
    await audio.play();
  })().catch((cause) => {
    if (canceled || finished) return;
    options.onError?.(cause instanceof Error ? cause.message : "Mira’s voice is temporarily unavailable.");
    finish(false);
  });

  return playback;
}
