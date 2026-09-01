import { describe, expect, it, vi } from "vitest";
import { RealtimeCallSession } from "../src";

describe("RealtimeCallSession", () => {
  it("stops output and listens immediately on barge-in", () => {
    const transport = { stopOutput: vi.fn(), startInput: vi.fn(), stopInput: vi.fn(), disconnect: vi.fn(async () => undefined) };
    const session = new RealtimeCallSession(transport);
    session.connect();
    session.connected();
    session.think();
    session.speak();
    session.bargeIn();
    expect(transport.stopOutput).toHaveBeenCalledOnce();
    expect(transport.startInput).toHaveBeenCalledTimes(2);
    expect(session.state).toBe("listening");
  });
});
