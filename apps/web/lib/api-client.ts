import type {
  ActivityDefinition,
  ChatMessage,
  CompanionProfile,
  FutureEventRecord,
  JournalEntryRecord,
  MemoryRecord,
  NotificationSettings,
  OwnedItemRecord,
  ResponsePreferences,
  ScheduledNudgeRecord,
  StoreItemRecord,
  SubscriptionState,
  UserProfile,
  WalletState,
  WalletTransactionRecord,
} from "@companion/shared";
import type { EdgeCompanionRequest } from "@/lib/companion-prompt";
import type { SemanticMemoryMatch } from "@/lib/semantic-memory";
import { requestFreeCompanionReply } from "@/lib/free-chat";

const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://127.0.0.1:4000";
const TOKEN_KEY = "luma.production-session.v1";

type ApiEnvelope<T> = { ok: true; data: T; requestId: string } | { ok: false; error: { code: string; message: string }; requestId: string };

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt?: string;
}

export interface SignupInput {
  email: string;
  password: string;
  name: string;
  birthday: string;
  pronouns: UserProfile["pronouns"];
  adultConfirmed: true;
  goals: string[];
  interests: string[];
  companionName: string;
  companionPronouns: CompanionProfile["pronouns"];
  relationshipMode: CompanionProfile["relationshipMode"];
}

export interface RealtimeConnection {
  peer: RTCPeerConnection;
  events: RTCDataChannel;
  audio: HTMLAudioElement;
  disconnect(): void;
}

function storedTokens(): SessionTokens | null {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(window.localStorage.getItem(TOKEN_KEY) ?? "null") as SessionTokens | null; } catch { return null; }
}

function saveTokens(tokens: SessionTokens | null) {
  if (typeof window === "undefined") return;
  if (tokens) window.localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
  else window.localStorage.removeItem(TOKEN_KEY);
}

async function decode<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const body = await response.json() as ApiEnvelope<T>;
  if (!response.ok || !body.ok) throw new Error(body.ok ? `Request failed (${response.status})` : body.error.message);
  return body.data;
}

async function authorizedFetch(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const tokens = storedTokens();
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (tokens?.accessToken) headers.set("authorization", `Bearer ${tokens.accessToken}`);
  const response = await fetch(`${API_ORIGIN}${path}`, { ...init, headers });
  if (response.status === 401 && retry && tokens?.refreshToken && path !== "/auth/refresh") {
    const refresh = await fetch(`${API_ORIGIN}/auth/refresh`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken: tokens.refreshToken }) });
    if (refresh.ok) {
      const next = await decode<SessionTokens>(refresh);
      saveTokens(next);
      return authorizedFetch(path, init, false);
    }
    saveTokens(null);
  }
  return response;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  return decode<T>(await authorizedFetch(path, init));
}

function secretValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "value" in value && typeof (value as { value?: unknown }).value === "string") return (value as { value: string }).value;
  return null;
}

