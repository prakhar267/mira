import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SELF, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { cleanupWorkerState } from "./cleanup.mjs";
import { after, withResponseScope } from "./framework-shim.mjs";

const origin = "http://localhost:4173";
beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("External network forbidden in synthetic Worker tests"); })); });
afterEach(async () => { await cleanupWorkerState(); vi.unstubAllGlobals(); });

async function session() {
  const response = await SELF.fetch(`${origin}/api/demo/session`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ adultDeclared: true, aiProcessingConsent: true, memoryConsent: false, policyVersion: "2026-09-13" }) });
  expect(response.status).toBe(201); await response.arrayBuffer();
  return response.headers.get("set-cookie").split(";")[0];
}
function chat(cookie, content, delivery = "text") {
  return SELF.fetch(`${origin}/api/companion-chat`, { method: "POST", headers: { origin, cookie, "content-type": "application/json", accept: "application/x-ndjson" }, body: JSON.stringify({ messages: [{ role: "user", content }], companion: { name: "Mira" }, user: { name: "Synthetic adult" }, delivery }) });
}

describe("text stream response body inside Workers with synthetic provider binding", () => {
  it("delivers voice and video replies on model stop without waiting for transport EOF",async()=>{
    const cookie=await session();
    for(const delivery of ["voice","video"]){
      const response=await chat(cookie,"Confirm the travel plan. [synthetic-model-stop]",delivery);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({reply:"Sunday morning departure, got it."});
    }
  });
  it("streams Priya through real consent and capacity boundaries without leaking provider JSON", async()=>{
    const cookie=await session();
    const response=await SELF.fetch(`${origin}/api/companion-speech`,{method:"POST",headers:{origin,cookie,"content-type":"application/json","x-mira-audio-stream":"1"},body:JSON.stringify({text:"Aaj chai achhi thi."})});
    expect(response.status).toBe(200);expect(response.headers.get("x-mira-audio-stream")).toBe("mp3");
    expect(response.headers.get("x-companion-voice")).toBe("Priya");
    expect(await response.text()).toBe("ID3synthetic-stream-not-acoustic-QA");
  });
  it("refuses streamed speech when demo consent has been revoked, before sending audio headers",async()=>{
    const cookie=await session();
    const revoked=await SELF.fetch(`${origin}/api/demo/session`,{method:"DELETE",headers:{origin,cookie}});await revoked.arrayBuffer();
    const response=await SELF.fetch(`${origin}/api/companion-speech`,{method:"POST",headers:{origin,cookie,"content-type":"application/json","x-mira-audio-stream":"1"},body:JSON.stringify({text:"hello"})});
    expect([401,403]).toContain(response.status);expect(response.headers.get("x-mira-audio-stream")).toBeNull();await response.arrayBuffer();
  });
  it("finishes a pulled delta/done response through real policy, capacity and SQLite boundaries", async () => {
    const response = await chat(await session(), "Help me prepare for my interview tomorrow.");
    expect(response.status).toBe(200); expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    const events = new TextDecoder().decode(await response.arrayBuffer()).trim().split("\n").map(JSON.parse);
    expect(events[0]).toMatchObject({ type: "delta", text: "That sounds good." });
    expect(events.at(-1)).toMatchObject({ type: "done", reply: "That sounds good. Tell me a little more about it.", model: "@cf/google/gemma-4-26b-a4b-it" });
    expect(events.every(event => event.requestId === response.headers.get("x-request-id"))).toBe(true);
    expect(events.filter(event => event.type === "done")).toHaveLength(1);
  });
  it("finishes a typed post-header stream error without declaring partial success", async () => {
    const response = await chat(await session(), "Help me prepare for my interview. [synthetic-stream-failure]");
    expect(response.status).toBe(200);
    const events = new TextDecoder().decode(await response.arrayBuffer()).trim().split("\n").map(JSON.parse);
    expect(events[0]).toMatchObject({ type: "delta", text: "Let's practice your introduction." });
    expect(events.at(-1)).toMatchObject({ type: "error", code: "STREAM_FAILED", status: 503, requestId: response.headers.get("x-request-id") });
    expect(events.some(event => event.type === "done")).toBe(false);
  });
  it("preserves complete JSON replies for voice and video even when a caller asks for text streaming", async () => {
    const cookie = await session();
    for (const delivery of ["voice", "video"]) {
      const response = await chat(cookie, "Help me prepare for my interview tomorrow.", delivery);
      expect(response.status).toBe(200); expect(response.headers.get("content-type")).toContain("application/json");
      expect(await response.json()).toMatchObject({ reply: "That sounds good. Tell me a little more about it.", model: "@cf/google/gemma-4-26b-a4b-it" });
    }
  });
  it("keeps post-response work in the real execution context and drains it before cleanup", async () => {
    const context = createExecutionContext(), completed = [];
    const stub = env.MIRA_STORE.get(env.MIRA_STORE.idFromName("scheduler-regression"));
    await withResponseScope(context, async () => {
      after(async () => {
        const response = await stub.fetch("https://store.internal/", { method: "POST", body: JSON.stringify({ action: "put", key: "support:scheduled", value: "{}" }) });
        await response.arrayBuffer(); completed.push("stored");
      });
    });
    await waitOnExecutionContext(context);
    expect(completed).toEqual(["stored"]);
    const stored = await stub.fetch("https://store.internal/", { method: "POST", body: JSON.stringify({ action: "get", key: "support:scheduled" }) });
    expect(await stored.json()).toEqual({ value: "{}" });
  });
});
