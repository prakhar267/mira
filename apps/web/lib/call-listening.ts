export interface CallListeningSession {
  cancel(): void;
}

export interface CallListeningOptions {
  signal?: AbortSignal;
  /** Headphones-only experimental talk-over. Never enabled by default. */
  interruption?: boolean;
  onSpeechStart?: () => void;
  onSpeechEnd?: (endpointingMs?: number) => void;
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
  isFinal?: boolean;
  0?: { transcript?: string; confidence?: number };
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
  const browser = browserTranscript.trim().replace(/\s+/g, " ");
  const server = serverTranscript.trim().replace(/\s+/g, " ");
  if (!server) return browser;
  if (!browser) return server;
  // Longer is not necessarily more accurate: en-IN recognition often invents
  // English words for Hindi. Prefer multilingual STT unless it is empty.
  return server;
}

/** A last-resort browser transcript must be a complete, high-confidence phrase. */
export function isConfidentBrowserTranscript(value: string, confidence = 0) {
  const clean = value.trim().replace(/\s+/g, " ");
  const words = clean.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (clean.length < 14 || words.length < 4) return false;
  if (confidence < .88) return false;
  if (/^(?:thank you|thanks for watching|please subscribe|hmm+|uh+)[.!?\s]*$/i.test(clean)) return false;
  const uniqueWords = new Set(words.map((word) => word.toLowerCase()));
  return uniqueWords.size >= Math.min(3, words.length);
}

export function isCallSilenceResponse(status: number) {
  return status === 422;
}

interface CallTranscriptionResult {
  response: { status: number; ok: boolean };
  body: { text?: string; error?: string } | null;
}

/** Never race an en-IN guess against a pending multilingual result. Fast server
 * replies also must not wait for the independent browser recognizer to end.
 * Consent/quota/silence responses are authoritative, not fallback opportunities. */
export async function resolveCallTranscription(
  server: Promise<CallTranscriptionResult | null>,
  browserFallback: () => Promise<{ text: string; confidence: number }>,
  signal: AbortSignal,
): Promise<string | null> {
  const result = await server;
  signal.throwIfAborted();
  if (result) {
    const { response, body } = result;
    if ([401, 403, 429].includes(response.status)) throw new Error(body?.error ?? "Voice processing is unavailable. Check consent or retry after the displayed limit resets.");
    if (isCallSilenceResponse(response.status)) return null;
    if (response.ok && body?.text?.trim()) return preferredCallTranscript("", body.text);
    if (response.status >= 400 && response.status < 500) throw new Error(body?.error ?? "This voice recording could not be processed.");
  }
  const fallback = await browserFallback();
  signal.throwIfAborted();
  if (isConfidentBrowserTranscript(fallback.text, fallback.confidence)) return preferredCallTranscript(fallback.text);
  throw new Error(result?.body?.error ?? "I couldn’t hear that clearly.");
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
  if (options.signal?.aborted) { stream.getTracks().forEach(track => track.stop()); throw new DOMException("Call cancelled", "AbortError"); }
  let acquiredContext: AudioContext | undefined;
  try {
  const AudioContextConstructor = window.AudioContext
    ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("Automatic voice detection is unavailable in this browser.");
  }

  const mimeType = recorderMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const context = new AudioContextConstructor();
  acquiredContext = context;
  await context.resume();
  if (options.signal?.aborted) { stream.getTracks().forEach(track => track.stop()); await context.close(); throw new DOMException("Call cancelled", "AbortError"); }
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = .35;
  source.connect(analyser);

  const samples = new Float32Array(analyser.fftSize);
  const chunks: Blob[] = [];
  let recordedBytes = 0;
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
  let browserConfidence = 0;
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

  if (Recognition && !options.interruption) {
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-IN";
    recognition.onresult = (event) => {
      const finalResults = Array.from(event.results).filter(result => result.isFinal === true);
      const alternatives = finalResults.map((result) => result[0]);
      browserConfidence = alternatives.length ? Math.min(...alternatives.map((result) => result?.confidence ?? 0)) : 0;
      browserTranscript = finalResults
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

  const finishBrowserRecognition = async (maximumWaitMs = 900) => {
    if (!recognitionEnded) {
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, maximumWaitMs);
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
    recordedBytes += event.data.size;
    if (recordedBytes > 2_500_000) { if (!canceled) options.onError("This recording is too large. Please try a shorter sentence."); canceled = true; stop(); cleanup(); return; }
    if (event.data.size && !canceled) chunks.push(event.data);
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
    options.onSpeechEnd?.(Math.max(0, performance.now() - lastVoicedAt));

    const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
    void blobBase64(blob)
      .then(async (audioBase64) => {
        if (canceled || options.signal?.aborted) return;
        const responsePromise = fetch("/api/companion-transcribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ audioBase64, contentType: blob.type, durationMs: Math.min(60_000, Math.round(performance.now() - startedAt)) }),
          signal: AbortSignal.any([transcriptionController.signal, AbortSignal.timeout(7_000)]),
        }).then(async (response) => ({
          response,
          body: await response.json().catch(() => null) as { text?: string; error?: string } | null,
        })).catch(() => null);
        const transcript = await resolveCallTranscription(responsePromise, async () => ({
          text: await finishBrowserRecognition(260), confidence: browserConfidence,
        }), options.signal ? AbortSignal.any([options.signal, transcriptionController.signal]) : transcriptionController.signal);
        if (canceled) return;
        if (transcript) options.onTranscript(transcript);
        else options.onSilence();
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
    if (now - startedAt < 250) {
      frame = window.requestAnimationFrame(detect);
      return;
    }
    const speechThreshold = options.interruption ? Math.max(.04, noiseFloor * 4) : Math.max(.018, noiseFloor * 2.8);
    const silenceThreshold = Math.max(.011, noiseFloor * 1.6);

    if (level >= speechThreshold) {
      voicedFrames += 1;
      totalVoicedFrames += 1;
      peakLevel = Math.max(peakLevel, level);
      firstVoicedAt ||= now;
      lastVoicedAt = now;
      quietSince = 0;
      if (!heardSpeech && voicedFrames >= (options.interruption ? 12 : 5)) {
        heardSpeech = true;
        options.onSpeechStart?.();
      }
    } else {
      voicedFrames = Math.max(0, voicedFrames - 1);
      if (heardSpeech && level < silenceThreshold) quietSince ||= now;
      else quietSince = 0;
    }

    if ((heardSpeech && quietSince && now - quietSince >= 700) || now - startedAt >= 30_000) {
      stop();
      return;
    }
    if (!heardSpeech && now - startedAt >= 10_000) {
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
  } catch (error) {
    stream.getTracks().forEach(track => track.stop());
    void acquiredContext?.close().catch(() => undefined);
    throw error;
  }
}
