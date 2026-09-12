import { assertEdgeSameOrigin, EdgeRequestError, edgeError, edgeJson, edgeRateLimited, readEdgeJson } from "@/lib/edge-security";
import { cloudStore } from "@/lib/cloud-store";

function parseSupportRequest(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const summary = typeof input.summary === "string" ? input.summary.trim() : "";
  const details = typeof input.details === "string" ? input.details.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim() : "";
  const page = typeof input.page === "string" ? input.page.trim() : "";
  if (summary.length < 5 || summary.length > 140 || details.length < 10 || details.length > 3_000 || page.length > 120) return null;
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return null;
  return { summary, details, email: email || null, page: page || null };
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  try {
    assertEdgeSameOrigin(request);
    if (await edgeRateLimited(request, "support", 4, 3_600)) throw new EdgeRequestError("Too many reports were submitted. Please try again later.", 429);
    const report = parseSupportRequest(await readEdgeJson(request, 8_000));
    if (!report) throw new EdgeRequestError("Please check the summary, details, and email fields.");
    const ticketId = `MIRA-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    await cloudStore.put(`support:${ticketId}`, JSON.stringify({ ticketId, ...report, status: "new", createdAt: new Date().toISOString() }), { expirationTtl: 90 * 86_400 });
    return edgeJson(requestId, "support", startedAt, { ticketId }, 201, { ticketId });
  } catch (cause) {
    return edgeError(requestId, "support", startedAt, cause);
  }
}
