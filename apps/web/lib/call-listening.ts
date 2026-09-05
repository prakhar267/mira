export interface CallListeningSession {
  cancel(): void;
}

export interface CallListeningOptions {
  onSpeechStart?: () => void;
  onTranscript: (text: string) => void;
  onSilence: () => void;
  onError: (message: string) => void;
}

export interface CallSpeechEvidence {
  peakLevel: number;
  voicedFrames: number;
  voicedSpanMs: number;
}

interface BrowserSpeechRecognitionResult {
  0?: { transcript?: string };
}

interface BrowserSpeechRecognitionEvent {
  results: ArrayLike<BrowserSpeechRecognitionResult>;
}

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

type BrowserSpeechWindow = Window & typeof globalThis & {
  SpeechRecognition?: new () => BrowserSpeechRecognition;
  webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
};

/** Rejects fan noise, clicks and other tiny bursts before paying for STT. */
export function hasUsableCallSpeech({ peakLevel, voicedFrames, voicedSpanMs }: CallSpeechEvidence) {
  return peakLevel >= .022 && voicedFrames >= 8 && voicedSpanMs >= 140;
}

export function preferredCallTranscript(browserTranscript: string, serverTranscript = "") {
  return (browserTranscript.trim() || serverTranscript.trim()).replace(/\s+/g, " ");
}

function recorderMimeType() {
  for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

async function blobBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export async function startCallListening(options: CallListeningOptions): Promise<CallListeningSession> {
  if (!navigator.mediaDevices?.getUserMedia || !("MediaRecorder" in window)) {
    throw new Error("Hands-free Hinglish voice input needs microphone recording support.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });
  const AudioContextConstructor = window.AudioContext
    ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("Automatic voice detection is unavailable in this browser.");
  }

  const mimeType = recorderMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const context = new AudioContextConstructor();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = .35;
  source.connect(analyser);

  const samples = new Float32Array(analyser.fftSize);
  const chunks: Blob[] = [];
  const startedAt = performance.now();
  let frame = 0;
  let canceled = false;
  let stopped = false;
  let cleaned = false;
  let heardSpeech = false;
  let voicedFrames = 0;
  let totalVoicedFrames = 0;
  let firstVoicedAt = 0;
  let lastVoicedAt = 0;
  let peakLevel = 0;
  let quietSince = 0;
  let noiseFloor = .007;
  let browserTranscript = "";
  let recognitionEnded = true;
  let recognitionEndResolver: (() => void) | null = null;
  const transcriptionController = new AbortController();
  const speechWindow = window as BrowserSpeechWindow;
  const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
  let browserRecognition: BrowserSpeechRecognition | null = null;

  const settleRecognition = () => {
    recognitionEnded = true;
    recognitionEndResolver?.();
    recognitionEndResolver = null;
  };

  if (Recognition) {
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-IN";
    recognition.onresult = (event) => {
      browserTranscript = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    };
    recognition.onerror = settleRecognition;
    recognition.onend = settleRecognition;
    try {
      recognition.start();
      recognitionEnded = false;
      browserRecognition = recognition;
    } catch {
      recognitionEnded = true;
    }
  }

  const finishBrowserRecognition = async () => {
    if (!recognitionEnded) {
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, 900);
        recognitionEndResolver = () => {
          window.clearTimeout(timer);
          resolve();
        };
      });
    }
    return browserTranscript.trim();
  };

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (frame) window.cancelAnimationFrame(frame);
    source.disconnect();
    analyser.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    void context.close();
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (browserRecognition && !recognitionEnded) {
      try { browserRecognition.stop(); } catch { settleRecognition(); }
    }
    if (recorder.state === "recording") recorder.stop();
    else cleanup();
  };

  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  recorder.onerror = () => {
    if (!canceled) options.onError("The microphone recording stopped unexpectedly. I’ll try listening again.");
    canceled = true;
    stop();
  };
  recorder.onstop = () => {
    cleanup();
    if (canceled) return;
    const evidence = {
      peakLevel,
      voicedFrames: totalVoicedFrames,
      voicedSpanMs: firstVoicedAt && lastVoicedAt ? lastVoicedAt - firstVoicedAt : 0,
    };
    if (!heardSpeech || !chunks.length || !hasUsableCallSpeech(evidence)) {
      options.onSilence();
      return;
    }

    const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
    void blobBase64(blob)
      .then(async (audioBase64) => {
        const nativeTranscript = await finishBrowserRecognition();
        if (nativeTranscript) {
          if (!canceled) options.onTranscript(preferredCallTranscript(nativeTranscript));
          return;
        }
        const response = await fetch("/api/companion-transcribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ audioBase64, contentType: blob.type }),
          signal: transcriptionController.signal,
        });
        const body = await response.json().catch(() => null) as { text?: string; error?: string } | null;
        if (!response.ok || !body?.text?.trim()) throw new Error(body?.error ?? "I couldn’t hear that clearly.");
        if (!canceled) options.onTranscript(preferredCallTranscript("", body.text));
      })
      .catch((cause) => {
        if (!canceled) options.onError(cause instanceof Error ? cause.message : "Voice transcription is temporarily unavailable.");
      });
  };

  const detect = () => {
    if (canceled || stopped) return;
    analyser.getFloatTimeDomainData(samples);
    let energy = 0;
    for (const sample of samples) energy += sample * sample;
    const level = Math.sqrt(energy / samples.length);
    const now = performance.now();

    if (!heardSpeech) noiseFloor = noiseFloor * .985 + Math.min(level, .03) * .015;
    if (now - startedAt < 400) {
      frame = window.requestAnimationFrame(detect);
      return;
    }
    const speechThreshold = Math.max(.018, noiseFloor * 2.8);
    const silenceThreshold = Math.max(.011, noiseFloor * 1.6);

    if (level >= speechThreshold) {
      voicedFrames += 1;
      totalVoicedFrames += 1;
      peakLevel = Math.max(peakLevel, level);
      firstVoicedAt ||= now;
      lastVoicedAt = now;
      quietSince = 0;
      if (!heardSpeech && voicedFrames >= 5) {
        heardSpeech = true;
        options.onSpeechStart?.();
      }
    } else {
      voicedFrames = Math.max(0, voicedFrames - 1);
      if (heardSpeech && level < silenceThreshold) quietSince ||= now;
      else quietSince = 0;
    }

    if ((heardSpeech && quietSince && now - quietSince >= 1_350) || now - startedAt >= 30_000) {
      stop();
      return;
    }
    if (!heardSpeech && now - startedAt >= 12_000) {
      stop();
      return;
    }
    frame = window.requestAnimationFrame(detect);
  };

  recorder.start(200);
  frame = window.requestAnimationFrame(detect);

  return {
    cancel() {
      if (canceled) return;
      canceled = true;
      transcriptionController.abort();
      try { browserRecognition?.abort(); } catch { /* recognition already ended */ }
      stop();
    },
  };
}
