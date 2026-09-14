import { describe, expect, it, vi } from "vitest";
import { AccountSync } from "./account-sync";

describe("account synchronization", () => {
  it("serializes writes and coalesces pending state with the returned revision", async () => {
    let first!: (value: { state: string; revision: number }) => void;
    const save = vi.fn().mockImplementationOnce(() => new Promise(resolve => { first = resolve; })).mockResolvedValue({ state: "latest", revision: 3 });
    const status = vi.fn(); const sync = new AccountSync(1, save, status);
    sync.enqueue("first"); sync.enqueue("middle"); sync.enqueue("latest");
    expect(save).toHaveBeenCalledTimes(1);
    first({ state: "first", revision: 2 }); await sync.flush();
    expect(save).toHaveBeenCalledTimes(2); expect(save).toHaveBeenLastCalledWith("latest", 2, expect.any(AbortSignal));
    expect(sync.revision).toBe(3); expect(status).toHaveBeenLastCalledWith("saved");
  });
  it("does not automatically overwrite a conflicting remote revision", async () => {
    const status = vi.fn(); const save = vi.fn().mockRejectedValue({ status: 409 });
    const sync = new AccountSync(1, save, status); sync.enqueue("private draft");
    await expect(sync.flush()).rejects.toEqual({ status: 409 });
    sync.enqueue("newer private draft");
    expect(save).toHaveBeenCalledTimes(1); expect(status).toHaveBeenLastCalledWith("conflict");
  });
  it("stopping prevents pending work and post-unmount status changes", async () => {
    let resolve!: (value: { state: string; revision: number }) => void;
    const status = vi.fn(); const save = vi.fn(() => new Promise<{ state: string; revision: number }>(done => { resolve = done; }));
    const sync = new AccountSync(1, save, status); sync.enqueue("first"); sync.enqueue("second"); sync.stop();
    resolve({ state: "first", revision: 2 }); await sync.flush();
    expect(save).toHaveBeenCalledTimes(1); expect(status).not.toHaveBeenCalledWith("saved");
  });
});
