import type { ServerEnv } from "@companion/config";
import {
  MockChatProvider,
  MockEmbeddingProvider,
  MockImageProvider,
  MockModerationProvider,
  MockRealtimeVoiceProvider,
  MockSpeechProvider,
  MockVisionProvider,
  OpenAIChatProvider,
  OpenAIEmbeddingProvider,
  OpenAIImageProvider,
  OpenAIModerationProvider,
  OpenAIRealtimeVoiceProvider,
  OpenAISpeechProvider,
  OpenAIVisionProvider,
  type ChatProvider,
  type EmbeddingProvider,
  type ImageGenerationProvider,
  type ModerationProvider,
  type RealtimeVoiceProvider,
  type SpeechToTextProvider,
  type TextToSpeechProvider,
  type VisionProvider,
} from "@companion/ai";
import { InMemoryCompanionRepository, PrismaAuthStore, PrismaCompanionRepository, inMemorySeed, type CompanionRepository } from "@companion/db";
import { AuthService, InMemoryAuthStore, type AuthStore } from "./auth";
import { InfrastructureServices } from "./infrastructure";

export interface ApiRuntime {
  repository: CompanionRepository;
  auth: AuthService;
  infrastructure: InfrastructureServices;
  chat: ChatProvider;
  embedding: EmbeddingProvider;
  moderation: ModerationProvider;
  speechToText: SpeechToTextProvider;
  textToSpeech: TextToSpeechProvider;
  realtime: RealtimeVoiceProvider;
  vision: VisionProvider;
  image: ImageGenerationProvider;
  close(): Promise<void>;
}

export async function createRuntime(env: ServerEnv): Promise<ApiRuntime> {
  const repository = env.PERSISTENCE_PROVIDER === "postgres" ? new PrismaCompanionRepository() : new InMemoryCompanionRepository(inMemorySeed);
  const authStore: AuthStore = repository instanceof PrismaCompanionRepository ? new PrismaAuthStore(repository.prisma) : new InMemoryAuthStore();
  const auth = new AuthService(authStore, env.SESSION_SECRET);
  const infrastructure = new InfrastructureServices(env);

  const openAIConfig = {
    apiKey: env.OPENAI_API_KEY ?? "",
    baseUrl: env.OPENAI_BASE_URL,
    chatModel: env.CHAT_MODEL,
    embeddingModel: env.EMBEDDING_MODEL,
    moderationModel: env.MODERATION_MODEL,
    realtimeModel: env.REALTIME_MODEL,
    transcriptionModel: env.TRANSCRIPTION_MODEL,
    speechModel: env.SPEECH_MODEL,
    visionModel: env.VISION_MODEL,
    imageModel: env.IMAGE_MODEL,
    requestTimeoutMs: env.PROVIDER_TIMEOUT_MS,
  };
  const speech = env.STT_PROVIDER === "openai" || env.TTS_PROVIDER === "openai" ? new OpenAISpeechProvider(openAIConfig) : new MockSpeechProvider();

  return {
    repository,
    auth,
    infrastructure,
    chat: env.CHAT_PROVIDER === "openai" ? new OpenAIChatProvider(openAIConfig) : new MockChatProvider(),
    embedding: env.EMBEDDING_PROVIDER === "openai" ? new OpenAIEmbeddingProvider(openAIConfig) : new MockEmbeddingProvider(),
    moderation: env.MODERATION_PROVIDER === "openai" ? new OpenAIModerationProvider(openAIConfig) : new MockModerationProvider(),
    speechToText: speech,
    textToSpeech: speech,
    realtime: env.REALTIME_VOICE_PROVIDER === "openai" ? new OpenAIRealtimeVoiceProvider(openAIConfig) : new MockRealtimeVoiceProvider(),
    vision: env.VISION_PROVIDER === "openai" ? new OpenAIVisionProvider(openAIConfig) : new MockVisionProvider(),
    image: env.IMAGE_GENERATION_PROVIDER === "openai" ? new OpenAIImageProvider(openAIConfig) : new MockImageProvider(),
    async close() {
      await infrastructure.close();
      if (repository instanceof PrismaCompanionRepository) await repository.disconnect();
    },
  };
}
