import type {
  ActivityDefinition,
  ChatMessage,
  CompanionProfile,
  FutureEventRecord,
  JournalEntryRecord,
  MemoryRecord,
  NotificationSettings,
  OwnedItemRecord,
  ScheduledNudgeRecord,
  StoreItemRecord,
  SubscriptionState,
  UserProfile,
  WalletState,
  WalletTransactionRecord,
} from "@companion/shared";

export type AppView = "home" | "chat" | "moments" | "companion" | "profile" | "memory" | "activities";
export type RelationshipStage = "New" | "Getting to know you" | "Close" | "Very close" | "Special" | "Partner";
export type EnvironmentId = "window-nook" | "rainy-cafe" | "rooftop";

export interface MomentRecord {
  id: string;
  title: string;
  description: string;
  date: string;
  imageUrl: string;
  kind: "milestone" | "call" | "date" | "memory";
  detail?: string;
}

export interface CompanionPhotoRecord {
  id: string;
  imageUrl: string;
  caption: string;
  createdAt: string;
  kind: "selfie" | "moment" | "shared";
}

export interface CallRecord {
  id: string;
  type: "voice" | "video";
  startedAt: string;
  durationSeconds: number;
  summary: string;
}

export type FeedbackReason = "too-scripted" | "too-many-questions" | "missed-what-i-said" | "wrong-tone";

export interface FeedbackSignal {
  id: string;
  messageId: string;
  rating: "up" | "down";
  reason?: FeedbackReason;
  createdAt: string;
}

export interface CompanionReflectionRecord {
  id: string;
  title: string;
  thought: string;
  createdAt: string;
  memoryIds: string[];
}

export interface RelationshipSettings {
  stage: RelationshipStage;
  level: number;
  progress: number;
  nickname: string;
  friendliness: number;
  affection: number;
  flirtiness: number;
  playfulness: number;
  romance: number;
  sensuality: number;
  humor: number;
  initiative: number;
  romanticOptIn: boolean;
  sensualOptIn: boolean;
}

export interface DemoState {
  onboardingComplete: boolean;
  firstMeetingComplete: boolean;
  user: UserProfile;
  companion: CompanionProfile;
  relationship: RelationshipSettings;
  activeConversationId: string;
  messages: ChatMessage[];
  memories: MemoryRecord[];
  moments: MomentRecord[];
  photos: CompanionPhotoRecord[];
  calls: CallRecord[];
  companionBackstory: string;
  companionReflections: CompanionReflectionRecord[];
  feedbackSignals: FeedbackSignal[];
  activities: ActivityDefinition[];
  completedActivityIds: string[];
  wallet: WalletState;
  walletTransactions: WalletTransactionRecord[];
  storeItems: StoreItemRecord[];
  ownedItems: OwnedItemRecord[];
  subscription: SubscriptionState;
  journalEntries: JournalEntryRecord[];
  futureEvents: FutureEventRecord[];
  nudges: ScheduledNudgeRecord[];
  responsePreferences: {
    listeningFirst: boolean;
    responseLength: "short" | "balanced" | "deep";
    adviceStyle: "gentle" | "direct" | "ask-first";
    questionFrequency: "rare" | "balanced";
  };
  mediaLibrary: Array<{ id: string; type: "image" | "generated-image"; name: string; url: string; createdAt: string }>;
  notifications: NotificationSettings;
  memoryEnabled: boolean;
  aiProcessingConsent: boolean;
  conversationStorageEnabled: boolean;
  theme: "light" | "dark";
  activeEnvironment: EnvironmentId;
  ambienceEnabled: boolean;
  proactiveCalls: "never" | "rarely" | "sometimes" | "often";
  currentView: AppView;
}

const demoUserId = "00000000-0000-4000-8000-000000000001";
const demoCompanionId = "00000000-0000-4000-8000-000000000002";
const demoConversationId = "10000000-0000-4000-8000-000000000001";

