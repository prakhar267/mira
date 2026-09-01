import type {
  ActivityDefinition,
  ChatMessage,
  CompanionProfile,
  ConversationSummaryRecord,
  FutureEventRecord,
  JournalEntryRecord,
  MemoryRecord,
  NotificationSettings,
  OwnedItemRecord,
  ProviderUsageRecord,
  ScheduledNudgeRecord,
  StoreItemRecord,
  SubscriptionState,
  UserProfile,
  WalletState,
  WalletTransactionRecord,
} from "@companion/shared";
import { WalletLedger } from "./ledger";

export interface CallRecord {
  id: string;
  userId: string;
  companionId: string;
  type: "voice" | "video";
  state: string;
  provider: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  summary?: string;
  environmentId?: string;
  cameraEnabled: boolean;
}

export interface CompanionRepository {
  health(): Promise<boolean>;
  createAccount(input: { user: UserProfile; companion: CompanionProfile; email?: string }): Promise<void>;
  getUser(userId: string): Promise<UserProfile | null>;
  listCompanions(userId: string): Promise<CompanionProfile[]>;
  getCompanion(userId: string, companionId: string): Promise<CompanionProfile | null>;
  updateCompanion(userId: string, companion: CompanionProfile): Promise<void>;
  listConversations(userId: string): Promise<Array<{ id: string; userId: string; companionId: string; createdAt: string }>>;
  createConversation(input: { id: string; userId: string; companionId: string; createdAt: string }): Promise<void>;
  listMessages(userId: string, conversationId: string): Promise<ChatMessage[]>;
  appendMessages(userId: string, conversationId: string, messages: ChatMessage[]): Promise<void>;
  updateMessage(userId: string, conversationId: string, message: ChatMessage): Promise<void>;
  listSummaries(userId: string, conversationId: string): Promise<ConversationSummaryRecord[]>;
  addSummary(userId: string, summary: ConversationSummaryRecord): Promise<void>;
  listCalls(userId: string): Promise<CallRecord[]>;
  createCall(userId: string, call: CallRecord): Promise<void>;
  endCall(userId: string, callId: string, endedAt: string): Promise<CallRecord | null>;
  recordProviderUsage(record: ProviderUsageRecord): Promise<void>;
  listProviderUsage(): Promise<ProviderUsageRecord[]>;
  listMemories(userId: string, companionId: string): Promise<MemoryRecord[]>;
  upsertMemory(userId: string, memory: MemoryRecord): Promise<void>;
  deleteMemory(userId: string, memoryId: string): Promise<boolean>;
  listActivities(): Promise<ActivityDefinition[]>;
  getWallet(userId: string): Promise<WalletState>;
  listWalletTransactions(userId: string): Promise<WalletTransactionRecord[]>;
  completeActivity(userId: string, activityId: string, idempotencyKey: string): Promise<WalletState>;
  listStoreItems(): Promise<StoreItemRecord[]>;
  listOwnedItems(userId: string): Promise<OwnedItemRecord[]>;
  purchaseItem(userId: string, itemId: string, idempotencyKey: string): Promise<{ wallet: WalletState; owned: OwnedItemRecord }>;
  equipItem(userId: string, itemId: string): Promise<OwnedItemRecord[]>;
  getSubscription(userId: string): Promise<SubscriptionState>;
  setSubscription(userId: string, subscription: SubscriptionState, idempotencyKey: string): Promise<SubscriptionState>;
  listJournalEntries(userId: string): Promise<JournalEntryRecord[]>;
  addJournalEntry(userId: string, entry: JournalEntryRecord): Promise<void>;
  deleteJournalEntry(userId: string, entryId: string): Promise<boolean>;
  listFutureEvents(userId: string): Promise<FutureEventRecord[]>;
  addFutureEvent(userId: string, event: FutureEventRecord): Promise<void>;
  listNudges(userId: string): Promise<ScheduledNudgeRecord[]>;
  addNudge(userId: string, nudge: ScheduledNudgeRecord): Promise<void>;
  getNotificationSettings(userId: string): Promise<NotificationSettings>;
  setNotificationSettings(userId: string, settings: NotificationSettings): Promise<void>;
  exportUser(userId: string): Promise<Record<string, unknown>>;
  deleteUser(userId: string): Promise<void>;
}

export interface InMemorySeed {
  user: UserProfile;
  companion: CompanionProfile;
  memories: MemoryRecord[];
  activities: ActivityDefinition[];
  storeItems: StoreItemRecord[];
}

