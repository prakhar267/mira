import { describe, expect, it } from "vitest";
import { createVeenaRequest, detectVeenaAudioContentType, fitVeenaSpeechPrompt } from "./veena-speech";

describe("Veena Kavya speech adapter", () => {
  it("preserves native Hindi and mixed-language speech text", () => {
    expect(fitVeenaSpeechPrompt("  आज   work बहुत hectic था।  ")).toBe("आज work बहुत hectic था।");
  });

  it("keeps generated prompts inside the Veena call latency budget", () => {
    expect(fitVeenaSpeechPrompt("hello ".repeat(120)).length).toBeLessThanOrEqual(500);
  });

  it("requests the selected Kavya voice with Veena's recommended settings", () => {
    const request = createVeenaRequest("Aaj coffee pe chalein?", "secret");
    expect(request.method).toBe("POST");
    expect(request.headers).toEqual({ "content-type": "application/json", "x-api-key": "secret" });
    expect(JSON.parse(String(request.body))).toEqual({
      text: "Aaj coffee pe chalein?",
      speaker: "kavya",
      temperature: 0.4,
      top_p: 0.9,
      repetition_penalty: 1.05,
    });
  });

  it("accepts real audio signatures and rejects mislabeled payloads", () => {
    const wav = new Uint8Array(48);
    wav.set([0x52, 0x49, 0x46, 0x46], 0);
    wav.set([0x57, 0x41, 0x56, 0x45], 8);
    expect(detectVeenaAudioContentType(wav)).toBe("audio/wav");
    expect(detectVeenaAudioContentType(new TextEncoder().encode("{\"error\":\"bad key\"}"))).toBeNull();
  });
});
