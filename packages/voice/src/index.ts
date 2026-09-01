export type RealtimeCallState = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "interrupted" | "reconnecting" | "ended";

export interface RealtimeAudioTransport {
  stopOutput(): void;
  startInput(): void;
  stopInput(): void;
  disconnect(): Promise<void>;
}

export class RealtimeCallSession {
  private current: RealtimeCallState = "idle";

  constructor(private readonly transport: RealtimeAudioTransport) {}

  get state(): RealtimeCallState {
    return this.current;
  }

  connect(): void {
    if (this.current !== "idle") return;
    this.current = "connecting";
  }

  connected(): void {
    if (this.current !== "connecting" && this.current !== "reconnecting") return;
    this.current = "listening";
    this.transport.startInput();
  }

  think(): void {
    if (this.current !== "listening") return;
    this.transport.stopInput();
    this.current = "thinking";
  }

  speak(): void {
    if (this.current !== "thinking") return;
    this.current = "speaking";
  }

  bargeIn(): void {
    if (this.current !== "speaking" && this.current !== "thinking") return;
    this.transport.stopOutput();
    this.current = "interrupted";
    this.transport.startInput();
    this.current = "listening";
  }

  reconnect(): void {
    if (this.current === "ended") return;
    this.current = "reconnecting";
  }

  async end(): Promise<void> {
    if (this.current === "ended") return;
    this.transport.stopOutput();
    this.transport.stopInput();
    await this.transport.disconnect();
    this.current = "ended";
  }
}

export interface VoiceStyle {
  emotion: string;
  speakingStyle: "soft" | "playful" | "calm" | "confident" | "warm";
  pace: number;
  energy: number;
  expression: string;
  gesture: string;
}
