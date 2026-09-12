import { cloudStore } from "@/lib/cloud-store";
export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    const { env } = await import(/* webpackIgnore: true */ "cloudflare:workers");
    await cloudStore.get("health:probe");
    const healthy = Boolean(env.AI && env.MIRA_STORE);
    return Response.json({
      status: healthy ? "ok" : "degraded",
      versionId:env.CF_VERSION_METADATA?.id??"local",
      demoSchemaVersion:2,
      checkedAt: new Date().toISOString(),
      services: { application: "ok", inference: env.AI ? "configured-not-probed" : "missing", accountStorage: "sqlite-reachable" },
      dataProtection: { accountExport: true, rollingBackups: true, backupRetentionDays: 30 },
    }, { status: healthy ? 200 : 503, headers: { "cache-control": "no-store", "x-request-id": requestId, "x-content-type-options": "nosniff" } });
  } catch {
    return Response.json({ status: "degraded", checkedAt: new Date().toISOString() }, { status: 503, headers: { "cache-control": "no-store", "x-request-id": requestId } });
  }
}
