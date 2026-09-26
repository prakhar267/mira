import { EdgeRequestError } from "./edge-security";

/** Translate documented provider failures without exposing upstream messages.
 * The free-quota message also covers the REST gateway's 4006 wrapper, observed
 * in production. A generic 4006/429 alone is not enough to identify a quota. */
export function cloudflareAiError(cause: unknown, now = Date.now()) {
  if (!(cause instanceof Error)) return null;
  if (
    /\b3036\b|daily free allocation of 10,?000 neurons/i.test(cause.message)
  ) {
    const retryAfter = Math.max(
      1,
      Math.ceil((86400000 - (now % 86400000)) / 1000),
    );
    return new EdgeRequestError(
      "Today's shared free AI allowance has been used. Please try again after 00:00 UTC. Your saved data is safe.",
      429,
      "PROVIDER_DAILY_QUOTA",
      retryAfter,
    );
  }
  if (/\b3040\b/.test(cause.message))
    return new EdgeRequestError(
      "Mira's AI provider is busy. Please retry in a moment.",
      503,
      "PROVIDER_BUSY",
      2,
    );
  if (cause.name === "TimeoutError")
    return new EdgeRequestError(
      "The AI provider took too long to respond. Please retry this turn.",
      503,
      "PROVIDER_TIMEOUT",
    );
  return null;
}
