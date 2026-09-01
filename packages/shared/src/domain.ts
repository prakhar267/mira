export type Pronouns = "she/her" | "he/him" | "they/them";
export type RelationshipMode = "friend" | "mentor" | "sibling" | "romantic" | "organic";
export type MemoryType = "semantic" | "episodic" | "preference" | "relationship" | "goal" | "emotional" | "shared";
export type MemoryStatus = "active" | "superseded" | "deleted";
export type CompanionMood = "calm" | "cheerful" | "curious" | "excited" | "thoughtful" | "sleepy";
export type MessageRole = "user" | "assistant" | "system";
export type SubscriptionPlanId = "free" | "plus" | "ultra" | "platinum";
export type MediaKind = "image" | "generated-image" | "audio";
export type CallType = "voice" | "video";
export type CallStatus = "connecting" | "listening" | "thinking" | "speaking" | "interrupted" | "reconnecting" | "ended";
export type RelationshipStage = "new" | "getting-to-know-you" | "close" | "very-close" | "special" | "partner";

export interface PersonalityTraits {
  warmth: number;
  humor: number;
  curiosity: number;
  assertiveness: number;
  optimism: number;
  energy: number;
  verbosity: number;
  playfulness: number;
  empathy: number;
}

export interface UserProfile {
  id: string;
  name: string;
  birthday: string;
  pronouns: Pronouns;
  interests: string[];
  timezone: string;
  adultConfirmed: boolean;
}

export interface CompanionProfile {
  id: string;
  name: string;
  pronouns: Pronouns;
  presentation: string;
  voiceId: string;
  relationshipMode: RelationshipMode;
  mood: CompanionMood;
  personality: PersonalityTraits;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  status?: "sending" | "sent" | "failed";
  replyToId?: string;
  attachments?: MessageAttachment[];
  feedback?: "up" | "down";
  explanation?: string[];
}

export interface MessageAttachment {
  id: string;
  type: MediaKind;
  url: string;
  name?: string;
  transcript?: string;
  durationMs?: number;
}

export interface MemoryRecord {
  id: string;
  userId: string;
  companionId: string;
  type: MemoryType;
  content: string;
  normalizedContent: string;
  importance: number;
  confidence: number;
  sourceMessageIds: string[];
  createdAt: string;
  updatedAt: string;
  lastRetrievedAt?: string;
  retrievalCount: number;
  status: MemoryStatus;
  pinned: boolean;
}

export interface ActivityDefinition {
  id: string;
  title: string;
  category: "Fun" | "Reflection" | "Relationships" | "Growth" | "Relaxation" | "Creativity" | "Games";
  description: string;
  durationMinutes: number;
  xp: number;
  coinReward: number;
}

export interface NotificationSettings {
  frequency: "off" | "low" | "normal" | "high";
  quietStart: string;
  quietEnd: string;
  timezone: string;
  enabledTopics: string[];
}

export interface WalletState {
  xp: number;
  level: number;
  coins: number;
  gems: number;
}

export interface WalletTransactionRecord {
  id: string;
  userId: string;
  type: "earn" | "purchase" | "refund" | "admin_adjustment";
  currency: "coins" | "gems" | "xp";
  amount: number;
  balanceAfter: number;
  referenceId: string;
  idempotencyKey: string;
  createdAt: string;
}

export interface StoreItemRecord {
  id: string;
  name: string;
  description: string;
  category: "Clothing" | "Accessories" | "Appearance" | "Room" | "Special Items";
  assetUrl: string;
  currency: "free" | "coins" | "gems";
  price: number;
  tierRequired: SubscriptionPlanId;
  metadata: Record<string, string>;
  active: boolean;
}

export interface OwnedItemRecord {
  itemId: string;
  purchasedAt: string;
  equipped: boolean;
}

export interface SubscriptionState {
  planId: SubscriptionPlanId;
  status: "active" | "trialing" | "canceled";
  testMode: boolean;
  renewsAt?: string;
}

export interface JournalEntryRecord {
  id: string;
  userId: string;
  title: string;
  content: string;
  mood: CompanionMood;
  tags: string[];
  reflected: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FutureEventRecord {
  id: string;
  userId: string;
  companionId: string;
  description: string;
  eventDate: string;
  relatedMemoryId?: string;
  status: "candidate" | "confirmed" | "completed" | "dismissed";
  createdAt: string;
}

export interface ScheduledNudgeRecord {
  id: string;
  userId: string;
  eventId?: string;
  content: string;
  scheduledFor: string;
  status: "planned" | "sent" | "canceled";
}

export interface ConversationSummaryRecord {
  id: string;
  conversationId: string;
  period: "conversation" | "daily" | "weekly";
  content: string;
  sourceMessageIds: string[];
  createdAt: string;
}

export interface ProviderUsageRecord {
  id: string;
  userId: string;
  feature: string;
  provider: string;
  model: string;
  inputUnits: number;
  outputUnits: number;
  estimatedCostUsd: number;
  latencyMs: number;
  success: boolean;
  createdAt: string;
}

export interface RelationshipMilestoneRecord {
  id: string;
  userId: string;
  companionId: string;
  kind: string;
  title: string;
  description: string;
  happenedAt: string;
}

export interface MomentRecord {
  id: string;
  userId: string;
  companionId: string;
  type: "milestone" | "call" | "date" | "memory" | "photo";
  title: string;
  description: string;
  happenedAt: string;
  environmentId?: string;
  mediaAssetId?: string;
}

export interface CompanionPhotoRecord {
  id: string;
  userId: string;
  companionId: string;
  mediaAssetId: string;
  type: "selfie" | "moment" | "shared";
  caption?: string;
  environmentId?: string;
  createdAt: string;
}

export interface CallRecord {
  id: string;
  userId: string;
  companionId: string;
  type: CallType;
  status: CallStatus;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  summary?: string;
  environmentId?: string;
  cameraEnabled?: boolean;
}

export interface MemoryEntityRecord {
  id: string;
  userId: string;
  companionId: string;
  type: "person" | "place" | "organization" | "interest" | "goal" | "event" | "preference";
  canonical: string;
  aliases: string[];
  metadata: Record<string, unknown>;
}

export interface MemoryRelationshipRecord {
  id: string;
  userId: string;
  companionId: string;
  fromEntityId: string;
  toEntityId: string;
  type: string;
  confidence: number;
  sourceIds: string[];
}
