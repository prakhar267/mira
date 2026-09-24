import { EdgeRequestError } from "./edge-security";
import { providerFetch } from "./provider-fetch";
import { cloudStore } from "./cloud-store";

export interface VoiceChoice {
  id: string;
  name: string;
  description: string;
  language: string;
}
export const DEFAULT_VOICE = "Priya";
export function normalizeVoiceId(value: string | undefined) {
  return !value || value === "mira-natural-01" ? DEFAULT_VOICE : value;
}
export function validVoiceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
}
export function parseVoiceCatalog(value: unknown): VoiceChoice[] {
  const rows = (value as { voices?: unknown[] })?.voices;
  if (!Array.isArray(rows)) throw new Error("Invalid voice catalog");
  const voices = new Map<string, VoiceChoice>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    // Only provider system voices. Custom/cloned/community voices are excluded.
    if (item.source !== "SYSTEM" || !validVoiceId(item.voiceId)) continue;
    voices.set(item.voiceId, {
      id: item.voiceId,
      name: String(item.displayName || item.voiceId).slice(0, 100),
      description: String(item.description || "").slice(0, 300),
      language: String(item.languageCode || item.langCode || "Multilingual")
        .replaceAll("_", "-")
        .slice(0, 40),
    });
  }
  return [...voices.values()].sort((a, b) =>
    a.id === DEFAULT_VOICE
      ? -1
      : b.id === DEFAULT_VOICE
        ? 1
        : a.name.localeCompare(b.name),
  );
}
export async function getVoiceCatalog(
  apiKey: string,
  signal?: AbortSignal,
): Promise<VoiceChoice[]> {
  const cached = await cloudStore.get("voice-catalog:system:v1");
  if (cached) return JSON.parse(cached) as VoiceChoice[];
  const voices = new Map<string, VoiceChoice>();
  let pageToken = "";
  for (let page = 0; page < 4; page++) {
    const params = new URLSearchParams({
      pageSize: "500",
      filter: 'source="SYSTEM"',
      ...(pageToken ? { pageToken } : {}),
    });
    const response = await providerFetch(
      `https://api.inworld.ai/voices/v1/voices?${params}`,
      {
        headers: { authorization: `Basic ${apiKey.replace(/^Basic\s+/i, "")}` },
        signal: AbortSignal.any([
          AbortSignal.timeout(8000),
          ...(signal ? [signal] : []),
        ]),
      },
    );
    if (!response.ok)
      throw new EdgeRequestError(
        "Voice choices could not load. Please retry.",
        503,
      );
    const body = (await response.json()) as {
      voices?: unknown[];
      nextPageToken?: string;
    };
    for (const voice of parseVoiceCatalog(body)) voices.set(voice.id, voice);
    pageToken = body.nextPageToken ?? "";
    if (!pageToken) break;
  }
  if (pageToken || !voices.size)
    throw new EdgeRequestError(
      "The voice catalog is incomplete. Please retry.",
      503,
    );
  const result = [...voices.values()].sort((a, b) =>
    a.id === DEFAULT_VOICE
      ? -1
      : b.id === DEFAULT_VOICE
        ? 1
        : a.name.localeCompare(b.name),
  );
  await cloudStore.put("voice-catalog:system:v1", JSON.stringify(result), {
    expirationTtl: 3600,
  });
  return result;
}
export async function assertVoiceAvailable(
  id: string,
  apiKey: string,
  signal?: AbortSignal,
) {
  if (!validVoiceId(id))
    throw new EdgeRequestError("Choose a voice from the voice library.");
  // Preserve the existing default if the catalog service is temporarily down.
  if (id === DEFAULT_VOICE) return;
  if (!(await getVoiceCatalog(apiKey, signal)).some((voice) => voice.id === id))
    throw new EdgeRequestError(
      "This voice is no longer available. Choose another voice.",
      422,
      "VOICE_UNAVAILABLE",
    );
}
