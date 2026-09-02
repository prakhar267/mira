import type { ChatMessage, MemoryRecord } from "@companion/shared";

const stopWords = new Set([
  "about", "after", "again", "also", "because", "before", "being", "every", "feels", "from", "have", "just", "lately", "like", "mostly", "really", "same", "that", "their", "there", "these", "they", "thing", "this", "today", "very", "want", "with", "would", "your",
]);
const genericSingleTokens = new Set(["feel", "friend", "heavy", "home", "life", "time", "week", "work"]);

function tokens(value: string) {
  return new Set(
    (value.toLowerCase().match(/[a-z0-9]+/g) ?? [])
      .map((token) => token.length > 5 ? token.replace(/(?:ing|ed|es|s)$/i, "") : token)
      .filter((token) => token.length >= 4 && !stopWords.has(token)),
  );
}

export function relevantMemoryContents(memories: MemoryRecord[], messages: ChatMessage[]) {
  const recentUserText = messages
    .filter((message) => message.role === "user")
    .slice(-2)
    .map((message) => message.content)
    .join(" ");

  if (/\b(?:what do you remember|remember about me|use (?:your|my) memor(?:y|ies)|recall)\b/i.test(recentUserText)) {
    return memories.slice(0, 8).map((memory) => memory.content);
  }

  const recentTokens = tokens(recentUserText);
  return memories
    .filter((memory) => {
      const overlap = [...tokens(memory.content)].filter((token) => recentTokens.has(token));
      return overlap.length >= 2 || overlap.some((token) => token.length >= 6 && !genericSingleTokens.has(token));
    })
    .slice(0, 4)
    .map((memory) => memory.content);
}
