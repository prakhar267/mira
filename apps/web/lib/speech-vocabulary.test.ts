import {describe, expect, it} from "vitest";
import {speechVocabulary} from "./speech-vocabulary";
import {parseTranscriptionPayload} from "./inference-payloads";

describe("ephemeral speech vocabulary", () => {
  it("keeps proper names from accepted speech, not common pronouns or a language lock", () => {
    expect(speechVocabulary("My friend Anika is visiting Pune. We speak English.")).toEqual(["Anika", "Pune"]);
    expect(speechVocabulary("नेहा कल पुणे आ रही है।")).toContain("पुणे");
    expect(speechVocabulary("one")).toEqual([]);
    expect(speechVocabulary("Mira aur Priya mere dost hain")).toEqual(["Mira", "Priya"]);
  });
  it("limits and deduplicates hints", () => {
    expect(speechVocabulary("Pune Pune Pune")).toEqual(["Pune"]);
    expect(speechVocabulary(Array.from({length:30},(_,i)=>`City${String.fromCharCode(65+i)}`).join(" ")).length).toBeLessThanOrEqual(12);
  });
  const input={audioBase64:"x".repeat(80),contentType:"audio/webm"};
  it("validates vocabulary before provider work and remains backward compatible", () => {
    expect(parseTranscriptionPayload(input).vocabulary).toEqual([]);
    expect(parseTranscriptionPayload({...input,vocabulary:["Pune","Pune","पुणे"]}).vocabulary).toEqual(["Pune","पुणे"]);
    for(const vocabulary of [["x".repeat(41)],Array(13).fill("Pune"),["https://example.test"],["<instruction>"],[{}],"Pune"]) {
      expect(()=>parseTranscriptionPayload({...input,vocabulary})).toThrow();
    }
  });
});