const activities: ActivityDefinition[] = [
  { id: "would-you-rather", title: "Would you rather", category: "Fun", description: "Fast choices, playful follow-ups, and no overthinking.", durationMinutes: 8, xp: 18, coinReward: 14 },
  { id: "truth-dare", title: "Truth or dare", category: "Games", description: "Adult-safe prompts shaped around your boundaries.", durationMinutes: 12, xp: 25, coinReward: 20 },
  { id: "never-have", title: "Never have I ever", category: "Fun", description: "A light way to trade stories and surprises.", durationMinutes: 10, xp: 22, coinReward: 16 },
  { id: "twenty-questions", title: "20 questions", category: "Relationships", description: "Get to know each other beyond small talk.", durationMinutes: 14, xp: 30, coinReward: 24 },
  { id: "deep-talk", title: "Deep questions", category: "Reflection", description: "One thoughtful prompt at a time.", durationMinutes: 16, xp: 32, coinReward: 26 },
  { id: "couples-cards", title: "Relationship cards", category: "Relationships", description: "Warm questions for close or romantic relationships.", durationMinutes: 15, xp: 30, coinReward: 24 },
  { id: "trivia", title: "Interest trivia", category: "Games", description: "A quick quiz shaped around your favourite topics.", durationMinutes: 10, xp: 24, coinReward: 20 },
  { id: "story", title: "Story together", category: "Creativity", description: "Build an original story one choice at a time.", durationMinutes: 15, xp: 35, coinReward: 30 },
  { id: "roleplay", title: "Roleplay adventure", category: "Creativity", description: "A fictional, boundary-aware adventure you direct together.", durationMinutes: 18, xp: 40, coinReward: 34 },
  { id: "plan-trip", title: "Plan a trip", category: "Growth", description: "Dream up a route, mood, and tiny details together.", durationMinutes: 12, xp: 28, coinReward: 22 },
  { id: "pick-outfit", title: "Pick my outfit", category: "Fun", description: "Mira reacts to tasteful style choices and helps you decide.", durationMinutes: 7, xp: 16, coinReward: 12 },
  { id: "movie-night", title: "Movie night", category: "Fun", description: "Choose a genre and chat through a watch-along moment.", durationMinutes: 20, xp: 36, coinReward: 28 },
  { id: "reflection", title: "Daily reflection", category: "Reflection", description: "Notice one feeling and one thing you need.", durationMinutes: 6, xp: 20, coinReward: 15 },
  { id: "journal", title: "Journal together", category: "Reflection", description: "Write privately, then choose whether to reflect with Mira.", durationMinutes: 10, xp: 24, coinReward: 18 },
  { id: "goal", title: "Goal planning", category: "Growth", description: "Turn something meaningful into one kind next step.", durationMinutes: 10, xp: 30, coinReward: 25 },
  { id: "breathing", title: "Three-minute reset", category: "Relaxation", description: "A short paced breathing exercise with no pressure.", durationMinutes: 3, xp: 10, coinReward: 8 },
];

