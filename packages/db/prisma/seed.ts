import { PrismaClient } from "@prisma/client";
import { featureFlags } from "@companion/config";
import { seedActivities, seedStoreItems } from "../src/seed";

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

  for (const item of seedStoreItems) {
    await prisma.storeItem.upsert({
      where: { slug: item.id },
      update: { name: item.name, description: item.description, category: item.category, assetKey: item.assetUrl, currency: item.currency, price: item.price, tierRequired: item.tierRequired, metadata: item.metadata, active: item.active },
      create: { id: item.id, slug: item.id, name: item.name, description: item.description, category: item.category, assetKey: item.assetUrl, currency: item.currency, price: item.price, tierRequired: item.tierRequired, metadata: item.metadata, active: item.active },
    });
  }

  const voices = [
    { id: "mira-warm-01", providerVoiceId: "marin", displayName: "Mira · Warm", style: "warm" },
    { id: "mira-playful-01", providerVoiceId: "marin", displayName: "Mira · Playful", style: "playful" },
    { id: "mira-soft-01", providerVoiceId: "marin", displayName: "Mira · Soft", style: "soft" },
    { id: "mira-seductive-01", providerVoiceId: "marin", displayName: "Mira · Seductive", style: "seductive" },
    { id: "mira-calm-01", providerVoiceId: "marin", displayName: "Mira · Mellow", style: "calm" },
    { id: "mira-confident-01", providerVoiceId: "marin", displayName: "Mira · Confident", style: "confident" },
    { id: "mira-sharp-01", providerVoiceId: "marin", displayName: "Mira · Sharp", style: "sharp" },
  ];
  for (const voice of voices) {
    await prisma.voiceProfile.upsert({ where: { id: voice.id }, update: { ...voice, provider: "openai", accent: "neutral", genderPresentation: "feminine", premiumTier: "free", active: true }, create: { ...voice, provider: "openai", accent: "neutral", genderPresentation: "feminine", premiumTier: "free", active: true } });
  }

  const environments = [
    { id: "window-nook", displayName: "Sunny loft", assetUrl: "/assets/mira/loft-morning.png" },
    { id: "rainy-cafe", displayName: "Rainy café", assetUrl: "/assets/mira/rainy-cafe.png" },
    { id: "rooftop", displayName: "Sunset rooftop", assetUrl: "/assets/mira/rooftop-evening.png" },
  ];
  for (const environment of environments) {
    await prisma.environment.upsert({ where: { id: environment.id }, update: { ...environment, rendererType: "image", active: true }, create: { ...environment, rendererType: "image", active: true } });
  }
}

main().finally(() => prisma.$disconnect());
