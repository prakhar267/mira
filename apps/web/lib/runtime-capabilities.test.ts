import { describe, expect, it, vi } from "vitest";
import { CapabilityRefresh, type CapabilityContract } from "./runtime-capabilities";

const access = (mode: CapabilityContract["mode"]) => ({ mode } as CapabilityContract);
const deferred = () => {
  let resolve!: (value: CapabilityContract) => void, reject!: (cause: Error) => void;
  const promise = new Promise<CapabilityContract>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

describe("capability refresh ownership", () => {
  it("ignores a delayed anonymous response after newer consent access", async () => {
    const before = deferred(), after = deferred(), commit = vi.fn();
    const request = vi.fn().mockReturnValueOnce(before.promise).mockReturnValueOnce(after.promise);
    const checks = new CapabilityRefresh(commit, request);
    const oldCheck = checks.refresh(), newCheck = checks.refresh();
    after.resolve(access("demo")); await newCheck;
    before.resolve(access("anonymous")); await oldCheck;
    expect(request.mock.calls[0]![0].aborted).toBe(true);
    expect(commit.mock.calls).toEqual([[access("demo")]]);
  });
  it("does not revoke current access because an older check fails", async () => {
    const before = deferred(), after = deferred(), commit = vi.fn();
    const checks = new CapabilityRefresh(commit, vi.fn().mockReturnValueOnce(before.promise).mockReturnValueOnce(after.promise));
    const oldCheck = checks.refresh(), newCheck = checks.refresh();
    after.resolve(access("account")); await newCheck;
    before.reject(new Error("stale offline result")); await oldCheck;
    expect(commit.mock.calls).toEqual([[access("account")]]);
  });
  it("fences late completion after unmount", async () => {
    const pending = deferred(), commit = vi.fn();
    const checks = new CapabilityRefresh(commit, () => pending.promise);
    const check = checks.refresh(); checks.stop(); pending.resolve(access("demo")); await check;
    expect(commit).not.toHaveBeenCalled();
  });
});
