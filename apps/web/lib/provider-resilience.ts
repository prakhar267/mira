type Provider = "llm7" | "cloudflare-chat" | "cloudflare" | "inworld-speech" | "inworld-transcribe";
const circuits = new Map<Provider, { failures: number; retryAt: number }>();

export class ProviderBackoffError extends Error {
  constructor(message: string, readonly retryAfterSeconds: number) { super(message); }
}

export async function withProviderDeadline<T>(provider: Provider, work: (signal: AbortSignal) => Promise<T>, timeoutMs: number, parent?: AbortSignal): Promise<T> {
  const state = circuits.get(provider);
  if (state && state.retryAt > Date.now()) throw new Error("Provider cooling down");
  const controller = new AbortController();
  const signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      work(signal),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("Provider deadline exceeded")); }, timeoutMs); }),
    ]);
    circuits.delete(provider);
    return value;
  } catch (cause) {
    if (!parent?.aborted) {
      const failures = (state?.failures ?? 0) + 1;
      const cooldown = cause instanceof ProviderBackoffError ? Math.min(300, Math.max(1, cause.retryAfterSeconds)) * 1_000 : failures >= 3 ? 30_000 : 0;
      circuits.set(provider, { failures, retryAt: cooldown ? Date.now() + cooldown : 0 });
    }
    throw cause;
  } finally { if (timer) clearTimeout(timer); }
}

export function providerCircuitStatus() {
  return Object.fromEntries([...circuits].map(([name, value]) => [name, { coolingDown: value.retryAt > Date.now(), retryAfterSeconds: Math.max(0, Math.ceil((value.retryAt - Date.now()) / 1000)) }]));
}
