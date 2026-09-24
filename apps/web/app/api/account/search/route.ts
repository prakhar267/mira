import {
  accountErrorResponse,
  AccountError,
  requireAccount,
} from "@/lib/account-server";
import { storeAction } from "@/lib/cloud-store";
import { edgeRateLimited } from "@/lib/edge-security";
import type { SearchOptions } from "@/lib/conversation-search";

export async function GET(request: Request) {
  try {
    const { account } = await requireAccount(request);
    if (await edgeRateLimited(request, "conversation-search", 40))
      throw new AccountError("Please wait before searching again.", 429);
    const params = new URL(request.url).searchParams;
    const messageId = params.get("messageId");
    if (messageId) {
      if (!/^[a-zA-Z0-9_:-]{1,120}$/.test(messageId))
        throw new AccountError("Invalid message.");
      return Response.json(
        await storeAction({
          action: "transcriptContext",
          userId: account.id,
          messageId,
        }),
        { headers: { "cache-control": "no-store" } },
      );
    }
    const query = params.get("q")?.trim() ?? "";
    if (query.length < 2 || query.length > 120)
      throw new AccountError("Enter between 2 and 120 characters to search.");
    const options: SearchOptions = { query };
    const conversationId = params.get("conversationId"),
      role = params.get("role"),
      before = params.get("cursor");
    if (conversationId) {
      if (!/^[a-zA-Z0-9_-]{1,120}$/.test(conversationId))
        throw new AccountError("Invalid conversation.");
      options.conversationId = conversationId;
    }
    if (role) {
      if (role !== "user" && role !== "assistant")
        throw new AccountError("Invalid speaker.");
      options.role = role;
    }
    if (before) {
      try {
        const cursor = JSON.parse(before);
        if (
          before.length > 300 ||
          !Array.isArray(cursor) ||
          cursor.length !== 2 ||
          cursor.some((item) => typeof item !== "string")
        )
          throw new Error();
        options.before = before;
      } catch {
        throw new AccountError("Invalid search page.");
      }
    }
    for (const key of ["from", "to"] as const) {
      const date = params.get(key);
      if (date) {
        if (
          !/^\d{4}-\d{2}-\d{2}T00:00:00.000Z$/.test(date) ||
          !Number.isFinite(Date.parse(date))
        )
          throw new AccountError("Invalid date filter.");
        options[key] = date;
      }
    }
    return Response.json(
      await storeAction({
        action: "transcriptSearch",
        userId: account.id,
        options,
      }),
      { headers: { "cache-control": "no-store" } },
    );
  } catch (cause) {
    return accountErrorResponse(cause);
  }
}
