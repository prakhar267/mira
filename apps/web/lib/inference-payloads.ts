import type { EdgeCompanionRequest } from "./companion-prompt";
import type { InferencePrincipal } from "./inference-policy";
import { EdgeRequestError } from "./edge-security";
import type { MemoryRecord } from "@companion/shared";
import { assessCompanionSafety } from "./companion-safety";

export function object(value: unknown, keys?: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new EdgeRequestError("The request must be an object.");
  const record = value as Record<string, unknown>;
  if (keys && Object.keys(record).some(key => !keys.includes(key))) throw new EdgeRequestError("The request contains unsupported fields.");
  return record;
}
export function text(value: unknown, name: string, maximum: number, minimum = 1) {
  if (typeof value !== "string" || value.trim().length < minimum) throw new EdgeRequestError(`${name} is required.`);
  if (value.length > maximum) throw new EdgeRequestError(`${name} must be at most ${maximum} characters.`, 413);
  return value.trim();
}
function choice<T extends string>(value: unknown, options: readonly T[], name: string): T {
  if (typeof value !== "string" || !options.includes(value as T)) throw new EdgeRequestError(`${name} is invalid.`);
  return value as T;
}
function number(value: unknown, name: string, min: number, max: number, integer = false) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new EdgeRequestError(`${name} is invalid.`);
  return value;
}
function array(value: unknown, name: string, max: number) {
  if (!Array.isArray(value)) throw new EdgeRequestError(`${name} must be a list.`);
  if (value.length > max) throw new EdgeRequestError(`${name} has too many entries.`, 413);
  return value;
}
export function parseChatPayload(value: unknown, principal?: InferencePrincipal): EdgeCompanionRequest {
  const raw = object(value, ["messages", "companion", "user", "relationshipMode", "memories", "responsePreferences", "delivery"]);
  const messages = array(raw.messages, "Messages", 48).map(value => {
    const message = object(value, ["role", "content"]);
    return { role: choice(message.role, ["user", "assistant"] as const, "Message role"), content: text(message.content, "Message", 8000) };
  });
  if (!messages.length || messages.at(-1)?.role !== "user") throw new EdgeRequestError("The last message must be from you.");
  const companion = object(raw.companion, ["name", "backstory", "personality"]);
  const user = object(raw.user, ["name"]);
  const personality = companion.personality === undefined ? undefined : object(companion.personality, ["warmth", "humor", "curiosity", "assertiveness", "optimism", "energy", "verbosity", "playfulness", "empathy"]);
  const input: EdgeCompanionRequest = { messages, companion: { name: text(companion.name, "Companion name", 80), ...(companion.backstory === undefined ? {} : { backstory: text(companion.backstory, "Background", 8000, 0) }), ...(personality ? { personality: Object.fromEntries(Object.entries(personality).map(([key, value]) => [key, number(value, key, 0, 1)])) } : {}) }, user: { name: text(user.name, "Name", 80) } };
  if (raw.relationshipMode !== undefined) input.relationshipMode = choice(raw.relationshipMode, ["friend", "mentor", "sibling", "romantic", "organic"], "Relationship mode");
  if (raw.delivery !== undefined) input.delivery = choice(raw.delivery, ["text", "voice", "video"], "Delivery");
  if (raw.memories !== undefined) input.memories = array(raw.memories, "Memories", 8).map(value => text(value, "Memory", 2000));
  if (raw.responsePreferences !== undefined) {
    const preferences = object(raw.responsePreferences, ["responseLength", "adviceStyle", "questionFrequency", "listeningFirst"]);
    input.responsePreferences = {};
    if (preferences.responseLength !== undefined) input.responsePreferences.responseLength = choice(preferences.responseLength, ["short", "balanced", "deep"], "Response length");
    if (preferences.adviceStyle !== undefined) input.responsePreferences.adviceStyle = choice(preferences.adviceStyle, ["gentle", "direct", "ask-first"], "Advice style");
    if (preferences.questionFrequency !== undefined) input.responsePreferences.questionFrequency = choice(preferences.questionFrequency, ["rare", "balanced"], "Question frequency");
    if (preferences.listeningFirst !== undefined) { if (typeof preferences.listeningFirst !== "boolean") throw new EdgeRequestError("Listening preference is invalid."); input.responsePreferences.listeningFirst = preferences.listeningFirst; }
  }
  if (principal?.state) {
    const state = principal.state;
    // Account profile, preferences and memory are server-owned; a request cannot
    // import another account's memory or override a revoked memory setting.
    input.user = { name: state.user.name };
    input.companion = { name: state.companion.name, personality: { ...state.companion.personality }, backstory: state.companionBackstory };
    input.relationshipMode = state.companion.relationshipMode;
    input.responsePreferences = state.responsePreferences;
    const active = state.memories.filter(memory => memory.status === "active" && memory.userId === principal.id);
    const requested = new Set(input.memories ?? []);
    const selected = active.filter(memory => requested.has(memory.content));
    input.memories = principal.memoryConsent ? (selected.length ? selected : active.slice(-8)).slice(0, 8).map(memory => memory.content) : [];
  } else if (principal && !principal.memoryConsent) input.memories = [];
  if (input.memories) input.memories = input.memories.filter(memory => !assessCompanionSafety([{ role: "user", content: memory }]));
  return input;
}
export function parseSpeechPayload(value: unknown) {
  return text(object(value, ["text"]).text, "Speech text", 500);
}
export function parseTranscriptionPayload(value: unknown) {
  const raw = object(value, ["audioBase64", "contentType", "durationMs"]);
  const audioBase64 = text(raw.audioBase64, "Recording", 4_000_000, 80);
  const contentType = raw.contentType === undefined ? "audio/webm" : text(raw.contentType, "Recording format", 80);
  if (!/^audio\/(?:webm|wav|mpeg|mp4|ogg)(?:;\s*codecs=[a-z0-9.,_-]+)?$/i.test(contentType) || audioBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audioBase64)) throw new EdgeRequestError("A supported voice recording is required.");
  // Byte limits are authoritative; duration supplied by a browser is only a
  // bounded hint, never proof of actual decoded audio length.
  const durationMs = raw.durationMs === undefined ? undefined : number(raw.durationMs, "Recording duration", 1, 60000);
  return { audioBase64, contentType, durationMs };
}
export function parseMemoryPayload(value: unknown, principal: InferencePrincipal) {
  const raw = object(value, ["query", "memories", "limit"]);
  const query = text(raw.query, "Memory query", 8000);
  const limit = raw.limit === undefined ? 8 : number(raw.limit, "Result limit", 1, 8, true);
  const now = new Date().toISOString();
  let memories: MemoryRecord[] = array(raw.memories ?? [], "Memories", 80).map(value => {
    const item = object(value, ["id", "content", "importance", "updatedAt", "retrievalCount", "pinned"]);
    if (item.pinned !== undefined && typeof item.pinned !== "boolean") throw new EdgeRequestError("Pinned memory value is invalid.");
    const content = text(item.content, "Memory", 2000);
    const updatedAt = item.updatedAt === undefined ? now : text(item.updatedAt, "Memory date", 40);
    if (!Number.isFinite(Date.parse(updatedAt))) throw new EdgeRequestError("Memory date is invalid.");
    return { id: text(item.id, "Memory ID", 100), userId: principal.id, companionId: principal.id, type: "semantic", content, normalizedContent: content.toLowerCase(), importance: item.importance === undefined ? .5 : number(item.importance, "Importance", 0, 1), confidence: .9, sourceMessageIds: [], createdAt: now, updatedAt, retrievalCount: item.retrievalCount === undefined ? 0 : number(item.retrievalCount, "Retrieval count", 0, 1000000, true), status: "active", pinned: item.pinned === true };
  });
  if (principal.state) {
    const active = principal.state.memories.filter(memory => memory.status === "active" && memory.userId === principal.id);
    const requested = new Set(memories.map(memory => memory.id));
    if (memories.some(memory => !active.some(saved => saved.id === memory.id))) throw new EdgeRequestError("A requested memory does not belong to this account or is no longer active.", 403, "MEMORY_ACCESS_DENIED");
    memories = active.filter(memory => requested.has(memory.id)).slice(0, 80);
  }
  return { query, limit, memories };
}
