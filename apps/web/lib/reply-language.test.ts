import { describe, expect, it } from "vitest";
import { matchesReplyLanguage } from "./reply-language";

describe("short Hinglish phrases without artificial filler", () => {
  it.each([
    "All the best for tomorrow! Phod dena.",
    "Reach safely, dhyaan rakhna.",
    "Photo bhej dena.",
    "Milte hain, take care!",
  ])("accepts the Hindi verb phrase: %s", reply => {
    expect(matchesReplyLanguage(reply, "hinglish")).toBe(true);
    expect(matchesReplyLanguage(reply, "en")).toBe(false);
  });
  it.each(["Good luck for tomorrow!", "Dena sent a photo.", "Phil and Dena are coming."])("does not turn English or names into Hinglish: %s", reply => {
    expect(matchesReplyLanguage(reply, "hinglish")).toBe(false);
  });
  it("does not allow an imperative to excuse the wrong script", () => {
    expect(matchesReplyLanguage("अच्छा, phod dena.", "hinglish")).toBe(false);
    expect(matchesReplyLanguage("Phod dena.", "hi")).toBe(false);
  });
});
