import type { CallListeningOptions, CallListeningSession } from "./call-listening";
import type { playCompanionSpeech, CompanionSpeechPlayback } from "./speech";

export type CallPhase = "idle" | "opening-mic" | "listening" | "transcribing" | "thinking" | "preparing" | "speaking" | "error" | "closed";
export interface CallSnapshot {
  phase: CallPhase;
  userLine: string;
  companionLine: string;
  error: string;
  muted: boolean;
  speaker: boolean;
  talkOver: boolean;
}
type SpeechOptions = NonNullable<Parameters<typeof playCompanionSpeech>[1]>;
export interface CallAdapters {
  listen(options: CallListeningOptions): Promise<CallListeningSession>;
  speak(text: string, options: SpeechOptions): CompanionSpeechPlayback;
  respond(text: string): Promise<string>;
  update(snapshot: CallSnapshot): void;
  onAudioLevel?: SpeechOptions["onAudioLevel"];
  onBoundary?: SpeechOptions["onBoundary"];
  onTiming?: (name: "call_transcribe_ms" | "call_reply_ms" | "call_speech_ms" | "call_roundtrip_ms", ms: number) => void;
}

/** Shared voice/video lifecycle. Every async callback is fenced to its call and
 * attempt; permission prompts and late HTTP results cannot revive a closed call. */
