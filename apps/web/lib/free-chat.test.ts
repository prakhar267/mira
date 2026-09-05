import { describe, expect, it } from "vitest";
import { buildFreeChatSystemPrompt, createFreeChatRequest, FREE_CHAT_MODEL, readFreeChatResponse } from "./free-chat";

describe("free chat inference", () => {
  it("creates an anonymous low-latency short-form request", () => {
    const request = createFreeChatRequest([{ role: "user", content: "yaar aaj kaafi hectic tha" }], "voice");
    expect(request.headers).toEqual({ authorization: "Bearer unused", "content-type": "application/json" });
    expect(JSON.parse(String(request.body))).toMatchObject({ model: FREE_CHAT_MODEL, max_tokens: 110 });
  });

  it("keeps the fast prompt concise while preserving Hinglish continuity rules", () => {
    const prompt = buildFreeChatSystemPrompt({
      messages: [
        { role: "user", content: "My sister Priya has an interview tomorrow." },
        { role: "assistant", content: "That is a big day for Priya." },
        { role: "user", content: "main uske liye kya karun?" },
      ],
      companion: { name: "Mira" },
      user: { name: "Prakhar" },
      delivery: "voice",
    });
    expect(prompt).toContain("natural Indian Hinglish");
    expect(prompt).toContain("does not reset the conversation");
    expect(prompt).toContain("Answer short turns normally");
    expect(prompt).toContain("Never say you heard it wrong");
    expect(prompt.length).toBeLessThan(2_500);
  });

  it("reads OpenAI-compatible text and the selected model safely", () => {
    expect(readFreeChatResponse({ model: "codestral-latest", choices: [{ message: { content: "  Haan, woh reply off tha.  " } }] })).toEqual({ text: "Haan, woh reply off tha.", model: "codestral-latest" });
    expect(readFreeChatResponse({ choices: [] })).toEqual({ text: "", model: "" });
  });
});
