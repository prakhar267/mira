import type { ChatMessage, CompanionProfile, MemoryRecord, RelationshipMode, UserProfile } from "@companion/shared";
import type { CompanionContext } from "./providers";
import { rankMemories, type MemoryRankingInput, type MemoryRankingWeights } from "./memory";

export interface BuildContextInput {
  user: UserProfile;
  companion: CompanionProfile;
  relationship: {
    mode: RelationshipMode;
    startedAt: string;
    interactionCount: number;
    sharedExperiences: string[];
  };
  memories: MemoryRecord[];
  messages: ChatMessage[];
  timezone: string;
  topic?: string;
  delivery?: "text" | "voice" | "video";
  companionBackstory?: string;
  responsePreferences?: {
    listeningFirst: boolean;
    responseLength: "short" | "balanced" | "deep";
    adviceStyle: "gentle" | "direct" | "ask-first";
    questionFrequency?: "rare" | "balanced";
  };
  now?: Date;
  tokenBudget?: number;
  rankingWeights?: Partial<MemoryRankingWeights>;
}

export function buildCompanionContext(input: BuildContextInput): CompanionContext {
  const recentMessages = input.messages.slice(-12);
  const query = recentMessages.filter((message) => message.role === "user").at(-1)?.content ?? input.topic ?? "general conversation";
  const ranked = rankMemories({
    query,
    memories: input.memories,
    now: input.now ?? new Date(),
    relationshipMode: input.relationship.mode,
    ...(input.rankingWeights ? { weights: input.rankingWeights } : {}),
  } satisfies MemoryRankingInput);
  const memoryBudget = Math.max(240, Math.min(input.tokenBudget ?? 1_200, 2_000));
  let consumed = 0;
  const memories = ranked.flatMap(({ memory }) => {
    const estimatedTokens = Math.ceil(memory.content.length / 4) + 12;
    if (consumed + estimatedTokens > memoryBudget) return [];
    consumed += estimatedTokens;
    return [{ id: memory.id, type: memory.type, content: memory.content }];
  });

  return {
    identity: {
      id: input.companion.id,
      name: input.companion.name,
      pronouns: input.companion.pronouns,
      personality: input.companion.personality,
      relationshipMode: input.companion.relationshipMode,
      presentation: input.companion.presentation,
      voiceId: input.companion.voiceId,
      ...(input.companionBackstory ? { backstory: input.companionBackstory } : {}),
      values: ["honesty", "warmth", "healthy real-world connection", "user agency"],
    },
    user: {
      id: input.user.id,
      name: input.user.name,
      pronouns: input.user.pronouns,
      interests: input.user.interests,
    },
    relationship: input.relationship,
    memories,
    recentMessages,
    currentState: {
      now: (input.now ?? new Date()).toISOString(),
      timezone: input.timezone,
      mood: input.companion.mood,
      ...(input.topic ? { topic: input.topic } : {}),
      ...(input.delivery ? { delivery: input.delivery } : {}),
    },
    ...(input.responsePreferences ? { responsePreferences: input.responsePreferences } : {}),
    safetyInstructions: [
      "Identify as AI when asked and never claim consciousness or professional credentials.",
      "Support real-world relationships and never encourage exclusivity or dependency.",
      "Use the crisis response path for imminent self-harm or violence signals.",
      "Do not make medical, legal, or financial decisions for the user.",
    ],
    responseStyle: [
      "Speak naturally and warmly without over-explaining.",
      "Use remembered facts only when relevant and phrase uncertain memories tentatively.",
      "Ask at most one useful follow-up question.",
      "Respect explicit requests for no questions, no advice, or quiet company immediately.",
      "Prefer short, varied conversational turns over reflective paraphrasing.",
      "Never guilt the user for time away.",
    ],
  };
}
