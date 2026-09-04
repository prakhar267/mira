export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    const { env } = await import(/* webpackIgnore: true */ "cloudflare:workers");
    const healthy = Boolean(env.AI && env.LUMA_ACCOUNTS);
    return Response.json({
      status: healthy ? "ok" : "degraded",
      checkedAt: new Date().toISOString(),
      services: { application: "ok", inference: env.AI ? "configured" : "missing", accountStorage: env.LUMA_ACCOUNTS ? "configured" : "missing" },
      dataProtection: { accountExport: true, rollingBackups: true, backupRetentionDays: 30 },
    }, { status: healthy ? 200 : 503, headers: { "cache-control": "no-store", "x-request-id": requestId, "x-content-type-options": "nosniff" } });
  } catch {
    return Response.json({ status: "degraded", checkedAt: new Date().toISOString() }, { status: 503, headers: { "cache-control": "no-store", "x-request-id": requestId } });
  }
}
