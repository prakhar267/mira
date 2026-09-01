import { PrismaClient } from "@prisma/client";
import { featureFlags } from "@companion/config";
import { seedActivities } from "../src/seed";

const prisma = new PrismaClient();

async function main() {
  for (const [key, enabled] of Object.entries(featureFlags)) {
    await prisma.featureFlag.upsert({
      where: { key },
      update: { enabled, config: {} },
      create: { key, enabled, config: {} },
    });
  }

  for (const activity of seedActivities) {
    await prisma.activity.upsert({
      where: { slug: activity.id },
      update: {
        title: activity.title,
        category: activity.category,
        description: activity.description,
        xpReward: activity.xp,
        coinReward: activity.coinReward,
      },
      create: {
        slug: activity.id,
        title: activity.title,
        category: activity.category,
        description: activity.description,
        config: { durationMinutes: activity.durationMinutes },
        xpReward: activity.xp,
        coinReward: activity.coinReward,
      },
    });
  }
}

main().finally(() => prisma.$disconnect());
