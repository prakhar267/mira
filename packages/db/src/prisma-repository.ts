import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
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
import type { CallRecord, CompanionRepository } from "./repository";

type JsonMap = Record<string, unknown>;

function memoryType(value: string) { return value.toUpperCase() as "SEMANTIC" | "EPISODIC" | "PREFERENCE" | "RELATIONSHIP" | "GOAL" | "EMOTIONAL" | "SHARED"; }
function memoryStatus(value: string) { return value.toUpperCase() as "ACTIVE" | "SUPERSEDED" | "DELETED"; }
function messageRole(value: string) { return value.toUpperCase() as "USER" | "ASSISTANT" | "SYSTEM"; }
function txType(value: string) { return value.toUpperCase() as "EARN" | "PURCHASE" | "REFUND" | "ADMIN_ADJUSTMENT"; }
function subscriptionStatus(value: string) { return value.toUpperCase() as "TRIALING" | "ACTIVE" | "CANCELED"; }

export class PrismaCompanionRepository implements CompanionRepository {
  readonly kind = "postgres";
  constructor(readonly prisma = new PrismaClient()) {}
  async disconnect() { await this.prisma.$disconnect(); }
  async health() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  async createAccount(input: { user: UserProfile; companion: CompanionProfile; email?: string }) {
    await this.prisma.$transaction(async (tx) => {
      await tx.user.create({ data: {
        id: input.user.id,
        email: input.email?.toLowerCase() ?? `${input.user.id}@pending.local`,
        displayName: input.user.name,
        birthday: new Date(`${input.user.birthday}T00:00:00.000Z`),
        pronouns: input.user.pronouns,
        timezone: input.user.timezone,
        adultConfirmedAt: new Date(),
        preferences: { create: [{ key: "interests", value: input.user.interests }] },
      } });
      await tx.companion.create({ data: {
        id: input.companion.id,
        userId: input.user.id,
        name: input.companion.name,
        pronouns: input.companion.pronouns,
        presentation: input.companion.presentation,
        relationshipMode: input.companion.relationshipMode,
        personality: { create: { version: 1, traits: { ...input.companion.personality }, reason: "onboarding" } },
        state: { create: { mood: input.companion.mood, energy: input.companion.personality.energy, context: {} } },
        relationship: { create: { mode: input.companion.relationshipMode } },
      } });
      await tx.wallet.create({ data: { userId: input.user.id } });
      await tx.notificationPreference.create({ data: { userId: input.user.id, enabled: true, frequency: "normal", timezone: input.user.timezone, enabledTopics: ["future-events", "goals"] } });
      const freeItems = await tx.storeItem.findMany({ where: { active: true, currency: "free" } });
      if (freeItems.length) await tx.ownedItem.createMany({ data: freeItems.map((item) => ({ userId: input.user.id, storeItemId: item.id, source: "onboarding" })), skipDuplicates: true });
    });
  }

