import type { ChatMessage, ConversationSummaryRecord } from "@companion/shared";

function meaningful(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((message) => message.role !== "system" && message.content.trim()).slice(-24);
}

export function summarizeConversation(conversationId: string, messages: ChatMessage[], now = new Date()): ConversationSummaryRecord {
  const selected = meaningful(messages);
  const userTopics = selected.filter((message) => message.role === "user").map((message) => message.content.replace(/\s+/g, " ").trim()).slice(-4);
  const content = userTopics.length
    ? `The user discussed ${userTopics.join("; ")}. The companion responded with support and a next-step question.`
    : "No durable conversation topics were available for this period.";
  return { id: crypto.randomUUID(), conversationId, period: "conversation", content, sourceMessageIds: selected.map((message) => message.id), createdAt: now.toISOString() };
}

export function rollupSummaries(conversationId: string, summaries: ConversationSummaryRecord[], period: "daily" | "weekly", now = new Date()): ConversationSummaryRecord {
  const selected = summaries.slice(period === "daily" ? -8 : -32);
  return {
    id: crypto.randomUUID(),
    conversationId,
    period,
    content: selected.map((summary) => summary.content).join(" ").slice(0, 4_000) || `No ${period} summary is available yet.`,
    sourceMessageIds: [...new Set(selected.flatMap((summary) => summary.sourceMessageIds))],
    createdAt: now.toISOString(),
  };
}
