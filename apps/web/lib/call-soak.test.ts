import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@companion/shared";
import { companionApi } from "./api-client";
import { CallSession, type CallAdapters } from "./call-session";
import { startCallListening, type CallListeningOptions } from "./call-listening";
import { appendUniqueMessages, resolveConversationTurn } from "./conversation-turn";
import { playCompanionSpeech, stopCompanionSpeech } from "./speech";

// Synthetic lifecycle evidence only. These transcripts do not test an accent,
// microphone, language-model quality, audible voice, echo, or real avatar FPS.
const phrases = [
  { language: "English", text: "I have a meeting on Sunday, and I am preparing tonight.", reply: "Sunday is your meeting day. We can work on your opening answer now." },
  { language: "Hindi", text: "रविवार को मेरी मीटिंग है और मैं आज तैयारी कर रहा हूँ।", reply: "रविवार की मीटिंग के लिए आज तैयारी कर लेते हैं। पहले अपना परिचय बोलो।" },
  { language: "Hinglish", text: "Sunday ko meri meeting hai aur aaj main taiyari kar raha hoon.", reply: "Sunday ki meeting ke liye aaj taiyari kar lete hain. Pehle apna introduction bolo." },
] as const;
type SpeechOptions = Parameters<CallAdapters["speak"]>[1];
const flush = () => vi.advanceTimersByTimeAsync(0);

