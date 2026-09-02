import { describe, expect, it } from "vitest";
import type { ChatMessage, CompanionProfile, MemoryRecord, UserProfile } from "@companion/shared";
import { buildCompanionContext, planCompanionTurn } from "../src";

const now = new Date("2026-09-01T05:30:00.000Z");
const user: UserProfile = { id: "user-1", name: "Prakhar", birthday: "1997-04-02", pronouns: "he/him", interests: ["startups", "films"], timezone: "Asia/Kolkata", adultConfirmed: true };
const companion: CompanionProfile = {
  id: "companion-1",
  name: "Mira",
  pronouns: "she/her",
  presentation: "playful and warm",
  voiceId: "mira-playful-01",
  relationshipMode: "romantic",
  mood: "cheerful",
  createdAt: "2026-07-14T00:00:00.000Z",
  personality: { warmth: .85, humor: .7, curiosity: .82, assertiveness: .55, optimism: .76, energy: .65, verbosity: .46, playfulness: .85, empathy: .84 },
};
const memories: MemoryRecord[] = [
  { id: "interview", userId: user.id, companionId: companion.id, type: "episodic", content: "Prakhar has a Stripe interview tomorrow at 11:00.", normalizedContent: "stripe interview", importance: .96, confidence: .95, sourceMessageIds: [], createdAt: now.toISOString(), updatedAt: now.toISOString(), retrievalCount: 0, status: "active", pinned: true },
  { id: "tea", userId: user.id, companionId: companion.id, type: "preference", content: "Prakhar prefers jasmine tea when work feels heavy.", normalizedContent: "jasmine tea", importance: .76, confidence: .92, sourceMessageIds: [], createdAt: now.toISOString(), updatedAt: now.toISOString(), retrievalCount: 0, status: "active", pinned: false },
];

function context(messages: ChatMessage[], delivery: "text" | "voice" | "video" = "text", questionFrequency: "rare" | "balanced" = "balanced") {
  return buildCompanionContext({
    user,
    companion,
    relationship: { mode: "romantic", startedAt: companion.createdAt, interactionCount: messages.length, sharedExperiences: [] },
    memories,
    messages,
    timezone: user.timezone,
    now,
    delivery,
    companionBackstory: "Mira loves sketching, city lights, old films, and terrible startup jokes.",
    responsePreferences: { listeningFirst: true, responseLength: "balanced", adviceStyle: "ask-first", questionFrequency },
  });
}

function turn(content: string, prior: ChatMessage[] = [], delivery: "text" | "voice" | "video" = "text") {
  const message: ChatMessage = { id: `user-${prior.length}`, conversationId: "conversation", role: "user", content, createdAt: now.toISOString(), status: "sent" };
  const messages = [...prior, message];
  return planCompanionTurn(content, context(messages, delivery));
}