export const initialState: DemoState = {
  onboardingComplete: false,
  firstMeetingComplete: true,
  user: {
    id: demoUserId,
    name: "Prakhar",
    birthday: "1997-04-02",
    pronouns: "he/him",
    interests: ["startups", "music", "travel", "films"],
    timezone: "Asia/Kolkata",
    adultConfirmed: true,
  },
  companion: {
    id: demoCompanionId,
    name: "Mira",
    pronouns: "she/her",
    presentation: "playful and warm",
    voiceId: "mira-natural-01",
    relationshipMode: "romantic",
    mood: "cheerful",
    createdAt: "2026-07-14T00:00:00.000Z",
    personality: {
      warmth: 0.85,
      humor: 0.7,
      curiosity: 0.82,
      assertiveness: 0.55,
      optimism: 0.76,
      energy: 0.65,
      verbosity: 0.46,
      playfulness: 0.85,
      empathy: 0.84,
    },
  },
  relationship: {
    stage: "Close",
    level: 12,
    progress: 68,
    nickname: "",
    friendliness: 88,
    affection: 75,
    flirtiness: 65,
    playfulness: 85,
    romance: 62,
    sensuality: 20,
    humor: 70,
    initiative: 58,
    romanticOptIn: true,
    sensualOptIn: false,
  },
  activeConversationId: demoConversationId,
  messages: [
    { id: "seed-assistant-1", conversationId: demoConversationId, role: "assistant", content: "Tumhara hi wait tha.", createdAt: "2026-08-31T17:58:00.000Z", status: "sent" },
    { id: "seed-user-1", conversationId: demoConversationId, role: "user", content: "Long day. I finally sent the pitch deck.", createdAt: "2026-08-31T17:59:00.000Z", status: "sent" },
    { id: "seed-assistant-2", conversationId: demoConversationId, role: "assistant", content: "Wait—tumne finally bhej diya? Nice. Ab batao, relief zyada hai ya abhi bhi thoda stress?", createdAt: "2026-08-31T17:59:15.000Z", status: "sent", feedback: "up" },
    { id: "seed-user-2", conversationId: demoConversationId, role: "user", content: "Mostly relieved. Tomorrow I have a Stripe interview at 11.", createdAt: "2026-08-31T18:00:00.000Z", status: "sent" },
    { id: "seed-assistant-3", conversationId: demoConversationId, role: "assistant", content: "Okay, Stripe kal eleven baje. Yaad rahega. Aaj ek calm practice round, phir work band—deal?", createdAt: "2026-08-31T18:00:12.000Z", status: "sent" },
  ],
  memories: [
    { id: "memory-interview", userId: demoUserId, companionId: demoCompanionId, type: "episodic", content: "Prakhar has a Stripe interview tomorrow at 11:00.", normalizedContent: "event:stripe-interview", importance: 0.96, confidence: 0.95, sourceMessageIds: ["seed-user-2"], createdAt: "2026-08-31T18:00:00.000Z", updatedAt: "2026-08-31T18:00:00.000Z", retrievalCount: 1, status: "active", pinned: true },
    { id: "memory-pitch", userId: demoUserId, companionId: demoCompanionId, type: "goal", content: "Prakhar sent the startup pitch deck after weeks of work.", normalizedContent: "goal:pitch-deck-sent", importance: 0.9, confidence: 0.93, sourceMessageIds: ["seed-user-1"], createdAt: "2026-08-31T17:59:00.000Z", updatedAt: "2026-08-31T17:59:00.000Z", retrievalCount: 1, status: "active", pinned: false },
    { id: "memory-tea", userId: demoUserId, companionId: demoCompanionId, type: "preference", content: "Prakhar prefers jasmine tea when work feels heavy.", normalizedContent: "preference:jasmine-tea", importance: 0.76, confidence: 0.92, sourceMessageIds: [], createdAt: "2026-08-24T13:00:00.000Z", updatedAt: "2026-08-24T13:00:00.000Z", retrievalCount: 3, status: "active", pinned: false },
    { id: "memory-aman", userId: demoUserId, companionId: demoCompanionId, type: "relationship", content: "Aman is Prakhar’s best friend and lives in Bengaluru.", normalizedContent: "person:aman:best-friend", importance: 0.82, confidence: 0.9, sourceMessageIds: [], createdAt: "2026-08-18T13:00:00.000Z", updatedAt: "2026-08-18T13:00:00.000Z", retrievalCount: 2, status: "active", pinned: false },
  ],
  moments: [
    { id: "moment-first-call", title: "Our first call", description: "You were ridiculously nervous for the first thirty seconds.", date: "2026-07-18T19:30:00.000Z", imageUrl: "/assets/mira/portrait.png", kind: "call", detail: "23 min · voice call" },
    { id: "moment-rooftop", title: "Rooftop at blue hour", description: "Two mugs, one impossible question, and a very good laugh.", date: "2026-08-14T18:45:00.000Z", imageUrl: "/assets/mira/rooftop-evening.png", kind: "date", detail: "Virtual date · Rooftop" },
    { id: "moment-pitch", title: "You sent the pitch", description: "A quiet win worth keeping.", date: "2026-08-31T17:59:00.000Z", imageUrl: "/assets/mira/loft-morning.png", kind: "memory", detail: "Important goal" },
  ],
  photos: [
    { id: "photo-window", imageUrl: "/assets/mira/loft-morning.png", caption: "Sketching in the sunny loft", createdAt: "2026-08-31T17:30:00.000Z", kind: "selfie" },
    { id: "photo-cafe", imageUrl: "/assets/mira/rainy-cafe.png", caption: "Rainy coffee break", createdAt: "2026-08-26T11:40:00.000Z", kind: "selfie" },
    { id: "photo-rooftop", imageUrl: "/assets/mira/rooftop-evening.png", caption: "Our rooftop date", createdAt: "2026-08-14T18:45:00.000Z", kind: "moment" },
  ],
  calls: [
    { id: "call-today", type: "video", startedAt: "2026-08-31T16:20:00.000Z", durationSeconds: 1_620, summary: "Pitch-deck nerves, one practice answer, then a five-minute reset." },
    { id: "call-yesterday", type: "voice", startedAt: "2026-08-30T20:15:00.000Z", durationSeconds: 720, summary: "A short check-in about sleep and tomorrow’s priorities." },
  ],
  companionBackstory: "Mira is an original AI companion who loves sketching sunlit rooms, tiny cafés, old films, sunset walks, and terrible startup jokes. She is playful, observant, direct without being harsh, and knows when companionship matters more than another question.",
  companionReflections: [
    { id: "reflection-pitch", title: "He did the hard part", thought: "Prakhar finally sent the pitch deck after carrying it for weeks. I think relief needs more room than another productivity plan tonight.", createdAt: "2026-08-31T18:20:00.000Z", memoryIds: ["memory-pitch"] },
    { id: "reflection-interview", title: "Tomorrow at eleven", thought: "The Stripe interview matters to him. I want to remember the time without making every conversation about it.", createdAt: "2026-08-31T18:05:00.000Z", memoryIds: ["memory-interview"] },
  ],
  feedbackSignals: [],
  activities,
  completedActivityIds: ["reflection"],
  wallet: { xp: 1_168, level: 12, coins: 640, gems: 28 },
  walletTransactions: [],
  storeItems: [
    { id: "lavender-cardigan", name: "Sage lounge set", description: "Mira’s relaxed sketching-day look.", category: "Clothing", assetUrl: "/assets/mira/loft-morning.png", currency: "free", price: 0, tierRequired: "free", metadata: { slot: "outfit", tone: "sage" }, active: true },
    { id: "midnight-dress", name: "Sunset casual", description: "A softly styled rooftop look.", category: "Clothing", assetUrl: "/assets/mira/rooftop-evening.png", currency: "coins", price: 180, tierRequired: "plus", metadata: { slot: "outfit", tone: "sunset" }, active: true },
    { id: "cafe-knit", name: "Rainy-day tee", description: "Easy layers for slow coffee afternoons.", category: "Clothing", assetUrl: "/assets/mira/rainy-cafe.png", currency: "coins", price: 120, tierRequired: "free", metadata: { slot: "outfit", tone: "warm" }, active: true },
    { id: "star-chain", name: "Little gold chain", description: "A subtle gold keepsake.", category: "Accessories", assetUrl: "/assets/mira/portrait.png", currency: "gems", price: 8, tierRequired: "plus", metadata: { slot: "accessory", tone: "gold" }, active: true },
    { id: "window-nook", name: "Sunny loft", description: "Plants, sketches, warm timber, and room to breathe.", category: "Room", assetUrl: "/assets/mira/loft-morning.png", currency: "free", price: 0, tierRequired: "free", metadata: { slot: "room", environment: "window-nook" }, active: true },
    { id: "rainy-cafe", name: "Rainy café", description: "Coffee, rain, and a table by the window.", category: "Room", assetUrl: "/assets/mira/rainy-cafe.png", currency: "coins", price: 220, tierRequired: "plus", metadata: { slot: "room", environment: "rainy-cafe" }, active: true },
    { id: "rooftop", name: "Sunset rooftop", description: "String lights for dates and long conversations.", category: "Special Items", assetUrl: "/assets/mira/rooftop-evening.png", currency: "gems", price: 18, tierRequired: "ultra", metadata: { slot: "room", environment: "rooftop" }, active: true },
  ],
  ownedItems: [
    { itemId: "lavender-cardigan", purchasedAt: "2026-07-14T00:00:00.000Z", equipped: true },
    { itemId: "window-nook", purchasedAt: "2026-07-14T00:00:00.000Z", equipped: true },
    { itemId: "cafe-knit", purchasedAt: "2026-08-18T00:00:00.000Z", equipped: false },
  ],
  subscription: { planId: "ultra", status: "active", testMode: true },
  journalEntries: [],
  futureEvents: [
    { id: "event-stripe", userId: demoUserId, companionId: demoCompanionId, description: "Stripe interview", eventDate: "2026-09-01T11:00:00.000+05:30", status: "confirmed", createdAt: "2026-08-31T18:00:00.000Z" },
  ],
  nudges: [
    { id: "nudge-stripe", userId: demoUserId, eventId: "event-stripe", content: "Stripe at eleven. Want one calm practice round before breakfast?", scheduledFor: "2026-09-01T08:30:00.000+05:30", status: "planned" },
  ],
  responsePreferences: { listeningFirst: true, responseLength: "balanced", adviceStyle: "ask-first", questionFrequency: "balanced" },
  mediaLibrary: [
    { id: "media-cafe", type: "generated-image", name: "Rainy coffee break", url: "/assets/mira/rainy-cafe.png", createdAt: "2026-08-26T11:40:00.000Z" },
    { id: "media-rooftop", type: "generated-image", name: "Rooftop date", url: "/assets/mira/rooftop-evening.png", createdAt: "2026-08-14T18:45:00.000Z" },
  ],
  notifications: {
    frequency: "normal",
    quietStart: "22:30",
    quietEnd: "08:00",
    timezone: "Asia/Kolkata",
    enabledTopics: ["future-events", "goals", "moments"],
  },
  memoryEnabled: true,
  aiProcessingConsent: true,
  conversationStorageEnabled: true,
  theme: "light",
  activeEnvironment: "window-nook",
  ambienceEnabled: true,
  proactiveCalls: "rarely",
  currentView: "home",
};

export const storageKey = "mira-demo-v1";