function setupCall(delivery: "voice" | "video") {
  const transcript: ChatMessage[] = [];
  const microphoneResources = new Set<object>();
  const playbackResources = new Set<object>();
  const updates: string[] = [];
  const attemptIds: string[] = [];
  const timing: number[] = [];
  const peak = { microphones: 0, playback: 0 };
  let listening!: { options: CallListeningOptions; release: () => void };
  let speech!: { options: SpeechOptions; release: () => void };
  let failReply = false;
  let pendingReply: ((response: Response) => void) | undefined;
  let holdReply = false;
  let httpSignal: AbortSignal | undefined;
  const http = vi.fn(async (_url: string, init: RequestInit) => {
    const input = JSON.parse(String(init.body)) as { delivery: string; messages: { role: string; content: string }[] };
    expect(input.delivery).toBe(delivery);
    expect(input.messages.length).toBeLessThanOrEqual(48);
    httpSignal = init.signal as AbortSignal;
    if (holdReply) return new Promise<Response>(resolve => { pendingReply = resolve; });
    if (failReply) { failReply = false; return Response.json({ error: "Synthetic temporary outage", code: "PROVIDER_UNAVAILABLE" }, { status: 503 }); }
    const phrase = phrases.find(item => item.text === input.messages.at(-1)?.content)!;
    expect(phrase).toBeDefined();
    return Response.json({ reply: phrase.reply, model: "synthetic-soak" });
  });
  vi.stubGlobal("fetch", http);
  const listen = vi.fn(async (options: CallListeningOptions) => {
    const resource = {};
    microphoneResources.add(resource);
    peak.microphones = Math.max(peak.microphones, microphoneResources.size);
    const release = () => { microphoneResources.delete(resource); };
    listening = { options, release };
    return { cancel: release };
  });
  const speak = vi.fn((_text: string, options: SpeechOptions) => {
    const resource = {};
    playbackResources.add(resource);
    peak.playback = Math.max(peak.playback, playbackResources.size);
    const release = () => { playbackResources.delete(resource); };
    speech = { options, release };
    return { cancel: release };
  });
  const call = new CallSession({
    listen, speak, update: state => updates.push(state.phase), onTiming: (_name, elapsed) => timing.push(elapsed),
    respond: (text, context) => {
      attemptIds.push(context.turnId);
      const user: ChatMessage = { id: context.turnId, conversationId: "synthetic-soak", role: "user", content: text, createdAt: new Date().toISOString(), status: "sent" };
      transcript.splice(0, transcript.length, ...appendUniqueMessages(transcript, [user]));
      return resolveConversationTurn(context, signal => companionApi.demoReply({
        messages: transcript.slice(-48).map(message => ({ role: message.role as "user" | "assistant", content: message.content })),
        companion: { name: "Mira" }, user: { name: "Synthetic adult" }, delivery,
      }, signal), reply => {
        transcript.splice(0, transcript.length, ...appendUniqueMessages(transcript, [{ ...user, id: `${context.turnId}:reply`, role: "assistant", content: reply }]));
      });
    },
  }, "Hello, how was your day?");
  return {
    call, transcript, microphoneResources, playbackResources, peak, listen, speak, http, updates, attemptIds, timing,
    get listening() { return listening; }, get speech() { return speech; }, get httpSignal() { return httpSignal; },
    failNextReply() { failReply = true; },
    holdNextReply() { holdReply = true; },
    releaseReply(reply: string = phrases[0].reply) { holdReply = false; pendingReply?.(Response.json({ reply, model: "synthetic-soak" })); },
    emitTranscript(text: string) {
      const current = listening;
      current.options.onSpeechStart?.();
      current.options.onSpeechEnd?.(700);
      // The actual microphone adapter releases tracks before completing STT.
      current.release();
      current.options.onTranscript(text);
      return current.options;
    },
    finishSpeech() { speech.release(); speech.options.onEnd?.(); },
  };
}

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] }));
afterEach(() => { stopCompanionSpeech(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe.each(["voice", "video"] as const)("%s deterministic long-call soak", delivery => {
  it("survives 90 alternating-language turns, recoverable failures and restarts with bounded resources", async () => {
    const x = setupCall(delivery);
    const started = performance.now();
    x.call.start(); x.speech.options.onStart?.(); x.finishSpeech();
    await vi.advanceTimersByTimeAsync(200);
    let replyFailures = 0, transcribeFailures = 0, playbackFailures = 0, silences = 0;
    for (let index = 0; index < 90; index++) {
      const phrase = phrases[index % phrases.length]!;
      expect(x.call.state.phase, `turn ${index}: ${phrase.language}`).toBe("listening");
      expect(x.microphoneResources.size).toBe(1);
      expect(x.playbackResources.size).toBe(0);
      if (index % 15 === 7) {
        transcribeFailures++;
        const failed = x.listening;
        failed.options.onSpeechEnd?.(700); failed.release(); failed.options.onError("Synthetic transcription failure");
        const attempts = x.listen.mock.calls.length;
        await vi.advanceTimersByTimeAsync(60_000);
        expect(x.call.state.phase).toBe("error"); expect(x.listen).toHaveBeenCalledTimes(attempts);
        failed.options.onTranscript(phrase.text);
        expect(x.transcript).toHaveLength(index * 2);
        x.call.retry(); await flush();
      }
      if (index % 17 === 8) {
        silences++;
        const silent = x.listening; silent.release(); silent.options.onSilence();
        await vi.advanceTimersByTimeAsync(200);
        expect(x.call.state.phase).toBe("listening");
      }
      const fail = index % 12 === 5;
      if (fail) { replyFailures++; x.failNextReply(); }
      const stale = x.emitTranscript(phrase.text);
      stale.onTranscript(phrase.text); // A delayed duplicate callback is not another turn.
      await flush();
      if (fail) {
        expect(x.call.state).toMatchObject({ phase: "error", userLine: phrase.text });
        expect(x.transcript).toHaveLength(index * 2 + 1);
        const failedId = x.attemptIds.at(-1);
        x.call.retry(); x.call.retry(); await flush();
        expect(x.attemptIds.at(-1)).toBe(failedId);
      }
      expect(x.call.state.phase).toBe("preparing");
      expect(x.transcript.at(-1)?.content).toBe(phrase.reply);
      x.speech.options.onStart?.();
      const staleSpeech = x.speech.options;
      await vi.advanceTimersByTimeAsync(20_000);
      if (index % 19 === 6) {
        playbackFailures++;
        x.speech.release(); x.speech.options.onError?.("Synthetic playback failure");
        staleSpeech.onEnd?.(); // A browser error followed by ended must not restart twice.
        await vi.advanceTimersByTimeAsync(400);
      } else if (index % 13 === 4) {
        x.call.interrupt(); staleSpeech.onStart?.(); staleSpeech.onEnd?.();
        await vi.advanceTimersByTimeAsync(200);
      } else {
        x.finishSpeech(); await vi.advanceTimersByTimeAsync(200);
      }
      expect(x.call.state.phase).toBe("listening");
      expect(x.transcript).toHaveLength((index + 1) * 2);
      expect(new Set(x.transcript.map(message => message.id)).size).toBe(x.transcript.length);
      expect(vi.getTimerCount()).toBe(0);
    }
    expect(performance.now() - started).toBeGreaterThanOrEqual(30 * 60_000);
    expect({ replyFailures, transcribeFailures, playbackFailures, silences }).toEqual({ replyFailures: 8, transcribeFailures: 6, playbackFailures: 5, silences: 5 });
    expect(x.transcript.filter(message => message.role === "assistant")).toHaveLength(90);
    expect(x.peak).toEqual({ microphones: 1, playback: 1 });
    expect(x.timing.every(value => Number.isFinite(value) && value >= 0)).toBe(true);
    const late = x.listening.options;
    x.call.close(); const updateCount = x.updates.length;
    late.onTranscript(phrases[0].text); late.onSilence(); late.onError("late");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(x.call.state.phase).toBe("closed"); expect(x.updates).toHaveLength(updateCount);
    expect(x.microphoneResources.size + x.playbackResources.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fences repeated mute and hang-up cancellation even if the HTTP transport ignores abort", async () => {
    const x = setupCall(delivery);
    x.call.listen(); await flush();
    for (let index = 0; index < 18; index++) {
      const phrase = phrases[index % phrases.length]!;
      x.holdNextReply(); x.emitTranscript(phrase.text); await flush();
      expect(x.call.state.phase).toBe("thinking");
      const failedId = x.attemptIds.at(-1);
      x.call.setMuted(true); expect(x.httpSignal?.aborted).toBe(true);
      x.releaseReply(phrase.reply); await flush();
      expect(x.transcript.filter(message => message.role === "assistant")).toHaveLength(index);
      expect(x.microphoneResources.size + x.playbackResources.size).toBe(0);
      x.call.setMuted(false); x.call.retry(); await flush();
      expect(x.attemptIds.at(-1)).toBe(failedId);
      expect(x.transcript).toHaveLength((index + 1) * 2);
      x.speech.options.onStart?.(); x.finishSpeech(); await vi.advanceTimersByTimeAsync(200);
    }
    x.holdNextReply(); x.emitTranscript(phrases[0].text); await flush();
    const commits = x.transcript.length, spoken = x.speak.mock.calls.length;
    x.call.close(); expect(x.httpSignal?.aborted).toBe(true);
    x.releaseReply(); await vi.advanceTimersByTimeAsync(60_000);
    expect(x.transcript).toHaveLength(commits); expect(x.speak).toHaveBeenCalledTimes(spoken);
    expect(x.microphoneResources.size + x.playbackResources.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a headphone interruption recorder alive and releases all of it on close", async () => {
    const x = setupCall(delivery);
    x.call.setTalkOver(true); x.call.start(); x.speech.options.onStart?.(); await flush();
    for (let index = 0; index < 24; index++) {
      expect(x.listening.options.interruption).toBe(true);
      const phrase = phrases[index % phrases.length]!;
      const stale = x.speech.options;
      x.emitTranscript(phrase.text); stale.onEnd?.(); await flush();
      expect(x.microphoneResources.size).toBe(0); expect(x.playbackResources.size).toBe(1);
      x.speech.options.onStart?.(); await flush();
      expect(x.microphoneResources.size).toBe(1);
      if (index % 2 === 0) {
        const microphone = x.listening;
        x.finishSpeech(); await vi.advanceTimersByTimeAsync(500);
        expect(x.listening).toBe(microphone);
      }
    }
    expect(x.transcript).toHaveLength(48); expect(x.peak).toEqual({ microphones: 1, playback: 1 });
    x.call.close(); expect(x.microphoneResources.size + x.playbackResources.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
});

function setupAudio() {
  const urls = new Set<string>();
  const audios: FakeAudio[] = [];
  class FakeAudio {
    onplaying: (() => void) | null = null;
    onwaiting: (() => void) | null = null;
    onpause: (() => void) | null = null;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    preload = ""; paused = false; currentTime = 0; duration = 1;
    constructor() { audios.push(this); }
    play = vi.fn(async () => { this.paused = false; this.onplaying?.(); });
    pause = vi.fn(() => { this.paused = true; this.onpause?.(); });
  }
  vi.stubGlobal("window", { setTimeout, clearTimeout, setInterval, clearInterval, URL: {
    createObjectURL: () => { const value = `blob:synthetic-${urls.size}-${audios.length}`; urls.add(value); return value; },
    revokeObjectURL: (value: string) => { urls.delete(value); },
  } });
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("OfflineAudioContext", undefined);
  // No decoder or speaker is involved: these are synthetic transport bytes.
  const response = () => new Response(new Uint8Array([82, 73, 70, 70]), { headers: { "content-type": "audio/wav" } });
  return { urls, audios, response };
}

describe("real playback adapter cancellation resources", () => {
  it("does not revive animation timers from a queued playing event after cancellation", async () => {
    const x = setupAudio(); vi.stubGlobal("fetch", vi.fn(async () => x.response()));
    const onStart = vi.fn(), onBoundary = vi.fn();
    const playback = playCompanionSpeech(phrases[0].reply, { onStart, onBoundary });
    await flush(); const audio = x.audios[0]!; const queuedPlaying = audio.onplaying;
    expect(vi.getTimerCount()).toBe(1); playback.cancel();
    expect(vi.getTimerCount()).toBe(0); expect(x.urls.size).toBe(0);
    queuedPlaying?.(); await vi.advanceTimersByTimeAsync(500);
    expect(vi.getTimerCount()).toBe(0); expect(onStart).toHaveBeenCalledOnce(); expect(onBoundary).not.toHaveBeenCalled();
  });

  it("does not issue the second TTS attempt if cancelled during its retry backoff", async () => {
    const x = setupAudio();
    const http = vi.fn().mockResolvedValueOnce(Response.json({ error: "synthetic unavailable" }, { status: 502 })).mockImplementation(async () => x.response());
    vi.stubGlobal("fetch", http);
    const onError = vi.fn(), onEnd = vi.fn();
    const playback = playCompanionSpeech(phrases[1].reply, { onError, onEnd });
    await flush(); expect(http).toHaveBeenCalledOnce(); playback.cancel();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(http).toHaveBeenCalledOnce(); expect(x.audios).toHaveLength(0); expect(x.urls.size).toBe(0);
    expect(onError).not.toHaveBeenCalled(); expect(onEnd).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it("releases URLs and interval timers across 120 multilingual playback completions", async () => {
    const x = setupAudio(); vi.stubGlobal("fetch", vi.fn(async () => x.response()));
    for (let index = 0; index < 120; index++) {
      const onEnd = vi.fn(), onError = vi.fn();
      const playback = playCompanionSpeech(phrases[index % phrases.length]!.reply, { onEnd, onError });
      await flush(); const audio = x.audios.at(-1)!;
      expect(x.urls.size).toBe(1); expect(vi.getTimerCount()).toBe(1);
      if (index % 5 === 0) playback.cancel(); else audio.onended?.();
      expect(x.urls.size).toBe(0); expect(vi.getTimerCount()).toBe(0); expect(onError).not.toHaveBeenCalled();
      expect(onEnd).toHaveBeenCalledTimes(index % 5 === 0 ? 0 : 1);
    }
  });

  it("cleans up failed playback without emitting successful completion or accepting late events", async () => {
    const x = setupAudio(); vi.stubGlobal("fetch", vi.fn(async () => x.response()));
    const onError = vi.fn(), onEnd = vi.fn();
    playCompanionSpeech(phrases[0].reply, { onError, onEnd }); await flush();
    const audio = x.audios[0]!, lateError = audio.onerror, latePlaying = audio.onplaying;
    lateError?.(); lateError?.(); latePlaying?.(); await vi.advanceTimersByTimeAsync(500);
    expect(onError).toHaveBeenCalledOnce(); expect(onEnd).not.toHaveBeenCalled();
    expect(audio.onplaying).toBeNull(); expect(x.urls.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });

  it("supports synchronous cancellation from playback start", async () => {
    const x = setupAudio(); vi.stubGlobal("fetch", vi.fn(async () => x.response()));
    const playback = playCompanionSpeech(phrases[0].reply, { onStart: () => playback.cancel() });
    await flush(); expect(x.urls.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });

  it("supports synchronous cancellation from an audio-level update", async () => {
    const x = setupAudio(); vi.stubGlobal("fetch", vi.fn(async () => x.response()));
    vi.stubGlobal("OfflineAudioContext", class {
      async decodeAudioData() { return { sampleRate: 44_100, getChannelData: () => new Float32Array(4_096).fill(.1) }; }
    });
    const onBoundary = vi.fn();
    const playback = playCompanionSpeech(phrases[0].reply, { onBoundary, onAudioLevel: level => { if (level > 0) playback.cancel(); } });
    await flush(); await vi.advanceTimersByTimeAsync(100);
    expect(x.urls.size).toBe(0); expect(vi.getTimerCount()).toBe(0); expect(onBoundary).not.toHaveBeenCalled();
  });
});

function setupMicrophone() {
  const tracks = new Set<object>(), contexts = new Set<object>(), connections = new Set<object>();
  const frames = new Map<number, FrameRequestCallback>();
  const recorders: FakeRecorder[] = [];
  let frameId = 0, level = 0;
  let delayedPermission = false;
  let resolvePermission: (() => void) | undefined;
  const getUserMedia = vi.fn(async () => {
    const track = { stop: () => { tracks.delete(track); } };
    tracks.add(track);
    const stream = { getTracks: () => [track] };
    if (delayedPermission) await new Promise<void>(resolve => { resolvePermission = resolve; });
    return stream;
  });
  class FakeRecorder {
    static isTypeSupported = () => true;
    state = "inactive"; mimeType = "audio/webm";
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() { recorders.push(this); }
    start() { this.state = "recording"; }
    stop() {
      if (this.state !== "recording") return;
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])], { type: this.mimeType }) });
      this.onstop?.();
    }
  }
  class FakeContext {
    constructor() { contexts.add(this); }
    async resume() {}
    async close() { contexts.delete(this); }
    createMediaStreamSource() {
      const source = { connect: () => connections.add(source), disconnect: () => connections.delete(source) };
      return source;
    }
    createAnalyser() {
      return { fftSize: 512, smoothingTimeConstant: 0, getFloatTimeDomainData: (samples: Float32Array) => samples.fill(level), disconnect() {} };
    }
  }
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("window", {
    MediaRecorder: FakeRecorder, AudioContext: FakeContext, setTimeout, clearTimeout,
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  });
  async function frame(value: number) {
    level = value;
    await vi.advanceTimersByTimeAsync(20);
    const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(performance.now()));
    await flush();
  }
  return {
    tracks, contexts, connections, frames, recorders, getUserMedia,
    delayPermission() { delayedPermission = true; }, releasePermission() { resolvePermission?.(); },
    async utterance() {
      // Deterministic analyser values, not recorded human or generated speech.
      for (let index = 0; index < 16; index++) await frame(0);
      for (let index = 0; index < 24; index++) await frame(.08);
      for (let index = 0; index < 38; index++) await frame(0);
    },
    expectReleased() { expect(tracks.size + contexts.size + connections.size + frames.size).toBe(0); },
  };
}

describe("real microphone adapter with synthetic browser resources", () => {
  it("releases tracks, audio contexts and animation frames over 30 successful/failed transcriptions", async () => {
    const x = setupMicrophone();
    const http = vi.fn(); vi.stubGlobal("fetch", http);
    for (let index = 0; index < 30; index++) {
      const phrase = phrases[index % phrases.length]!;
      const failure = index % 7 === 4;
      http.mockResolvedValueOnce(failure
        ? Response.json({ error: "Synthetic STT outage" }, { status: 503 })
        : Response.json({ text: phrase.text }));
      const onTranscript = vi.fn(), onError = vi.fn(), onSilence = vi.fn();
      const session = await startCallListening({ onTranscript, onError, onSilence });
      expect(x.tracks.size).toBe(1); expect(x.contexts.size).toBe(1);
      await x.utterance();
      if (failure) { expect(onError).toHaveBeenCalledWith("Synthetic STT outage"); expect(onTranscript).not.toHaveBeenCalled(); }
      else { expect(onTranscript).toHaveBeenCalledWith(phrase.text); expect(onError).not.toHaveBeenCalled(); }
      expect(onSilence).not.toHaveBeenCalled();
      const [, request] = http.mock.calls.at(-1)!;
      expect(JSON.parse(String(request.body)).durationMs).toBeLessThanOrEqual(60_000);
      session.cancel(); x.expectReleased(); expect(vi.getTimerCount()).toBe(0);
    }
    expect(http).toHaveBeenCalledTimes(30);
  });

  it("aborts in-flight STT and suppresses ignored late HTTP results after hang-up", async () => {
    const x = setupMicrophone();
    let resolve!: (response: Response) => void;
    const http = vi.fn((url: string, init: RequestInit) => {
      expect(url).toBe("/api/companion-transcribe"); expect(init.signal).toBeInstanceOf(AbortSignal);
      return new Promise<Response>(done => { resolve = done; });
    });
    vi.stubGlobal("fetch", http);
    const respond = vi.fn(), speak = vi.fn(() => ({ cancel() {} }));
    const call = new CallSession({ listen: startCallListening, respond, speak, update() {} }, "Hello");
    call.listen(); await flush(); await x.utterance(); expect(call.state.phase).toBe("transcribing");
    const signal = http.mock.calls[0]![1].signal;
    call.close(); expect(signal?.aborted).toBe(true);
    resolve(Response.json({ text: phrases[2].text })); await flush();
    expect(call.state.phase).toBe("closed"); expect(respond).not.toHaveBeenCalled(); expect(speak).not.toHaveBeenCalled();
    x.expectReleased(); expect(vi.getTimerCount()).toBe(0);
  });

  it("stops media returned by a permission dialog after hang-up before creating a recorder", async () => {
    const x = setupMicrophone(); x.delayPermission();
    const call = new CallSession({ listen: startCallListening, respond: vi.fn(), speak: vi.fn(() => ({ cancel() {} })), update() {} }, "Hello");
    call.listen(); call.close(); x.releasePermission(); await flush();
    expect(call.state.phase).toBe("closed"); expect(x.recorders).toHaveLength(0); x.expectReleased();
  });
});
