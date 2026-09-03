import { cloudSpeakerForVoice } from "@/lib/speech";

const MODEL = "@cf/deepgram/aura-2-en";
const windowMs = 60_000;
const requestWindows = new Map<string, { count: number; startedAt: number }>();

function rateLimited(request: Request) {
  const key = request.headers.get("cf-connecting-ip") ?? "local";
  const now = Date.now();
  const current = requestWindows.get(key);
  if (!current || now - current.startedAt >= windowMs) {
    requestWindows.set(key, { count: 1, startedAt: now });
    return false;
  }
  current.count += 1;
  return current.count > 40;
}

export async function POST(request: Request) {
  if (rateLimited(request)) return Response.json({ error: "Please wait a moment before playing more speech." }, { status: 429 });
  const body = await request.json().catch(() => null) as { text?: unknown; voiceId?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim().slice(0, 900) : "";
  const voiceId = typeof body?.voiceId === "string" ? body.voiceId.slice(0, 80) : "mira-natural-01";
  if (!text) return Response.json({ error: "Speech text is required." }, { status: 400 });

  try {
    const { env } = await import(/* webpackIgnore: true */ "cloudflare:workers");
    const audio = await env.AI.run(MODEL as never, {
      text,
      speaker: cloudSpeakerForVoice(voiceId),
      encoding: "mp3",
    } as never);
    if (!(audio instanceof ReadableStream)) return Response.json({ error: "Speech audio was unavailable." }, { status: 503 });
    return new Response(audio, {
      headers: {
        "cache-control": "no-store",
        "content-type": "audio/mpeg",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Companion speech failed", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Speech audio was unavailable." }, { status: 503 });
  }
}
