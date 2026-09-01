import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import { z } from "zod";
import {
  MockChatProvider,
  MockImageProvider,
  MockSpeechProvider,
  MockVisionProvider,
  applyContradictions,
  assessSafety,
  buildCompanionContext,
  extractMemoryCandidates,
  generateNudge,
  summarizeConversation,
} from "@companion/ai";
import { brand, featureEntitlements, featureFlags, parseServerEnv, plans, type Entitlement, type PlanId } from "@companion/config";
import { InMemoryCompanionRepository, inMemorySeed, seedCompanion, seedUser } from "@companion/db";
import {
  chatRequestSchema,
  futureEventSchema,
  journalEntrySchema,
  memoryUpdateSchema,
  onboardingSchema,
  storePurchaseSchema,
  subscriptionWebhookSchema,
  type ChatMessage,
  type ConversationSummaryRecord,
  type FutureEventRecord,
  type JournalEntryRecord,
  type MemoryRecord,
  type NotificationSettings,
  type ProviderUsageRecord,
  type SubscriptionState,
} from "@companion/shared";

const repository = new InMemoryCompanionRepository(inMemorySeed);
const provider = new MockChatProvider();
const visionProvider = new MockVisionProvider();
const speechProvider = new MockSpeechProvider();
const imageProvider = new MockImageProvider();
const passwordChallenges = new Map<string, string>();
const usageRecords: ProviderUsageRecord[] = [];
const conversations = new Map<string, { id: string; userId: string; companionId: string; createdAt: string }>();
const summaries = new Map<string, ConversationSummaryRecord[]>();
const callSessions = new Map<string, { id: string; userId: string; companionId: string; type: "voice" | "video"; state: string; startedAt: string; environmentId?: string; cameraEnabled: boolean }>();
const runtimeFeatureFlags: Record<string, boolean> = { ...featureFlags };

function actorId(headers: Record<string, string | string[] | undefined>): string {
  const header = headers["x-user-id"];
  return typeof header === "string" && /^[0-9a-f-]{36}$/i.test(header) ? header : seedUser.id;
}

function apiError(code: string, message: string, requestId: string) {
  return { ok: false, error: { code, message }, requestId };
}

function isAdmin(headers: Record<string, string | string[] | undefined>, expected: string): boolean {
  return headers["x-admin-key"] === expected;
}

