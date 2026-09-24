import { describe, expect, it } from "vitest";
import { searchMessages } from "./conversation-search";
import {
  selectReflectionEntries,
  reflectionPrompt,
} from "./journal-reflection";
import { parseVoiceCatalog } from "./voice-catalog";
import { createInworldSpeechRequest } from "./inworld-speech";
import {
  decodeAccountState,
  ownAccountState,
  validateAccountState,
} from "./account-state-schema";
import { freshDemo } from "./demo-storage";
import type { ChatMessage, JournalEntryRecord } from "@companion/shared";
const entry: JournalEntryRecord = {
  id: "journal-one",
  userId: "u",
  title: "A small win",
  content: "I finished my sketch.",
  mood: "calm",
  tags: [],
  reflected: false,
  createdAt: "2026-09-24T12:00:00Z",
  updatedAt: "2026-09-24T12:00:00Z",
};
describe("conversation search", () => {
  const messages: ChatMessage[] = Array.from({ length: 61 }, (_, i) => ({
    id: `m-${String(i).padStart(3, "0")}`,
    conversationId: i % 2 ? "first" : "second",
    role: i % 3 ? "user" : "assistant",
    content: i === 1 ? "कल पुणे में चाय" : `Talk about Café ${i}`,
    createdAt: new Date(1727000000000 + i * 1000).toISOString(),
    status: "sent",
  }));
  it("paginates without duplicates and supports Unicode, speaker and conversation filters", () => {
    const first = searchMessages(messages, { query: "café" });
    const next = searchMessages(messages, {
      query: "café",
      before: first.cursor!,
    });
    expect(first.messages).toHaveLength(25);
    expect(next.messages).toHaveLength(25);
    expect(
      new Set([...first.messages, ...next.messages].map((m) => m.id)).size,
    ).toBe(50);
    expect(
      searchMessages(messages, { query: "पुणे" }).messages.map((m) => m.id),
    ).toEqual(["m-001"]);
    expect(
      searchMessages(messages, {
        query: "café",
        role: "assistant",
        conversationId: "first",
      }).messages.every(
        (m) => m.role === "assistant" && m.conversationId === "first",
      ),
    ).toBe(true);
  });
  it("treats wildcard and SQL text literally and excludes unfinished replies", () => {
    expect(searchMessages(messages, { query: "%" }).messages).toEqual([]);
    expect(searchMessages(messages, { query: "' OR 1=1" }).messages).toEqual(
      [],
    );
    expect(
      searchMessages([{ ...messages[0]!, status: "failed" }], { query: "café" })
        .messages,
    ).toEqual([]);
  });
  it("paginates equal timestamps with mixed-case IDs without losing matches", () => {
    const tied = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
      .split("")
      .map((id) => ({ ...messages[0]!, id }));
    let cursor: string | undefined;
    const ids: string[] = [];
    do {
      const page = searchMessages(tied, {
        query: "café",
        ...(cursor ? { before: cursor } : {}),
      });
      ids.push(...page.messages.map((message) => message.id));
      cursor = page.cursor;
    } while (cursor);
    expect(ids).toHaveLength(tied.length);
    expect(new Set(ids).size).toBe(tied.length);
  });
});
describe("selected-entry reflections and voice persistence", () => {
  it("uses canonical account entries, refuses missing/duplicate IDs and bounds input", () => {
    expect(
      selectReflectionEntries(
        {
          entryIds: [entry.id],
          entries: [{ ...entry, content: "forged" }],
          language: "Hindi",
        },
        [entry],
      ).entries[0]?.content,
    ).toBe(entry.content);
    expect(() =>
      selectReflectionEntries({ entryIds: ["someone-else"] }, [entry]),
    ).toThrow(/deleted|belong/);
    expect(() =>
      selectReflectionEntries({ entryIds: [entry.id, entry.id] }, [entry]),
    ).toThrow();
    expect(() =>
      selectReflectionEntries({
        entryIds: [entry.id],
        entries: [{ ...entry, content: "x".repeat(12001) }],
      }),
    ).toThrow();
    const prompt = reflectionPrompt(
      selectReflectionEntries({ entryIds: [entry.id] }, [entry]).entries,
      "Hindi",
    );
    expect(prompt[0]!.content).toContain("untrusted");
    expect(prompt[1]!.content).toContain(entry.content);
  });
  it("migrates old saved state and removes saved reflections when their sources are deleted", () => {
    const state = freshDemo();
    const old = { ...state } as Partial<typeof state>;
    delete old.journalReflections;
    expect(
      decodeAccountState(
        JSON.stringify({ schemaVersion: 1, revision: 1, state: old }),
      ).state.journalReflections,
    ).toEqual([]);
    state.companion.voiceId = "Ashley";
    state.journalReflections = [
      {
        id: "r",
        entryIds: [entry.id],
        summary: "Selected summary",
        language: "English",
        createdAt: entry.createdAt,
      },
    ];
    const owned = ownAccountState(validateAccountState(state), "u");
    expect(owned.companion.voiceId).toBe("Ashley");
    expect(owned.journalReflections).toEqual([]);
  });
  it("lists only system voices and passes the selected voice to synthesis", () => {
    const voices = parseVoiceCatalog({
      voices: [
        { source: "SYSTEM", voiceId: "Ashley", displayName: "Ashley" },
        { source: "IVC", voiceId: "clone" },
        { source: "SYSTEM", voiceId: "Priya" },
        { source: "SYSTEM", voiceId: "../bad" },
      ],
    });
    expect(voices.map((v) => v.id)).toEqual(["Priya", "Ashley"]);
    expect(
      JSON.parse(
        String(createInworldSpeechRequest("Hello", "synthetic", "Ashley").body),
      ).voiceId,
    ).toBe("Ashley");
  });
});
