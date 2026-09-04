const localWindows = new Map<string, { count: number; expiresAt: number }>();

export class EdgeRequestError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function anonymousClientKey(request: Request) {
  const input = `${request.headers.get("cf-connecting-ip") ?? "local"}:${request.headers.get("user-agent")?.slice(0, 80) ?? "unknown"}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return base64Url(new Uint8Array(digest)).slice(0, 22);
}

export function assertEdgeSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (origin && origin !== new URL(request.url).origin) throw new EdgeRequestError("That request did not come from this site.", 403);
  if (!origin && fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") throw new EdgeRequestError("That request did not come from this site.", 403);
}

export async function readEdgeJson(request: Request, maximumBytes: number) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maximumBytes) throw new EdgeRequestError("That request is too large.", 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) throw new EdgeRequestError("That request is too large.", 413);
  try { return JSON.parse(text) as unknown; } catch { throw new EdgeRequestError("The request was not valid JSON."); }
}

export async function edgeRateLimited(request: Request, scope: string, maximum: number, windowSeconds = 60) {
  const client = await anonymousClientKey(request);
  const bucket = Math.floor(Date.now() / (windowSeconds * 1_000));
  const key = `${scope}:${client}:${bucket}`;
  const now = Date.now();
  const local = localWindows.get(key);
  if (!local || local.expiresAt <= now) localWindows.set(key, { count: 1, expiresAt: now + windowSeconds * 1_000 });
  else {
    local.count += 1;
    if (local.count > maximum) return true;
  }
  try {
    const { env } = await import(/* webpackIgnore: true */ "cloudflare:workers");
    if (!env.LUMA_ACCOUNTS) return false;
    const storageKey = `edge-limit:${key}`;
    const count = Number(await env.LUMA_ACCOUNTS.get(storageKey) ?? 0) + 1;
    await env.LUMA_ACCOUNTS.put(storageKey, String(count), { expirationTtl: windowSeconds * 2 });
    return count > maximum;
  } catch {
    return false;
  }
}

export function edgeJson(requestId: string, route: string, startedAt: number, body: unknown, status = 200, details: Record<string, unknown> = {}, extraHeaders: Record<string, string> = {}) {
  console.log(JSON.stringify({ event: "edge_request", requestId, route, status, latencyMs: Date.now() - startedAt, ...details }));
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-request-id": requestId,
      ...extraHeaders,
    },
  });
}

export function edgeError(requestId: string, route: string, startedAt: number, cause: unknown) {
  const error = cause instanceof EdgeRequestError ? cause : new EdgeRequestError("The service is temporarily unavailable.", 503);
  return edgeJson(requestId, route, startedAt, { error: error.message }, error.status);
}

export function containsDisallowedAbuse(text: string) {
  const normalized = text.toLowerCase().normalize("NFKC");
  const involvesMinor = /\b(?:child|kid|minor|underage|schoolgirl|schoolboy|13|14|15|16|17)[-\s\w]{0,28}(?:sex|nude|naked|explicit|seduce|porn)\b|\b(?:sex|nude|naked|explicit|porn)[-\s\w]{0,28}(?:child|kid|minor|underage)\b/i.test(normalized);
  const exploitation = /\b(?:rape|drug (?:her|him|them)|without (?:her|his|their) consent|revenge porn|sexual blackmail)\b/i.test(normalized);
  return involvesMinor || exploitation;
}
