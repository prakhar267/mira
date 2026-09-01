import type { ChatMessage } from "@companion/shared";

export interface ChatChunk {
  delta: string;
  done: boolean;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface ChatProvider {
  readonly id: string;
  stream(input: { messages: ChatMessage[]; context: CompanionContext }): AsyncIterable<ChatChunk>;
}

export interface EmbeddingProvider {
  readonly id: string;
  embed(input: string[]): Promise<number[][]>;
}

export interface SpeechToTextProvider {
  readonly id: string;
  transcribe(audio: Uint8Array, contentType: string): Promise<{ text: string; durationMs: number }>;
}

export interface TextToSpeechProvider {
  readonly id: string;
  synthesize(text: string, voiceId: string): Promise<{ audio: Uint8Array; contentType: string; durationMs: number }>;
}

export interface RealtimeVoiceProvider {
  readonly id: string;
  createSession(input: { companionId: string; userId: string }): Promise<{ sessionId: string; clientSecret: string; expiresAt: string }>;
}

export interface VisionProvider {
  readonly id: string;
  describe(input: { image: Uint8Array; contentType: string; prompt: string }): Promise<string>;
}

export interface ImageGenerationProvider {
  readonly id: string;
  generate(input: { prompt: string; appearance: string }): Promise<{ bytes: Uint8Array; contentType: string }>;
}

export interface ModerationProvider {
  readonly id: string;
  assess(input: string): Promise<SafetyAssessment>;
}

export interface CompanionContext {
  identity: Record<string, unknown>;
  user: Record<string, unknown>;
  relationship: Record<string, unknown>;
  memories: Array<{ id: string; type: string; content: string }>;
  recentMessages: ChatMessage[];
  currentState: {
    now: string;
    timezone: string;
    mood: string;
    topic?: string;
    delivery?: "text" | "voice" | "video";
  };
  responsePreferences?: {
    listeningFirst: boolean;
    responseLength: "short" | "balanced" | "deep";
    adviceStyle: "gentle" | "direct" | "ask-first";
    questionFrequency?: "rare" | "balanced";
  };
  safetyInstructions: string[];
  responseStyle: string[];
}

export interface SafetyAssessment {
  level: "safe" | "support" | "crisis" | "blocked";
  category?: "self_harm" | "violence" | "abuse" | "medical" | "minor_sexual" | "manipulation";
  response?: string;
}
