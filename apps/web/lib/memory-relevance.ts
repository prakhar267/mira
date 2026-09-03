import type { ChatMessage, MemoryRecord } from "@companion/shared";

const stopWords = new Set([
  "about", "after", "again", "also", "because", "before", "being", "every", "feels", "from", "have", "just", "lately", "like", "mostly", "really", "same", "that", "their", "there", "these", "they", "thing", "this", "today", "very", "want", "with", "would", "your",
  "baare", "bataya", "bola", "hai", "hain", "kya", "maine", "mein", "mera", "mere", "meri", "mujhe", "pehle", "yaad",
  "क्या", "बताया", "बारे", "मेरी", "मेरे", "मुझे", "याद", "है", "हैं",
]);
const recallWords = new Set(["do", "did", "know", "memory", "memories", "remember", "said", "tell", "told", "what"]);
const genericSingleTokens = new Set(["feel", "friend", "heavy", "home", "life", "time", "week", "work"]);

function tokens(value: string) {
  return new Set(
    (value.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? [])
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

  const recentFirst = [...memories].sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    return (Date.parse(right.updatedAt ?? "") || 0) - (Date.parse(left.updatedAt ?? "") || 0);
  });

  if (/\b(?:what do you remember|remember about me|what did i (?:say|tell you)|told you earlier|use (?:your|my) memor(?:y|ies)|recall|maine (?:pehle )?kya (?:bola|bataya)|yaad hai)\b/i.test(recentUserText)
    || /(?:तुम्हें याद है|मैंने (?:पहले )?क्या (?:कहा|बताया)|मेरे बारे में क्या याद|क्या याद (?:है|हैं))/u.test(recentUserText)) {
    const recallTokens = [...tokens(recentUserText)].filter((token) => !recallWords.has(token));
    const topicMatches = recallTokens.length
      ? recentFirst.filter((memory) => [...tokens(memory.content)].some((token) => recallTokens.includes(token)))
      : [];
    return (topicMatches.length ? topicMatches : recentFirst).slice(0, 10).map((memory) => memory.content);
  }

  const recentTokens = tokens(recentUserText);
  return recentFirst
    .filter((memory) => {
      const overlap = [...tokens(memory.content)].filter((token) => recentTokens.has(token));
      return overlap.length >= 2 || overlap.some((token) => token.length >= 6 && !genericSingleTokens.has(token));
    })
    .slice(0, 6)
    .map((memory) => memory.content);
}
