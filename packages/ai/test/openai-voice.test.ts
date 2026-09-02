import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIRealtimeVoiceProvider } from "../src/openai-provider";

describe("OpenAI companion voice", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps one neural voice identity while delivery style changes", async () => {
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({
        value: "temporary-client-secret",
        expires_at: 2_000_000_000,
        session: { id: crypto.randomUUID() },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const provider = new OpenAIRealtimeVoiceProvider({
      apiKey: "test-key",
      chatModel: "test-chat",
      embeddingModel: "test-embedding",
      moderationModel: "test-moderation",
      realtimeModel: "test-realtime",
      transcriptionModel: "test-transcription",
      speechModel: "test-speech",
      visionModel: "test-vision",
      imageModel: "test-image",
    });
    const styles = ["mira-warm-01", "mira-playful-01", "mira-soft-01", "mira-seductive-01", "mira-calm-01", "mira-confident-01", "mira-sharp-01"];

    for (const voiceId of styles) {
      await provider.createSession({ companionId: "companion-1", userId: "user-1", voiceId });
    }

    const outputs = requests.map((request) => ((request.session as { audio: { output: { speed: number; voice: string } } }).audio.output));
    expect(new Set(outputs.map((output) => output.voice))).toEqual(new Set(["marin"]));
    expect(new Set(outputs.map((output) => output.speed)).size).toBeGreaterThan(3);
  });
});