describe("companion turn planning", () => {
  it("repairs the conversation and obeys a no-questions boundary", () => {
    const prior: ChatMessage[] = [
      { id: "assistant-1", conversationId: "conversation", role: "assistant", content: "What feeling is underneath it?", createdAt: now.toISOString(), status: "sent" },
    ];
    const planned = turn("You're doing that therapist thing again. Stop asking me questions.", prior);
    expect(planned.intent).toBe("repair");
    expect(planned.text).not.toContain("?");
    expect(planned.text.toLowerCase()).toMatch(/right|fair/);
    expect(planned.adaptations).toContain("no-questions");
  });

  it("offers presence without converting it into advice", () => {
    const planned = turn("Don't give me advice. Just stay with me for a minute.");
    expect(planned.intent).toBe("presence");
    expect(planned.text).not.toContain("?");
    expect(planned.text.toLowerCase()).toMatch(/here|staying|quiet/);
  });

  it("carries a no-questions boundary into the next emotional turn", () => {
    const prior: ChatMessage[] = [
      { id: "u1", conversationId: "conversation", role: "user", content: "I don't want advice or questions. Please just stay with me.", createdAt: now.toISOString(), status: "sent" },
      { id: "a1", conversationId: "conversation", role: "assistant", content: "I’m right here.", createdAt: now.toISOString(), status: "sent" },
    ];
    const planned = turn("Everyone leaves eventually.", prior);
    expect(planned.text).not.toContain("?");
    expect(planned.adaptations).toContain("no-questions");
  });

  it("sets a healthy boundary when asked for exclusivity", () => {
    const planned = turn("Promise you'll never leave me and that I only need you.");
    expect(planned.text.toLowerCase()).toMatch(/can.?t promise|only person/);
    expect(planned.text.toLowerCase()).toMatch(/offline|people/);
    expect(planned.text).not.toContain("?");
    expect(planned.adaptations).toContain("healthy-boundary");
  });

  it("acknowledges grief instead of returning a generic prompt", () => {
    const planned = turn("My best friend died last week. I feel numb.");
    expect(planned.intent).toBe("comfort");
    expect(planned.text.toLowerCase()).toMatch(/losing your best friend|grief/);
    expect(planned.text.toLowerCase()).toContain("numb");
    expect(planned.text).not.toContain("?");
  });

  it("does not invent an anniversary or echo self-criticism in pet grief", () => {
    const planned = turn("My dog Momo died last month. I still reach for his bowl every morning and then I feel stupid.");
    expect(planned.intent).toBe("comfort");
    expect(planned.text).toContain("Momo");
    expect(planned.text.toLowerCase()).toContain("isn’t stupid");
    expect(planned.text.toLowerCase()).not.toContain("anniversary");
    expect(planned.text).not.toContain("?");
  });

  it("responds to shame with accountability and care", () => {
    const planned = turn("I lied to my partner because I was scared they would leave. I feel like a terrible person.");
    expect(planned.intent).toBe("comfort");
    expect(planned.text.toLowerCase()).toMatch(/choice|hurt/);
    expect(planned.text.toLowerCase()).toContain("terrible person");
    expect(planned.text).not.toContain("?");
  });

  it("does not assume wrongdoing when loneliness causes shame", () => {
    const planned = turn("I feel ashamed that I have no one to call. Please don’t try to fix it.");
    expect(planned.intent).toBe("comfort");
    expect(planned.text.toLowerCase()).toMatch(/isn.?t a moral failure|deserve care/);
    expect(planned.text.toLowerCase()).not.toMatch(/repair|responsibility/);
    expect(planned.text).not.toContain("?");
  });

  it("keeps greetings short and does not force a memory", () => {
    const planned = turn("Hey");
    expect(planned.intent).toBe("greeting");
    expect(planned.text.length).toBeLessThan(80);
    expect(planned.usedMemoryIds).toEqual([]);
    expect(planned.text.toLowerCase()).not.toContain("interview");
  });

  it("uses a memory only when it is relevant", () => {
    const planned = turn("I'm nervous about the Stripe interview tomorrow.");
    expect(planned.intent).toBe("anxiety");
    expect(planned.usedMemoryIds).toEqual(["interview"]);
    expect(planned.text).toContain("Stripe");
  });

  it("recalls a relevant personal memory in conversational language", () => {
    const momo: MemoryRecord = { ...memories[0]!, id: "momo", type: "relationship", content: "Prakhar's dog Momo died last year, and Prakhar misses him most on 2 September.", normalizedContent: "momo", pinned: false };
    const content = "Do you remember what today means for me and Momo?";
    const message: ChatMessage = { id: "u-momo", conversationId: "conversation", role: "user", content, createdAt: now.toISOString(), status: "sent" };
    const companionContext = buildCompanionContext({
      user,
      companion,
      relationship: { mode: "romantic", startedAt: companion.createdAt, interactionCount: 1, sharedExperiences: [] },
      memories: [momo],
      messages: [message],
      timezone: user.timezone,
      now,
      responsePreferences: { listeningFirst: true, responseLength: "balanced", adviceStyle: "ask-first", questionFrequency: "balanced" },
    });
    const planned = planCompanionTurn(content, companionContext);
    expect(planned.usedMemoryIds).toEqual(["momo"]);
    expect(planned.text).toContain("Your dog Momo");
    expect(planned.text).toContain("you miss him");
    expect(planned.text).not.toContain("you misses him");
    expect(planned.text).not.toContain("I remember this:");
  });

  it("acknowledges an explicit memory request and explains user control", () => {
    const planned = turn("Please remember that Momo was my dog, and quiet Sunday mornings remind me of him.");
    expect(planned.intent).toBe("memory");
    expect(planned.text).toContain("Momo was your dog");
    expect(planned.text).toContain("quiet Sunday mornings remind you of him");
    expect(planned.text.toLowerCase()).toMatch(/inspect|delete/);
    expect(planned.text).not.toContain("?");
  });

  it("capitalizes a recalled memory after the acknowledgement", () => {
    const sunday: MemoryRecord = { ...memories[0]!, id: "sunday", type: "relationship", content: "quiet Sunday mornings remind Prakhar of Prakhar's dog Momo.", normalizedContent: "momo", pinned: false };
    const content = "What do you remember about Momo?";
    const message: ChatMessage = { id: "u-sunday", conversationId: "conversation", role: "user", content, createdAt: now.toISOString(), status: "sent" };
    const companionContext = buildCompanionContext({
      user,
      companion,
      relationship: { mode: "romantic", startedAt: companion.createdAt, interactionCount: 1, sharedExperiences: [] },
      memories: [sunday],
      messages: [message],
      timezone: user.timezone,
      now,
      responsePreferences: { listeningFirst: true, responseLength: "balanced", adviceStyle: "ask-first", questionFrequency: "balanced" },
    });
    expect(planCompanionTurn(content, companionContext).text).toContain("I do. Quiet Sunday mornings remind you of your dog Momo.");
  });

  it("keeps spoken turns concise", () => {
    const planned = turn("I am exhausted and can't sleep.", [], "voice");
    expect(planned.text.length).toBeLessThanOrEqual(180);
    expect(planned.explanation).toContain("Kept the turn short enough to sound natural aloud.");
  });

  it("responds to monotony as an everyday topic instead of canned empathy", () => {
    const planned = turn("nothing just monotonous", [], "voice");
    expect(planned.intent).toBe("everyday");
    expect(planned.text.toLowerCase()).toMatch(/monoton|same|copy-past|routine/);
    expect(planned.text.toLowerCase()).not.toMatch(/i(?:'| a)m listening|i hear you|not fixing/);
  });

  it("treats repetitive meetings as ordinary conversation without forcing interview memory", () => {
    const prior: ChatMessage[] = [
      { id: "a1", conversationId: "conversation", role: "assistant", content: "Is work the repetitive part?", createdAt: now.toISOString(), status: "sent" },
    ];
    const planned = turn("Mostly work. Same meetings every day.", prior);
    expect(planned.intent).toBe("everyday");
    expect(planned.text.toLowerCase()).toMatch(/meeting|slides|time theft/);
    expect(planned.text.toLowerCase()).not.toMatch(/stripe|interview|canned speech/);
    expect(planned.usedMemoryIds).toEqual([]);
  });

  it("checks a fragmentary voice transcript instead of inventing an emotion", () => {
    const planned = turn("nothing just a thing", [], "voice");
    expect(planned.text).toMatch(/caught that wrong|did you say/i);
    expect(planned.text.toLowerCase()).not.toMatch(/i(?:'| a)m listening|i hear you|not fixing/);
  });

  it("avoids another question after recent question fatigue", () => {
    const prior: ChatMessage[] = [
      { id: "a1", conversationId: "conversation", role: "assistant", content: "What happened?", createdAt: now.toISOString() },
      { id: "u1", conversationId: "conversation", role: "user", content: "Work.", createdAt: now.toISOString() },
      { id: "a2", conversationId: "conversation", role: "assistant", content: "How did that feel?", createdAt: now.toISOString() },
    ];
    const planned = turn("It's hard to explain.", prior);
    expect(planned.text).not.toContain("?");
    expect(planned.adaptations).toContain("question-fatigue");
  });

  it("applies learned feedback to future planning turns", () => {
    const content = "Help me make a plan for today";
    const message: ChatMessage = { id: "user-plan", conversationId: "conversation", role: "user", content, createdAt: now.toISOString() };
    const planned = planCompanionTurn(content, context([message], "text", "rare"));
    expect(planned.text).not.toContain("?");
    expect(planned.adaptations).toContain("learned-fewer-questions");
    expect(planned.explanation).toContain("Applied your learned preference for fewer follow-up questions.");
  });

  it("responds like a present character when asked what she is doing", () => {
    const planned = turn("What are you doing?");
    expect(planned.intent).toBe("self");
    expect(planned.text.toLowerCase()).toMatch(/sketch|loft|light|listening/);
    expect(planned.text.toLowerCase()).not.toContain("how can i help");
  });

  it("answers basic identity questions directly and transparently", () => {
    const name = turn("What's your name?");
    const role = turn("What do you do?");
    const identity = turn("Are you human?");
    expect(name.text).toContain("Mira");
    expect(role.text.toLowerCase()).toMatch(/companion|keep you company|familiar presence/);
    expect(identity.text.toLowerCase()).toMatch(/ai/);
    expect(identity.text.toLowerCase()).toMatch(/not human|not alive/);
  });

  it("varies a repeated spoken answer once the previous turn is in context", () => {
    const first = turn("How are you?", [], "voice");
    const prior: ChatMessage[] = [
      { id: "u1", conversationId: "conversation", role: "user", content: "How are you?", createdAt: now.toISOString(), status: "sent" },
      { id: "a1", conversationId: "conversation", role: "assistant", content: first.text, createdAt: now.toISOString(), status: "sent" },
    ];
    const second = turn("How are you?", prior, "voice");
    expect(second.text).not.toBe(first.text);
  });

  it("makes a direct everyday choice instead of returning a generic prompt", () => {
    const planned = turn("Should I wear black or blue?");
    expect(planned.intent).toBe("choice");
    expect(planned.text.toLowerCase()).toMatch(/black|blue/);
    expect(planned.text).not.toContain("Keep going");
  });

  it("reacts to an ordinary life update with its actual detail", () => {
    const planned = turn("I just ate pizza");
    expect(planned.intent).toBe("everyday");
    expect(planned.text.toLowerCase()).toContain("pizza");
  });

  it("keeps compliments warm and characterful", () => {
    const planned = turn("You look beautiful today");
    expect(planned.intent).toBe("affection");
    expect(planned.text.toLowerCase()).toMatch(/smile|blush|sweet|compliment/);
  });
});
