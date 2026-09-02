import type { ActivityDefinition, CompanionProfile, MemoryRecord, StoreItemRecord, UserProfile } from "@companion/shared";

export const seedUser: UserProfile = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Mira",
  birthday: "1998-04-02",
  pronouns: "she/her",
  interests: ["music", "career", "travel", "books"],
  timezone: "Asia/Kolkata",
  adultConfirmed: true,
};

export const seedCompanion: CompanionProfile = {
  id: "00000000-0000-4000-8000-000000000002",
  name: "Mira",
  pronouns: "she/her",
  presentation: "warm and grounded",
  voiceId: "mira-playful-01",
  relationshipMode: "romantic",
  mood: "cheerful",
  createdAt: "2026-08-01T00:00:00.000Z",
  personality: {
    warmth: 0.88,
    humor: 0.54,
    curiosity: 0.82,
    assertiveness: 0.42,
    optimism: 0.7,
    energy: 0.55,
    verbosity: 0.44,
    playfulness: 0.58,
    empathy: 0.9,
  },
};

export const seedMemories: MemoryRecord[] = [
  {
    id: "00000000-0000-4000-8000-000000000003",
    userId: seedUser.id,
    companionId: seedCompanion.id,
    type: "episodic",
    content: "Mira had an interview today and wanted a calm preparation plan.",
    normalizedContent: "interview:today",
    importance: 0.92,
    confidence: 0.9,
    sourceMessageIds: ["seed-message-1"],
    createdAt: "2026-08-29T13:00:00.000Z",
    updatedAt: "2026-08-29T13:00:00.000Z",
    retrievalCount: 1,
    status: "active",
    pinned: true,
  },
  {
    id: "00000000-0000-4000-8000-000000000004",
    userId: seedUser.id,
    companionId: seedCompanion.id,
    type: "preference",
    content: "Mira prefers listening before advice when work feels heavy.",
    normalizedContent: "support-style:listening-first",
    importance: 0.8,
    confidence: 0.94,
    sourceMessageIds: ["seed-message-2"],
    createdAt: "2026-08-20T13:00:00.000Z",
    updatedAt: "2026-08-20T13:00:00.000Z",
    retrievalCount: 2,
    status: "active",
    pinned: false,
  },
];

export const seedActivities: ActivityDefinition[] = [
  { id: "activity-would-you-rather", title: "Would You Rather", category: "Fun", description: "Trade surprising choices and learn the stories behind them.", durationMinutes: 8, xp: 18, coinReward: 12 },
  { id: "activity-reflection", title: "Daily reflection", category: "Reflection", description: "Notice one feeling and one thing you need, without trying to fix either.", durationMinutes: 6, xp: 20, coinReward: 15 },
  { id: "activity-questions", title: "20 Questions", category: "Games", description: "A playful back-and-forth that becomes part of your shared history.", durationMinutes: 12, xp: 25, coinReward: 20 },
  { id: "activity-week", title: "Plan my week", category: "Growth", description: "Turn the week ahead into a few kind, realistic priorities.", durationMinutes: 10, xp: 30, coinReward: 25 },
  { id: "activity-breathe", title: "Three-minute reset", category: "Relaxation", description: "A short paced breathing exercise with no streaks or pressure.", durationMinutes: 3, xp: 10, coinReward: 8 },
  { id: "activity-story", title: "Story together", category: "Creativity", description: "Build an original short story one choice at a time.", durationMinutes: 15, xp: 35, coinReward: 30 },
  { id: "activity-gratitude", title: "Gratitude", category: "Reflection", description: "Name three small moments worth keeping from today.", durationMinutes: 5, xp: 15, coinReward: 10 },
  { id: "activity-goal", title: "Goal planning", category: "Growth", description: "Break one meaningful goal into a gentle next step.", durationMinutes: 10, xp: 30, coinReward: 25 },
  { id: "activity-trivia", title: "Trivia", category: "Games", description: "A quick round built around your favorite topics.", durationMinutes: 10, xp: 22, coinReward: 16 },
  { id: "activity-cards", title: "Conversation cards", category: "Relationships", description: "Prompts that can help you understand someone in your life.", durationMinutes: 12, xp: 26, coinReward: 18 },
  { id: "activity-journal", title: "Journal prompt", category: "Reflection", description: "Write privately, then choose whether Mira may reflect with you.", durationMinutes: 8, xp: 20, coinReward: 14 },
  { id: "activity-movie", title: "Movie discussion", category: "Fun", description: "Unpack a film, character, or scene that stayed with you.", durationMinutes: 12, xp: 22, coinReward: 16 },
  { id: "activity-music", title: "Music discussion", category: "Fun", description: "Share a song and the feeling or memory it carries.", durationMinutes: 10, xp: 22, coinReward: 16 },
  { id: "activity-relationship", title: "Relationship reflection", category: "Relationships", description: "Think through a real-world relationship with care and perspective.", durationMinutes: 12, xp: 28, coinReward: 20 },
];

export const seedStoreItems: StoreItemRecord[] = [
  { id: "lavender-cardigan", name: "Sage lounge set", description: "Mira's relaxed sketching-day look.", category: "Clothing", assetUrl: "/assets/mira/loft-morning.png", currency: "free", price: 0, tierRequired: "free", metadata: { slot: "outfit", tone: "sage" }, active: true },
  { id: "midnight-blue", name: "Sunset casual", description: "A softly styled rooftop look.", category: "Clothing", assetUrl: "/assets/mira/rooftop-evening.png", currency: "coins", price: 180, tierRequired: "plus", metadata: { slot: "outfit", tone: "sunset" }, active: true },
  { id: "star-chain", name: "Little gold chain", description: "A subtle gold keepsake.", category: "Accessories", assetUrl: "/assets/mira/portrait.png", currency: "gems", price: 8, tierRequired: "plus", metadata: { slot: "jewelry" }, active: true },
  { id: "window-nook", name: "Sunny loft", description: "Plants, sketches, warm timber, and room to breathe.", category: "Room", assetUrl: "/assets/mira/loft-morning.png", currency: "free", price: 0, tierRequired: "free", metadata: { slot: "room", ambience: "daylight", environment: "window-nook" }, active: true },
  { id: "rainy-cafe", name: "Rainy café", description: "Coffee and nowhere to rush.", category: "Room", assetUrl: "/assets/mira/rainy-cafe.png", currency: "coins", price: 220, tierRequired: "plus", metadata: { slot: "room", ambience: "rain", environment: "rainy-cafe" }, active: true },
];

export const inMemorySeed = { user: seedUser, companion: seedCompanion, memories: seedMemories, activities: seedActivities, storeItems: seedStoreItems };
