import { z } from "zod";

export const pronounsSchema = z.enum(["she/her", "he/him", "they/them"]);
export const relationshipModeSchema = z.enum(["friend", "mentor", "sibling", "romantic", "organic"]);

export const onboardingSchema = z.object({
  name: z.string().trim().min(1).max(80),
  birthday: z.iso.date(),
  pronouns: pronounsSchema,
  adultConfirmed: z.literal(true),
  goals: z.array(z.string().min(1)).min(1),
  interests: z.array(z.string().min(1)).min(1),
  companionName: z.string().trim().min(1).max(40),
  companionPronouns: pronounsSchema,
  relationshipMode: relationshipModeSchema,
});

export const chatRequestSchema = z.object({
  conversationId: z.uuid(),
  companionId: z.uuid(),
  clientMessageId: z.string().min(8).max(120),
  content: z.string().trim().min(1).max(8_000),
});

export const memoryUpdateSchema = z.object({
  content: z.string().trim().min(1).max(2_000).optional(),
  pinned: z.boolean().optional(),
  status: z.enum(["active", "superseded", "deleted"]).optional(),
});

export const storePurchaseSchema = z.object({
  itemId: z.string().min(1).max(120),
  idempotencyKey: z.string().min(8).max(120),
});

export const journalEntrySchema = z.object({
  title: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(12_000),
  mood: z.enum(["calm", "cheerful", "curious", "excited", "thoughtful", "sleepy"]),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
});

export const futureEventSchema = z.object({
  description: z.string().trim().min(1).max(500),
  eventDate: z.iso.datetime(),
  status: z.enum(["candidate", "confirmed", "completed", "dismissed"]).default("confirmed"),
});

export const subscriptionWebhookSchema = z.object({
  eventId: z.string().min(8).max(160),
  userId: z.uuid(),
  planId: z.enum(["free", "plus", "ultra", "platinum"]),
  status: z.enum(["active", "trialing", "canceled"]),
});

export type OnboardingInput = z.infer<typeof onboardingSchema>;
export type ChatRequest = z.infer<typeof chatRequestSchema>;