export class CallSession {
  state: CallSnapshot;
  private closed = false;
  private listenId = 0;
  private speechId = 0;
  private turnId = 0;
  private listenPending = false;
  private listener: CallListeningSession | null = null;
  private playback: CompanionSpeechPlayback | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private speechEndedAt = 0;
  constructor(private adapters: CallAdapters, greeting: string) {
    this.state = { phase: "idle", userLine: "", companionLine: greeting, error: "", muted: false, speaker: true, talkOver: false };
  }
  private patch(value: Partial<CallSnapshot>) {
    if (this.closed) return;
    this.state = { ...this.state, ...value };
    this.adapters.update(this.state);
  }
  private clearTimer() { if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
  private stopListening() {
    this.listenId++;
    this.listenPending = false;
    this.listener?.cancel();
    this.listener = null;
  }
  private stopSpeaking() {
    this.speechId++;
    this.playback?.cancel();
    this.playback = null;
    this.adapters.onAudioLevel?.(0);
  }
  private queueListen(delay = 180) {
    this.clearTimer();
    if (this.closed || this.state.muted) return;
    this.timer = setTimeout(() => { this.timer = undefined; this.listen(); }, delay);
  }
  start() { this.say(this.state.companionLine); }
  say(text: string) {
    if (this.closed) return;
    this.clearTimer();
    this.stopListening();
    this.stopSpeaking();
    this.patch({ companionLine: text, error: "" });
    if (!this.state.speaker) {
      this.patch({ phase: "idle" });
      this.queueListen();
      return;
    }
    const id = this.speechId;
    const requestedAt = performance.now();
    const current = () => !this.closed && id === this.speechId;
    this.patch({ phase: "preparing" });
    this.playback = this.adapters.speak(text, {
      onStart: () => {
        if (!current()) return;
        this.patch({ phase: "speaking" });
        this.adapters.onTiming?.("call_speech_ms", performance.now() - requestedAt);
        if (this.speechEndedAt) {
          this.adapters.onTiming?.("call_roundtrip_ms", performance.now() - this.speechEndedAt);
          this.speechEndedAt = 0;
        }
        if (this.state.talkOver) this.listen(true);
      },
      onAudioLevel: level => { if (current()) this.adapters.onAudioLevel?.(level); },
      onBoundary: boundary => { if (current()) this.adapters.onBoundary?.(boundary); },
      onEnd: () => {
        if (!current()) return;
        this.stopSpeaking();
        // Keep a headset interruption recording alive when playback finishes.
        this.patch({ phase: this.listener || this.listenPending ? "listening" : "idle" });
        if (!this.listener && !this.listenPending) this.queueListen();
      },
      onError: message => {
        if (!current()) return;
        this.stopSpeaking();
        this.stopListening();
        this.patch({ phase: "idle", error: message });
        this.queueListen(400);
      },
    });
  }
  listen(interruption = false) {
    if (this.closed || this.state.muted || this.listenPending || this.listener) return;
    if (["thinking", "transcribing", "preparing"].includes(this.state.phase)) return;
    if (this.state.phase === "speaking" && !interruption) return;
    this.clearTimer();
    const id = ++this.listenId;
    this.listenPending = true;
    const current = () => !this.closed && id === this.listenId;
    const complete = () => { this.listenId++; this.listener = null; this.listenPending = false; };
    if (!interruption) this.patch({ phase: "opening-mic", userLine: "" });
    void this.adapters.listen({
      interruption,
      onSpeechStart: () => {
        if (!current()) return;
        if (this.state.phase === "speaking") this.stopSpeaking();
        this.patch({ phase: "listening", userLine: "Hearing you…", error: "" });
      },
      onSpeechEnd: () => {
        if (!current()) return;
        this.speechEndedAt = performance.now();
        this.patch({ phase: "transcribing" });
      },
      onTranscript: text => {
        if (!current()) return;
        if (this.speechEndedAt) this.adapters.onTiming?.("call_transcribe_ms", performance.now() - this.speechEndedAt);
        complete();
        void this.submit(text);
      },
      onSilence: () => {
        if (!current()) return;
        complete();
        if (this.state.phase === "speaking") { if (this.state.talkOver) this.listen(true); return; }
        this.patch({ phase: "idle", userLine: "" });
        this.queueListen(200);
      },
      onError: message => {
        if (!current()) return;
        complete();
        this.stopSpeaking();
        this.patch({ phase: "error", error: message, userLine: "" });
        // No unbounded permission/STT retry loop. Explicit retry remains visible.
      },
    }).then(session => {
      if (!current()) { session.cancel(); return; }
      this.listenPending = false;
      this.listener = session;
      if (!interruption && this.state.phase === "opening-mic") this.patch({ phase: "listening" });
    }).catch(error => {
      if (!current()) return;
      complete();
      this.patch({ phase: "error", error: error instanceof Error ? error.message : "Allow microphone access, then try again." });
    });
  }
  private async submit(text: string) {
    if (this.closed || !text.trim() || this.state.phase === "thinking") return;
    this.stopListening();
    this.stopSpeaking();
    const id = ++this.turnId;
    const started = performance.now();
    this.patch({ phase: "thinking", userLine: text.trim(), error: "" });
    try {
      const reply = await this.adapters.respond(text.trim());
      if (this.closed || id !== this.turnId) return;
      this.adapters.onTiming?.("call_reply_ms", performance.now() - started);
      this.say(reply);
    } catch {
      if (this.closed || id !== this.turnId) return;
      this.patch({ phase: "error", error: "The reply service is unavailable. Your last message is still shown; retry when you’re ready." });
    }
  }
  retry() {
    if (this.state.phase === "error" && this.state.userLine && this.state.userLine !== "Hearing you…") { void this.submit(this.state.userLine); return; }
    this.patch({ error: "" });
    this.listen();
  }
  interrupt() {
    if (this.closed || this.state.muted || !["speaking", "preparing"].includes(this.state.phase)) return;
    this.stopSpeaking();
    this.patch({ phase: this.listener || this.listenPending ? "listening" : "idle" });
    if (!this.listener && !this.listenPending) this.queueListen(100);
  }
  setMuted(muted: boolean) {
    this.patch({ muted });
    if (muted) {
      this.clearTimer();
      this.stopListening();
      if (["listening", "opening-mic", "transcribing"].includes(this.state.phase)) this.patch({ phase: "idle" });
    } else if (this.state.phase === "speaking" && this.state.talkOver) this.listen(true);
    else this.queueListen();
  }
  setSpeaker(speaker: boolean) {
    this.patch({ speaker });
    if (!speaker && ["speaking", "preparing"].includes(this.state.phase)) {
      this.stopSpeaking();
      this.patch({ phase: this.listener || this.listenPending ? "listening" : "idle" });
      this.queueListen();
    }
  }
  setTalkOver(talkOver: boolean) {
    this.patch({ talkOver });
    if (this.state.phase === "speaking") {
      if (talkOver) this.listen(true);
      else this.stopListening();
    }
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.turnId++;
    this.clearTimer();
    this.stopListening();
    this.stopSpeaking();
    this.state = { ...this.state, phase: "closed" };
  }
}
