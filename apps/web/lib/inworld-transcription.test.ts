import { describe, expect, it } from "vitest";
import { createInworldTranscriptionRequest, INWORLD_STT_MODEL, readInworldTranscript } from "./inworld-transcription";

describe("Inworld transcription", () => {
  it("creates an auto-detected Latin-script Hinglish request", () => {
    const request = createInworldTranscriptionRequest("YWJj", "audio/webm;codecs=opus", "Basic secret");
    expect(request.headers).toEqual({ authorization: "Basic secret", "content-type": "application/json" });
    expect(JSON.parse(String(request.body))).toMatchObject({
      transcribeConfig: { modelId: INWORLD_STT_MODEL, audioEncoding: "AUTO_DETECT", language: "en" },
      audioData: { content: "YWJj" },
    });
  });

  it("uses explicit encodings and safely reads transcripts", () => {
    expect(JSON.parse(String(createInworldTranscriptionRequest("YWJj", "audio/mpeg", "secret").body))).toMatchObject({ transcribeConfig: { audioEncoding: "MP3" } });
    expect(readInworldTranscript({ transcription: { transcript: "  aaj work hectic tha  " } })).toBe("aaj work hectic tha");
    expect(readInworldTranscript({ error: "bad response" })).toBe("");
  });
});