export async function createServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info",
      redact: {
        paths: ["req.headers.authorization", "req.headers.cookie", "body.content", "body.email", "body.password", "res.body"],
        censor: "[redacted]",
      },
    },
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
  });

  const env = parseServerEnv(process.env);
  const rateWindows = new Map<string, { count: number; resetsAt: number }>();
  await app.register(cors, { origin: env.APP_ORIGIN, credentials: true });
  await app.register(swagger, {
    openapi: {
      info: {
        title: `${brand.displayName} API`,
        description: "Production-oriented companion API with a deterministic mock runtime.",
        version: "0.1.0",
      },
      servers: [{ url: env.API_ORIGIN }],
    },
  });

  async function entitlementFor(userId: string, entitlement: Entitlement) {
    const subscription = await repository.getSubscription(userId);
    return {
      allowed: featureEntitlements.has(subscription.planId, entitlement),
      subscription,
      minimumPlan: featureEntitlements.minimumPlan(entitlement),
    };
  }

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("permissions-policy", "camera=(), microphone=(self), geolocation=()");
    return payload;
  });

  app.addHook("onRequest", async (request, reply) => {
    const now = Date.now();
    const key = `${actorId(request.headers)}:${request.routeOptions.url}`;
    const current = rateWindows.get(key);
    const windowState = !current || current.resetsAt <= now ? { count: 0, resetsAt: now + 60_000 } : current;
    windowState.count += 1;
    rateWindows.set(key, windowState);
    reply.header("x-rate-limit-remaining", String(Math.max(0, 120 - windowState.count)));
    if (windowState.count > 120) return reply.code(429).send(apiError("rate_limited", "Please wait a moment and try again.", request.id));
  });

  app.get("/health", async (request) => ({
    ok: true,
    data: {
      status: "ok",
      version: "0.1.0",
      mockMode: env.AI_MOCK_MODE,
      persistence: "in-memory-repository",
      providers: {
        chat: env.CHAT_PROVIDER,
        embedding: env.EMBEDDING_PROVIDER,
        moderation: env.MODERATION_PROVIDER,
      },
    },
    requestId: request.id,
  }));

  app.get("/ready", async (request, reply) => {
    const ready = Boolean(await repository.getUser(seedUser.id));
    return ready
      ? { ok: true, data: { status: "ready", database: "mock-repository", redis: "mock", storage: "mock-s3" }, requestId: request.id }
      : reply.code(503).send(apiError("not_ready", "The API is not ready.", request.id));
  });

  app.get("/openapi.json", async () => app.swagger());

  app.post("/auth/signup", async (request, reply) => {
    const parsed = onboardingSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError("invalid_onboarding", "Check the onboarding fields and try again.", request.id));
    return reply.code(201).send({
      ok: true,
      data: {
        accessToken: `mock.${randomUUID()}`,
        refreshToken: `mock-refresh.${randomUUID()}`,
        user: { ...seedUser, name: parsed.data.name, birthday: parsed.data.birthday, pronouns: parsed.data.pronouns },
        companion: { ...seedCompanion, name: parsed.data.companionName, pronouns: parsed.data.companionPronouns, relationshipMode: parsed.data.relationshipMode },
      },
      requestId: request.id,
    });
  });

  app.post("/auth/login", async (request, reply) => {
    const parsed = z.object({ email: z.email(), password: z.string().min(8) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError("invalid_credentials", "Enter a valid email and password.", request.id));
    return { ok: true, data: { accessToken: `mock.${randomUUID()}`, refreshToken: `mock-refresh.${randomUUID()}`, user: seedUser }, requestId: request.id };
  });

  app.post("/auth/forgot-password", async (request, reply) => {
    const parsed = z.object({ email: z.email() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError("invalid_email", "Enter a valid email.", request.id));
    const token = `reset.${randomUUID()}`;
    passwordChallenges.set(token, parsed.data.email.toLowerCase());
    return { ok: true, data: { accepted: true, ...(env.AI_MOCK_MODE ? { mockResetToken: token } : {}) }, requestId: request.id };
  });

  app.post("/auth/reset-password", async (request, reply) => {
    const parsed = z.object({ token: z.string().min(12), password: z.string().min(8).max(200) }).safeParse(request.body);
    if (!parsed.success || !passwordChallenges.has(parsed.data.token)) return reply.code(400).send(apiError("invalid_reset", "The reset link is invalid or expired.", request.id));
    passwordChallenges.delete(parsed.data.token);
    return { ok: true, data: { reset: true }, requestId: request.id };
  });

  app.post("/auth/refresh", async (request, reply) => {
    const parsed = z.object({ refreshToken: z.string().startsWith("mock-refresh.") }).safeParse(request.body);
    if (!parsed.success) return reply.code(401).send(apiError("invalid_refresh", "Sign in again to continue.", request.id));
    return { ok: true, data: { accessToken: `mock.${randomUUID()}`, refreshToken: `mock-refresh.${randomUUID()}` }, requestId: request.id };
  });

  app.post("/auth/verify-email", async (request, reply) => {
    const parsed = z.object({ token: z.string().min(8) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError("invalid_verification", "Verification token is invalid.", request.id));
    return { ok: true, data: { verified: true }, requestId: request.id };
  });

  app.post("/auth/oauth/:provider", async (request, reply) => {
    const params = z.object({ provider: z.enum(["google", "apple"]) }).safeParse(request.params);
    if (!params.success) return reply.code(404).send(apiError("provider_not_found", "OAuth provider is unavailable.", request.id));
    return { ok: true, data: { provider: params.data.provider, authorizationUrl: `${env.APP_ORIGIN}/app?oauth=${params.data.provider}&mock=true`, mock: true }, requestId: request.id };
  });

  app.post("/auth/logout", async (_request, reply) => reply.code(204).send());

  app.get("/users/me", async (request, reply) => {
    const user = await repository.getUser(actorId(request.headers));
    if (!user) return reply.code(404).send(apiError("user_not_found", "Account not found.", request.id));
    return { ok: true, data: user, requestId: request.id };
  });

  app.get("/companions", async (request, reply) => {
    const userId = actorId(request.headers);
    const companion = await repository.getCompanion(userId, seedCompanion.id);
    if (!companion) return reply.code(404).send(apiError("companion_not_found", "Companion not found.", request.id));
    return { ok: true, data: [companion], requestId: request.id };
  });

  app.get("/companions/:companionId", async (request, reply) => {
    const params = z.object({ companionId: z.uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send(apiError("invalid_companion", "Companion ID is invalid.", request.id));
    const companion = await repository.getCompanion(actorId(request.headers), params.data.companionId);
    return companion ? { ok: true, data: companion, requestId: request.id } : reply.code(404).send(apiError("companion_not_found", "Companion not found.", request.id));
  });

  app.patch("/companions/:companionId", async (request, reply) => {
    const userId = actorId(request.headers);
    const params = z.object({ companionId: z.uuid() }).safeParse(request.params);
    const body = z.object({ name: z.string().trim().min(1).max(40).optional(), relationshipMode: z.enum(["friend", "mentor", "sibling", "romantic", "organic"]).optional(), voiceId: z.string().min(1).max(80).optional() }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send(apiError("invalid_companion", "Check the companion update.", request.id));
    const companion = await repository.getCompanion(userId, params.data.companionId);
    if (!companion) return reply.code(404).send(apiError("companion_not_found", "Companion not found.", request.id));
    if (body.data.relationshipMode === "romantic" && !runtimeFeatureFlags.romanticMode) return reply.code(403).send(apiError("romantic_mode_disabled", "Romantic mode is not available in this release.", request.id));
    const updated = {
      ...companion,
      ...(body.data.name !== undefined ? { name: body.data.name } : {}),
      ...(body.data.relationshipMode !== undefined ? { relationshipMode: body.data.relationshipMode } : {}),
      ...(body.data.voiceId !== undefined ? { voiceId: body.data.voiceId } : {}),
    };
    await repository.updateCompanion(userId, updated);
    return { ok: true, data: updated, requestId: request.id };
  });

  app.patch("/companions/:companionId/personality", async (request, reply) => {
    const userId = actorId(request.headers);
    const params = z.object({ companionId: z.uuid() }).safeParse(request.params);
    const trait = z.number().min(0).max(1);
    const body = z.object({ warmth: trait.optional(), humor: trait.optional(), curiosity: trait.optional(), assertiveness: trait.optional(), optimism: trait.optional(), energy: trait.optional(), verbosity: trait.optional(), playfulness: trait.optional(), empathy: trait.optional() }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send(apiError("invalid_personality", "Check personality values.", request.id));
    const companion = await repository.getCompanion(userId, params.data.companionId);
    if (!companion) return reply.code(404).send(apiError("companion_not_found", "Companion not found.", request.id));
    const updated = {
      ...companion,
      personality: {
        ...companion.personality,
        ...(body.data.warmth !== undefined ? { warmth: body.data.warmth } : {}),
        ...(body.data.humor !== undefined ? { humor: body.data.humor } : {}),
        ...(body.data.curiosity !== undefined ? { curiosity: body.data.curiosity } : {}),
        ...(body.data.assertiveness !== undefined ? { assertiveness: body.data.assertiveness } : {}),
        ...(body.data.optimism !== undefined ? { optimism: body.data.optimism } : {}),
        ...(body.data.energy !== undefined ? { energy: body.data.energy } : {}),
        ...(body.data.verbosity !== undefined ? { verbosity: body.data.verbosity } : {}),
        ...(body.data.playfulness !== undefined ? { playfulness: body.data.playfulness } : {}),
        ...(body.data.empathy !== undefined ? { empathy: body.data.empathy } : {}),
      },
    };
    await repository.updateCompanion(userId, updated);
    return { ok: true, data: updated, requestId: request.id };
  });

  app.get("/companions/:companionId/appearance", async (request) => ({ ok: true, data: { ownedItems: await repository.listOwnedItems(actorId(request.headers)) }, requestId: request.id }));

  app.get("/conversations", async (request) => ({ ok: true, data: [...conversations.values()].filter((conversation) => conversation.userId === actorId(request.headers)), requestId: request.id }));

  app.post("/conversations", async (request, reply) => {
    const body = z.object({ companionId: z.uuid() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send(apiError("invalid_conversation", "Choose a valid companion.", request.id));
    const conversation = { id: randomUUID(), userId: actorId(request.headers), companionId: body.data.companionId, createdAt: new Date().toISOString() };
    conversations.set(conversation.id, conversation);
    return reply.code(201).send({ ok: true, data: conversation, requestId: request.id });
  });

  app.get("/conversations/:conversationId/messages", async (request) => {
    const params = z.object({ conversationId: z.uuid() }).parse(request.params);
    const messages = await repository.listMessages(actorId(request.headers), params.conversationId);
    return { ok: true, data: messages, requestId: request.id };
  });

  app.post("/chat/stream", async (request, reply) => {
    const startedAt = Date.now();
    const parsed = chatRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError("invalid_message", "Write a shorter message and try again.", request.id));
    const userId = actorId(request.headers);
    const [user, companion, existingMemories, existingMessages] = await Promise.all([
      repository.getUser(userId),
      repository.getCompanion(userId, parsed.data.companionId),
      repository.listMemories(userId, parsed.data.companionId),
      repository.listMessages(userId, parsed.data.conversationId),
    ]);
    if (!user || !companion) return reply.code(404).send(apiError("actor_not_found", "Account or companion not found.", request.id));

    const safety = assessSafety(parsed.data.content);
    const now = new Date();
    const userMessage: ChatMessage = {
      id: `${userId}:${randomUUID()}`,
      conversationId: parsed.data.conversationId,
      role: "user",
      content: parsed.data.content,
      createdAt: now.toISOString(),
      status: "sent",
    };
    const allMessages = [...existingMessages, userMessage];
    const context = buildCompanionContext({
      user,
      companion,
      relationship: { mode: companion.relationshipMode, startedAt: companion.createdAt, interactionCount: existingMessages.length, sharedExperiences: [] },
      memories: existingMemories,
      messages: allMessages,
      timezone: user.timezone,
      now,
    });

    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-request-id": request.id,
    });

    let assistantContent = "";
    let usage = { inputTokens: 0, outputTokens: 0 };
    if (safety.level !== "safe" && safety.response) {
      assistantContent = safety.response;
      reply.raw.write(`event: token\ndata: ${JSON.stringify({ delta: assistantContent })}\n\n`);
    } else {
      for await (const chunk of provider.stream({ messages: allMessages, context })) {
        assistantContent += chunk.delta;
        if (chunk.usage) usage = chunk.usage;
        reply.raw.write(`event: ${chunk.done ? "usage" : "token"}\ndata: ${JSON.stringify(chunk)}\n\n`);
      }
    }

    const assistantMessage: ChatMessage = {
      id: `${userId}:${randomUUID()}`,
      conversationId: parsed.data.conversationId,
      role: "assistant",
      content: assistantContent,
      createdAt: new Date().toISOString(),
      status: "sent",
    };
    await repository.appendMessages(userId, parsed.data.conversationId, [userMessage, assistantMessage]);
    usageRecords.push({ id: randomUUID(), userId, feature: "text_chat", provider: provider.id, model: env.CHAT_MODEL, inputUnits: usage.inputTokens, outputUnits: usage.outputTokens, estimatedCostUsd: 0, latencyMs: Date.now() - startedAt, success: true, createdAt: new Date().toISOString() });

    let nextMemories = existingMemories;
    for (const candidate of extractMemoryCandidates(parsed.data.content)) {
      nextMemories = applyContradictions(nextMemories, candidate, now);
      for (const memory of nextMemories) await repository.upsertMemory(userId, memory);
      const duplicate = nextMemories.some((memory) => memory.status === "active" && memory.normalizedContent === candidate.normalizedContent);
      if (!duplicate) {
        await repository.upsertMemory(userId, {
          id: randomUUID(),
          userId,
          companionId: companion.id,
          type: candidate.type,
          content: candidate.content,
          normalizedContent: candidate.normalizedContent,
          importance: candidate.importance,
          confidence: candidate.confidence,
          sourceMessageIds: [userMessage.id],
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          retrievalCount: 0,
          status: "active",
          pinned: false,
        });
      }
    }

    const summary = summarizeConversation(parsed.data.conversationId, [...allMessages, assistantMessage]);
    summaries.set(parsed.data.conversationId, [...(summaries.get(parsed.data.conversationId) ?? []), summary]);
    reply.raw.write(`event: done\ndata: ${JSON.stringify({ assistantMessageId: assistantMessage.id, summary })}\n\n`);
    reply.raw.end();
  });

  app.get("/conversations/:conversationId/summaries", async (request, reply) => {
    const params = z.object({ conversationId: z.uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send(apiError("invalid_conversation", "Conversation ID is invalid.", request.id));
    return { ok: true, data: summaries.get(params.data.conversationId) ?? [], requestId: request.id };
  });

  app.patch("/conversations/:conversationId/messages/:messageId/feedback", async (request, reply) => {
    const params = z.object({ conversationId: z.uuid(), messageId: z.string().min(8) }).safeParse(request.params);
    const body = z.object({ feedback: z.enum(["up", "down"]), note: z.string().trim().max(500).optional() }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send(apiError("invalid_feedback", "Choose helpful or not helpful.", request.id));
    const userId = actorId(request.headers);
    const message = (await repository.listMessages(userId, params.data.conversationId)).find((candidate) => candidate.id === params.data.messageId && candidate.role === "assistant");
    if (!message) return reply.code(404).send(apiError("message_not_found", "Assistant message not found.", request.id));
    const updated: ChatMessage = { ...message, feedback: body.data.feedback };
    await repository.updateMessage(userId, params.data.conversationId, updated);
    return { ok: true, data: { message: updated, preferenceSignalRecorded: true }, requestId: request.id };
  });

  app.get("/memories", async (request) => ({
    ok: true,
    data: await repository.listMemories(actorId(request.headers), seedCompanion.id),
    requestId: request.id,
  }));

  app.get("/memories/search", async (request, reply) => {
    const query = z.object({ q: z.string().trim().min(1).max(200), companionId: z.uuid().default(seedCompanion.id) }).safeParse(request.query);
    if (!query.success) return reply.code(400).send(apiError("invalid_search", "Add a search phrase.", request.id));
    const memories = await repository.listMemories(actorId(request.headers), query.data.companionId);
    const q = query.data.q.toLowerCase();
    return { ok: true, data: memories.filter((memory) => memory.content.toLowerCase().includes(q) || memory.normalizedContent.includes(q)), requestId: request.id };
  });

  app.post("/memories", async (request, reply) => {
    const userId = actorId(request.headers);
    const body = z.object({ companionId: z.uuid().default(seedCompanion.id), type: z.enum(["semantic", "episodic", "preference", "relationship", "goal", "emotional", "shared"]), content: z.string().trim().min(1).max(2_000), pinned: z.boolean().default(false) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send(apiError("invalid_memory", "Check the memory fields.", request.id));
    const now = new Date().toISOString();
    const memory: MemoryRecord = { id: randomUUID(), userId, companionId: body.data.companionId, type: body.data.type, content: body.data.content, normalizedContent: body.data.content.toLowerCase(), importance: 0.8, confidence: 1, sourceMessageIds: [], createdAt: now, updatedAt: now, retrievalCount: 0, status: "active", pinned: body.data.pinned };
    await repository.upsertMemory(userId, memory);
    return reply.code(201).send({ ok: true, data: memory, requestId: request.id });
  });

  app.patch("/memories/:memoryId", async (request, reply) => {
    const userId = actorId(request.headers);
    const params = z.object({ memoryId: z.uuid() }).safeParse(request.params);
    const body = memoryUpdateSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send(apiError("invalid_memory", "Check the memory update.", request.id));
    const memories = await repository.listMemories(userId, seedCompanion.id);
    const memory = memories.find((item) => item.id === params.data.memoryId);
    if (!memory) return reply.code(404).send(apiError("memory_not_found", "Memory not found.", request.id));
    const updated: MemoryRecord = {
      ...memory,
      ...(body.data.content !== undefined ? { content: body.data.content } : {}),
      ...(body.data.pinned !== undefined ? { pinned: body.data.pinned } : {}),
      ...(body.data.status !== undefined ? { status: body.data.status } : {}),
      updatedAt: new Date().toISOString(),
    };
    await repository.upsertMemory(userId, updated);
    return { ok: true, data: updated, requestId: request.id };
  });

  app.delete("/memories/:memoryId", async (request, reply) => {
    const params = z.object({ memoryId: z.uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send(apiError("invalid_memory", "Memory ID is invalid.", request.id));
    const deleted = await repository.deleteMemory(actorId(request.headers), params.data.memoryId);
    if (!deleted) return reply.code(404).send(apiError("memory_not_found", "Memory not found.", request.id));
    return reply.code(204).send();
  });

  app.get("/activities", async (request) => ({ ok: true, data: await repository.listActivities(), requestId: request.id }));

  app.post("/activities/:activityId/start", async (request, reply) => {
    const params = z.object({ activityId: z.string().min(1) }).safeParse(request.params);
    const activity = params.success ? (await repository.listActivities()).find((item) => item.id === params.data.activityId) : null;
    return activity
      ? reply.code(201).send({ ok: true, data: { sessionId: randomUUID(), activity, status: "active", startedAt: new Date().toISOString() }, requestId: request.id })
      : reply.code(404).send(apiError("activity_not_found", "Activity not found.", request.id));
  });

  app.post("/activities/:activityId/complete", async (request, reply) => {
    const params = z.object({ activityId: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ idempotencyKey: z.string().min(8).max(120) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send(apiError("invalid_activity", "Activity completion is invalid.", request.id));
    try {
      const wallet = await repository.completeActivity(actorId(request.headers), params.data.activityId, body.data.idempotencyKey);
      return { ok: true, data: wallet, requestId: request.id };
    } catch {
      return reply.code(404).send(apiError("activity_not_found", "Activity not found.", request.id));
    }
  });

  app.get("/wallet", async (request) => ({ ok: true, data: await repository.getWallet(actorId(request.headers)), requestId: request.id }));
  app.get("/wallet/transactions", async (request) => ({ ok: true, data: await repository.listWalletTransactions(actorId(request.headers)), requestId: request.id }));

  app.get("/notifications/preferences", async (request) => ({ ok: true, data: await repository.getNotificationSettings(actorId(request.headers)), requestId: request.id }));

  app.patch("/notifications/preferences", async (request, reply) => {
    const schema = z.object({ frequency: z.enum(["off", "low", "normal", "high"]), quietStart: z.string().regex(/^\d{2}:\d{2}$/), quietEnd: z.string().regex(/^\d{2}:\d{2}$/), timezone: z.string().min(1), enabledTopics: z.array(z.string()) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError("invalid_notifications", "Check notification settings.", request.id));
    await repository.setNotificationSettings(actorId(request.headers), parsed.data as NotificationSettings);
    return { ok: true, data: parsed.data, requestId: request.id };
  });

  app.get("/journal", async (request) => ({ ok: true, data: await repository.listJournalEntries(actorId(request.headers)), requestId: request.id }));

  app.post("/journal", async (request, reply) => {
    const body = journalEntrySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(apiError("invalid_journal", "Check the journal entry.", request.id));
    const userId = actorId(request.headers);
    const now = new Date().toISOString();
    const entry: JournalEntryRecord = { id: randomUUID(), userId, ...body.data, reflected: false, createdAt: now, updatedAt: now };
    await repository.addJournalEntry(userId, entry);
    return reply.code(201).send({ ok: true, data: entry, requestId: request.id });
  });

  app.post("/journal/:entryId/reflect", async (request, reply) => {
    const params = z.object({ entryId: z.uuid() }).safeParse(request.params);
    const entry = params.success ? (await repository.listJournalEntries(actorId(request.headers))).find((item) => item.id === params.data.entryId) : null;
    return entry
      ? { ok: true, data: { reflection: `I notice ${entry.mood} energy in this entry. What part of it would you like to understand more deeply?`, memoryCreated: false }, requestId: request.id }
      : reply.code(404).send(apiError("journal_not_found", "Journal entry not found.", request.id));
  });

  app.delete("/journal/:entryId", async (request, reply) => {
    const params = z.object({ entryId: z.uuid() }).safeParse(request.params);
    if (!params.success || !await repository.deleteJournalEntry(actorId(request.headers), params.data.entryId)) return reply.code(404).send(apiError("journal_not_found", "Journal entry not found.", request.id));
    return reply.code(204).send();
  });

  app.get("/events", async (request) => ({ ok: true, data: await repository.listFutureEvents(actorId(request.headers)), requestId: request.id }));

  app.post("/events", async (request, reply) => {
    const body = futureEventSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(apiError("invalid_event", "Check the event details.", request.id));
    const userId = actorId(request.headers);
    const event: FutureEventRecord = { id: randomUUID(), userId, companionId: seedCompanion.id, ...body.data, createdAt: new Date().toISOString() };
    await repository.addFutureEvent(userId, event);
    const settings = await repository.getNotificationSettings(userId);
    const nudge = generateNudge({ userId, userName: seedUser.name, event, memories: await repository.listMemories(userId, seedCompanion.id), settings });
    if (nudge) await repository.addNudge(userId, nudge);
    return reply.code(201).send({ ok: true, data: { event, nudge }, requestId: request.id });
  });

  app.get("/notifications/planned", async (request) => ({ ok: true, data: await repository.listNudges(actorId(request.headers)), requestId: request.id }));

  app.get("/store", async (request) => {
    const userId = actorId(request.headers);
    const [items, owned] = await Promise.all([repository.listStoreItems(), repository.listOwnedItems(userId)]);
    return { ok: true, data: items.map((item) => ({ ...item, owned: owned.some((entry) => entry.itemId === item.id), equipped: owned.some((entry) => entry.itemId === item.id && entry.equipped) })), requestId: request.id };
  });

  app.get("/inventory", async (request) => ({ ok: true, data: await repository.listOwnedItems(actorId(request.headers)), requestId: request.id }));

  app.post("/store/purchase", async (request, reply) => {
    const body = storePurchaseSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(apiError("invalid_purchase", "Check the purchase request.", request.id));
    const userId = actorId(request.headers);
    const item = (await repository.listStoreItems()).find((candidate) => candidate.id === body.data.itemId);
    if (!item) return reply.code(404).send(apiError("item_not_found", "Store item not found.", request.id));
    const subscription = await repository.getSubscription(userId);
    const order: PlanId[] = ["free", "plus", "ultra", "platinum"];
    if (order.indexOf(subscription.planId) < order.indexOf(item.tierRequired)) return reply.code(403).send(apiError("upgrade_required", `${plans[item.tierRequired].name} is required for this item.`, request.id));
    try {
      const result = await repository.purchaseItem(userId, item.id, body.data.idempotencyKey);
      return { ok: true, data: result, requestId: request.id };
    } catch (error) {
      const code = error instanceof Error && error.message === "Insufficient balance" ? "insufficient_balance" : "purchase_failed";
      return reply.code(409).send(apiError(code, code === "insufficient_balance" ? "You do not have enough currency for this item." : "Purchase could not be completed.", request.id));
    }
  });

  app.post("/inventory/:itemId/equip", async (request, reply) => {
    const params = z.object({ itemId: z.string().min(1) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send(apiError("invalid_item", "Item is invalid.", request.id));
    try {
      return { ok: true, data: await repository.equipItem(actorId(request.headers), params.data.itemId), requestId: request.id };
    } catch {
      return reply.code(409).send(apiError("equip_failed", "Purchase this item before equipping it.", request.id));
    }
  });

  app.get("/subscriptions", async (request) => {
    const subscription = await repository.getSubscription(actorId(request.headers));
    return { ok: true, data: { subscription, plans, entitlements: [...featureEntitlements.featuresFor(subscription.planId)] }, requestId: request.id };
  });

  app.post("/subscriptions/mock-upgrade", async (request, reply) => {
    const parsed = z.object({ planId: z.enum(["free", "plus", "ultra", "platinum"]), idempotencyKey: z.string().min(8).max(160).default(() => randomUUID()) }).safeParse(request.body);
    if (!env.AI_MOCK_MODE || !parsed.success) return reply.code(400).send(apiError("upgrade_unavailable", "Billing test mode is not available.", request.id));
    const subscription: SubscriptionState = { planId: parsed.data.planId, status: "active", testMode: true, renewsAt: new Date(Date.now() + 30 * 86_400_000).toISOString() };
    const updated = await repository.setSubscription(actorId(request.headers), subscription, parsed.data.idempotencyKey);
    return { ok: true, data: { subscription: updated, entitlements: [...featureEntitlements.featuresFor(updated.planId)] }, requestId: request.id };
  });

  app.post("/subscriptions/webhook", async (request, reply) => {
    const body = subscriptionWebhookSchema.safeParse(request.body);
    const secret = request.headers["x-webhook-secret"];
    const acceptedSecret = env.STRIPE_WEBHOOK_SECRET ?? env.REVENUECAT_WEBHOOK_SECRET;
    if (!body.success) return reply.code(400).send(apiError("invalid_webhook", "Webhook payload is invalid.", request.id));
    if (!env.AI_MOCK_MODE && (!acceptedSecret || secret !== acceptedSecret)) return reply.code(401).send(apiError("invalid_signature", "Webhook signature is invalid.", request.id));
    const subscription: SubscriptionState = { planId: body.data.planId, status: body.data.status, testMode: env.AI_MOCK_MODE };
    const updated = await repository.setSubscription(body.data.userId, subscription, body.data.eventId);
    return { ok: true, data: updated, requestId: request.id };
  });

  app.get("/entitlements", async (request) => {
    const subscription = await repository.getSubscription(actorId(request.headers));
    return { ok: true, data: { planId: subscription.planId, features: [...featureEntitlements.featuresFor(subscription.planId)] }, requestId: request.id };
  });

  app.post("/voice/transcribe", async (request, reply) => {
    const userId = actorId(request.headers);
    const access = await entitlementFor(userId, "voiceNotes");
    if (!access.allowed) return reply.code(402).send(apiError("upgrade_required", `${plans[access.minimumPlan].name} is required for voice notes.`, request.id));
    const body = z.object({ audioBase64: z.string().max(8_000_000).default(""), contentType: z.string().default("audio/webm") }).safeParse(request.body);
    if (!body.success) return reply.code(400).send(apiError("invalid_audio", "Audio payload is invalid.", request.id));
    const result = await speechProvider.transcribe(new TextEncoder().encode(body.data.audioBase64), body.data.contentType);
    return { ok: true, data: { ...result, provider: speechProvider.id, mock: true }, requestId: request.id };
  });

  app.post("/voice/synthesize", async (request, reply) => {
    const body = z.object({ text: z.string().trim().min(1).max(4_000), voiceId: z.string().default(seedCompanion.voiceId) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send(apiError("invalid_speech", "Text is required.", request.id));
    const result = await speechProvider.synthesize(body.data.text, body.data.voiceId);
    return { ok: true, data: { audioBase64: Buffer.from(result.audio).toString("base64"), contentType: result.contentType, durationMs: result.durationMs, provider: speechProvider.id, mock: true }, requestId: request.id };
  });

  app.post("/voice/session", async (request, reply) => {
    const userId = actorId(request.headers);
    const access = await entitlementFor(userId, "voiceCalls");
    if (!access.allowed) return reply.code(402).send(apiError("upgrade_required", `${plans[access.minimumPlan].name} is required for realtime voice.`, request.id));
    return { ok: true, data: { sessionId: randomUUID(), provider: "mock", state: "ready", expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() }, requestId: request.id };
  });

  app.get("/moments", async (request) => ({
    ok: true,
    data: [
      { id: "moment-first-call", type: "call", title: "Our first call", description: "You were ridiculously nervous for the first thirty seconds.", happenedAt: "2026-07-18T19:30:00.000Z", mediaUrl: "/assets/luma/portrait.png" },
      { id: "moment-rooftop", type: "date", title: "Rooftop at blue hour", description: "Two mugs, one impossible question, and a very good laugh.", happenedAt: "2026-08-14T18:45:00.000Z", mediaUrl: "/assets/luma/rooftop-date.png" },
    ],
    requestId: request.id,
  }));

  app.get("/photos", async (request) => ({
    ok: true,
    data: [
      { id: "photo-window", type: "selfie", caption: "Waiting in the window nook", createdAt: "2026-08-31T17:30:00.000Z", mediaUrl: "/assets/luma/window-nook.png" },
      { id: "photo-cafe", type: "selfie", caption: "Rainy coffee break", createdAt: "2026-08-26T11:40:00.000Z", mediaUrl: "/assets/luma/cafe-selfie.png" },
    ],
    requestId: request.id,
  }));

  app.post("/video/session", async (request, reply) => {
    const userId = actorId(request.headers);
    const access = await entitlementFor(userId, "videoCalls");
    if (!access.allowed) return reply.code(402).send(apiError("upgrade_required", `${plans[access.minimumPlan].name} is required for video calls.`, request.id));
    const body = z.object({ companionId: z.string().default(seedCompanion.id), environmentId: z.string().default("window-nook"), cameraEnabled: z.boolean().default(false) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send(apiError("invalid_video_session", "Video call settings are invalid.", request.id));
    const session = { id: randomUUID(), userId, companionId: body.data.companionId, type: "video" as const, state: "connecting", startedAt: new Date().toISOString(), environmentId: body.data.environmentId, cameraEnabled: body.data.cameraEnabled };
    callSessions.set(session.id, session);
    return reply.code(201).send({ ok: true, data: { ...session, provider: "mock", rawRecording: false }, requestId: request.id });
  });

  app.get("/calls", async (request) => ({
    ok: true,
    data: [
      { id: "call-today", type: "video", startedAt: "2026-08-31T16:20:00.000Z", durationMs: 1_620_000, summary: "Pitch-deck nerves, one practice answer, then a five-minute reset." },
      { id: "call-yesterday", type: "voice", startedAt: "2026-08-30T20:15:00.000Z", durationMs: 720_000, summary: "A short check-in about sleep and tomorrow’s priorities." },
    ],
    requestId: request.id,
  }));

  app.post("/calls/:callId/barge-in", async (request, reply) => {
    const params = z.object({ callId: z.string().min(8) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send(apiError("invalid_call", "Call id is required.", request.id));
    const session = callSessions.get(params.data.callId);
    if (!session || session.userId !== actorId(request.headers)) return reply.code(404).send(apiError("call_not_found", "Call not found.", request.id));
    session.state = "listening";
    return { ok: true, data: { ...session, outputCanceled: true, inputActive: true }, requestId: request.id };
  });

  app.post("/calls/:callId/end", async (request, reply) => {
    const params = z.object({ callId: z.string().min(8) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send(apiError("invalid_call", "Call id is required.", request.id));
    const session = callSessions.get(params.data.callId);
    if (!session || session.userId !== actorId(request.headers)) return reply.code(404).send(apiError("call_not_found", "Call not found.", request.id));
    session.state = "ended";
    callSessions.delete(session.id);
    return { ok: true, data: { ...session, endedAt: new Date().toISOString(), rawRecording: false }, requestId: request.id };
  });

  app.post("/camera/session", async (request, reply) => {
    const userId = actorId(request.headers);
    const access = await entitlementFor(userId, "cameraConversation");
    if (!access.allowed) return reply.code(402).send(apiError("upgrade_required", `${plans[access.minimumPlan].name} is required for camera conversations.`, request.id));
    return { ok: true, data: { sessionId: randomUUID(), state: "permission-required", consentRequired: true, mock: true }, requestId: request.id };
  });

  app.post("/media/upload", async (request, reply) => {
    const body = z.object({ name: z.string().min(1).max(180), contentType: z.enum(["image/jpeg", "image/png", "image/webp"]), dataBase64: z.string().max(12_000_000) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send(apiError("invalid_media", "Use a JPEG, PNG, or WebP image.", request.id));
    const assetId = randomUUID();
    return reply.code(201).send({ ok: true, data: { id: assetId, url: `/mock-media/${assetId}`, name: body.data.name, contentType: body.data.contentType, bytes: Math.round(body.data.dataBase64.length * 0.75), mock: true }, requestId: request.id });
  });

  app.post("/media/analyze", async (request, reply) => {
    const body = z.object({ dataBase64: z.string().max(12_000_000).default(""), contentType: z.string().default("image/jpeg"), prompt: z.string().max(1_000).default("Describe this image safely") }).safeParse(request.body);
    if (!body.success) return reply.code(400).send(apiError("invalid_media", "Image request is invalid.", request.id));
    const description = await visionProvider.describe({ image: new TextEncoder().encode(body.data.dataBase64), contentType: body.data.contentType, prompt: body.data.prompt });
    return { ok: true, data: { description, provider: visionProvider.id, mock: true }, requestId: request.id };
  });

  app.post("/media/generate", async (request, reply) => {
    const userId = actorId(request.headers);
    const access = await entitlementFor(userId, "imageGeneration");
    if (!access.allowed) return reply.code(402).send(apiError("upgrade_required", `${plans[access.minimumPlan].name} is required for image generation.`, request.id));
    const body = z.object({ prompt: z.string().trim().min(1).max(1_000), appearance: z.string().max(1_000).default("Luma in a premium stylized-realistic 3D style") }).safeParse(request.body);
    if (!body.success) return reply.code(400).send(apiError("invalid_prompt", "Describe the image you want.", request.id));
    const result = await imageProvider.generate(body.data);
    return { ok: true, data: { assetUrl: "/assets/luma/cafe-selfie.png", artifactBase64: Buffer.from(result.bytes).toString("base64"), contentType: result.contentType, provider: imageProvider.id, mock: true }, requestId: request.id };
  });

  app.get("/responses/:messageId/explanation", async (request, reply) => {
    const userId = actorId(request.headers);
    const access = await entitlementFor(userId, "responseExplanation");
    if (!access.allowed) return reply.code(402).send(apiError("upgrade_required", `${plans[access.minimumPlan].name} is required for response explanations.`, request.id));
    const params = z.object({ messageId: z.string().min(8) }).safeParse(request.params);
    const query = z.object({ conversationId: z.uuid() }).safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send(apiError("invalid_message", "Message and conversation are required.", request.id));
    const message = (await repository.listMessages(userId, query.data.conversationId)).find((candidate) => candidate.id === params.data.messageId);
    if (!message || message.role !== "assistant") return reply.code(404).send(apiError("message_not_found", "Assistant message not found.", request.id));
    const memories = (await repository.listMemories(userId, seedCompanion.id)).filter((memory) => memory.status === "active").slice(0, 3);
    return { ok: true, data: { messageId: message.id, reasons: ["Matched Luma's warm, playful personality settings.", "Used the recent conversation turn for continuity.", ...memories.map((memory) => `Considered an approved ${memory.type} memory: ${memory.content}`)], safety: "Passed local policy assessment.", model: env.CHAT_MODEL }, requestId: request.id };
  });

  app.get("/admin/metrics", async (request, reply) => {
    if (!isAdmin(request.headers, env.ADMIN_API_KEY)) return reply.code(401).send(apiError("admin_required", "Admin key is required.", request.id));
    const successful = usageRecords.filter((record) => record.success);
    const averageLatencyMs = successful.length ? Math.round(successful.reduce((total, record) => total + record.latencyMs, 0) / successful.length) : 0;
    return { ok: true, data: { conversations: conversations.size, requests: usageRecords.length, successfulRequests: successful.length, averageLatencyMs, estimatedCostUsd: usageRecords.reduce((total, record) => total + record.estimatedCostUsd, 0), privacy: "Conversation content is excluded from admin telemetry." }, requestId: request.id };
  });

  app.get("/admin/usage", async (request, reply) => {
    if (!isAdmin(request.headers, env.ADMIN_API_KEY)) return reply.code(401).send(apiError("admin_required", "Admin key is required.", request.id));
    return { ok: true, data: usageRecords.map(({ userId: _userId, ...record }) => record), requestId: request.id };
  });

  app.get("/admin/providers", async (request, reply) => {
    if (!isAdmin(request.headers, env.ADMIN_API_KEY)) return reply.code(401).send(apiError("admin_required", "Admin key is required.", request.id));
    return { ok: true, data: { chat: provider.id, speech: speechProvider.id, vision: visionProvider.id, image: imageProvider.id, model: env.CHAT_MODEL, mockMode: env.AI_MOCK_MODE }, requestId: request.id };
  });

  app.get("/admin/feature-flags", async (request, reply) => {
    if (!isAdmin(request.headers, env.ADMIN_API_KEY)) return reply.code(401).send(apiError("admin_required", "Admin key is required.", request.id));
    return { ok: true, data: runtimeFeatureFlags, requestId: request.id };
  });

  app.patch("/admin/feature-flags", async (request, reply) => {
    if (!isAdmin(request.headers, env.ADMIN_API_KEY)) return reply.code(401).send(apiError("admin_required", "Admin key is required.", request.id));
    const body = z.record(z.string(), z.boolean()).safeParse(request.body);
    if (!body.success || Object.keys(body.data).some((key) => !(key in runtimeFeatureFlags))) return reply.code(400).send(apiError("invalid_flags", "One or more feature flags are invalid.", request.id));
    Object.assign(runtimeFeatureFlags, body.data);
    return { ok: true, data: runtimeFeatureFlags, requestId: request.id };
  });

  app.post("/data/export", async (request) => ({ ok: true, data: await repository.exportUser(actorId(request.headers)), requestId: request.id }));

  app.post("/account/delete", async (request, reply) => {
    const parsed = z.object({ confirmation: z.literal("DELETE") }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError("confirmation_required", "Type DELETE to confirm.", request.id));
    await repository.deleteUser(actorId(request.headers));
    return reply.code(204).send();
  });

  app.get("/features", async (request) => {
    const subscription = await repository.getSubscription(actorId(request.headers));
    return { ok: true, data: { flags: runtimeFeatureFlags, planId: subscription.planId, entitlements: [...featureEntitlements.featuresFor(subscription.planId)] }, requestId: request.id };
  });

  return app;
}

async function start() {
  const app = await createServer();
  const port = Number(process.env.PORT || 4000);
  await app.listen({ port, host: "0.0.0.0" });
}

const isEntryPoint = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isEntryPoint) {
  start().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "API failed to start");
    process.exit(1);
  });
}