  async getUser(userId: string): Promise<UserProfile | null> {
    const row = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null }, include: { preferences: true } });
    if (!row) return null;
    const interests = row.preferences.find((item) => item.key === "interests")?.value;
    return {
      id: row.id,
      name: row.displayName,
      birthday: row.birthday.toISOString().slice(0, 10),
      pronouns: row.pronouns as UserProfile["pronouns"],
      interests: Array.isArray(interests) ? interests.filter((item): item is string => typeof item === "string") : [],
      timezone: row.timezone,
      adultConfirmed: Boolean(row.adultConfirmedAt),
    };
  }

  async updateUser(userId: string, user: UserProfile) {
    if (user.id !== userId) throw new Error("Cross-user profile write rejected");
    const updated = await this.prisma.user.updateMany({ where: { id: userId, deletedAt: null }, data: { displayName: user.name, pronouns: user.pronouns, timezone: user.timezone } });
    if (!updated.count) throw new Error("User not found");
  }

  async listCompanions(userId: string): Promise<CompanionProfile[]> {
    const rows = await this.prisma.companion.findMany({ where: { userId, archivedAt: null }, select: { id: true }, orderBy: { createdAt: "asc" } });
    const companions = await Promise.all(rows.map((row) => this.getCompanion(userId, row.id)));
    return companions.filter((companion): companion is CompanionProfile => companion !== null);
  }

  async getCompanion(userId: string, companionId: string): Promise<CompanionProfile | null> {
    const row = await this.prisma.companion.findFirst({ where: { id: companionId, userId, archivedAt: null }, include: { personality: { where: { effectiveTo: null }, orderBy: { version: "desc" }, take: 1 }, state: true } });
    if (!row) return null;
    const traits = (row.personality[0]?.traits ?? {}) as JsonMap;
    const trait = (key: string, fallback: number) => typeof traits[key] === "number" ? traits[key] as number : fallback;
    return {
      id: row.id,
      name: row.name,
      pronouns: row.pronouns as CompanionProfile["pronouns"],
      presentation: row.presentation,
      voiceId: row.voiceProfileId ?? "alloy",
      relationshipMode: row.relationshipMode as CompanionProfile["relationshipMode"],
      mood: (row.state?.mood ?? "calm") as CompanionProfile["mood"],
      personality: { warmth: trait("warmth", .8), humor: trait("humor", .6), curiosity: trait("curiosity", .7), assertiveness: trait("assertiveness", .4), optimism: trait("optimism", .7), energy: trait("energy", .6), verbosity: trait("verbosity", .4), playfulness: trait("playfulness", .6), empathy: trait("empathy", .8) },
      createdAt: row.createdAt.toISOString(),
    };
  }

  async updateCompanion(userId: string, companion: CompanionProfile) {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.companion.findFirst({ where: { id: companion.id, userId }, include: { personality: { orderBy: { version: "desc" }, take: 1 } } });
      if (!current) throw new Error("Companion not found");
      await tx.companion.update({ where: { id: companion.id }, data: { name: companion.name, pronouns: companion.pronouns, presentation: companion.presentation, relationshipMode: companion.relationshipMode, voiceProfileId: companion.voiceId } });
      await tx.companionPersonality.updateMany({ where: { companionId: companion.id, effectiveTo: null }, data: { effectiveTo: new Date() } });
      await tx.companionPersonality.create({ data: { companionId: companion.id, version: (current.personality[0]?.version ?? 0) + 1, traits: { ...companion.personality }, reason: "user-update" } });
      await tx.companionState.upsert({ where: { companionId: companion.id }, update: { mood: companion.mood, energy: companion.personality.energy }, create: { companionId: companion.id, mood: companion.mood, energy: companion.personality.energy, context: {} } });
    });
  }

  async listConversations(userId: string) {
    const rows = await this.prisma.conversation.findMany({ where: { userId, archivedAt: null }, orderBy: { updatedAt: "desc" } });
    return rows.map((row) => ({ id: row.id, userId: row.userId, companionId: row.companionId, createdAt: row.startedAt.toISOString() }));
  }
  async createConversation(input: { id: string; userId: string; companionId: string; createdAt: string }) {
    await this.prisma.conversation.create({ data: { id: input.id, userId: input.userId, companionId: input.companionId, startedAt: new Date(input.createdAt) } });
  }
  async deleteConversation(userId: string, conversationId: string) {
    const archivedAt = new Date();
    const result = await this.prisma.conversation.updateMany({ where: { id: conversationId, userId, archivedAt: null }, data: { archivedAt } });
    if (result.count) await this.prisma.message.updateMany({ where: { conversationId, userId, deletedAt: null }, data: { deletedAt: archivedAt } });
    return result.count > 0;
  }

  async listMessages(userId: string, conversationId: string): Promise<ChatMessage[]> {
    const rows = await this.prisma.message.findMany({ where: { userId, conversationId, deletedAt: null }, include: { feedback: true }, orderBy: { createdAt: "asc" } });
    return rows.map((row) => ({ id: row.id, conversationId: row.conversationId, role: row.role.toLowerCase() as ChatMessage["role"], content: row.content, createdAt: row.createdAt.toISOString(), status: "sent", ...(row.replyToId ? { replyToId: row.replyToId } : {}), ...(row.feedback[0] ? { feedback: row.feedback[0].rating > 0 ? "up" as const : "down" as const } : {}) }));
  }

  async appendMessages(userId: string, conversationId: string, messages: ChatMessage[]) {
    const conversation = await this.prisma.conversation.findFirst({ where: { id: conversationId, userId } });
    if (!conversation) throw new Error("Conversation not found");
    await this.prisma.message.createMany({ data: messages.map((message) => ({ id: message.id, userId, conversationId, role: messageRole(message.role), content: message.content, ...(message.replyToId ? { replyToId: message.replyToId } : {}), createdAt: new Date(message.createdAt) })), skipDuplicates: true });
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
  }

  async updateMessage(userId: string, conversationId: string, message: ChatMessage) {
    const updated = await this.prisma.message.updateMany({ where: { id: message.id, userId, conversationId }, data: { content: message.content, editedAt: new Date() } });
    if (!updated.count) throw new Error("Message not found");
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
    if (message.feedback) await this.prisma.messageFeedback.upsert({ where: { messageId: message.id }, update: { rating: message.feedback === "up" ? 1 : -1 }, create: { messageId: message.id, rating: message.feedback === "up" ? 1 : -1, tags: [] } });
  }

  async listSummaries(userId: string, conversationId: string): Promise<ConversationSummaryRecord[]> {
    const conversation = await this.prisma.conversation.findFirst({ where: { id: conversationId, userId } });
    if (!conversation) return [];
    const rows = await this.prisma.conversationSummary.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" } });
    return rows.map((row) => ({ id: row.id, conversationId, period: row.scope as ConversationSummaryRecord["period"], content: row.content, sourceMessageIds: [], createdAt: row.createdAt.toISOString() }));
  }
  async addSummary(userId: string, summary: ConversationSummaryRecord) {
    const conversation = await this.prisma.conversation.findFirst({ where: { id: summary.conversationId, userId } });
    if (!conversation) throw new Error("Conversation not found");
    await this.prisma.conversationSummary.create({ data: { id: summary.id, conversationId: summary.conversationId, scope: summary.period, periodStart: new Date(summary.createdAt), periodEnd: new Date(summary.createdAt), content: summary.content, tokenCount: Math.ceil(summary.content.length / 4) } });
  }

  async listCalls(userId: string): Promise<CallRecord[]> {
    const [voice, video] = await Promise.all([
      this.prisma.voiceCall.findMany({ where: { userId }, orderBy: { startedAt: "desc" } }),
      this.prisma.videoCall.findMany({ where: { userId }, orderBy: { startedAt: "desc" } }),
    ]);
    return [
      ...voice.map((call) => ({ id: call.id, userId: call.userId, companionId: call.companionId, type: "voice" as const, state: call.status, provider: call.provider, startedAt: call.startedAt.toISOString(), ...(call.endedAt ? { endedAt: call.endedAt.toISOString() } : {}), ...(call.durationMs !== null ? { durationMs: call.durationMs } : {}), ...(call.summary ? { summary: call.summary } : {}), cameraEnabled: false })),
      ...video.map((call) => ({ id: call.id, userId: call.userId, companionId: call.companionId, type: "video" as const, state: call.status, provider: call.provider, startedAt: call.startedAt.toISOString(), ...(call.endedAt ? { endedAt: call.endedAt.toISOString() } : {}), ...(call.durationMs !== null ? { durationMs: call.durationMs } : {}), ...(call.summary ? { summary: call.summary } : {}), ...(call.environmentId ? { environmentId: call.environmentId } : {}), cameraEnabled: call.cameraEnabled })),
    ].sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  async createCall(userId: string, call: CallRecord) {
    if (call.userId !== userId || !await this.getCompanion(userId, call.companionId)) throw new Error("Cross-user call write rejected");
    if (call.type === "voice") await this.prisma.voiceCall.create({ data: { id: call.id, userId, companionId: call.companionId, status: call.state, provider: call.provider, startedAt: new Date(call.startedAt), metadata: {} } });
    else await this.prisma.videoCall.create({ data: { id: call.id, userId, companionId: call.companionId, status: call.state, provider: call.provider, startedAt: new Date(call.startedAt), ...(call.environmentId ? { environmentId: call.environmentId } : {}), cameraEnabled: call.cameraEnabled, metadata: {} } });
  }

  async endCall(userId: string, callId: string, endedAt: string): Promise<CallRecord | null> {
    const current = (await this.listCalls(userId)).find((call) => call.id === callId);
    if (!current) return null;
    const ended = new Date(endedAt);
    const durationMs = Math.max(0, ended.getTime() - Date.parse(current.startedAt));
    if (current.type === "voice") await this.prisma.voiceCall.update({ where: { id: callId }, data: { status: "ended", endedAt: ended, durationMs } });
    else await this.prisma.videoCall.update({ where: { id: callId }, data: { status: "ended", endedAt: ended, durationMs } });
    return { ...current, state: "ended", endedAt, durationMs };
  }

  async recordProviderUsage(record: ProviderUsageRecord) {
    await this.prisma.providerUsage.create({ data: { id: record.id, userId: record.userId, feature: record.feature, provider: record.provider, model: record.model, inputTokens: record.inputUnits, outputTokens: record.outputUnits, durationMs: record.latencyMs, estimatedCost: record.estimatedCostUsd, requestId: record.id, createdAt: new Date(record.createdAt) } });
  }
  async listProviderUsage(): Promise<ProviderUsageRecord[]> {
    const rows = await this.prisma.providerUsage.findMany({ orderBy: { createdAt: "desc" }, take: 5_000 });
    return rows.map((row) => ({ id: row.id, ...(row.userId ? { userId: row.userId } : { userId: "anonymous" }), feature: row.feature, provider: row.provider, model: row.model, inputUnits: row.inputTokens, outputUnits: row.outputTokens, estimatedCostUsd: Number(row.estimatedCost), latencyMs: row.durationMs, success: true, createdAt: row.createdAt.toISOString() }));
  }

  async listMemories(userId: string, companionId: string): Promise<MemoryRecord[]> {
    const rows = await this.prisma.memory.findMany({ where: { userId, companionId, status: { not: "DELETED" } }, include: { sources: true }, orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }] });
    return rows.map((row) => ({ id: row.id, userId: row.userId, companionId: row.companionId, type: row.type.toLowerCase() as MemoryRecord["type"], content: row.content, normalizedContent: row.normalizedContent, importance: row.importance, confidence: row.confidence, sourceMessageIds: row.sources.map((source) => source.messageId), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), ...(row.lastRetrievedAt ? { lastRetrievedAt: row.lastRetrievedAt.toISOString() } : {}), retrievalCount: row.retrievalCount, status: row.status.toLowerCase() as MemoryRecord["status"], pinned: row.pinned }));
  }

  async upsertMemory(userId: string, memory: MemoryRecord) {
    if (memory.userId !== userId) throw new Error("Cross-user memory write rejected");
    await this.prisma.memory.upsert({ where: { id: memory.id }, update: { content: memory.content, normalizedContent: memory.normalizedContent, importance: memory.importance, confidence: memory.confidence, status: memoryStatus(memory.status), pinned: memory.pinned, retrievalCount: memory.retrievalCount, lastRetrievedAt: memory.lastRetrievedAt ? new Date(memory.lastRetrievedAt) : null, deletedAt: memory.status === "deleted" ? new Date() : null }, create: { id: memory.id, userId, companionId: memory.companionId, type: memoryType(memory.type), content: memory.content, normalizedContent: memory.normalizedContent, importance: memory.importance, confidence: memory.confidence, status: memoryStatus(memory.status), pinned: memory.pinned, retrievalCount: memory.retrievalCount, createdAt: new Date(memory.createdAt) } });
    const existingMessages = await this.prisma.message.findMany({ where: { id: { in: memory.sourceMessageIds }, userId }, select: { id: true } });
    if (existingMessages.length) await this.prisma.memorySource.createMany({ data: existingMessages.map((message) => ({ memoryId: memory.id, messageId: message.id, quoteHash: createHash("sha256").update(message.id).digest("hex") })), skipDuplicates: true });
  }

  async deleteMemory(userId: string, memoryId: string) {
    const result = await this.prisma.memory.updateMany({ where: { id: memoryId, userId, status: { not: "DELETED" } }, data: { status: "DELETED", deletedAt: new Date() } });
    return result.count > 0;
  }

  async listActivities(): Promise<ActivityDefinition[]> {
    const rows = await this.prisma.activity.findMany({ where: { active: true }, orderBy: { title: "asc" } });
    return rows.map((row) => ({ id: row.slug, title: row.title, category: row.category as ActivityDefinition["category"], description: row.description, durationMinutes: Number((row.config as JsonMap).durationMinutes ?? 10), xp: row.xpReward, coinReward: row.coinReward }));
  }

  async getWallet(userId: string): Promise<WalletState> {
    const wallet = await this.prisma.wallet.upsert({ where: { userId }, update: {}, create: { userId } });
    return { xp: wallet.xp, level: wallet.level, coins: wallet.coins, gems: wallet.gems };
  }

  async listWalletTransactions(userId: string): Promise<WalletTransactionRecord[]> {
    const rows = await this.prisma.walletTransaction.findMany({ where: { wallet: { userId } }, orderBy: { createdAt: "desc" } });
    return rows.map((row) => ({ id: row.id, userId, type: row.type.toLowerCase() as WalletTransactionRecord["type"], currency: row.currency as WalletTransactionRecord["currency"], amount: row.amount, balanceAfter: row.balanceAfter, referenceId: row.referenceId, idempotencyKey: row.idempotencyKey, createdAt: row.createdAt.toISOString() }));
  }

  async completeActivity(userId: string, activityId: string, _idempotencyKey: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const activity = await tx.activity.findFirst({ where: { OR: [{ id: activityId }, { slug: activityId }], active: true } });
        if (!activity) throw new Error("Activity not found");
        const wallet = await tx.wallet.upsert({ where: { userId }, update: {}, create: { userId } });
        const completionKey = `activity:${userId}:${activity.slug}`;
        const coinKey = `${completionKey}:coins`;
        if (await tx.walletTransaction.findUnique({ where: { idempotencyKey: coinKey } })) return { xp: wallet.xp, level: wallet.level, coins: wallet.coins, gems: wallet.gems };
        const xp = wallet.xp + activity.xpReward;
        const coins = wallet.coins + activity.coinReward;
        const level = Math.max(wallet.level, Math.floor(xp / 100) + 1);
        const next = await tx.wallet.update({ where: { id: wallet.id }, data: { xp, coins, level, version: { increment: 1 } } });
        await tx.walletTransaction.createMany({ data: [
          { walletId: wallet.id, type: "EARN", currency: "xp", amount: activity.xpReward, balanceAfter: xp, idempotencyKey: `${completionKey}:xp`, referenceType: "activity", referenceId: activity.slug, metadata: {} },
          { walletId: wallet.id, type: "EARN", currency: "coins", amount: activity.coinReward, balanceAfter: coins, idempotencyKey: coinKey, referenceType: "activity", referenceId: activity.slug, metadata: {} },
        ] });
        return { xp: next.xp, level: next.level, coins: next.coins, gems: next.gems };
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") return this.getWallet(userId);
      throw error;
    }
  }

  async listStoreItems(): Promise<StoreItemRecord[]> {
    const rows = await this.prisma.storeItem.findMany({ where: { active: true } });
    return rows.map((row) => ({ id: row.id, name: row.name, description: row.description, category: row.category as StoreItemRecord["category"], assetUrl: row.assetKey, currency: row.currency as StoreItemRecord["currency"], price: row.price, tierRequired: (row.tierRequired ?? "free") as StoreItemRecord["tierRequired"], metadata: row.metadata as Record<string, string>, active: row.active }));
  }

  async listOwnedItems(userId: string): Promise<OwnedItemRecord[]> {
    const rows = await this.prisma.ownedItem.findMany({ where: { userId }, include: { storeItem: { include: { equipped: true } } } });
    return rows.map((row) => ({ itemId: row.storeItemId, purchasedAt: row.acquiredAt.toISOString(), equipped: row.storeItem.equipped.some((item) => item.storeItemId === row.storeItemId) }));
  }

  async purchaseItem(userId: string, itemId: string, idempotencyKey: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.ownedItem.findUnique({ where: { userId_storeItemId: { userId, storeItemId: itemId } } });
      if (existing) return { wallet: await this.getWallet(userId), owned: { itemId, purchasedAt: existing.acquiredAt.toISOString(), equipped: false } };
      const item = await tx.storeItem.findFirst({ where: { id: itemId, active: true } });
      if (!item) throw new Error("Item not found");
      const wallet = await tx.wallet.upsert({ where: { userId }, update: {}, create: { userId } });
      let next = wallet;
      if (item.currency !== "free") {
        const current = item.currency === "coins" ? wallet.coins : wallet.gems;
        if (current < item.price) throw new Error("Insufficient balance");
        const balance = current - item.price;
        next = await tx.wallet.update({ where: { id: wallet.id }, data: { [item.currency]: balance, version: { increment: 1 } } });
        await tx.walletTransaction.create({ data: { walletId: wallet.id, type: "PURCHASE", currency: item.currency, amount: -item.price, balanceAfter: balance, idempotencyKey, referenceType: "store-item", referenceId: item.id, metadata: {} } });
      }
      const owned = await tx.ownedItem.create({ data: { userId, storeItemId: item.id, source: "store" } });
      return { wallet: { xp: next.xp, level: next.level, coins: next.coins, gems: next.gems }, owned: { itemId, purchasedAt: owned.acquiredAt.toISOString(), equipped: false } };
    });
  }

  async equipItem(userId: string, itemId: string) {
    const owned = await this.prisma.ownedItem.findUnique({ where: { userId_storeItemId: { userId, storeItemId: itemId } }, include: { storeItem: true } });
    if (!owned) throw new Error("Item is not owned");
    const companion = await this.prisma.companion.findFirst({ where: { userId, archivedAt: null } });
    if (!companion) throw new Error("Companion not found");
    const metadata = owned.storeItem.metadata as Record<string, string>;
    const slot = metadata.slot ?? owned.storeItem.category.toLowerCase();
    await this.prisma.equippedItem.upsert({ where: { companionId_slot: { companionId: companion.id, slot } }, update: { storeItemId: itemId }, create: { companionId: companion.id, storeItemId: itemId, slot } });
    return this.listOwnedItems(userId);
  }

  async getSubscription(userId: string): Promise<SubscriptionState> {
    const row = await this.prisma.subscription.findFirst({ where: { userId }, orderBy: { updatedAt: "desc" } });
    return row ? { planId: row.planId as SubscriptionState["planId"], status: row.status.toLowerCase() as SubscriptionState["status"], testMode: row.provider === "test", renewsAt: row.currentPeriodEnd.toISOString() } : { planId: "free", status: "active", testMode: true };
  }

  async setSubscription(userId: string, subscription: SubscriptionState, idempotencyKey: string) {
    const now = new Date();
    await this.prisma.subscription.upsert({ where: { providerSubscriptionId: idempotencyKey }, update: { planId: subscription.planId, status: subscriptionStatus(subscription.status) }, create: { userId, provider: subscription.testMode ? "test" : "external", providerSubscriptionId: idempotencyKey, planId: subscription.planId, status: subscriptionStatus(subscription.status), currentPeriodStart: now, currentPeriodEnd: subscription.renewsAt ? new Date(subscription.renewsAt) : new Date(now.getTime() + 30 * 86_400_000) } });
    return subscription;
  }

  async listJournalEntries(userId: string): Promise<JournalEntryRecord[]> {
    const rows = await this.prisma.journalEntry.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
    return rows.map((row) => ({ id: row.id, userId, title: row.title ?? "Untitled", content: row.content, mood: (row.mood ?? "thoughtful") as JournalEntryRecord["mood"], tags: row.tags, reflected: Boolean(row.reflectedAt), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }));
  }
  async addJournalEntry(userId: string, entry: JournalEntryRecord) { if (entry.userId !== userId) throw new Error("Cross-user journal write rejected"); await this.prisma.journalEntry.create({ data: { id: entry.id, userId, title: entry.title, content: entry.content, mood: entry.mood, tags: entry.tags, reflectedAt: entry.reflected ? new Date() : null, createdAt: new Date(entry.createdAt) } }); }
  async deleteJournalEntry(userId: string, entryId: string) { const result = await this.prisma.journalEntry.deleteMany({ where: { id: entryId, userId } }); return result.count > 0; }

  async listFutureEvents(userId: string): Promise<FutureEventRecord[]> {
    const rows = await this.prisma.futureEvent.findMany({ where: { userId }, orderBy: { startsAt: "asc" } });
    return rows.map((row) => ({ id: row.id, userId, companionId: row.companionId, description: row.description, eventDate: row.startsAt.toISOString(), ...(row.memoryId ? { relatedMemoryId: row.memoryId } : {}), status: row.status as FutureEventRecord["status"], createdAt: row.createdAt.toISOString() }));
  }
  async addFutureEvent(userId: string, event: FutureEventRecord) { if (event.userId !== userId) throw new Error("Cross-user event write rejected"); const user = await this.getUser(userId); await this.prisma.futureEvent.create({ data: { id: event.id, userId, companionId: event.companionId, description: event.description, startsAt: new Date(event.eventDate), timezone: user?.timezone ?? "UTC", status: event.status, ...(event.relatedMemoryId ? { memoryId: event.relatedMemoryId } : {}), createdAt: new Date(event.createdAt) } }); }

  async listNudges(userId: string): Promise<ScheduledNudgeRecord[]> {
    const rows = await this.prisma.scheduledNudge.findMany({ where: { userId }, orderBy: { scheduledAt: "asc" } });
    return rows.map((row) => ({ id: row.id, userId, ...(row.futureEventId ? { eventId: row.futureEventId } : {}), content: row.content, scheduledFor: row.scheduledAt.toISOString(), status: row.status as ScheduledNudgeRecord["status"] }));
  }
  async addNudge(userId: string, nudge: ScheduledNudgeRecord) { if (nudge.userId !== userId) throw new Error("Cross-user nudge write rejected"); const companion = await this.prisma.companion.findFirst({ where: { userId, archivedAt: null } }); if (!companion) throw new Error("Companion not found"); await this.prisma.scheduledNudge.create({ data: { id: nudge.id, userId, companionId: companion.id, ...(nudge.eventId ? { futureEventId: nudge.eventId } : {}), topic: nudge.eventId ? "future-events" : "general", content: nudge.content, scheduledAt: new Date(nudge.scheduledFor), status: nudge.status } }); }

  async getNotificationSettings(userId: string): Promise<NotificationSettings> {
    const row = await this.prisma.notificationPreference.findUnique({ where: { userId } });
    return row ? { frequency: row.enabled ? row.frequency as NotificationSettings["frequency"] : "off", quietStart: row.quietStart, quietEnd: row.quietEnd, timezone: row.timezone, enabledTopics: row.enabledTopics } : { frequency: "off", quietStart: "22:00", quietEnd: "08:00", timezone: "UTC", enabledTopics: [] };
  }
  async setNotificationSettings(userId: string, settings: NotificationSettings) { await this.prisma.notificationPreference.upsert({ where: { userId }, update: { enabled: settings.frequency !== "off", frequency: settings.frequency, quietStart: settings.quietStart, quietEnd: settings.quietEnd, timezone: settings.timezone, enabledTopics: settings.enabledTopics }, create: { userId, enabled: settings.frequency !== "off", frequency: settings.frequency, quietStart: settings.quietStart, quietEnd: settings.quietEnd, timezone: settings.timezone, enabledTopics: settings.enabledTopics } }); }

  async exportUser(userId: string) {
    const [user, companion, conversations, memories, wallet, walletTransactions, ownedItems, subscription, journal, events, nudges, notifications] = await Promise.all([this.getUser(userId), this.prisma.companion.findFirst({ where: { userId, archivedAt: null } }), this.prisma.conversation.findMany({ where: { userId }, include: { messages: true, summaries: true } }), this.prisma.memory.findMany({ where: { userId } }), this.getWallet(userId), this.listWalletTransactions(userId), this.listOwnedItems(userId), this.getSubscription(userId), this.listJournalEntries(userId), this.listFutureEvents(userId), this.listNudges(userId), this.getNotificationSettings(userId)]);
    return { exportedAt: new Date().toISOString(), user, companion, conversations, memories, wallet, walletTransactions, ownedItems, subscription, journal, events, nudges, notifications };
  }
  async deleteUser(userId: string) { await this.prisma.user.deleteMany({ where: { id: userId } }); }
}