export class InMemoryCompanionRepository implements CompanionRepository {
  private users = new Map<string, UserProfile>();
  private companions = new Map<string, CompanionProfile>();
  private companionOwners = new Map<string, string>();
  private messages = new Map<string, ChatMessage[]>();
  private conversations = new Map<string, { id: string; userId: string; companionId: string; createdAt: string }>();
  private summaries = new Map<string, ConversationSummaryRecord[]>();
  private calls = new Map<string, CallRecord>();
  private providerUsage: ProviderUsageRecord[] = [];
  private memories = new Map<string, MemoryRecord[]>();
  private ledgers = new Map<string, WalletLedger>();
  private notificationSettings = new Map<string, NotificationSettings>();
  private ownedItems = new Map<string, OwnedItemRecord[]>();
  private subscriptions = new Map<string, SubscriptionState>();
  private journals = new Map<string, JournalEntryRecord[]>();
  private futureEvents = new Map<string, FutureEventRecord[]>();
  private nudges = new Map<string, ScheduledNudgeRecord[]>();
  private subscriptionEvents = new Set<string>();

  constructor(private readonly seed: InMemorySeed) {
    this.users.set(seed.user.id, seed.user);
    this.companions.set(seed.companion.id, seed.companion);
    this.companionOwners.set(seed.companion.id, seed.user.id);
    this.memories.set(seed.user.id, seed.memories.map((memory) => ({ ...memory })));
    this.ledgers.set(seed.user.id, new WalletLedger(seed.user.id, { xp: 180, level: 3, coins: 240, gems: 12 }));
    this.notificationSettings.set(seed.user.id, { frequency: "normal", quietStart: "22:00", quietEnd: "08:00", timezone: seed.user.timezone, enabledTopics: ["future-events", "goals"] });
    this.ownedItems.set(seed.user.id, seed.storeItems.filter((item) => item.currency === "free").map((item) => ({ itemId: item.id, purchasedAt: seed.companion.createdAt, equipped: true })));
    this.subscriptions.set(seed.user.id, { planId: "free", status: "active", testMode: true });
  }

  async createAccount(input: { user: UserProfile; companion: CompanionProfile; email?: string }) {
    if (this.users.has(input.user.id)) throw new Error("User already exists");
    this.users.set(input.user.id, { ...input.user, interests: [...input.user.interests] });
    this.companions.set(input.companion.id, { ...input.companion, personality: { ...input.companion.personality } });
    this.companionOwners.set(input.companion.id, input.user.id);
    this.memories.set(input.user.id, []);
    this.ledgers.set(input.user.id, new WalletLedger(input.user.id, { xp: 0, level: 1, coins: 0, gems: 0 }));
    this.notificationSettings.set(input.user.id, { frequency: "normal", quietStart: "22:00", quietEnd: "08:00", timezone: input.user.timezone, enabledTopics: ["future-events", "goals"] });
    this.ownedItems.set(input.user.id, this.seed.storeItems.filter((item) => item.currency === "free").map((item) => ({ itemId: item.id, purchasedAt: input.companion.createdAt, equipped: true })));
    this.subscriptions.set(input.user.id, { planId: "free", status: "active", testMode: true });
  }

  async health() { return true; }
  async getUser(userId: string) { return this.users.get(userId) ?? null; }
  async listCompanions(userId: string) {
    return [...this.companionOwners.entries()].filter(([, ownerId]) => ownerId === userId).flatMap(([companionId]) => {
      const companion = this.companions.get(companionId);
      return companion ? [{ ...companion, personality: { ...companion.personality } }] : [];
    });
  }

  async getCompanion(userId: string, companionId: string) {
    if (!this.users.has(userId) || this.companionOwners.get(companionId) !== userId) return null;
    return this.companions.get(companionId) ?? null;
  }

  async updateCompanion(userId: string, companion: CompanionProfile) {
    if (!this.users.has(userId) || this.companionOwners.get(companion.id) !== userId) throw new Error("Companion not found");
    this.companions.set(companion.id, { ...companion });
  }

  async listConversations(userId: string) { return [...this.conversations.values()].filter((conversation) => conversation.userId === userId).map((conversation) => ({ ...conversation })); }
  async createConversation(input: { id: string; userId: string; companionId: string; createdAt: string }) {
    if (!this.users.has(input.userId) || !this.companions.has(input.companionId)) throw new Error("Actor not found");
    this.conversations.set(input.id, { ...input });
  }

  async listMessages(userId: string, conversationId: string) {
    if (!this.users.has(userId) || this.conversations.get(conversationId)?.userId !== userId) return [];
    return [...(this.messages.get(conversationId) ?? [])];
  }

  async appendMessages(userId: string, conversationId: string, messages: ChatMessage[]) {
    if (!this.users.has(userId) || this.conversations.get(conversationId)?.userId !== userId) throw new Error("Conversation not found");
    const current = this.messages.get(conversationId) ?? [];
    const ids = new Set(current.map((message) => message.id));
    this.messages.set(conversationId, [...current, ...messages.filter((message) => !ids.has(message.id))]);
  }

