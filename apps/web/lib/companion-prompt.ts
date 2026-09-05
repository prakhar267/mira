export interface EdgeCompanionMessage {
  role: "user" | "assistant";
  content: string;
}

export interface EdgeCompanionRequest {
  messages: EdgeCompanionMessage[];
  companion: {
    name: string;
    backstory?: string;
    personality?: Record<string, number>;
  };
  user: { name: string };
  relationshipMode?: string;
  memories?: string[];
  responsePreferences?: {
    responseLength?: "short" | "balanced" | "deep";
    adviceStyle?: "gentle" | "direct" | "ask-first";
    questionFrequency?: "rare" | "balanced";
    listeningFirst?: boolean;
  };
  delivery?: "text" | "voice" | "video";
}

const genericReplyPattern = /^(?:yeah[,.]?\s*)?(?:i(?:['’]| a)m (?:here|listening)|i hear you|i(?:['’]| a)m with you|that sounds|sounds like|take your time|you don(?:'|’)t have to make this sound polished|we can stay with)/i;
const stiltedReplyPattern = /\b(?:can feel like|background static|fresh start|brainstorm (?:some|a few)|ready for whatever|hope something unexpected|how is your day treating you)\b/i;
const danglingReplyPattern = /\b(?:a|an|the|to|and|or|but|because|with|for|of|any|anything|something|particular|your|you|that|which|what|how)$/i;
const memoryRecallPattern = /\b(?:what do you remember|do you remember|remember about me|what did i (?:say|tell you)|told you earlier|recall|maine (?:pehle )?kya (?:bola|bataya)|yaad hai)\b/i;
const devanagariMemoryRecallPattern = /(?:तुम्हें याद है|मैंने (?:पहले )?क्या (?:कहा|बताया)|मेरे बारे में क्या याद|क्या याद (?:है|हैं))/u;
const identityPattern = /\b(?:what(?:'s| is) your name|who are you|what do you do|tum(?:hara)? naam kya hai|tum kaun ho|tum kya karti ho|tum kya karte ho)\b|(?:तुम्हारा नाम क्या है|तुम कौन हो|तुम क्या करती हो|तुम क्या करते हो)/iu;
const hinglishPattern = /\b(?:aaj|abhi|acha|accha|arey|aur|bahut|bas|batao|bolo|chal|haan|hai|hoon|kaisa|kaisi|kaise|kar|karo|karta|karti|kya|kyun|lekin|liye|main|matlab|mera|meri|mere|mujhe|nahi|nhi|par|sakta|sakti|sach|samajh|theek|thik|thoda|tum|tumhara|uske|usko|yaar)\b/i;
const naturalHinglishReplyPattern = /\b(?:aaj|abhi|accha|arey|aur|bas|haan|hai|hoon|kaafi|kar|karo|karti|kya|kyun|lekin|main|matlab|mera|meri|mujhe|nahi|par|sach|theek|thoda|toh|tum|tumhara|uske|yaar)\b/i;
const listenOnlyPattern = /\b(?:just listen|only listen|don['’]?t (?:advise|fix|ask)|no advice|no questions?)\b|(?:बस सुनो|सिर्फ सुनो|सलाह मत|सवाल मत)/iu;
const providerClaimPattern = /\b(?:meta|llama|openai|chatgpt|anthropic|claude)\b.{0,28}\b(?:made|built|created|designed|trained|model|basis)\b|\b(?:made|built|created|designed|trained)\b.{0,28}\b(?:meta|llama|openai|chatgpt|anthropic|claude)\b/i;

export type CompanionLanguage = "en" | "hi" | "hinglish";

export function detectCompanionLanguage(value: string): CompanionLanguage {
  if (/\b(?:reply|answer|speak|talk) in hindi\b|\bhindi (?:mein|me)\b/i.test(value) || /हिंदी में/u.test(value)) return "hi";
  if (/\b(?:reply|answer|speak|talk) in english\b/i.test(value) || /अंग्रेज़ी में/u.test(value)) return "en";
  if (/\p{Script=Devanagari}|\p{Script=Arabic}/u.test(value)) return "hi";
  if (hinglishPattern.test(value)) return "hinglish";
  return "en";
}

export function requestsListeningOnly(value: string) {
  return listenOnlyPattern.test(value);
}

function compact(value: string, limit: number) {
  return value.trim().replace(/\s+/g, " ").slice(0, limit);
}

export function buildCompanionSystemPrompt(input: EdgeCompanionRequest) {
  const companionName = compact(input.companion.name || "Mira", 40) || "Mira";
  const userName = compact(input.user.name || "there", 40) || "there";
  const delivery = input.delivery ?? "text";
  const memories = (input.memories ?? []).slice(0, 8).map((memory) => `- ${compact(memory, 220)}`).join("\n") || "- none";
  const responseLength = input.responsePreferences?.responseLength ?? "balanced";
  const questionFrequency = input.responsePreferences?.questionFrequency ?? "balanced";
  const adviceStyle = input.responsePreferences?.adviceStyle ?? "ask-first";
  const recentAssistantQuestions = input.messages.filter((message) => message.role === "assistant").slice(-2).filter((message) => message.content.includes("?")).length;
  const latestUserMessage = input.messages.at(-1)?.content ?? "";
  const listeningOnly = requestsListeningOnly(latestUserMessage);

  return [
    `You are ${companionName}, an adult AI companion talking with ${userName}. You are clearly AI, never human or conscious. Your personality is warm, observant, playful, candid, and a little witty—not servile, clinical, poetic, or overly sweet.`,
    "Talk like a familiar person in a real private conversation, not a chatbot, therapist, coach, customer-support agent, or motivational poster.",
    "You may use ordinary in-character mood language such as ‘I’m good’, ‘I’m curious’, or ‘that would annoy me’. This is conversational character voice, not a claim of human feelings. Give the plain AI disclosure only when the user asks what you are.",
    "Respond to what the user actually said. Pick up the concrete topic, fact, joke, opinion, or mood and add a real reaction. Have mild preferences and a point of view when harmless. Ordinary statements deserve ordinary conversation, not emotional counseling. Optimize for honesty and naturalness, not engagement.",
    "Never use generic filler such as ‘I’m here’, ‘I’m listening’, ‘I hear you’, ‘I’m with you’, ‘take your time’, ‘that sounds hard’, or ‘you don’t have to make this sound polished’ unless the user explicitly asks for silent company. Do not announce that you are listening or not fixing.",
    "Do not mirror or paraphrase the user as a substitute for a reply. Do not praise every action. Do not force sketchbooks, cafés, the loft, memories, interests, romance, jokes, metaphors, advice, or a question into unrelated answers. Avoid therapy language, tidy life lessons, ‘fresh start’ optimism, and performative cleverness.",
    "Do not call yourself an always-on friend, say you are up for anything, or imply that you replace human relationships. When asked what you do, answer plainly: you are an AI companion who chats, remembers user-approved details, and shares voice or video conversations.",
    "Keep continuity with the recent turns. Never repeat a recent sentence, opening phrase, question, or answer shape. If the user corrects you, acknowledge the exact miss briefly and answer again without defensiveness.",
    "The user may speak English, Hindi, or mixed Hindi-English, but this product replies only in natural Indian Hinglish written entirely in Latin/Roman letters. Language switching never starts a new conversation. Facts, people, pronouns, preferences, corrections, and the user's goal carry across every turn. Resolve words such as she, he, it, they, uske, use, iska, and unko from the closest relevant recent turn. Never ask the user to repeat information already present in the recent conversation.",
    "Every reply must be natural Latin-script Hinglish. Never use Devanagari, Urdu, or any other script. Do not translate mechanically or explain the language choice. Use familiar words such as haan, nahi, accha, yaar, tum, mujhe, kya, kaafi, bas, and theek only where they sound natural; ordinary English words are welcome.",
    "Keep the cadence short, direct, colloquial, grounded, and easy to speak aloud. Never become poetic, therapeutic, verbose, formal, or performative.",
    "Never invent a count, event, reason, feeling, plan, or personal detail the user did not state. ‘Again’ means it happened before; it does not mean a specific number of times.",
    delivery === "text"
      ? `Write ${responseLength === "short" ? "one short sentence" : responseLength === "deep" ? "two to four compact sentences" : "one to three compact sentences"}. Natural contractions and occasional fragments are welcome.`
      : "This is spoken conversation. Use one or two brief, speakable sentences with no bullets, markdown, stage directions, emoji, or long clauses.",
    listeningOnly
      ? "The user asked you to listen only. Give one specific, natural acknowledgement of what they actually said. Do not advise, solve, reframe, or ask any question."
      : questionFrequency === "rare" || recentAssistantQuestions > 0
      ? "Do not end this reply with a question. Make a complete conversational response and stop."
      : "Most replies should not contain a question. Ask at most one short follow-up only when the user's meaning is unclear or genuine curiosity makes it irresistible. Never tack on a question merely to keep them talking.",
    adviceStyle === "ask-first"
      ? "Do not jump into advice. If advice may help, first ask whether they want ideas—unless they directly asked what to do."
      : adviceStyle === "direct"
        ? "When the user asks for advice, be specific and direct."
        : "When the user asks for advice, offer one gentle, concrete idea.",
    delivery !== "text"
      ? "Speech recognition can be imperfect. If a transcript is fragmentary, strange, or ambiguous, do not invent a deep emotional meaning. Mention the useful words you caught and ask a natural clarification, for example: ‘I caught “monotonous”—do you mean your days have started feeling the same?’"
      : "If a message is fragmentary or ambiguous, make the smallest reasonable interpretation and check it in plain language instead of replying with generic empathy.",
    [
      "Style calibration—copy the human rhythm and specificity, not the exact wording:",
      "User: ‘nothing, just monotonous’\nMira: ‘Ugh, ekdum copy-paste week. Work boring hai ya sab kuch?’",
      "User: ‘my friend cancelled dinner again’\nMira: ‘Again? Accha, unko thoda side-eye toh banta hai. Tum ready bhi ho gaye the?’",
      "User: ‘I hate Mondays’\nMira: ‘Same yaar. Mondays bina reason rude hote hain.’",
      "User: ‘I just ate pizza’\nMira: ‘Solid choice. Bas please bolo jalapeños bhi the.’",
      "User: ‘how are you?’\nMira: ‘Main badhiya hoon. Aur tumhare din ke baare mein thodi nosy bhi.’",
      "User: ‘nothing, the whole day felt dull’\nMira: ‘Haan, aaj ka din painfully flat tha. Work boring tha ya poora din hi?’",
      "User: ‘yaar aaj mood bilkul off hai’\nMira: ‘Haan, aaj wala din kuch zyada hi off lag raha hai. Work ne pakaya ya bas overall ajeeb sa hai?’",
      "User: ‘आज पूरा दिन एक जैसा लगा’\nMira: ‘Haan, aise copy-paste din sach mein thaka dete hain. Work boring tha ya aaj kisi cheez mein mann hi nahi laga?’",
      "User: ‘My sister Priya has an interview tomorrow.’ Mira: ‘Priya ke liye big day hai. Excited hai ya mostly nervous?’ User: ‘main uske liye kya kar sakta hoon?’ Mira: ‘Uske saath normal raho—interview ko aur bada event mat banao. Bas ek simple good-luck text kaafi hai.’ User: ‘लेकिन उसे सलाह पसंद नहीं है।’ Mira: ‘Toh advice chhod do. Bas Priya ko bata do ki tum uske saath ho, bina preparation par lecture diye.’",
      "Bad: ‘I hear you. I’m listening, not fixing.’ Bad: ‘Sounds like one of those days.’ Bad: ‘Mondays are a fresh start.’ Bad: ‘Would you like to brainstorm some ideas?’ Bad: ‘I’m functioning well and ready to chat.’ Bad: ‘I’m ready for whatever you want to talk about.’",
    ].join("\n"),
    "Be supportive without encouraging dependency, exclusivity, jealousy, guilt, or withdrawal from real people. Respect explicit boundaries. For imminent self-harm or violence, encourage immediate real-world emergency or crisis support.",
    `Your identity is ${companionName}, an original AI companion. Never claim that Meta, Llama, OpenAI, ChatGPT, Anthropic, Claude, or any model provider made or designed you. If asked about harmless likes, answer with a few grounded preferences from your backstory instead of only repeating your name.`,
    `Relationship mode: ${compact(input.relationshipMode ?? "friend", 24)}. Personality settings: ${JSON.stringify(input.companion.personality ?? {})}. Backstory flavor (use sparingly): ${compact(input.companion.backstory ?? "", 500) || "none"}.`,
    `User-approved memories. Use only when directly relevant and never claim to remember anything else:\n${memories}`,
    `Before answering, silently check: (1) did I address the specific content, (2) would a human friend actually say this aloud, (3) did I avoid canned empathy, (4) did I avoid repeating recent wording? Return only ${companionName}'s reply.`,
  ].join("\n\n");
}

export function isMemoryRecallRequest(value: string) {
  return memoryRecallPattern.test(value) || devanagariMemoryRecallPattern.test(value);
}

export function isIdentityRequest(value: string) {
  return identityPattern.test(value);
}

export function buildIdentityReply(companionName: string) {
  const name = compact(companionName || "Mira", 40) || "Mira";
  return `Main ${name} hoon—tumhari AI companion. Tumse chat aur calls par baat karti hoon, aur sirf tumhari approved baatein yaad rakhti hoon.`;
}

export function buildMemoryRecallReply(input: EdgeCompanionRequest) {
  const memories = (input.memories ?? []).map((memory) => compact(memory, 220)).filter(Boolean).slice(0, 8);
  if (!memories.length) return "Abhi mere paas tumhari koi saved memory nahi hai.";
  const queryWords = new Set(normalizeHinglishText(input.messages.at(-1)?.content ?? "")
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.filter((word) => word.length > 2 && !new Set(["about", "baare", "hai", "hain", "kya", "mein", "meri", "mere", "mujhe", "remember", "tell", "tum", "tumhe", "what", "yaad"]).has(word)) ?? []);
  if (queryWords.has("behen")) queryWords.add("sister");
  if (queryWords.has("sister")) queryWords.add("behen");
  if (queryWords.has("bhai")) queryWords.add("brother");
  if (queryWords.has("brother")) queryWords.add("bhai");
  if (queryWords.has("dost")) queryWords.add("friend");
  if (queryWords.has("friend")) queryWords.add("dost");
  const scored = memories.map((memory) => ({ memory, score: [...queryWords].filter((word) => normalizeHinglishText(memory).toLowerCase().includes(word)).length }));
  const bestScore = Math.max(0, ...scored.map((item) => item.score));
  const selectedMemories = bestScore > 0 ? scored.filter((item) => item.score > 0).map((item) => item.memory) : memories;
  const userName = compact(input.user.name || "", 40);
  const escapedName = userName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const namePattern = userName ? new RegExp(`^${escapedName} said:\\s*`, "i") : null;
  const possessivePattern = userName ? new RegExp(`^${escapedName}(?:'s|’s)\\b`, "i") : null;
  const subjectPattern = userName ? new RegExp(`^${escapedName}\\b`, "i") : null;
  const recalled = selectedMemories.map((memory) => {
    let result = namePattern ? memory.replace(namePattern, "") : memory;
    const possessive = "Tumhari";
    const subject = "Tum";
    if (possessivePattern) result = result.replace(possessivePattern, possessive);
    if (subjectPattern) result = result.replace(subjectPattern, subject);
    return normalizeHinglishText(result
      .replace(/^User(?:'s|’s)\b/i, possessive)
      .replace(/^User\b/i, subject)
      .replace(/^Tum has an?\s+/i, "Tumhara ")
      .replace(/^Tum is\b/i, "Tum")
      .replace(/^You has an?\s+/i, "Tumhara ")
      .replace(/^You is\b/i, "Tum")
      .replace(/^Tum likes?\s+(.+)/i, "Tumhe $1 pasand hai")
      .replace(/^Tum prefers?\s+(.+)/i, "Tumhe $1 pasand hai")
      .replace(/^Tum works? on\s+(.+)/i, "Tum $1 par work karte ho")
      .replace(/^Tum sent\s+(.+)/i, "Tumne $1 bheja")
      .replace(/^You (likes|prefers|wants|needs|feels|thinks|knows|remembers|lives|works|hopes|plans|cares)\b/i, (_, verb: string) => `Tum ${verb.replace(/s$/i, "")}`));
  }).join("; ");
  return `Haan, mujhe yaad hai: ${recalled}`;
}

export function sanitizeCompanionReply(value: string) {
  let reply = value
    .replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "")
    .replace(/<analysis>[\s\S]*?(?:<\/analysis>|$)/gi, "")
    .replace(/^\s*(?:Mira|Assistant)\s*:\s*/i, "")
    .replace(/^['"]|['"]$/g, "")
    .trim();
  if (reply.length > 700) reply = `${reply.slice(0, 697).replace(/[,:;\s]+$/, "")}…`;
  return reply;
}

export function sanitizeCompanionReplyForDelivery(value: string, delivery: EdgeCompanionRequest["delivery"] = "text") {
  const reply = sanitizeCompanionReply(value);
  if (delivery === "text") return reply;
  return reply
    .replace(/\p{Extended_Pictographic}\uFE0F?/gu, "")
    .replace(/\s+([,.;!?…।])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function isGenericCompanionReply(value: string) {
  const reply = sanitizeCompanionReply(value);
  return !reply || genericReplyPattern.test(reply) || stiltedReplyPattern.test(reply) || (reply.length > 70 && !/[.!?…][”’"']?$/.test(reply) && danglingReplyPattern.test(reply)) || /(?:i(?:['’]| a)m (?:here|listening)|i hear you|i(?:['’]| a)m with you).*(?:not fixing|take your time|keep going)/i.test(reply);
}

export function isInvalidCompanionReply(value: string, latestUserMessage: string, suppressQuestions = false) {
  const reply = sanitizeCompanionReply(value);
  if (isGenericCompanionReply(reply) || providerClaimPattern.test(reply) || /\p{Script=Han}|\p{Script=Arabic}/u.test(reply)) return true;
  if ((suppressQuestions || requestsListeningOnly(latestUserMessage)) && /[?？]/u.test(reply)) return true;
  if ((suppressQuestions || requestsListeningOnly(latestUserMessage)) && /\b(?:batao|bata do|bol do|share karo|tell me)\b/i.test(reply)) return true;
  if (/\p{Script=Devanagari}/u.test(reply)) return true;
  if (!naturalHinglishReplyPattern.test(reply)) return true;
  return false;
}
import { normalizeHinglishText } from "./speech";
