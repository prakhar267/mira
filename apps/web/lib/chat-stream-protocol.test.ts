import { describe, expect, it, vi } from "vitest";
import { readCompanionReplyStream } from "./chat-stream-protocol";

function bytes(text: string) {
  const input = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({ start(controller) { for (let index = 0; index < input.length; index += 3) controller.enqueue(input.slice(index, index + 3)); controller.close(); } });
}
describe("bounded text-stream protocol", () => {
  it("decodes partial frames and split Hindi UTF-8 without changing the final reply", async () => {
    const prefix = "पहले अपना परिचय दो।", reply = `${prefix} फिर तैयारी करते हैं।`, delta = vi.fn();
    const response = await readCompanionReplyStream(bytes(`${JSON.stringify({ type: "delta", text: prefix })}\n${JSON.stringify({ type: "done", reply, model: "synthetic" })}\n`), new AbortController().signal, delta);
    expect(response.reply).toBe(reply); expect(delta).toHaveBeenCalledWith(prefix);
  });
  it("refuses transport EOF, malformed events and final text diverging from a displayed prefix", async () => {
    for (const content of ['{"type":"delta","text":"A partial reply."}\n', 'not-json\n', '{"type":"delta","text":"Old draft."}\n{"type":"done","reply":"Changed draft.","model":"test"}\n']) {
      await expect(readCompanionReplyStream(bytes(content), new AbortController().signal)).rejects.toMatchObject({ code: "INCOMPLETE_STREAM" });
    }
  });
  it("cancels a stalled reader after abort without accepting a partial success", async () => {
    const abort = new AbortController(), cancel = vi.fn();
    const result = readCompanionReplyStream(new ReadableStream({ cancel }), abort.signal);
    const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" }); abort.abort(); await rejected;
    expect(cancel).toHaveBeenCalledOnce();
  });
});
