import { describe, expect, it } from "vitest";
import { buildCompanionSystemPrompt, buildIdentityReply, buildMemoryRecallReply, detectCompanionLanguage, isGenericCompanionReply, isIdentityRequest, isInvalidCompanionReply, isMemoryRecallRequest, requestsListeningOnly, sanitizeCompanionReply, sanitizeCompanionReplyForDelivery } from "./companion-prompt";

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
    expect(prompt).toContain("natural Indian Hinglish");
    expect(prompt).toContain("Every reply must be natural Latin-script Hinglish");
    expect(prompt).toContain("Never use Devanagari");
  });

  it("accepts all input languages but rejects non-Roman replies", () => {
    expect(detectCompanionLanguage("How are you today?")).toBe("en");
    expect(detectCompanionLanguage("आज तुम कैसी हो?" )).toBe("hi");
    expect(detectCompanionLanguage("yaar aaj kaafi busy tha")).toBe("hinglish");
    expect(detectCompanionLanguage("main uske liye kya kar sakta hoon")).toBe("hinglish");
    expect(isInvalidCompanionReply("आज मैं अच्छी हूँ।", "How are you today?")).toBe(true);
    expect(isInvalidCompanionReply("Main aaj badhiya hoon.", "आज तुम कैसी हो?" )).toBe(false);
    expect(isInvalidCompanionReply("Good luck tomorrow! Just be yourself.", "Okay, what should I text her tonight?")).toBe(true);
    expect(isInvalidCompanionReply("तो फिर बस उसके साथ समय bitta karne ki koshish karo, movie dekhne jao.", "लेकिन उसे सलाह पसंद नहीं है।")).toBe(true);
    expect(isInvalidCompanionReply("main اس کے لئے کیا کر سکتا ہوں", "main uske liye kya kar sakta hoon")).toBe(true);
    expect(isInvalidCompanionReply("तो सलाह छोड़ दो। बस प्रिया को बता दो कि तुम उसके साथ हो, बिना लंबा भाषण दिए।", "लेकिन उसे सलाह पसंद नहीं है।")).toBe(true);
    expect(isInvalidCompanionReply("Haan, aaj mood kaafi accha hai.", "yaar tum kaisi ho?")).toBe(false);
  });

  it("enforces listen-only intent and rejects provider identity hallucinations", () => {
    expect(requestsListeningOnly("Please just listen, no advice and no questions.")).toBe(true);
    expect(isInvalidCompanionReply("That meeting really drained you. What happened next?", "Please just listen, no advice and no questions.")).toBe(true);
    expect(isInvalidCompanionReply("Aaj ka din tough tha. Bas bata do kya hua.", "Please just listen, no advice and no questions.")).toBe(true);
    expect(isInvalidCompanionReply("Meta designed me and Llama is my basis.", "Who made you?")).toBe(true);
  });

  it("answers identity questions consistently in natural Hinglish", () => {
    expect(isIdentityRequest("What is your name and what do you do?")).toBe(true);
    expect(isIdentityRequest("tum kya karti ho?")).toBe(true);
    expect(buildIdentityReply("Mira")).toBe("Main Mira hoon—tumhari AI companion. Tumse chat aur calls par baat karti hoon, aur sirf tumhari approved baatein yaad rakhti hoon.");
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

  it("removes symbols that should not be spoken during calls", () => {
    expect(sanitizeCompanionReplyForDelivery("You've got this. 😎", "voice")).toBe("You've got this.");
    expect(sanitizeCompanionReplyForDelivery("You've got this. 😎", "video")).toBe("You've got this.");
    expect(sanitizeCompanionReplyForDelivery("You've got this. 😎", "text")).toBe("You've got this. 😎");
  });

  it("answers every memory request in Roman Hinglish", () => {
    expect(isMemoryRecallRequest("maine pehle kya bataya tha?")).toBe(true);
    expect(isMemoryRecallRequest("मैंने पहले क्या बताया था?" )).toBe(true);
    expect(buildMemoryRecallReply({ ...request, messages: [{ role: "user", content: "maine pehle kya bataya tha?" }], memories: ["Prakhar said: “I work from a small studio in Pune”"] })).toContain("I work from a small studio in Pune");
    expect(buildMemoryRecallReply({ ...request, messages: [{ role: "user", content: "What do you remember about me?" }], memories: [] })).toContain("saved memory nahi hai");
    expect(buildMemoryRecallReply({ ...request, messages: [{ role: "user", content: "meri behen ke baare mein kya yaad hai?" }], memories: ["User's behen is named Priya."] })).toBe("Haan, mujhe yaad hai: Tumhari behen is named Priya.");
    expect(buildMemoryRecallReply({ ...request, messages: [{ role: "user", content: "meri behen ke baare mein kya yaad hai?" }], memories: ["Prakhar has a Stripe interview tomorrow.", "Prakhar's sister is named Priya."] })).toBe("Haan, mujhe yaad hai: Tumhari sister is named Priya.");
    expect(buildMemoryRecallReply({ ...request, messages: [{ role: "user", content: "What do you remember about my interview?" }], memories: ["Prakhar has a Stripe interview tomorrow."] })).toBe("Haan, mujhe yaad hai: Tumhara Stripe interview tomorrow.");
  });
});