  async updateMessage(userId: string, conversationId: string, message: ChatMessage) {
    if (!this.users.has(userId) || this.conversations.get(conversationId)?.userId !== userId) throw new Error("Conversation not found");
    const current = this.messages.get(conversationId) ?? [];
    const index = current.findIndex((candidate) => candidate.id === message.id);
    if (index === -1) throw new Error("Message not found");
    current[index] = { ...message };
    this.messages.set(conversationId, current);
  }

  async listSummaries(userId: string, conversationId: string) {
    if (!this.users.has(userId) || this.conversations.get(conversationId)?.userId !== userId) return [];
    return (this.summaries.get(conversationId) ?? []).map((summary) => ({ ...summary, sourceMessageIds: [...summary.sourceMessageIds] }));
  }
  async addSummary(userId: string, summary: ConversationSummaryRecord) {
    if (this.conversations.get(summary.conversationId)?.userId !== userId) throw new Error("Conversation not found");
    this.summaries.set(summary.conversationId, [...(this.summaries.get(summary.conversationId) ?? []), { ...summary, sourceMessageIds: [...summary.sourceMessageIds] }]);
  }
  async listCalls(userId: string) { return [...this.calls.values()].filter((call) => call.userId === userId).sort((left, right) => right.startedAt.localeCompare(left.startedAt)).map((call) => ({ ...call })); }
  async createCall(userId: string, call: CallRecord) {
    if (call.userId !== userId || this.companionOwners.get(call.companionId) !== userId) throw new Error("Cross-user call write rejected");
    this.calls.set(call.id, { ...call });
  }
  async endCall(userId: string, callId: string, endedAt: string) {
    const call = this.calls.get(callId);
    if (!call || call.userId !== userId) return null;
    const next = { ...call, state: "ended", endedAt, durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(call.startedAt)) };
    this.calls.set(callId, next);
    return { ...next };
  }
  async recordProviderUsage(record: ProviderUsageRecord) { this.providerUsage.push({ ...record }); }
  async listProviderUsage() { return this.providerUsage.map((record) => ({ ...record })); }

  async listMemories(userId: string, companionId: string) {
    return (this.memories.get(userId) ?? []).filter((memory) => memory.companionId === companionId && memory.status !== "deleted");
  }

  async upsertMemory(userId: string, memory: MemoryRecord) {
    if (memory.userId !== userId) throw new Error("Cross-user memory write rejected");
    const current = this.memories.get(userId) ?? [];
    const index = current.findIndex((item) => item.id === memory.id);
    if (index === -1) current.push({ ...memory }); else current[index] = { ...memory };
    this.memories.set(userId, current);
  }

  async deleteMemory(userId: string, memoryId: string) {
    const found = (this.memories.get(userId) ?? []).find((memory) => memory.id === memoryId);
    if (!found) return false;
    found.status = "deleted";
    found.updatedAt = new Date().toISOString();
    return true;
  }

  async listActivities() { return this.seed.activities.map((activity) => ({ ...activity })); }

  private ledger(userId: string) {
    const ledger = this.ledgers.get(userId);
    if (!ledger) throw new Error("Wallet not found");
    return ledger;
  }

  async getWallet(userId: string) { return this.ledger(userId).snapshot(); }
  async listWalletTransactions(userId: string) { return this.ledger(userId).history(); }

  async completeActivity(userId: string, activityId: string, idempotencyKey: string) {
    const activity = this.seed.activities.find((item) => item.id === activityId);
    if (!activity) throw new Error("Activity not found");
    const ledger = this.ledger(userId);
    ledger.earn({ currency: "xp", amount: activity.xp, referenceId: activity.id, idempotencyKey: `${idempotencyKey}:xp` });
    return ledger.earn({ currency: "coins", amount: activity.coinReward, referenceId: activity.id, idempotencyKey: `${idempotencyKey}:coins` });
  }

  async listStoreItems() { return this.seed.storeItems.filter((item) => item.active).map((item) => ({ ...item, metadata: { ...item.metadata } })); }
  async listOwnedItems(userId: string) { return (this.ownedItems.get(userId) ?? []).map((item) => ({ ...item })); }

  async purchaseItem(userId: string, itemId: string, idempotencyKey: string) {
    const item = this.seed.storeItems.find((candidate) => candidate.id === itemId && candidate.active);
    if (!item) throw new Error("Item not found");
    const current = this.ownedItems.get(userId) ?? [];
    const existing = current.find((owned) => owned.itemId === itemId);
    if (existing) return { wallet: await this.getWallet(userId), owned: { ...existing } };
    const wallet = this.ledger(userId).purchase(item, idempotencyKey);
    const owned: OwnedItemRecord = { itemId, purchasedAt: new Date().toISOString(), equipped: false };
    current.push(owned);
    this.ownedItems.set(userId, current);
    return { wallet, owned: { ...owned } };
  }

  async equipItem(userId: string, itemId: string) {
    const current = this.ownedItems.get(userId) ?? [];
    if (!current.some((owned) => owned.itemId === itemId)) throw new Error("Item is not owned");
    const item = this.seed.storeItems.find((candidate) => candidate.id === itemId);
    if (!item) throw new Error("Item not found");
    const slot = item.metadata.slot;
    const next = current.map((owned) => {
      const ownedItem = this.seed.storeItems.find((candidate) => candidate.id === owned.itemId);
      return ownedItem?.metadata.slot === slot ? { ...owned, equipped: owned.itemId === itemId } : owned;
    });
    this.ownedItems.set(userId, next);
    return next.map((owned) => ({ ...owned }));
  }

  async getSubscription(userId: string) { return this.subscriptions.get(userId) ?? { planId: "free", status: "active", testMode: true } as SubscriptionState; }

  async setSubscription(userId: string, subscription: SubscriptionState, idempotencyKey: string) {
    if (this.subscriptionEvents.has(idempotencyKey)) return this.getSubscription(userId);
    this.subscriptionEvents.add(idempotencyKey);
    this.subscriptions.set(userId, { ...subscription });
    return { ...subscription };
  }

  async listJournalEntries(userId: string) { return (this.journals.get(userId) ?? []).map((entry) => ({ ...entry, tags: [...entry.tags] })); }
  async addJournalEntry(userId: string, entry: JournalEntryRecord) {
    if (entry.userId !== userId) throw new Error("Cross-user journal write rejected");
    this.journals.set(userId, [entry, ...(this.journals.get(userId) ?? [])]);
  }
  async deleteJournalEntry(userId: string, entryId: string) {
    const current = this.journals.get(userId) ?? [];
    const next = current.filter((entry) => entry.id !== entryId);
    this.journals.set(userId, next);
    return next.length !== current.length;
  }

  async listFutureEvents(userId: string) { return (this.futureEvents.get(userId) ?? []).map((event) => ({ ...event })); }
  async addFutureEvent(userId: string, event: FutureEventRecord) {
    if (event.userId !== userId) throw new Error("Cross-user event write rejected");
    this.futureEvents.set(userId, [event, ...(this.futureEvents.get(userId) ?? [])]);
  }
  async listNudges(userId: string) { return (this.nudges.get(userId) ?? []).map((nudge) => ({ ...nudge })); }
  async addNudge(userId: string, nudge: ScheduledNudgeRecord) {
    if (nudge.userId !== userId) throw new Error("Cross-user nudge write rejected");
    this.nudges.set(userId, [nudge, ...(this.nudges.get(userId) ?? [])]);
  }

  async getNotificationSettings(userId: string) {
    return this.notificationSettings.get(userId) ?? { frequency: "off", quietStart: "22:00", quietEnd: "08:00", timezone: "UTC", enabledTopics: [] };
  }

  async setNotificationSettings(userId: string, settings: NotificationSettings) {
    if (!this.users.has(userId)) throw new Error("User not found");
    this.notificationSettings.set(userId, { ...settings, enabledTopics: [...settings.enabledTopics] });
  }

  async exportUser(userId: string) {
    return {
      exportedAt: new Date().toISOString(),
      user: this.users.get(userId) ?? null,
      companion: [...this.companions.values()][0] ?? null,
      conversations: [...this.messages.entries()],
      memories: this.memories.get(userId) ?? [],
      wallet: await this.getWallet(userId),
      walletTransactions: await this.listWalletTransactions(userId),
      ownedItems: await this.listOwnedItems(userId),
      subscription: await this.getSubscription(userId),
      journal: await this.listJournalEntries(userId),
      events: await this.listFutureEvents(userId),
      nudges: await this.listNudges(userId),
      notifications: await this.getNotificationSettings(userId),
    };
  }

  async deleteUser(userId: string) {
    for (const [companionId, ownerId] of this.companionOwners) if (ownerId === userId) { this.companionOwners.delete(companionId); this.companions.delete(companionId); }
    this.users.delete(userId);
    this.memories.delete(userId);
    this.ledgers.delete(userId);
    this.notificationSettings.delete(userId);
    this.ownedItems.delete(userId);
    this.subscriptions.delete(userId);
    this.journals.delete(userId);
    this.futureEvents.delete(userId);
    this.nudges.delete(userId);
    for (const [callId, call] of this.calls) if (call.userId === userId) this.calls.delete(callId);
    this.providerUsage = this.providerUsage.filter((record) => record.userId !== userId);
    for (const [conversationId, conversation] of this.conversations) if (conversation.userId === userId) { this.conversations.delete(conversationId); this.summaries.delete(conversationId); }
    for (const [conversationId, messages] of this.messages) if (messages.some((message) => message.id.startsWith(`${userId}:`))) this.messages.delete(conversationId);
  }
}
