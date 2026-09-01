import type { ChatMessage } from "@companion/shared";

export function messagesForConversation(messages: ChatMessage[], conversationId: string): ChatMessage[] {
  return messages.filter((message) => message.conversationId === conversationId);
}

export function previousUserMessage(messages: ChatMessage[], messageId: string, conversationId: string): ChatMessage | null {
  const conversation = messagesForConversation(messages, conversationId);
  const messageIndex = conversation.findIndex((message) => message.id === messageId);
  if (messageIndex < 0) return null;
  for (let index = messageIndex - 1; index >= 0; index -= 1) {
    if (conversation[index]?.role === "user") return conversation[index] ?? null;
  }
  return null;
}
