export type SyncStatus = "saved" | "saving" | "offline" | "conflict" | "failed";
export interface Versioned<T> { state: T; revision: number }
/** One request at a time; edits during a save are coalesced, never locally persisted. */
export class AccountSync<T> {
  private pending: T | undefined;
  private running: Promise<void> | null = null;
  private stopped = false;
  private blocked = false;
  private controller = new AbortController();
  constructor(public revision: number, private save: (state: T, revision: number, signal?: AbortSignal) => Promise<Versioned<T>>, private status: (status: SyncStatus) => void) {}
  enqueue(state: T) { this.pending = state; if (!this.blocked) void this.flush().catch(() => undefined); }
  async flush(): Promise<void> {
    if (this.running) { await this.running; if (this.pending !== undefined) return this.flush(); return; }
    if (this.stopped || this.blocked) throw new Error("Resolve the account sync issue before continuing.");
    const drain = async () => {
      while (this.pending !== undefined && !this.stopped) {
        const state = this.pending;
        this.pending = undefined;
        this.status("saving");
        try {
          const result = await this.save(state, this.revision, this.controller.signal);
          if (this.stopped) return;
          this.revision = result.revision;
        } catch (error) {
          if (this.pending === undefined) this.pending = state;
          this.blocked = true;
          if (!this.stopped) this.status(typeof error === "object" && error !== null && "status" in error && error.status === 409 ? "conflict" : typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "failed");
          throw error;
        }
      }
      if (!this.stopped) this.status("saved");
    };
    this.running = drain();
    try { await this.running; } finally { this.running = null; }
  }
  retry() { this.blocked = false; return this.flush(); }
  stop() { this.stopped = true; this.controller.abort(); this.pending = undefined; }
}
