export const analyticsEvents = [
  "signup_started",
  "signup_completed",
  "onboarding_completed",
  "companion_created",
  "message_sent",
  "voice_call_started",
  "voice_call_completed",
  "memory_created",
  "memory_edited",
  "memory_deleted",
  "activity_started",
  "activity_completed",
  "subscription_viewed",
  "subscription_started",
  "store_item_purchased",
  "notification_opened",
] as const;

export type AnalyticsEventName = (typeof analyticsEvents)[number];

export interface AnalyticsEvent {
  name: AnalyticsEventName;
  userId?: string;
  companionId?: string;
  occurredAt: string;
  properties: Record<string, string | number | boolean | null>;
}

export function redactAnalyticsProperties(properties: AnalyticsEvent["properties"]): AnalyticsEvent["properties"] {
  const blocked = new Set(["message", "content", "conversation", "memory", "email", "token"]);
  return Object.fromEntries(Object.entries(properties).filter(([key]) => !blocked.has(key.toLowerCase())));
}
