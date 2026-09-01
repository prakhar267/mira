import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@companion/shared";
import { messagesForConversation, previousUserMessage } from "./conversation-state";

const message = (id: string, conversationId: string, role: ChatMessage["role"]): ChatMessage => ({
  id,
  conversationId,
  role,
  content: id,
  createdAt: "2026-09-01T00:00:00.000Z",
  status: "sent",
});

describe("conversation state", () => {
  const messages = [
    message("old-user", "old", "user"),
    message("old-assistant", "old", "assistant"),
    message("new-greeting", "new", "assistant"),
    message("new-user", "new", "user"),
    message("new-assistant", "new", "assistant"),
  ];

  it("keeps a new conversation isolated from earlier transcripts", () => {
    expect(messagesForConversation(messages, "new").map(({ id }) => id)).toEqual(["new-greeting", "new-user", "new-assistant"]);
  });

  it("never regenerates a response from a user message in another conversation", () => {
    expect(previousUserMessage(messages, "new-greeting", "new")).toBeNull();
    expect(previousUserMessage(messages, "new-assistant", "new")?.id).toBe("new-user");
  });
});