export const companionApi = {
  enabled: process.env.NEXT_PUBLIC_API_MODE === "live",
  hasSession: () => Boolean(storedTokens()?.accessToken),
  clearSession: () => saveTokens(null),

  async demoReply(input: EdgeCompanionRequest, signal?: AbortSignal, onDelta?: (delta: string) => void) {
    return requestFreeCompanionReply(input, signal, onDelta);
  },

  async semanticMemories(query: string, memories: MemoryRecord[], limit = 8) {
    const response = await fetch("/api/companion-memory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query,
        limit,
        memories: memories.map(({ id, content, importance, pinned, updatedAt, retrievalCount }) => ({ id, content, importance, pinned, updatedAt, retrievalCount })),
      }),
    });
    const body = await response.json().catch(() => null) as { matches?: SemanticMemoryMatch[]; model?: string; error?: string } | null;
    if (!response.ok || !Array.isArray(body?.matches)) throw new Error(body?.error ?? "Memory retrieval is unavailable.");
    return { matches: body.matches, model: body.model ?? "unknown" };
  },

  async edgeTranscribe(audioBase64: string, contentType: string, signal?: AbortSignal) {
    const response = await fetch("/api/companion-transcribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ audioBase64, contentType }),
      ...(signal ? { signal } : {}),
    });
    const body = await response.json().catch(() => null) as { text?: string; language?: string; error?: string } | null;
    if (!response.ok || !body?.text) throw new Error(body?.error ?? "The voice note could not be transcribed.");
    return { text: body.text, durationMs: 0 };
  },

  async signup(input: SignupInput) {
    const data = await request<SessionTokens & { user: UserProfile; companion: CompanionProfile }>("/auth/signup", { method: "POST", body: JSON.stringify(input) });
    saveTokens(data);
    return data;
  },

  async login(email: string, password: string) {
    const data = await request<SessionTokens & { user: UserProfile }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    saveTokens(data);
    return data;
  },

  async logout() {
    try { await request<void>("/auth/logout", { method: "POST" }); } finally { saveTokens(null); }
  },
  forgotPassword: (email: string) => request<{ accepted: boolean; mockResetToken?: string }>("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }),
  resetPassword: (token: string, password: string) => request<{ reset: boolean }>("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password }) }),
  verifyEmail: (token: string) => request<{ verified: boolean }>("/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) }),

  me: () => request<UserProfile>("/users/me"),
  updateUser: (input: { name?: string; pronouns?: UserProfile["pronouns"]; timezone?: string }) => request<UserProfile>("/users/me", { method: "PATCH", body: JSON.stringify(input) }),
  companions: () => request<CompanionProfile[]>("/companions"),
  updateCompanion: (companionId: string, input: { name?: string; relationshipMode?: CompanionProfile["relationshipMode"]; voiceId?: string }) => request<CompanionProfile>(`/companions/${companionId}`, { method: "PATCH", body: JSON.stringify(input) }),
  updatePersonality: (companionId: string, input: Partial<CompanionProfile["personality"]>) => request<CompanionProfile>(`/companions/${companionId}/personality`, { method: "PATCH", body: JSON.stringify(input) }),
  conversations: () => request<Array<{ id: string; companionId: string }>>("/conversations"),
  messages: (conversationId: string) => request<ChatMessage[]>(`/conversations/${conversationId}/messages`),
  createConversation: (companionId: string) => request<{ id: string; companionId: string }>("/conversations", { method: "POST", body: JSON.stringify({ companionId }) }),
  deleteConversation: (conversationId: string) => request<void>(`/conversations/${conversationId}`, { method: "DELETE" }),
  memories: () => request<MemoryRecord[]>("/memories"),
  activities: () => request<ActivityDefinition[]>("/activities"),
  wallet: () => request<WalletState>("/wallet"),
  walletTransactions: () => request<WalletTransactionRecord[]>("/wallet/transactions"),
  store: () => request<Array<StoreItemRecord & { owned: boolean; equipped: boolean }>>("/store"),
  inventory: () => request<OwnedItemRecord[]>("/inventory"),
  subscription: () => request<{ subscription: SubscriptionState }>("/subscriptions"),
  journal: () => request<JournalEntryRecord[]>("/journal"),
  events: () => request<FutureEventRecord[]>("/events"),
  nudges: () => request<ScheduledNudgeRecord[]>("/notifications/planned"),
  notifications: () => request<NotificationSettings>("/notifications/preferences"),
  calls: () => request<Array<{ id: string; type: "voice" | "video"; startedAt: string; durationMs?: number; summary?: string }>>("/calls"),
  moments: () => request<Array<{ id: string; type: "call" | "date" | "milestone" | "memory"; title: string; description: string; happenedAt: string; mediaUrl: string }>>("/moments"),
  photos: () => request<Array<{ id: string; type: "selfie" | "moment" | "shared"; caption: string; createdAt: string; mediaUrl: string }>>("/photos"),
  updateMemory: (memoryId: string, input: { content?: string; pinned?: boolean; status?: MemoryRecord["status"] }) => request<MemoryRecord>(`/memories/${memoryId}`, { method: "PATCH", body: JSON.stringify(input) }),
  createMemory: (companionId: string, type: MemoryRecord["type"], content: string) => request<MemoryRecord>("/memories", { method: "POST", body: JSON.stringify({ companionId, type, content, pinned: false }) }),
  deleteMemory: (memoryId: string) => request<void>(`/memories/${memoryId}`, { method: "DELETE" }),
  completeActivity: (activityId: string) => request<WalletState>(`/activities/${activityId}/complete`, { method: "POST", body: JSON.stringify({ idempotencyKey: `web:${activityId}:${crypto.randomUUID()}` }) }),
  purchaseItem: (itemId: string) => request<{ wallet: WalletState; owned: OwnedItemRecord }>("/store/purchase", { method: "POST", body: JSON.stringify({ itemId, idempotencyKey: `web:${itemId}:${crypto.randomUUID()}` }) }),
  equipItem: (itemId: string) => request<OwnedItemRecord[]>(`/inventory/${itemId}/equip`, { method: "POST" }),
  mockUpgrade: (planId: SubscriptionState["planId"]) => request<{ subscription: SubscriptionState }>("/subscriptions/mock-upgrade", { method: "POST", body: JSON.stringify({ planId, idempotencyKey: `web:${planId}:${crypto.randomUUID()}` }) }),
  addJournal: (input: { title: string; content: string; mood: JournalEntryRecord["mood"] }) => request<JournalEntryRecord>("/journal", { method: "POST", body: JSON.stringify({ ...input, tags: [] }) }),
  deleteJournal: (entryId: string) => request<void>(`/journal/${entryId}`, { method: "DELETE" }),
  reflectJournal: (entryId: string) => request<{ reflection: string }>(`/journal/${entryId}/reflect`, { method: "POST" }),
  addEvent: (description: string, eventDate: string) => request<{ event: FutureEventRecord; nudge: ScheduledNudgeRecord | null }>("/events", { method: "POST", body: JSON.stringify({ description, eventDate, status: "confirmed" }) }),
  updateNotifications: (settings: NotificationSettings) => request<NotificationSettings>("/notifications/preferences", { method: "PATCH", body: JSON.stringify(settings) }),
  feedback: (conversationId: string, messageId: string, feedback: "up" | "down", note?: string) => request<{ message: ChatMessage }>(`/conversations/${conversationId}/messages/${messageId}/feedback`, { method: "PATCH", body: JSON.stringify({ feedback, ...(note ? { note } : {}) }) }),
  regenerate: (conversationId: string, messageId: string, memoryEnabled: boolean, responsePreferences?: ResponsePreferences) => request<ChatMessage>(`/conversations/${conversationId}/messages/${messageId}/regenerate`, { method: "POST", body: JSON.stringify({ memoryEnabled, responsePreferences }) }),

  async streamChat(input: { conversationId: string; companionId: string; content: string; clientMessageId: string; memoryEnabled?: boolean; responsePreferences?: ResponsePreferences }, onDelta: (delta: string) => void, signal?: AbortSignal) {
    const response = await authorizedFetch("/chat/stream", {
      method: "POST",
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok || !response.body) {
      const message = await response.json().catch(() => null) as ApiEnvelope<never> | null;
      throw new Error(message && !message.ok ? message.error.message : "Mira could not respond just now.");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let assistantMessageId = "";
    while (true) {
      const chunk = await reader.read();
      pending += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done });
      const blocks = pending.split("\n\n");
      pending = blocks.pop() ?? "";
      for (const block of blocks) {
        const event = block.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim();
        const raw = block.split("\n").find((line) => line.startsWith("data:"))?.slice(5).trim();
        if (!raw) continue;
        const data = JSON.parse(raw) as { delta?: string; assistantMessageId?: string; message?: string };
        if (event === "token" && data.delta) onDelta(data.delta);
        if (event === "done" && data.assistantMessageId) assistantMessageId = data.assistantMessageId;
        if (event === "error") throw new Error(data.message ?? "Mira could not respond just now.");
      }
      if (chunk.done) break;
    }
    return { assistantMessageId };
  },

  synthesize: (text: string, voiceId?: string) => request<{ audioBase64: string; contentType: string; mock?: boolean }>("/voice/synthesize", { method: "POST", body: JSON.stringify({ text, voiceId }) }),
  transcribe: (audioBase64: string, contentType: string) => request<{ text: string; durationMs: number }>("/voice/transcribe", { method: "POST", body: JSON.stringify({ audioBase64, contentType }) }),
  startCameraSession: () => request<{ sessionId: string; consentRequired: boolean }>("/camera/session", { method: "POST" }),
  analyzeImage: (dataBase64: string, contentType: string, prompt: string) => request<{ description: string }>("/media/analyze", { method: "POST", body: JSON.stringify({ dataBase64, contentType, prompt }) }),
  uploadImage: (name: string, contentType: string, dataBase64: string) => request<{ id: string; url: string }>("/media/upload", { method: "POST", body: JSON.stringify({ name, contentType, dataBase64 }) }),
  generateImage: (prompt: string, appearance: string) => request<{ assetUrl: string; artifactBase64?: string; contentType: string }>("/media/generate", { method: "POST", body: JSON.stringify({ prompt, appearance }) }),
  adminMetrics: (key: string) => request<{ requests: number; successfulRequests: number; averageLatencyMs: number; estimatedCostUsd: number }>("/admin/metrics", { headers: { "x-admin-key": key } }),
  adminProviders: (key: string) => request<Record<string, string | boolean>>("/admin/providers", { headers: { "x-admin-key": key } }),
  adminFlags: (key: string) => request<Record<string, boolean>>("/admin/feature-flags", { headers: { "x-admin-key": key } }),
  updateAdminFlags: (key: string, flags: Record<string, boolean>) => request<Record<string, boolean>>("/admin/feature-flags", { method: "PATCH", headers: { "x-admin-key": key }, body: JSON.stringify(flags) }),
  exportData: () => request<Record<string, unknown>>("/data/export", { method: "POST" }),
  async deleteAccount(confirmation: "DELETE") {
    try { await request<void>("/account/delete", { method: "POST", body: JSON.stringify({ confirmation }) }); } finally { saveTokens(null); }
  },

  async connectRealtime(kind: "voice" | "video", companionId: string): Promise<RealtimeConnection> {
    const session = kind === "voice"
      ? await request<{ clientSecret: unknown; callId: string }>("/voice/session", { method: "POST", body: JSON.stringify({ companionId }) })
      : await request<{ id: string; realtime: { clientSecret: unknown } }>("/video/session", { method: "POST", body: JSON.stringify({ companionId, cameraEnabled: kind === "video" }) }).then((data) => ({ clientSecret: data.realtime.clientSecret, callId: data.id }));
    const secret = secretValue(session.clientSecret);
    if (!secret || secret.startsWith("mock-")) {
      await request(`/calls/${session.callId}/end`, { method: "POST" }).catch(() => undefined);
      throw new Error("Realtime voice is running in local fallback mode.");
    }

    const peer = new RTCPeerConnection();
    const audio = new Audio();
    audio.autoplay = true;
    peer.ontrack = (event) => { audio.srcObject = event.streams[0] ?? null; };
    const media = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of media.getTracks()) peer.addTrack(track, media);
    const events = peer.createDataChannel("oai-events");
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    const sdp = await fetch("https://api.openai.com/v1/realtime/calls", { method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/sdp" }, body: offer.sdp ?? "" });
    if (!sdp.ok) {
      for (const track of media.getTracks()) track.stop();
      peer.close();
      throw new Error("The realtime media connection could not be established.");
    }
    await peer.setRemoteDescription({ type: "answer", sdp: await sdp.text() });
    return { peer, events, audio, disconnect() { for (const track of media.getTracks()) track.stop(); events.close(); peer.close(); audio.srcObject = null; void request(`/calls/${session.callId}/end`, { method: "POST" }).catch(() => undefined); } };
  },
};

export type { ChatMessage };