export interface PrismaAuthIdentity { email: string; userId: string; passwordHash: string; emailVerified: boolean }
export interface PrismaAuthSession { id: string; userId: string; refreshTokenHash: string; expiresAt: number; revokedAt?: number }
export interface PrismaAuthChallenge { tokenHash: string; email: string; kind: "password-reset" | "email-verification"; expiresAt: number }

export class PrismaAuthStore {
  constructor(private readonly prisma: PrismaClient) {}
  async createIdentity(identity: PrismaAuthIdentity) { await this.prisma.authIdentity.create({ data: { userId: identity.userId, provider: "password", providerAccountId: identity.email.toLowerCase(), passwordHash: identity.passwordHash } }); }
  async deleteIdentity(email: string) { await this.prisma.authIdentity.deleteMany({ where: { provider: "password", providerAccountId: email.toLowerCase() } }); }
  async deleteUser(userId: string) { await this.prisma.user.deleteMany({ where: { id: userId } }); }
  async findIdentity(email: string): Promise<PrismaAuthIdentity | null> { const row = await this.prisma.authIdentity.findUnique({ where: { provider_providerAccountId: { provider: "password", providerAccountId: email.toLowerCase() } }, include: { user: true } }); return row?.passwordHash ? { email: row.providerAccountId, userId: row.userId, passwordHash: row.passwordHash, emailVerified: Boolean(row.user.emailVerifiedAt) } : null; }
  async updateIdentity(identity: PrismaAuthIdentity) { await this.prisma.$transaction([this.prisma.authIdentity.update({ where: { provider_providerAccountId: { provider: "password", providerAccountId: identity.email.toLowerCase() } }, data: { passwordHash: identity.passwordHash } }), this.prisma.user.update({ where: { id: identity.userId }, data: { emailVerifiedAt: identity.emailVerified ? new Date() : null } })]); }
  async saveSession(session: PrismaAuthSession) { await this.prisma.session.create({ data: { id: session.id, userId: session.userId, tokenHash: createHash("sha256").update(session.id).digest("hex"), refreshTokenHash: session.refreshTokenHash, expiresAt: new Date(session.expiresAt), revokedAt: session.revokedAt ? new Date(session.revokedAt) : null } }); }
  async findSessionById(sessionId: string): Promise<PrismaAuthSession | null> { const row = await this.prisma.session.findUnique({ where: { id: sessionId } }); return row ? { id: row.id, userId: row.userId, refreshTokenHash: row.refreshTokenHash, expiresAt: row.expiresAt.getTime(), ...(row.revokedAt ? { revokedAt: row.revokedAt.getTime() } : {}) } : null; }
  async findSessionByRefreshHash(refreshTokenHash: string): Promise<PrismaAuthSession | null> { const row = await this.prisma.session.findUnique({ where: { refreshTokenHash } }); return row ? { id: row.id, userId: row.userId, refreshTokenHash: row.refreshTokenHash, expiresAt: row.expiresAt.getTime(), ...(row.revokedAt ? { revokedAt: row.revokedAt.getTime() } : {}) } : null; }
  async revokeSession(sessionId: string) { await this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } }); }
  async revokeSessionsForUser(userId: string) { await this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }); }
  async saveChallenge(challenge: PrismaAuthChallenge) { const identity = await this.findIdentity(challenge.email); await this.prisma.authChallenge.create({ data: { email: challenge.email, tokenHash: challenge.tokenHash, kind: challenge.kind, expiresAt: new Date(challenge.expiresAt), ...(identity ? { user: { connect: { id: identity.userId } } } : {}) } }); }
  async consumeChallenge(tokenHash: string, kind: PrismaAuthChallenge["kind"]): Promise<PrismaAuthChallenge | null> { return this.prisma.$transaction(async (tx) => { const row = await tx.authChallenge.findFirst({ where: { tokenHash, kind, consumedAt: null, expiresAt: { gt: new Date() } } }); if (!row) return null; await tx.authChallenge.update({ where: { id: row.id }, data: { consumedAt: new Date() } }); return { tokenHash: row.tokenHash, email: row.email, kind: row.kind as PrismaAuthChallenge["kind"], expiresAt: row.expiresAt.getTime() }; }); }
}
