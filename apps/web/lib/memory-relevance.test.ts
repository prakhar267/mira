import { describe, expect, it } from "vitest";
import type { ChatMessage, MemoryRecord } from "@companion/shared";
import { relevantMemoryContents } from "./memory-relevance";

const messages = (content: string): ChatMessage[] => [{
  id: "message-1",
  conversationId: "conversation-1",
  role: "user",
  content,
  createdAt: "2026-09-02T12:00:00.000Z",
  status: "sent",
}];

const memories = [
  { id: "stripe", content: "Prakhar has a Stripe interview at 11 tomorrow" },
  { id: "manager", content: "Prakhar's manager schedules repetitive meetings" },
] as MemoryRecord[];

describe("relevantMemoryContents", () => {
  it("keeps unrelated memories out of ordinary conversation", () => {
    expect(relevantMemoryContents(memories, messages("Nothing feels exciting lately"))).toEqual([]);
  });

  it("does not treat a generic word like work as enough relevance", () => {
    const pitchMemory = [{ ...memories[0]!, content: "Prakhar sent the startup pitch deck after weeks of work" }];
    expect(relevantMemoryContents(pitchMemory, messages("Mostly work. Same meetings every day."))).toEqual([]);
  });

  it("keeps memories with a concrete topic match", () => {
    expect(relevantMemoryContents(memories, messages("My manager added three more meetings"))).toEqual([
      "Prakhar's manager schedules repetitive meetings",
    ]);
  });

  it("returns approved memories when the user explicitly asks for recall", () => {
    expect(relevantMemoryContents(memories, messages("What do you remember about me?"))).toHaveLength(2);
  });
});
