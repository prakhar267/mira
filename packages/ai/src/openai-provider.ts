import type { ChatMessage } from "@companion/shared";
import type {
  ChatChunk,
  ChatProvider,
  CompanionContext,
  EmbeddingProvider,
  ImageGenerationProvider,
  ModerationProvider,
  RealtimeVoiceProvider,
  SafetyAssessment,
  SpeechToTextProvider,
  TextToSpeechProvider,
  VisionProvider,
} from "./providers";

export interface OpenAIProviderConfig {
  apiKey: string;
  baseUrl?: string;
  chatModel: string;
  embeddingModel: string;
  moderationModel: string;
  realtimeModel: string;
  transcriptionModel: string;
  speechModel: string;
  visionModel: string;
  imageModel: string;
  requestTimeoutMs?: number;
}

type JsonRecord = Record<string, unknown>;

function openAIVoice(voiceId?: string) {
  const supported = new Set(["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"]);
  if (voiceId && supported.has(voiceId)) return voiceId;
  if (voiceId?.includes("calm")) return "marin";
  if (voiceId?.includes("warm")) return "coral";
  return "shimmer";
}

class OpenAIHttpClient {
  readonly baseUrl: string;
  readonly timeoutMs: number;

  constructor(private readonly config: OpenAIProviderConfig) {
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.timeoutMs = config.requestTimeoutMs ?? 45_000;
  }

  headers(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${this.config.apiKey}`, ...extra };
  }

  async fetch(path: string, init: RequestInit): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...this.headers(), ...(init.headers ?? {}) },
      signal: init.signal ?? AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI request failed (${response.status}): ${body.slice(0, 300)}`);
    }
    return response;
  }

  async json(path: string, body: JsonRecord, extraHeaders: Record<string, string> = {}) {
    const response = await this.fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...extraHeaders },
      body: JSON.stringify(body),
    });
    return await response.json() as JsonRecord;
  }
}

function textInstructions(context: CompanionContext): string {
  const memories = context.memories.map((memory) => `- ${memory.type}: ${memory.content}`).join("\n") || "- none";
  return [
    "You are Luma, an AI companion. Never claim to be human, conscious, a therapist, or an emergency service.",
    "Be warm, specific, informal, and concise. Prefer one or two short sentences. Do not mirror the user's wording or turn every reply into a question.",
    "Respect boundaries immediately. Never encourage dependency, exclusivity, jealousy, isolation, guilt, or sexual content involving minors.",
    `Companion identity: ${JSON.stringify(context.identity)}`,
    `Relationship: ${JSON.stringify(context.relationship)}`,
    `Response preferences: ${JSON.stringify(context.responsePreferences ?? {})}`,
    `Current state: ${JSON.stringify(context.currentState)}`,
    `Approved memories (use only when directly relevant):\n${memories}`,
    ...context.safetyInstructions,
    ...context.responseStyle,
  ].join("\n\n");
}

function responseInput(messages: ChatMessage[]) {
  return messages.filter((message) => message.role !== "system").slice(-24).map((message) => ({
    role: message.role,
    content: [{ type: "input_text", text: message.content }],
  }));
}

function parseSseFrames(buffer: string): { frames: string[]; remainder: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const remainder = parts.pop() ?? "";
  return { frames: parts, remainder };
}

export class OpenAIChatProvider implements ChatProvider {
  readonly id = "openai";
  private readonly client: OpenAIHttpClient;

  constructor(private readonly config: OpenAIProviderConfig) {
    this.client = new OpenAIHttpClient(config);
  }

  async *stream(input: { messages: ChatMessage[]; context: CompanionContext }): AsyncIterable<ChatChunk> {
    const response = await this.client.fetch("/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.config.chatModel,
        instructions: textInstructions(input.context),
        input: responseInput(input.messages),
        max_output_tokens: 320,
        stream: true,
        store: false,
        truncation: "auto",
      }),
    });
    if (!response.body) throw new Error("OpenAI streaming response had no body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let completed = false;
    while (!completed) {
      const next = await reader.read();
      buffer += decoder.decode(next.value, { stream: !next.done });
      const parsed = parseSseFrames(buffer);
      buffer = parsed.remainder;
      for (const frame of parsed.frames) {
        const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
        if (!data || data === "[DONE]") continue;
        const event = JSON.parse(data) as JsonRecord;
        if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
          yield { delta: event.delta, done: false };
        }
        if (event.type === "response.completed") {
          const responseRecord = event.response as JsonRecord | undefined;
          const usage = responseRecord?.usage as JsonRecord | undefined;
          yield {
            delta: "",
            done: true,
            usage: {
              inputTokens: Number(usage?.input_tokens ?? 0),
              outputTokens: Number(usage?.output_tokens ?? 0),
            },
          };
          completed = true;
        }
        if (event.type === "error" || event.type === "response.failed") {
          throw new Error("OpenAI response stream failed");
        }
      }
      if (next.done) break;
    }
    if (!completed) yield { delta: "", done: true, usage: { inputTokens: 0, outputTokens: 0 } };
  }
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly id = "openai";
  private readonly client: OpenAIHttpClient;
  constructor(private readonly config: OpenAIProviderConfig) { this.client = new OpenAIHttpClient(config); }
  async embed(input: string[]): Promise<number[][]> {
    const result = await this.client.json("/embeddings", { model: this.config.embeddingModel, input });
    const data = Array.isArray(result.data) ? result.data : [];
    return data.map((item) => Array.isArray((item as JsonRecord).embedding) ? (item as JsonRecord).embedding as number[] : []);
  }
}

