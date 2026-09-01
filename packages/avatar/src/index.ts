export type AvatarFormat = "vrm" | "gltf" | "live2d" | "raster-fallback";
export type AvatarPhase = "idle" | "noticing" | "listening" | "thinking" | "speaking" | "reacting";
export type AvatarExpression = "neutral" | "happy" | "excited" | "laughing" | "shy" | "playful" | "curious" | "concerned" | "thoughtful" | "surprised" | "sleepy" | "romantic" | "flirty" | "blushing" | "teasing";
export type AvatarGesture = "wave" | "nod" | "shake-head" | "laugh" | "shrug" | "look-away" | "lean-closer" | "lean-back" | "cross-arms" | "chin-touch" | "small-clap" | "excited-bounce" | "hair-adjustment" | "blow-kiss" | "heart" | "hug" | "dance" | "stretch" | "idle-breathing";
export type GazeMode = "camera" | "side-glance" | "downward" | "soft-focus";

export interface AvatarBehavior {
  phase: AvatarPhase;
  expression: AvatarExpression;
  gesture: AvatarGesture;
  gaze: GazeMode;
  intensity: number;
}

export interface AvatarRenderer {
  readonly format: AvatarFormat;
  load(characterUrl: string, environmentUrl: string): Promise<void>;
  render(behavior: AvatarBehavior): void;
  dispose(): void;
}

export interface LipSyncEngine {
  startFromVisemes(visemes: Array<{ phoneme: string; startMs: number; endMs: number }>): void;
  startFromAmplitude(sample: number): void;
  stop(): void;
}

const gesturesByExpression: Record<AvatarExpression, AvatarGesture[]> = {
  neutral: ["idle-breathing", "nod"],
  happy: ["nod", "small-clap"],
  excited: ["excited-bounce", "small-clap"],
  laughing: ["laugh", "lean-back"],
  shy: ["look-away", "hair-adjustment"],
  playful: ["look-away", "lean-closer"],
  curious: ["chin-touch", "lean-closer"],
  concerned: ["chin-touch", "nod"],
  thoughtful: ["chin-touch", "look-away"],
  surprised: ["lean-back", "small-clap"],
  sleepy: ["stretch", "idle-breathing"],
  romantic: ["lean-closer", "heart"],
  flirty: ["look-away", "hair-adjustment"],
  blushing: ["look-away", "hair-adjustment"],
  teasing: ["lean-closer", "look-away"],
};

export class AvatarBehaviorEngine {
  private history: AvatarGesture[] = [];

  next(input: { phase: AvatarPhase; expression: AvatarExpression; intensity?: number; random?: number }): AvatarBehavior {
    const candidates = gesturesByExpression[input.expression];
    const available = candidates.filter((gesture) => !this.history.slice(-2).includes(gesture));
    const pool = available.length ? available : candidates;
    const random = Math.max(0, Math.min(.999, input.random ?? Math.random()));
    const gesture = pool[Math.floor(random * pool.length)]!;
    this.history.push(gesture);
    if (this.history.length > 6) this.history.shift();

    const gaze: GazeMode = input.phase === "listening"
      ? "camera"
      : input.expression === "shy" || input.expression === "blushing"
        ? "downward"
        : input.phase === "thinking" || input.expression === "teasing"
          ? "side-glance"
          : "soft-focus";

    return {
      phase: input.phase,
      expression: input.expression,
      gesture,
      gaze,
      intensity: Math.max(0, Math.min(1, input.intensity ?? .55)),
    };
  }
}

export interface EnvironmentRenderer {
  setEnvironment(id: string): Promise<void>;
  setTimeOfDay(hour: number): void;
  setAmbience(id: string, volume: number): void;
}
