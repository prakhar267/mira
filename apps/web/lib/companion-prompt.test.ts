import { describe, expect, it } from "vitest";
import { buildCompanionSystemPrompt, buildContextualDirectReply, buildIdentityReply, buildMemoryRecallReply, detectCompanionLanguage, detectCompanionRequestLanguage, isGenericCompanionReply, isIdentityRequest, isInvalidCompanionReply, isMemoryRecallRequest, requestsListeningOnly, sanitizeCompanionReply, sanitizeCompanionReplyForDelivery } from "./companion-prompt";

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
    expect(prompt).toContain("Never announce that you heard the user wrong");
    expect(prompt).toContain("natural conversational English");
    expect(prompt).toContain("Match the language of the latest user turn");
    expect(prompt).toContain("Facts, people, pronouns, preferences, corrections");
  });

  it("detects each input language and validates matching replies", () => {
    expect(detectCompanionLanguage("How are you today?")).toBe("en");
    expect(detectCompanionLanguage("आज तुम कैसी हो?" )).toBe("hi");
    expect(detectCompanionLanguage("yaar aaj kaafi busy tha")).toBe("hinglish");
    expect(detectCompanionLanguage("main uske liye kya kar sakta hoon")).toBe("hinglish");
    expect(detectCompanionLanguage("English में बात करें। Hindi में नहीं, English.")).toBe("en");
    expect(detectCompanionLanguage("मैं बोल रहा हूँ English नहीं, Hinglish में बोलो")).toBe("hinglish");
    expect(detectCompanionLanguage("Please don't speak Hindi, talk in English")).toBe("en");
    expect(detectCompanionLanguage("अब हिंदी में बात करो")).toBe("hi");
    expect(isInvalidCompanionReply("I’m good today.", "How are you today?")).toBe(false);
    expect(isInvalidCompanionReply("Main aaj badhiya hoon.", "How are you today?")).toBe(true);
    expect(isInvalidCompanionReply("आज मैं अच्छी हूँ।", "आज तुम कैसी हो?" )).toBe(false);
    expect(isInvalidCompanionReply("Main aaj badhiya hoon.", "आज तुम कैसी हो?" )).toBe(true);
    expect(isInvalidCompanionReply("Good luck tomorrow! Just be yourself.", "Okay, what should I text her tonight?")).toBe(false);
    expect(isInvalidCompanionReply("तो फिर बस उसके साथ समय bitta karne ki koshish karo, movie dekhne jao.", "लेकिन उसे सलाह पसंद नहीं है।")).toBe(false);
    expect(isInvalidCompanionReply("main اس کے لئے کیا کر سکتا ہوں", "main uske liye kya kar sakta hoon")).toBe(true);
    expect(isInvalidCompanionReply("तो सलाह छोड़ दो। बस प्रिया को बता दो कि तुम उसके साथ हो, बिना लंबा भाषण दिए।", "लेकिन उसे सलाह पसंद नहीं है।")).toBe(false);
    expect(isInvalidCompanionReply("Haan, aaj mood kaafi accha hai.", "yaar tum kaisi ho?")).toBe(false);
    expect(isInvalidCompanionReply("Hamesha aisa hi karta hai.", "woh manager hamesha aisa hi karti hai")).toBe(true);
  });

  it("keeps short acknowledgements in the active language but switches on clear input", () => {
    expect(detectCompanionRequestLanguage({ messages: [
      { role: "user", content: "आज काम बहुत मुश्किल था" },
      { role: "assistant", content: "आज सच में बहुत load था।" },
      { role: "user", content: "okay" },
    ] })).toBe("hi");
    expect(detectCompanionRequestLanguage({ messages: [
      { role: "user", content: "yaar aaj work bahut hectic tha" },
      { role: "assistant", content: "Haan, kaafi load tha." },
      { role: "user", content: "Tell me what you think about it" },
    ] })).toBe("en");
  });

  it("resolves a named person through English, Hinglish, Hindi, then English", () => {
    const messages = [
      { role: "user" as const, content: "My sister Priya has an interview tomorrow and she is nervous." },
      { role: "assistant" as const, content: "Big day for Priya." },
      { role: "user" as const, content: "main uske liye kya kar sakta hoon?" },
      { role: "assistant" as const, content: "Uske saath normal raho." },
      { role: "user" as const, content: "लेकिन उसे सलाह पसंद नहीं है।" },
      { role: "assistant" as const, content: "तो advice छोड़ दो।" },
      { role: "user" as const, content: "Okay, what should I text her tonight?" },
    ];
    const reply = buildContextualDirectReply({ ...request, messages, delivery: "text" });
    expect(reply).toContain("Priya");
    expect(reply).toContain("No advice");
  });

  it("enforces listen-only intent and rejects provider identity hallucinations", () => {
    expect(requestsListeningOnly("Please just listen, no advice and no questions.")).toBe(true);
    expect(requestsListeningOnly("yaar bas suno, advice mat dena aur sawal mat poochna")).toBe(true);
    expect(isInvalidCompanionReply("That meeting really drained you. What happened next?", "Please just listen, no advice and no questions.")).toBe(true);
    expect(isInvalidCompanionReply("Haan, samajh raha hoon. Kya hua?", "yaar bas suno advice mat dena")).toBe(true);
    expect(isInvalidCompanionReply("Haan, samajh rahi hoon. Launch wali nervousness ko abhi bas yahin rehne dete hain.", "yaar bas suno advice mat dena")).toBe(false);
    expect(isInvalidCompanionReply("Aaj ka din tough tha. Bas bata do kya hua.", "Please just listen, no advice and no questions.")).toBe(true);
    expect(isInvalidCompanionReply("Meta designed me and Llama is my basis.", "Who made you?")).toBe(true);
    expect(isInvalidCompanionReply("I'm a large language model, so I don't have feelings like humans do, but I'm working properly and ready to chat.", "What about you?")).toBe(true);
  });

  it("answers identity questions in the user's current language", () => {
    expect(isIdentityRequest("What is your name and what do you do?")).toBe(true);
    expect(isIdentityRequest("tum kya karti ho?")).toBe(true);
    expect(buildIdentityReply("Mira")).toBe("Main Mira hoon—tumhari AI companion. Tumse chat aur calls par baat karti hoon, aur sirf tumhari approved baatein yaad rakhti hoon.");
    expect(buildIdentityReply("Mira", "en")).toContain("I’m Mira, your AI companion");
    expect(buildIdentityReply("Mira", "hi")).toContain("मैं Mira हूँ");
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

  it("keeps generated call replies concise for low-latency speech", () => {
    const longReply = `${"Yaar aaj ka din kaafi long tha, but tumne phir bhi handle kar liya. ".repeat(8)}Bas ab thoda breathe karo.`;
    expect(sanitizeCompanionReplyForDelivery(longReply, "voice").length).toBeLessThanOrEqual(290);
    expect(sanitizeCompanionReplyForDelivery(longReply, "video").length).toBeLessThanOrEqual(290);
    expect(sanitizeCompanionReplyForDelivery(longReply, "text").length).toBeGreaterThan(290);
  });

  it("answers memory requests in the user's current language", () => {
    expect(isMemoryRecallRequest("maine pehle kya bataya tha?")).toBe(true);
    expect(isMemoryRecallRequest("मैंने पहले क्या बताया था?" )).toBe(true);
    expect(buildMemoryRecallReply({ ...request, messages: [{ role: "user", content: "maine pehle kya bataya tha?" }], memories: ["Prakhar said: “I work from a small studio in Pune”"] })).toContain("I work from a small studio in Pune");
    expect(buildMemoryRecallReply({ ...request, messages: [{ role: "user", content: "What do you remember about me?" }], memories: [] })).toBe("I don’t have any saved memories about you yet.");
    expect(buildMemoryRecallReply({ ...request, messages: [{ role: "user", content: "meri behen ke baare mein kya yaad hai?" }], memories: ["User's behen is named Priya."] })).toBe("Haan, mujhe yaad hai: Tumhari behen is named Priya.");
    expect(buildMemoryRecallReply({ ...request, messages: [{ role: "user", content: "meri behen ke baare mein kya yaad hai?" }], memories: ["Prakhar has a Stripe interview tomorrow.", "Prakhar's sister is named Priya."] })).toBe("Haan, mujhe yaad hai: Tumhari sister is named Priya.");
    expect(buildMemoryRecallReply({ ...request, messages: [{ role: "user", content: "What do you remember about my interview?" }], memories: ["Prakhar has a Stripe interview tomorrow."] })).toBe("Yes, I remember: You have a Stripe interview tomorrow.");
    expect(buildMemoryRecallReply({ ...request, messages: [{ role: "user", content: "मैंने पहले क्या बताया था?" }], memories: [] })).toContain("कोई saved memory नहीं");
  });
});
