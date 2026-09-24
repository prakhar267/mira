import {
  AccountError,
  accountErrorResponse,
  assertSameOrigin,
  requireAccount,
  sha256,
} from "@/lib/account-server";
import { storeAction } from "@/lib/cloud-store";
import {
  edgeRateLimited,
  readEdgeJson,
  EdgeRequestError,
} from "@/lib/edge-security";
import { parsePushDevice, parseReminderRule } from "@/lib/reminders";

export async function GET(request: Request) {
  try {
    const { account } = await requireAccount(request);
    const result = await storeAction<{ error?: string }>({
      action: "remindersRead",
      userId: account.id,
    });
    if (result.error) throw new AccountError(result.error, 401);
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (cause) {
    return accountErrorResponse(cause);
  }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { account } = await requireAccount(request);
    if (await edgeRateLimited(request, "reminder-settings", 30))
      throw new AccountError(
        "Please wait before changing reminder settings again.",
        429,
      );
    const body = (await readEdgeJson(request, 8000)) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AccountError("Invalid reminder request.");
    let data: Record<string, unknown>;
    try {
      if (body.action === "subscribe") {
        const device = parsePushDevice(body.subscription);
        data = {
          action: "remindersSubscribe",
          device,
          id: await sha256(device.endpoint),
        };
      } else if (body.action === "unsubscribe") {
        if (
          body.id !== undefined &&
          (typeof body.id !== "string" || !/^[a-zA-Z0-9_-]{43}$/.test(body.id))
        )
          throw new Error("Invalid device.");
        data = { action: "remindersUnsubscribe", id: body.id };
      } else if (body.action === "save")
        data = { action: "remindersSave", rule: parseReminderRule(body.rule) };
      else if (body.action === "delete") {
        if (
          typeof body.id !== "string" ||
          !/^(daily|event:[a-zA-Z0-9_-]{1,120})$/.test(body.id)
        )
          throw new Error("Invalid reminder.");
        data = { action: "remindersDelete", id: body.id };
      } else throw new Error("Choose a reminder action.");
    } catch (cause) {
      throw new AccountError(
        cause instanceof Error ? cause.message : "Invalid reminder settings.",
      );
    }
    const result = await storeAction<{ error?: string }>({
      ...data,
      userId: account.id,
    });
    if (result.error) throw new AccountError(result.error);
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (cause) {
    return accountErrorResponse(
      cause instanceof EdgeRequestError
        ? new AccountError(cause.message, cause.status)
        : cause,
    );
  }
}
