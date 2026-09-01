import { describe, expect, it } from "vitest";
import { AvatarBehaviorEngine } from "../src";

describe("AvatarBehaviorEngine", () => {
  it("avoids immediate gesture repetition and maps listening to eye contact", () => {
    const engine = new AvatarBehaviorEngine();
    const first = engine.next({ phase: "listening", expression: "playful", random: 0 });
    const second = engine.next({ phase: "listening", expression: "playful", random: 0 });
    expect(first.gaze).toBe("camera");
    expect(second.gesture).not.toBe(first.gesture);
  });
});
