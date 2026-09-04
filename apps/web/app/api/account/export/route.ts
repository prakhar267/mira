import { accountErrorResponse, publicAccount, readState, requireAccount, sha256 } from "@/lib/account-server";

export async function GET(request: Request) {
  try {
    const { account } = await requireAccount(request);
    const state = await readState(account.id);
    const exportedAt = new Date().toISOString();
    const checksum = `sha256:${await sha256(JSON.stringify(state))}`;
    return Response.json({ schemaVersion: 2, exportedAt, checksum, backupPolicy: { rolling: true, retentionDays: 30 }, account: publicAccount(account), state }, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  } catch (cause) {
    return accountErrorResponse(cause);
  }
}
