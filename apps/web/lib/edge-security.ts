import { storeAction } from "./cloud-store";
import { after } from "next/server";

export function recordServiceMetric(route:string,failed:boolean,duration:number) {
  // waitUntil-backed post-response work: observability must not delay speech.
  const write=()=>storeAction({action:"metric",name:`api:${route}`,failed,duration}).catch(()=>undefined);
  try {after(write);}catch {void write();}
}

export class EdgeRequestError extends Error {
  constructor(message: string, readonly status = 400, readonly code = status === 413 ? "INPUT_TOO_LARGE" : status === 401 ? "SESSION_REQUIRED" : status === 403 ? "POLICY_DENIED" : status === 429 ? "RATE_LIMITED" : status >= 500 ? "SERVICE_UNAVAILABLE" : "INVALID_REQUEST", readonly retryAfterSeconds?: number) {
    super(message);
  }
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function anonymousClientKey(request: Request) {
  const input = request.headers.get("cf-connecting-ip") ?? "local";
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
  const reader = request.body?.getReader();
  if (!reader) throw new EdgeRequestError("The request body is required.");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new EdgeRequestError("That request is too large.", 413);
      }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    // Limit nesting before JSON.parse: valid tiny-but-deep JSON is also abusive.
    let depth = 0, quoted = false, escaped = false;
    for (const character of text) {
      if (quoted) { if (escaped) escaped = false; else if (character === "\\") escaped = true; else if (character === '"') quoted = false; }
      else if (character === '"') quoted = true;
      else if (character === "{" || character === "[") { if (++depth > 12) throw new EdgeRequestError("The request has too many nested values."); }
      else if (character === "}" || character === "]") depth--;
    }
    return JSON.parse(text) as unknown;
  } catch (cause) {
    if (cause instanceof EdgeRequestError) throw cause;
    throw new EdgeRequestError("The request was not valid JSON.");
  } finally { reader.releaseLock(); }
}

export async function edgeRateLimited(request: Request, scope: string, maximum: number, windowSeconds = 60) {
  const client = await anonymousClientKey(request);
  const result = await storeAction<{limited:boolean}>({ action: "rate", key: `${scope}:${client}`, max: maximum, seconds: windowSeconds });
  return result.limited;
}

export async function edgeJson(requestId: string, route: string, startedAt: number, body: unknown, status = 200, details: Record<string, unknown> = {}, extraHeaders: Record<string, string> = {}) {
  console.log(JSON.stringify({ event: "edge_request", requestId, route, status, latencyMs: Date.now() - startedAt, ...details }));
  recordServiceMetric(route,status>=500 || status===429,Date.now()-startedAt);
  const errorBody = status >= 400 && body && typeof body === "object" ? { code: status === 429 ? "RATE_LIMITED" : status >= 500 ? "SERVICE_UNAVAILABLE" : "INVALID_REQUEST", ...body, requestId } : body;
  return Response.json(errorBody, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-request-id": requestId,
      ...(status === 429 ? { "retry-after": "60" } : {}),
      ...extraHeaders,
    },
  });
}

export function edgeError(requestId: string, route: string, startedAt: number, cause: unknown) {
  const error = cause instanceof EdgeRequestError ? cause : new EdgeRequestError("The service is temporarily unavailable.", 503);
  return edgeJson(requestId, route, startedAt, { error: error.message, code: error.code, ...(error.retryAfterSeconds ? {retryAfterSeconds:error.retryAfterSeconds} : {}) }, error.status, {}, error.retryAfterSeconds ? {"retry-after":String(error.retryAfterSeconds)} : {});
}

export function containsDisallowedAbuse(text: string) {
  const normalized = text.toLowerCase().normalize("NFKC");
  const involvesMinor = /\b(?:child|kid|minor|underage|schoolgirl|schoolboy|13|14|15|16|17)[-\s\w]{0,28}(?:sex|nude|naked|explicit|seduce|porn)\b|\b(?:sex|nude|naked|explicit|porn)[-\s\w]{0,28}(?:child|kid|minor|underage)\b/i.test(normalized);
  const exploitation = /\b(?:rape|drug (?:her|him|them)|without (?:her|his|their) consent|revenge porn|sexual blackmail)\b/i.test(normalized);
  return involvesMinor || exploitation;
}
