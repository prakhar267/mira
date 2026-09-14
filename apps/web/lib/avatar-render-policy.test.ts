import { describe, expect, it } from "vitest";
import { AvatarResolutionBudget, avatarFrameInterval, avatarPixelRatio, avatarSmoothing } from "./avatar-render-policy";

describe("avatar rendering budget", () => {
  it("caps high-DPI and full-screen framebuffers without enlarging low-DPI displays", () => {
    expect(avatarPixelRatio(393, 851, 1)).toBe(1);
    expect(avatarPixelRatio(393, 851, 3)).toBe(1.25);
    const ratio = avatarPixelRatio(2560, 1440, 2);
    expect(2560 * 1440 * ratio ** 2).toBeCloseTo(600_000);
    expect(Number.isFinite(avatarPixelRatio(0, 0, 0))).toBe(true);
  });
  it("reserves input/audio headroom and preserves speech motion in reduced-motion mode", () => {
    expect(avatarFrameInterval(true, false)).toBeCloseTo(1000 / 30);
    expect(avatarFrameInterval(true, true)).toBeCloseTo(1000 / 30);
    expect(avatarFrameInterval(false, false)).toBe(50);
    expect(avatarFrameInterval(false, true)).toBeCloseTo(1000 / 12);
  });
  it("keeps expression easing time-based when rendering at a lower frequency", () => {
    expect(avatarSmoothing(.4, 1 / 60)).toBeCloseTo(.4);
    expect(avatarSmoothing(.4, 1 / 30)).toBeCloseTo(1 - .6 ** 2);
    expect(avatarSmoothing(.4, 1 / 20)).toBeCloseTo(1 - .6 ** 3);
    expect(avatarSmoothing(.4, 10)).toBe(avatarSmoothing(.4, .1));
    expect(avatarSmoothing(.4, -1)).toBe(0);
  });
  it("only steps resolution down after sustained slow frames, with a fixed floor", () => {
    const budget = new AvatarResolutionBudget();
    for (let i = 0; i < 7; i++) expect(budget.observe(100)).toBe(false);
    expect(budget.observe(100)).toBe(true);
    expect(budget.scale).toBe(.875);
    for (let i = 0; i < 8; i++) budget.observe(70);
    expect(budget.scale).toBe(.75);
    for (let i = 0; i < 40; i++) budget.observe(150);
    expect(budget.scale).toBe(.75);
    for (let i = 0; i < 40; i++) budget.observe(16);
    expect(budget.scale).toBe(.75);
  });
  it("ignores resume stalls/invalid timing and does not react to an isolated slow frame", () => {
    const budget = new AvatarResolutionBudget();
    for (let i = 0; i < 20; i++) { budget.observe(80); budget.observe(16); }
    for (const value of [NaN, Infinity, -1, 3000]) expect(budget.observe(value)).toBe(false);
    expect(budget.scale).toBe(1);
  });
});