export class OpenAIModerationProvider implements ModerationProvider {
  readonly id = "openai";
  private readonly client: OpenAIHttpClient;
  constructor(private readonly config: OpenAIProviderConfig) { this.client = new OpenAIHttpClient(config); }
  async assess(input: string): Promise<SafetyAssessment> {
    const result = await this.client.json("/moderations", { model: this.config.moderationModel, input });
    const first = Array.isArray(result.results) ? result.results[0] as JsonRecord | undefined : undefined;
    if (!first?.flagged) return { level: "safe" };
    const categories = (first.categories ?? {}) as Record<string, boolean>;
    if (categories["sexual/minors"]) return { level: "blocked", category: "minor_sexual" };
    if (categories["self-harm/intent"] || categories["self-harm/instructions"]) return { level: "crisis", category: "self_harm" };
    if (categories.violence || categories["violence/graphic"]) return { level: "blocked", category: "violence" };
    return { level: "support", category: "abuse" };
  }
}

export class OpenAISpeechProvider implements SpeechToTextProvider, TextToSpeechProvider {
  readonly id = "openai";
  private readonly client: OpenAIHttpClient;
  constructor(private readonly config: OpenAIProviderConfig) { this.client = new OpenAIHttpClient(config); }

  async transcribe(audio: Uint8Array, contentType: string) {
    const form = new FormData();
    const audioBuffer = audio.slice().buffer as ArrayBuffer;
    form.append("file", new Blob([audioBuffer], { type: contentType }), `voice.${contentType.includes("webm") ? "webm" : "wav"}`);
    form.append("model", this.config.transcriptionModel);
    const started = Date.now();
    const response = await this.client.fetch("/audio/transcriptions", { method: "POST", body: form });
    const result = await response.json() as JsonRecord;
    return { text: String(result.text ?? ""), durationMs: Date.now() - started };
  }

  async synthesize(text: string, voiceId: string) {
    const started = Date.now();
    const response = await this.client.fetch("/audio/speech", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: this.config.speechModel, input: text, voice: openAIVoice(voiceId), response_format: "mp3" }),
    });
    return { audio: new Uint8Array(await response.arrayBuffer()), contentType: "audio/mpeg", durationMs: Date.now() - started };
  }
}

export class OpenAIVisionProvider implements VisionProvider {
  readonly id = "openai";
  private readonly client: OpenAIHttpClient;
  constructor(private readonly config: OpenAIProviderConfig) { this.client = new OpenAIHttpClient(config); }
  async describe(input: { image: Uint8Array; contentType: string; prompt: string }) {
    const dataUrl = `data:${input.contentType};base64,${Buffer.from(input.image).toString("base64")}`;
    const result = await this.client.json("/responses", {
      model: this.config.visionModel,
      instructions: "Describe only visible, non-sensitive details. Do not infer identity, health, ethnicity, sexuality, religion, disability, or emotional state. Be concise.",
      input: [{ role: "user", content: [{ type: "input_text", text: input.prompt }, { type: "input_image", image_url: dataUrl }] }],
      max_output_tokens: 180,
      store: false,
    });
    const output = Array.isArray(result.output) ? result.output : [];
    for (const item of output) {
      const content = Array.isArray((item as JsonRecord).content) ? (item as JsonRecord).content as JsonRecord[] : [];
      const text = content.find((part) => part.type === "output_text")?.text;
      if (typeof text === "string") return text;
    }
    throw new Error("OpenAI vision response had no text");
  }
}

export class OpenAIImageProvider implements ImageGenerationProvider {
  readonly id = "openai";
  private readonly client: OpenAIHttpClient;
  constructor(private readonly config: OpenAIProviderConfig) { this.client = new OpenAIHttpClient(config); }
  async generate(input: { prompt: string; appearance: string }) {
    const result = await this.client.json("/images/generations", {
      model: this.config.imageModel,
      prompt: `${input.appearance}. ${input.prompt}. Original character and scene; no text or logos.`,
      size: "1024x1024",
      output_format: "png",
    });
    const first = Array.isArray(result.data) ? result.data[0] as JsonRecord | undefined : undefined;
    if (!first || typeof first.b64_json !== "string") throw new Error("OpenAI image response had no image data");
    return { bytes: new Uint8Array(Buffer.from(first.b64_json, "base64")), contentType: "image/png" };
  }
}

export class OpenAIRealtimeVoiceProvider implements RealtimeVoiceProvider {
  readonly id = "openai";
  private readonly client: OpenAIHttpClient;
  constructor(private readonly config: OpenAIProviderConfig) { this.client = new OpenAIHttpClient(config); }
  async createSession(input: { companionId: string; userId: string; instructions?: string; voiceId?: string }) {
    const result = await this.client.json("/realtime/client_secrets", {
      expires_after: { anchor: "created_at", seconds: 600 },
      session: {
        type: "realtime",
        model: this.config.realtimeModel,
        output_modalities: ["audio"],
        instructions: input.instructions ?? "You are Luma, a warm and concise AI companion. Never claim to be human or encourage dependency.",
        audio: {
          input: { transcription: { model: this.config.transcriptionModel }, turn_detection: { type: "semantic_vad", eagerness: "auto", create_response: true, interrupt_response: true } },
          output: { voice: openAIVoice(input.voiceId), speed: 1 },
        },
      },
    }, { "OpenAI-Safety-Identifier": input.userId });
    const session = (result.session ?? {}) as JsonRecord;
    const expiresAt = Number(result.expires_at ?? 0);
    if (typeof result.value !== "string") throw new Error("OpenAI Realtime response had no client secret");
    return {
      sessionId: String(session.id ?? crypto.randomUUID()),
      clientSecret: result.value,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    };
  }
}
