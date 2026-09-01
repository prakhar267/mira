import type { ChatMessage, MemoryRecord } from "@companion/shared";
import type { ChatChunk, ChatProvider, CompanionContext, EmbeddingProvider, ImageGenerationProvider, SpeechToTextProvider, TextToSpeechProvider, VisionProvider } from "./providers";
import { planCompanionTurn } from "./conversation-engine";

export class MockChatProvider implements ChatProvider {
  readonly id = "mock";

  async *stream(input: { messages: ChatMessage[]; context: CompanionContext }): AsyncIterable<ChatChunk> {
    const last = input.messages.filter((message) => message.role === "user").at(-1)?.content ?? "";
    const response = planCompanionTurn(last, input.context).text;
    const words = response.split(/(\s+)/).filter(Boolean);
    for (const word of words) {
      yield { delta: word, done: false };
    }
    yield {
      delta: "",
      done: true,
      usage: { inputTokens: Math.ceil(last.length / 4), outputTokens: Math.ceil(response.length / 4) },
    };
  }
}

export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly id = "mock";

  async embed(input: string[]): Promise<number[][]> {
    return input.map((text) => {
      const vector = Array.from({ length: 32 }, () => 0);
      for (let index = 0; index < text.length; index += 1) {
        const slot = index % vector.length;
        vector[slot] = (vector[slot] ?? 0) + text.charCodeAt(index) / 255;
      }
      const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
      return vector.map((value) => value / norm);
    });
  }
}

export class MockSpeechProvider implements SpeechToTextProvider, TextToSpeechProvider {
  readonly id = "mock";

  async transcribe(_audio: Uint8Array, _contentType: string) {
    return { text: "This is a simulated voice note transcript.", durationMs: 2_400 };
  }

  async synthesize(text: string, _voiceId: string) {
    return { audio: new TextEncoder().encode(`mock-audio:${text}`), contentType: "audio/mpeg", durationMs: text.length * 45 };
  }
}

export class MockVisionProvider implements VisionProvider {
  readonly id = "mock";
  async describe(_input: { image: Uint8Array; contentType: string; prompt: string }) {
    return "I can see a warmly lit photo. In mock mode I avoid inferring sensitive traits, but we can talk about what the image means to you.";
  }
}

export class MockImageProvider implements ImageGenerationProvider {
  readonly id = "mock";
  async generate(input: { prompt: string; appearance: string }) {
    return { bytes: new TextEncoder().encode(`${input.appearance}:${input.prompt}`), contentType: "application/x-companion-mock-image" };
  }
}

export async function collectMockResponse(messages: ChatMessage[], context: CompanionContext): Promise<string> {
  const provider = new MockChatProvider();
  let result = "";
  for await (const chunk of provider.stream({ messages, context })) result += chunk.delta;
  return result;
}

export function explainResponse(memories: MemoryRecord[], context: CompanionContext): string[] {
  const used = new Set(context.memories.map((memory) => memory.id));
  return memories.filter((memory) => used.has(memory.id)).map((memory) => `Referenced an approved ${memory.type} memory.`);
}
