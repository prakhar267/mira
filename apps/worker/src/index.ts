import { PrismaClient } from "@prisma/client";
import { parseServerEnv } from "@companion/config";
import { createClient } from "redis";

const env = parseServerEnv(process.env);
const prisma = new PrismaClient();
const redis = createClient({ url: env.REDIS_URL });
let stopping = false;

async function dispatch(value: string) {
  const queued = JSON.parse(value) as { id?: string; userId?: string };
  if (!queued.id || !queued.userId) {
    await redis.zRem("companion:nudges", value);
    return;
  }
  const nudge = await prisma.scheduledNudge.findFirst({ where: { id: queued.id, userId: queued.userId, status: "planned", scheduledAt: { lte: new Date() } } });
  if (!nudge) {
    await redis.zRem("companion:nudges", value);
    return;
  }
  if (env.NOTIFICATION_PROVIDER !== "webhook" || !env.NOTIFICATION_WEBHOOK_URL) throw new Error("Notification webhook is not configured");
  const response = await fetch(env.NOTIFICATION_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "nudge", userId: nudge.userId, title: "A note from Luma", body: nudge.content }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Notification provider returned ${response.status}`);
  await prisma.scheduledNudge.update({ where: { id: nudge.id }, data: { status: "sent", sentAt: new Date() } });
  await redis.zRem("companion:nudges", value);
}

async function tick() {
  const due = await redis.zRangeByScore("companion:nudges", 0, Date.now(), { LIMIT: { offset: 0, count: 25 } });
  for (const value of due) {
    try { await dispatch(value); } catch (error) { console.error(error instanceof Error ? error.message : "Nudge dispatch failed"); }
  }
}

async function main() {
  if (env.QUEUE_PROVIDER !== "redis") throw new Error("The notification worker requires QUEUE_PROVIDER=redis");
  await redis.connect();
  while (!stopping) {
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { stopping = true; });

main().finally(async () => {
  if (redis.isOpen) await redis.quit();
  await prisma.$disconnect();
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Worker failed");
  process.exitCode = 1;
});
