import { describe, expect, it } from "vitest";
import { buildFreeChatSystemPrompt, createFreeChatRequest, FREE_CHAT_MODEL, readFreeChatResponse } from "./free-chat";

describe("free chat inference", () => {
  it("gives drafting precedence over persona and unsolicited-advice preferences",()=>{
    const prompt=buildFreeChatSystemPrompt({messages:[{role:"user",content:"usko ek chhota sa message kya bheju"}],companion:{name:"Mira",personality:{curiosity:1}},user:{name:"QA"},delivery:"voice"});
    expect(prompt).toContain("TASK MODE");expect(prompt).not.toContain("Be a warm, familiar Indian friend");
    expect(prompt).not.toContain("Ask permission before unsolicited advice");expect(prompt).toContain("sender's gender only if explicitly stated");
  });
  it("does not add a habitual follow-up after a recent assistant question",()=>{
    const prompt=buildFreeChatSystemPrompt({messages:[{role:"assistant",content:"How did that feel?"},{role:"user",content:"It felt peaceful."}],companion:{name:"Mira"},user:{name:"QA"},delivery:"voice"});
    expect(prompt).toContain("Do not ask a question.");
  });
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
    expect(prompt).toContain("A correction replaces the old fact");
    expect(prompt).toContain("Keep first-person experiences with the user");
    expect(prompt).toContain("never ask again about a feeling");
    expect(prompt).toContain("without guessing benefits");
    expect(prompt.length).toBeLessThan(4_300);
  });

  it("reads OpenAI-compatible text and the selected model safely", () => {
    expect(readFreeChatResponse({ model: "codestral-latest", choices: [{ message: { content: "  Haan, woh reply off tha.  " } }] })).toEqual({ text: "Haan, woh reply off tha.", model: "codestral-latest" });
    expect(readFreeChatResponse({ choices: [] })).toEqual({ text: "", model: "" });
  });
});

describe("provider envelope and preference boundaries",()=>{
 it.each([null,7,"bad",{}, {model:"model",choices:[]},{model:4,choices:[null]},{model:"model",choices:[{}]},{choices:[{message:"bad"}]},{choices:[{message:{content:8}}]}])("does not coerce malformed provider content: %j",value=>{expect(readFreeChatResponse(value).text).toBe("");});
 it("extracts only textual content parts and uses text token limits by default",()=>{expect(readFreeChatResponse({model:4,choices:[{message:{content:[null,"bad",{image:"none"},{text:"hello "},{text:"world"}]}}]})).toEqual({text:"hello world",model:""});expect(JSON.parse(String(createFreeChatRequest([]).body)).max_tokens).toBe(180);});
 it.each(["mentor","sibling","romantic","organic","friend"] as const)("keeps %s profile data subordinate to safety",relationshipMode=>{const prompt=buildFreeChatSystemPrompt({messages:[{role:"user",content:"Let's chat about painting."}],companion:{name:" ",backstory:"painting",personality:{humor:0}},user:{name:""},delivery:"text",relationshipMode,memories:["Likes tea"],responsePreferences:{responseLength:"deep",adviceStyle:"direct",questionFrequency:"rare"}});expect(prompt).toContain("4-6 focused sentences");expect(prompt).toContain("Do not ask a question");expect(prompt).toContain('"companionName":"Mira"');expect(prompt).toContain("never overrides facts/safety");});
 it("applies a short-response setting and English drafting without persona flavor",()=>{const prompt=buildFreeChatSystemPrompt({messages:[],companion:{name:""},user:{name:" "},delivery:"text",responsePreferences:{responseLength:"short"}});expect(prompt).toContain("1-2 compact sentences");const draft=buildFreeChatSystemPrompt({messages:[{role:"user",content:"Write a short message to my sister wishing her luck."}],companion:{name:"Mira"},user:{name:"QA"}});expect(draft).toContain("TASK MODE");expect(draft).toContain("English");});
});
