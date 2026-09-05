import { describe, expect, it } from "vitest";
import { createInworldSpeechRequest, decodeInworldAudio, fitInworldSpeechPrompt } from "./inworld-speech";

describe("Inworld Priya speech adapter", () => {
  it("preserves native Hindi and mixed-language speech text", () => {
    expect(fitInworldSpeechPrompt("  आज   work बहुत hectic था।  ")).toBe("आज work बहुत hectic था।");
  });

  it("removes user-supplied voice-control markup", () => {
    expect(fitInworldSpeechPrompt("[shout] hello <break time=\"9s\"/> yaar")).toBe("shout hello yaar");
  });

  it("keeps generated prompts inside the low-latency call budget", () => {
    expect(fitInworldSpeechPrompt("hello ".repeat(120)).length).toBeLessThanOrEqual(500);
  });

  it("requests Priya with one warm, balanced delivery", () => {
    const request = createInworldSpeechRequest("Aaj coffee pe chalein?", "Basic secret");
    expect(request.method).toBe("POST");
    expect(request.headers).toEqual({ authorization: "Basic secret", "content-type": "application/json" });
    expect(JSON.parse(String(request.body))).toMatchObject({
      voiceId: "Priya",
      modelId: "inworld-tts-2-flash",
      deliveryMode: "BALANCED",
      audioConfig: { audioEncoding: "MP3", sampleRateHertz: 48_000, bitRate: 128_000 },
    });
  });

  it("accepts MP3 audio and rejects provider error payloads", () => {
    expect(decodeInworldAudio(btoa("ID3valid audio bytes"))).toEqual(expect.any(Uint8Array));
    expect(() => decodeInworldAudio(btoa('{"error":"bad key"}'))).toThrow("invalid audio");
  });
});
