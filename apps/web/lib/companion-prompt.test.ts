import { describe, expect, it } from "vitest";
import { buildCompanionSystemPrompt, buildMemoryRecallReply, detectCompanionLanguage, isGenericCompanionReply, isInvalidCompanionReply, isMemoryRecallRequest, requestsListeningOnly, sanitizeCompanionReply } from "./companion-prompt";

const request = {
  messages: [{ role: "user" as const, content: "nothing just monotonous" }],
  companion: { name: "Mira", backstory: "Warm, playful, and observant.", personality: { playfulness: .8 } },
  user: { name: "Prakhar" },
  relationshipMode: "friend",
  memories: ["Prakhar likes old films."],
  responsePreferences: { responseLength: "balanced" as const, adviceStyle: "ask-first" as const, questionFrequency: "balanced" as const },
  delivery: "voice" as const,
};

describe("edge companion prompting", () => {
  it("forbids the canned listener language seen in the failed call", () => {
    const prompt = buildCompanionSystemPrompt(request);
    expect(prompt).toContain("Ordinary statements deserve ordinary conversation");
    expect(prompt).toContain("Do not announce that you are listening or not fixing");
    expect(prompt).toContain("Speech recognition can be imperfect");
    expect(prompt).toContain("natural English");
    expect(prompt).toContain("required reply language");
    expect(prompt).toContain("same conversational cadence in every language");
    expect(prompt).toContain("more poetic, therapeutic, verbose, formal, or performative than Hindi");
  });

  it("locks every reply to the language of the latest turn", () => {
    expect(detectCompanionLanguage("How are you today?")).toBe("en");
    expect(detectCompanionLanguage("आज तुम कैसी हो?" )).toBe("hi");
    expect(detectCompanionLanguage("yaar aaj kaafi busy tha")).toBe("hinglish");
    expect(isInvalidCompanionReply("आज मैं अच्छी हूँ।", "How are you today?")).toBe(true);
    expect(isInvalidCompanionReply("I am good today.", "आज तुम कैसी हो?" )).toBe(true);
    expect(isInvalidCompanionReply("Haan, aaj mood kaafi accha hai.", "yaar tum kaisi ho?")).toBe(false);
  });

  it("enforces listen-only intent and rejects provider identity hallucinations", () => {
    expect(requestsListeningOnly("Please just listen, no advice and no questions.")).toBe(true);
    expect(isInvalidCompanionReply("That meeting really drained you. What happened next?", "Please just listen, no advice and no questions.")).toBe(true);
    expect(isInvalidCompanionReply("Meta designed me and Llama is my basis.", "Who made you?")).toBe(true);
  });

  it("detects generic replies so the UI can use its contextual fallback", () => {
    expect(isGenericCompanionReply("Yeah. I’m listening, not fixing.")).toBe(true);
    expect(isGenericCompanionReply("Monotony can feel like background static.")).toBe(true);
    expect(isGenericCompanionReply("Monotony’s a sneaky thief and I was wondering if there was any particular")).toBe(true);
    expect(isGenericCompanionReply("Monotonous as in every day feels copy-pasted, or is work the repetitive part?")).toBe(false);
  });

  it("removes model reasoning and speaker labels", () => {
    expect(sanitizeCompanionReply("<think>hidden</think> Mira: That routine would bore me too.")).toBe("That routine would bore me too.");
  });

  it("answers explicit English, Hindi, and Hinglish recall from saved facts", () => {
    expect(isMemoryRecallRequest("maine pehle kya bataya tha?")).toBe(true);
    expect(isMemoryRecallRequest("मैंने पहले क्या बताया था?" )).toBe(true);
    expect(buildMemoryRecallReply({ ...request, messages: [{ role: "user", content: "maine pehle kya bataya tha?" }], memories: ["Prakhar said: “I work from a small studio in Pune”"] })).toContain("I work from a small studio in Pune");
    expect(buildMemoryRecallReply({ ...request, messages: [{ role: "user", content: "What do you remember about me?" }], memories: [] })).toContain("don’t have any saved memories");
    expect(buildMemoryRecallReply({ ...request, messages: [{ role: "user", content: "meri behen ke baare mein kya yaad hai?" }], memories: ["User's behen is named Priya."] })).toBe("Haan, mujhe yaad hai: Tumhari behen is named Priya.");
    expect(buildMemoryRecallReply({ ...request, messages: [{ role: "user", content: "What do you remember about my interview?" }], memories: ["Prakhar has a Stripe interview tomorrow."] })).toBe("I remember this: You have a Stripe interview tomorrow.");
  });
});
