import { accountErrorResponse, publicAccount, readStateEnvelope, requireRecentAccount, sha256 } from "@/lib/account-server";

export async function GET(request: Request) {
  try {
    const { account } = await requireRecentAccount(request);
    const {state,revision} = await readStateEnvelope(account.id,true);
    const exportedAt = new Date().toISOString();
    const checksum = `sha256:${await sha256(JSON.stringify(state))}`;
    return Response.json({ schemaVersion: 3,revision, exportedAt, checksum, backupPolicy: { rolling: true, retentionDays: 30,containsTranscripts:false,forgottenMemoriesExcluded:true }, account: publicAccount(account), state }, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  } catch (cause) {
    return accountErrorResponse(cause);
  }
}
