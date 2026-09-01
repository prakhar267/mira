export interface ResilienceOptions<T> {
  timeoutMs: number;
  retries: number;
  fallback: () => Promise<T> | T;
}

export async function withProviderResilience<T>(operation: () => Promise<T>, options: ResilienceOptions<T>): Promise<T> {
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      return await Promise.race([
        operation(),
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error("provider_timeout")), options.timeoutMs)),
      ]);
    } catch {
      if (attempt === options.retries) return options.fallback();
    }
  }
  return options.fallback();
}

export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;

  constructor(private readonly failureThreshold = 3, private readonly resetAfterMs = 30_000) {}

  canRun(now = Date.now()): boolean {
    if (this.openedAt === null) return true;
    if (now - this.openedAt >= this.resetAfterMs) {
      this.failures = 0;
      this.openedAt = null;
      return true;
    }
    return false;
  }

  success() {
    this.failures = 0;
    this.openedAt = null;
  }

  failure(now = Date.now()) {
    this.failures += 1;
    if (this.failures >= this.failureThreshold) this.openedAt = now;
  }
}
