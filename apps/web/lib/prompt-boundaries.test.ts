import { describe, expect, it } from "vitest";
import {
  buildCompanionSystemPrompt,
  buildContextualDirectReply,
  buildMemoryRecallReply,
  buildIdentityReply,
  canUseSavedMemoryReply,
  detectCompanionLanguage,
  sanitizeCompanionReply,
  sanitizeCompanionReplyForDelivery,
  companionReplyIssue,
  type EdgeCompanionRequest,
} from "./companion-prompt";
const input = (text = "Let's talk about painting."): EdgeCompanionRequest => ({
  messages: [{ role: "user", content: text }],
  companion: { name: "Mira" },
  user: { name: "QA" },
});
describe("prompt preferences and recall boundaries", () => {
  it.each(["en", "hi", "hinglish"] as const)(
    "grounds contextual drafting in the prior user facts for %s",
    (language) => {
      for (const dislikes of [false, true]) {
        const data = input(
          language === "hi"
            ? "उसको क्या संदेश लिखूँ?"
            : language === "hinglish"
              ? "usko kya message bheju?"
              : "What should I text her?",
        );
        data.messages.unshift(
          {
            role: "user",
            content: "My sister Riya has an interview tomorrow.",
          },
          { role: "assistant", content: "That sounds important." },
          ...(dislikes
            ? [{ role: "user" as const, content: "She hates advice." }]
            : []),
        );
        const reply = buildContextualDirectReply(data, language);
        expect(reply).toContain("Riya");
        expect(reply).toContain(
          dislikes
            ? language === "hi"
              ? "कोई सलाह नहीं"
              : language === "hinglish"
                ? "Advice nahi"
                : "No advice"
            : language === "en"
              ? "Thinking"
              : "all the best",
        );
      }
      expect(buildContextualDirectReply(input())).toBeNull();
      expect(
        buildContextualDirectReply({ ...input(), messages: [] }),
      ).toBeNull();
      expect(
        buildContextualDirectReply(input("What should I text her?")),
      ).toBeNull();
    },
  );
  it.each(["short", "balanced", "deep"] as const)(
    "keeps %s response preferences subordinate to identity and memory rules",
    (responseLength) => {
      for (const [text, language] of [
        ["Let's chat.", "English"],
        ["आज दिन अच्छा था।", "Hindi"],
        ["yaar aaj kaafi boring tha", "Hinglish"],
      ]) {
        for (const adviceStyle of ["ask-first", "direct", "gentle"] as const) {
          const prompt = buildCompanionSystemPrompt({
            ...input(text),
            delivery: "text",
            companion: {
              name: " ",
              personality: { humor: 0.5 },
              backstory: " ",
            },
            user: { name: "" },
            memories: ["Likes tea"],
            responsePreferences: {
              responseLength,
              adviceStyle,
              questionFrequency: "rare",
            },
          });
          expect(prompt).toContain(language!);
          expect(prompt).toContain("adult AI companion");
          expect(prompt).toContain("Likes tea");
          expect(prompt).toContain("Do not end this reply with a question");
          expect(prompt).toContain(
            responseLength === "short"
              ? "one short sentence"
              : responseLength === "deep"
                ? "two to four"
                : "one to three",
          );
        }
      }
    },
  );
  it("honors listening-only, recent questions, missing profile and spoken delivery", () => {
    expect(
      buildCompanionSystemPrompt({
        ...input("Just listen, no advice."),
        delivery: "voice",
      }),
    ).toContain("The user asked you to listen only");
    const recent = input();
    recent.messages.unshift({ role: "assistant", content: "How are you?" });
    expect(buildCompanionSystemPrompt(recent)).toContain(
      "Do not end this reply with a question",
    );
    const empty = {
      ...input(),
      messages: [],
      companion: { name: "" },
      user: { name: " " },
    };
    expect(buildCompanionSystemPrompt(empty)).toContain("Mira");
    expect(canUseSavedMemoryReply(empty)).toBe(false);
    expect(buildIdentityReply("")).toContain("Mira");
    expect(buildIdentityReply(" ", "hi")).toContain("AI");
  });
  it.each(["bhai", "brother", "dost", "friend"])(
    "matches bilingual relative labels: %s",
    (topic) => {
      const data = input(`Do you remember my ${topic}?`);
      data.memories = [
        "QA's brother is named Arjun.",
        "QA's friend likes tea.",
        "Likes painting.",
      ];
      const result = buildMemoryRecallReply(data);
      expect(result).toContain(
        topic === "bhai" || topic === "brother" ? "Arjun" : "tea",
      );
      expect(result).not.toContain("painting");
    },
  );
  it("recalls approved facts without a name or lexical query and preserves Hindi grammar", () => {
    for (const name of ["", "QA"]) {
      const data = {
        ...input("तुम्हें मेरे बारे में क्या याद है?"),
        user: { name },
        memories: ["QA likes tea.", "User's sister is Riya."],
      };
      expect(buildMemoryRecallReply(data)).toContain("हाँ, मुझे याद है");
    }
    expect(
      buildMemoryRecallReply({
        ...input(),
        messages: [],
        memories: ["Likes tea."],
      }),
    ).toContain("Likes tea");
    expect(
      buildMemoryRecallReply({
        ...input("!!!"),
        user: { name: "" },
        memories: ["Likes tea."],
      }),
    ).toContain("Likes tea");
    expect(
      buildMemoryRecallReply({
        ...input("yaad hai"),
        memories: ["You likes tea.", "QA works on art.", "QA sent a letter."],
      }),
    ).toContain("Tum");
  });
  it("bounds unpunctuated or quoted text without cutting a usable sentence", () => {
    expect(sanitizeCompanionReply("'hello'")).toBe("hello");
    expect(sanitizeCompanionReply('"hello')).toBe('"hello');
    expect(sanitizeCompanionReply("x".repeat(710))).toHaveLength(698);
    for (const long of [
      "x".repeat(400),
      "word ".repeat(90),
      `${"x".repeat(190)}. ${"y".repeat(190)}`,
    ])
      expect(
        sanitizeCompanionReplyForDelivery(long, "voice").length,
      ).toBeLessThanOrEqual(290);
    expect(companionReplyIssue("I'm listening.", "A quiet day.")).toBe(
      "holding-statement",
    );
  });
  it("recognizes explicit language requests after negated mentions", () => {
    expect(detectCompanionLanguage("hindi me")).toBe("hi");
    expect(detectCompanionLanguage("don't reply in hindi")).toBe("en");
    expect(detectCompanionLanguage("don't reply in english")).toBe("en");
  });
});
