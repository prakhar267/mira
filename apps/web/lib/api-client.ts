import type { ChatMessage, CompanionProfile, UserProfile } from "@companion/shared";

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
  companions: () => request<CompanionProfile[]>("/companions"),
  updateCompanion: (companionId: string, input: { name?: string; relationshipMode?: CompanionProfile["relationshipMode"]; voiceId?: string }) => request<CompanionProfile>(`/companions/${companionId}`, { method: "PATCH", body: JSON.stringify(input) }),
  updatePersonality: (companionId: string, input: Partial<CompanionProfile["personality"]>) => request<CompanionProfile>(`/companions/${companionId}/personality`, { method: "PATCH", body: JSON.stringify(input) }),
  conversations: () => request<Array<{ id: string; companionId: string }>>("/conversations"),
  messages: (conversationId: string) => request<ChatMessage[]>(`/conversations/${conversationId}/messages`),
  createConversation: (companionId: string) => request<{ id: string; companionId: string }>("/conversations", { method: "POST", body: JSON.stringify({ companionId }) }),

  async streamChat(input: { conversationId: string; companionId: string; content: string; clientMessageId: string }, onDelta: (delta: string) => void) {
    const response = await authorizedFetch("/chat/stream", {
      method: "POST",
      body: JSON.stringify(input),
    });
    if (!response.ok || !response.body) {
      const message = await response.json().catch(() => null) as ApiEnvelope<never> | null;
      throw new Error(message && !message.ok ? message.error.message : "Luma could not respond just now.");
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
        if (event === "error") throw new Error(data.message ?? "Luma could not respond just now.");
      }
      if (chunk.done) break;
    }
    return { assistantMessageId };
  },

  synthesize: (text: string, voiceId?: string) => request<{ audioBase64: string; contentType: string }>("/voice/synthesize", { method: "POST", body: JSON.stringify({ text, voiceId }) }),
  transcribe: (audioBase64: string, contentType: string) => request<{ text: string; durationMs: number }>("/voice/transcribe", { method: "POST", body: JSON.stringify({ audioBase64, contentType }) }),
  startCameraSession: () => request<{ sessionId: string; consentRequired: boolean }>("/camera/session", { method: "POST" }),
  analyzeImage: (dataBase64: string, contentType: string, prompt: string) => request<{ description: string }>("/media/analyze", { method: "POST", body: JSON.stringify({ dataBase64, contentType, prompt }) }),
  uploadImage: (name: string, contentType: string, dataBase64: string) => request<{ id: string; url: string }>("/media/upload", { method: "POST", body: JSON.stringify({ name, contentType, dataBase64 }) }),
  generateImage: (prompt: string, appearance: string) => request<{ assetUrl: string; artifactBase64?: string; contentType: string }>("/media/generate", { method: "POST", body: JSON.stringify({ prompt, appearance }) }),
  adminMetrics: (key: string) => request<{ requests: number; successfulRequests: number; averageLatencyMs: number; estimatedCostUsd: number }>("/admin/metrics", { headers: { "x-admin-key": key } }),
  adminProviders: (key: string) => request<Record<string, string | boolean>>("/admin/providers", { headers: { "x-admin-key": key } }),
  adminFlags: (key: string) => request<Record<string, boolean>>("/admin/feature-flags", { headers: { "x-admin-key": key } }),
  updateAdminFlags: (key: string, flags: Record<string, boolean>) => request<Record<string, boolean>>("/admin/feature-flags", { method: "PATCH", headers: { "x-admin-key": key }, body: JSON.stringify(flags) }),

  async connectRealtime(kind: "voice" | "video", companionId: string): Promise<RealtimeConnection> {
    const session = kind === "voice"
      ? await request<{ clientSecret: unknown; callId: string }>("/voice/session", { method: "POST", body: JSON.stringify({ companionId }) })
      : await request<{ id: string; realtime: { clientSecret: unknown } }>("/video/session", { method: "POST", body: JSON.stringify({ companionId, cameraEnabled: kind === "video" }) }).then((data) => ({ clientSecret: data.realtime.clientSecret, callId: data.id }));
    const secret = secretValue(session.clientSecret);
    if (!secret || secret.startsWith("mock-")) throw new Error("Realtime voice is running in local fallback mode.");

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
