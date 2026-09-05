import type { ChatMessage, MemoryRecord } from "@companion/shared";

const stopWords = new Set([
  "about", "after", "again", "also", "because", "before", "being", "every", "feels", "from", "have", "just", "lately", "like", "mostly", "really", "same", "that", "their", "there", "these", "they", "thing", "this", "today", "very", "want", "with", "would", "your",
  "baare", "bataya", "bola", "hai", "hain", "kya", "maine", "mein", "mera", "mere", "meri", "mujhe", "pehle", "yaad",
  "क्या", "बताया", "बारे", "मेरी", "मेरे", "मुझे", "याद", "है", "हैं",
]);
const recallWords = new Set(["do", "did", "know", "memory", "memories", "remember", "said", "tell", "told", "what"]);
const genericSingleTokens = new Set(["feel", "friend", "heavy", "home", "life", "time", "week", "work"]);

const relationshipAliases: Record<string, string> = {
  behen: "sister",
  bhai: "brother",
  dost: "friend",
  mummy: "mother",
  maa: "mother",
  papa: "father",
};

function tokens(value: string) {
  return new Set(
    (value.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? [])
      .map((token) => token.length > 5 ? token.replace(/(?:ing|ed|es|s)$/i, "") : token)
      .filter((token) => token.length >= 4 && !stopWords.has(token)),
  );
}

function namedRelationship(memory: MemoryRecord) {
  const normalized = memory.normalizedContent?.toLowerCase().match(/^(sister|brother|mother|father|friend|partner|wife|husband|behen|bhai|dost|mummy|maa|papa):([\p{L}][\p{L}'-]{1,40})$/u);
  const content = memory.content.match(/\b(?:my|meri|mere|mera|user(?:'s|’s)|[\p{L}'-]+(?:'s|’s))\s+(sister|brother|mother|father|friend|partner|wife|husband|behen|bhai|dost|mummy|maa|papa)\s+(?:(?:is\s+)?(?:named|called)\s+|is\s+|ka\s+naam\s+)?([\p{L}][\p{L}'-]{1,40})/iu);
  const match = normalized ?? content;
  if (!match?.[1] || !match[2]) return null;
  const rawSubject = match[1].toLowerCase();
  return { subject: relationshipAliases[rawSubject] ?? rawSubject, name: match[2].toLowerCase() };
}

function removeSupersededRelationshipFacts(memories: MemoryRecord[]) {
  const chronological = [...memories].sort((left, right) => (Date.parse(right.updatedAt ?? right.createdAt ?? "") || 0) - (Date.parse(left.updatedAt ?? left.createdAt ?? "") || 0));
  const authoritativeNames = new Map<string, string>();
  for (const memory of chronological) {
    const relationship = namedRelationship(memory);
    if (relationship && !authoritativeNames.has(relationship.subject)) authoritativeNames.set(relationship.subject, relationship.name);
  }
  return memories.filter((memory) => {
    const relationship = namedRelationship(memory);
    return !relationship || authoritativeNames.get(relationship.subject) === relationship.name;
  });
}

export function currentMemoryRecords(memories: MemoryRecord[]) {
  return removeSupersededRelationshipFacts(memories.filter((memory) => memory.status !== "superseded"));
}

export function relevantMemoryContents(memories: MemoryRecord[], messages: ChatMessage[]) {
  const recentUserText = messages
    .filter((message) => message.role === "user")
    .slice(-2)
    .map((message) => message.content)
    .join(" ");

  const recentFirst = currentMemoryRecords(memories).sort((left, right) => {
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
