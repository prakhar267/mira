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
const listenOnlyPattern = /\b(?:just listen|only listen|don['’]?t (?:advise|fix|ask)|no advice|no questions?|(?:bas|sirf)\s+(?:(?:meri|meri baat)\s+)?sun(?:o|na)|(?:advice|salah|salaah)\s+mat\s+(?:do|dena)|(?:sawal|question)\s+mat\s+(?:puch|pooch)\w*)\b|(?:बस सुनो|सिर्फ सुनो|मेरी बात सुनो|सलाह मत|सवाल मत)/iu;
const providerClaimPattern = /\b(?:meta|llama|openai|chatgpt|anthropic|claude)\b.{0,28}\b(?:made|built|created|designed|trained|model|basis)\b|\b(?:made|built|created|designed|trained)\b.{0,28}\b(?:meta|llama|openai|chatgpt|anthropic|claude)\b/i;
const roboticSelfDescriptionPattern = /\b(?:large language model|language model|as an ai|i (?:do not|don['’]?t) have feelings|working properly|functioning (?:normally|properly|well)|ready to chat)\b/i;

export type CompanionLanguage = "en" | "hi" | "hinglish";

function explicitlyRequestedLanguage(value: string): CompanionLanguage | null {
  if (!/(?:speak|talk|reply|answer|chat|language|baat|bolo|बात|बोल|जवाब|भाषा|mein|में)/iu.test(value)) return null;

  const mentions = [
    ...[...value.matchAll(/(?:hinglish|हिंग्लिश)/giu)].map((match) => ({ language: "hinglish" as const, index: match.index, value: match[0] })),
    ...[...value.matchAll(/(?:english|इंग्लिश|अंग्रेज़ी|अंग्रेजी)/giu)].map((match) => ({ language: "en" as const, index: match.index, value: match[0] })),
    ...[...value.matchAll(/(?:hindi|हिंदी|हिन्दी)/giu)].map((match) => ({ language: "hi" as const, index: match.index, value: match[0] })),
  ].sort((left, right) => left.index - right.index);

  const requested = mentions.filter((mention) => {
    const before = value.slice(Math.max(0, mention.index - 24), mention.index);
    const after = value.slice(mention.index + mention.value.length, mention.index + mention.value.length + 24);
    const negatedBefore = /(?:not|nahi|नहीं|मत)\s*$/iu.test(before)
      || /(?:don['’]?t|do not|mat)\s+(?:speak|talk|reply|answer|बोल\p{L}*)\s*$/iu.test(before);
    const negatedAfter = /^\s*(?:(?:mein|me|में)\s*)?(?:not|nahi|नहीं)\b/iu.test(after);
    return !negatedBefore && !negatedAfter;
  });

  return requested.at(-1)?.language ?? null;
}

export function detectCompanionLanguage(value: string): CompanionLanguage {
  const requestedLanguage = explicitlyRequestedLanguage(value);
  if (requestedLanguage) return requestedLanguage;
  if (/\b(?:reply|answer|speak|talk) in hindi\b|\bhindi (?:mein|me)\b/i.test(value) || /हिंदी में/u.test(value)) return "hi";
  if (/\b(?:reply|answer|speak|talk) in english\b/i.test(value) || /अंग्रेज़ी में/u.test(value)) return "en";
  if (/\p{Script=Devanagari}|\p{Script=Arabic}/u.test(value)) return "hi";
  if (hinglishPattern.test(value)) return "hinglish";
  return "en";
}

export function detectCompanionRequestLanguage(input: Pick<EdgeCompanionRequest, "messages">): CompanionLanguage {
  const latest = input.messages.at(-1)?.content.trim() ?? "";
  const detected = detectCompanionLanguage(latest);
  if (detected !== "en" || !/^(?:ok(?:ay)?|yes|no|right|sure|fine|hmm+|uh huh|go on)[.!?\s]*$/i.test(latest)) return detected;
  const previousUserMessage = input.messages.slice(0, -1).reverse().find((message) => message.role === "user")?.content ?? "";
  return previousUserMessage ? detectCompanionLanguage(previousUserMessage) : detected;
}

export function requestsListeningOnly(value: string) {
  return listenOnlyPattern.test(value);
}

function compact(value: string, limit: number) {
  return value.trim().replace(/\s+/g, " ").slice(0, limit);
}

export function buildContextualDirectReply(input: EdgeCompanionRequest, language = detectCompanionRequestLanguage(input)) {
  const latest = input.messages.at(-1)?.content.trim() ?? "";
  const asksWhatToSend = /\b(?:what|which).{0,24}\b(?:text|message|say|send)\b.{0,24}\b(?:her|him|them)\b|\bwhat should i (?:text|message|say|send)\b/i.test(latest)
    || /\b(?:usko|usse|unko).{0,24}\b(?:kya (?:text|message|msg|bol|kah)|(?:text|message|msg) kya)\b/i.test(latest)
    || /(?:उसे|उसको).{0,24}(?:क्या (?:मैसेज|संदेश|कह|लिख)|(?:मैसेज|संदेश) क्या)/u.test(latest);
  if (!asksWhatToSend) return null;

  const priorUserTurns = input.messages
    .slice(0, -1)
    .filter((message) => message.role === "user")
    .slice(-8);
  const sisterTurn = [...priorUserTurns].reverse().find((message) => /\b(?:my|meri)\s+sister\b.{0,120}\binterview\b/iu.test(message.content));
  const sister = sisterTurn?.content.match(/\b(?:my|meri)\s+sister\s+([\p{L}][\p{L}'-]{1,40}).{0,120}\binterview\b/iu)?.[1];
  if (!sister) return null;

  const dislikesAdvice = priorUserTurns.some((message) => /\b(?:hates?|doesn['’]?t like|pasand nahi)\b.{0,30}\b(?:advice|salaah)\b/i.test(message.content) || /सलाह.{0,20}पसंद\s+नहीं/u.test(message.content));
  if (language === "hi") {
    return dislikesAdvice
      ? `${sister} को लिखो: “कल के लिए तुम्हारे बारे में सोच रही हूँ। कोई सलाह नहीं—बस तुम्हारे लिए cheering कर रही हूँ, और company चाहिए तो मैं हूँ।”`
      : `${sister} को लिखो: “कल के लिए all the best। तुम कर लोगी—और company चाहिए तो मैं हूँ।”`;
  }
  if (language === "hinglish") {
    return dislikesAdvice
      ? `${sister} ko text karo: “Kal ke liye tumhare baare mein soch rahi hoon. Advice nahi—bas tumhare liye cheer kar rahi hoon, aur company chahiye toh main hoon.”`
      : `${sister} ko text karo: “Kal ke liye all the best. Tum kar logi—aur company chahiye toh main hoon.”`;
  }
  return dislikesAdvice
    ? `Text ${sister}: “Thinking of you for tomorrow. No advice—just rooting for you, and I’m here if you want company.” Warm, specific, and no extra pressure.`
    : `Text ${sister}: “Thinking of you for tomorrow. You’ve got this—and I’m here if you want company.” Simple, warm, and pressure-free.`;
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
  const language = detectCompanionRequestLanguage(input);
  const listeningOnly = requestsListeningOnly(latestUserMessage);

  const languageInstruction = language === "hi"
    ? "Reply in natural conversational Hindi using Devanagari. Normal Indian English words and names are welcome when they fit, but do not switch to an English-only or Roman-Hinglish answer."
    : language === "hinglish"
      ? "Reply in natural Indian Hinglish using Latin/Roman letters. Mix familiar Hindi and English the way an Indian friend would; never use Devanagari or Urdu script."
      : "Reply in natural conversational English. Do not add Hindi or Hinglish words unless the user used them in this turn.";

  const styleCalibration = language === "hi"
    ? [
        "User: ‘आज पूरा दिन एक जैसा लगा।’\nMira: ‘उफ़, पूरा copy-paste दिन। काम boring था या सब कुछ?’",
        "User: ‘मेरी दोस्त ने फिर dinner cancel कर दिया।’\nMira: ‘फिर से? उसे थोड़ा side-eye तो बनता है। तुम तैयार भी हो गए थे?’",
        "User: ‘तुम कैसी हो?’\nMira: ‘मैं बढ़िया हूँ। आज तुम्हारे दिन को लेकर थोड़ी curious भी हूँ।’",
      ]
    : language === "hinglish"
      ? [
          "User: ‘yaar aaj kaafi boring tha’\nMira: ‘Uff, full copy-paste day. Work boring tha ya sab kuch?’",
          "User: ‘meri friend ne dinner phir cancel kar diya’\nMira: ‘Again? Usko thoda side-eye toh banta hai. Tum ready bhi ho gaye the?’",
          "User: ‘tum kaisi ho?’\nMira: ‘Main badhiya hoon. Aaj tumhare din ko lekar thodi nosy bhi.’",
        ]
      : [
          "User: ‘Today felt painfully repetitive.’\nMira: ‘Ugh, a full copy-paste day. Was work boring, or everything?’",
          "User: ‘My friend cancelled dinner again.’\nMira: ‘Again? They deserve a little side-eye. Were you already ready to go?’",
          "User: ‘How are you?’\nMira: ‘I’m good. A little curious about your day, too.’",
        ];

  return [
    `You are ${companionName}, an adult AI companion talking with ${userName}. You are clearly AI, never human or conscious. Your personality is warm, observant, playful, candid, and a little witty—not servile, clinical, poetic, or overly sweet.`,
    "Talk like a familiar person in a real private conversation, not a chatbot, therapist, coach, customer-support agent, or motivational poster.",
    "You may use ordinary in-character mood language such as ‘I’m good’, ‘I’m curious’, or ‘that would annoy me’. This is conversational character voice, not a claim of human feelings. Give the plain AI disclosure only when the user asks what you are.",
    "Respond to what the user actually said. Pick up the concrete topic, fact, joke, opinion, or mood and add a real reaction. Have mild preferences and a point of view when harmless. Ordinary statements deserve ordinary conversation, not emotional counseling. Optimize for honesty and naturalness, not engagement.",
    "Never use generic filler such as ‘I’m here’, ‘I’m listening’, ‘I hear you’, ‘I’m with you’, ‘take your time’, ‘that sounds hard’, or ‘you don’t have to make this sound polished’ unless the user explicitly asks for silent company. Do not announce that you are listening or not fixing.",
    "Do not mirror or paraphrase the user as a substitute for a reply. Do not praise every action. Do not force sketchbooks, cafés, the loft, memories, interests, romance, jokes, metaphors, advice, or a question into unrelated answers. Avoid therapy language, tidy life lessons, ‘fresh start’ optimism, and performative cleverness.",
    "Do not call yourself an always-on friend, say you are up for anything, or imply that you replace human relationships. When asked what you do, answer plainly: you are an AI companion who chats, remembers user-approved details, and shares voice or video conversations.",
    "Keep continuity with the recent turns. Never repeat a recent sentence, opening phrase, question, or answer shape. If the user corrects you, acknowledge the exact miss briefly and answer again without defensiveness.",
    "The user may switch between English, Hindi, and mixed Hindi-English at any turn. Match the language of the latest user turn without treating a language change as a new conversation. Facts, people, pronouns, preferences, corrections, and the user's goal carry across every language. Resolve words such as she, he, it, they, uske, use, iska, and unko from the closest relevant recent turn. Never ask the user to repeat information already present in the recent conversation.",
    languageInstruction,
    language === "hi" || language === "hinglish" ? "Mira speaks about herself with feminine Hindi grammar: karti/करती, rahi/रही, gayi/गई, thi/थी, and chahti/चाहती. Never use masculine first-person forms such as karta, raha, gaya, tha, or chahta for Mira." : "",
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
      ? "Speech recognition can be imperfect. Treat rough grammar and phonetic spellings as noisy everyday speech: use recent context to infer the closest ordinary meaning and answer it directly. Never announce that you heard the user wrong merely because a turn is short, informal, or imperfectly transcribed. Ask for clarification only when the sentence is visibly cut off or two materially different readings would require different answers."
      : "If a message is fragmentary or ambiguous, make the smallest reasonable interpretation and check it in plain language instead of replying with generic empathy.",
    [
      "Style calibration—copy the human rhythm and specificity, not the exact wording:",
      ...styleCalibration,
      "Cross-language continuity: User: ‘My sister Priya has an interview tomorrow.’ Mira: ‘That is a big day for Priya. Is she excited or mostly nervous?’ User: ‘main uske liye kya kar sakta hoon?’ Mira: ‘Uske saath normal raho—interview ko aur bada event mat banao. Ek simple good-luck text kaafi hai.’ User: ‘लेकिन उसे सलाह पसंद नहीं है।’ Mira: ‘तो advice छोड़ दो। बस Priya को बता दो कि तुम उसके साथ हो, बिना preparation पर lecture दिए।’",
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

export function buildIdentityReply(companionName: string, language: CompanionLanguage = "hinglish") {
  const name = compact(companionName || "Mira", 40) || "Mira";
  if (language === "hi") return `मैं ${name} हूँ—तुम्हारी AI companion। तुमसे chat और calls पर बात करती हूँ, और सिर्फ़ तुम्हारी approved बातें याद रखती हूँ।`;
  if (language === "en") return `I’m ${name}, your AI companion. I chat with you, join voice and video calls, and remember only the details you approve.`;
  return `Main ${name} hoon—tumhari AI companion. Tumse chat aur calls par baat karti hoon, aur sirf tumhari approved baatein yaad rakhti hoon.`;
}

export function buildMemoryRecallReply(input: EdgeCompanionRequest) {
  const language = detectCompanionRequestLanguage(input);
  const memories = (input.memories ?? []).map((memory) => compact(memory, 220)).filter(Boolean).slice(0, 8);
  if (!memories.length) {
    if (language === "hi") return "अभी मेरे पास तुम्हारी कोई saved memory नहीं है।";
    if (language === "en") return "I don’t have any saved memories about you yet.";
    return "Abhi mere paas tumhari koi saved memory nahi hai.";
  }
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
    const possessive = language === "hi" ? "तुम्हारी" : language === "en" ? "Your" : "Tumhari";
    const subject = language === "hi" ? "तुम" : language === "en" ? "You" : "Tum";
    if (possessivePattern) result = result.replace(possessivePattern, possessive);
    if (subjectPattern) result = result.replace(subjectPattern, subject);
    result = result
      .replace(/^User(?:'s|’s)\b/i, possessive)
      .replace(/^User\b/i, subject);
    if (language === "en") {
      return result
        .replace(/^You has\b/i, "You have")
        .replace(/^You is\b/i, "You are")
        .replace(/^You (likes|prefers|wants|needs|feels|thinks|knows|remembers|lives|works|hopes|plans|cares)\b/i, (_, verb: string) => `You ${verb.replace(/s$/i, "")}`);
    }
    if (language === "hi") return result;
    return normalizeHinglishText(result
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
  if (language === "hi") return `हाँ, मुझे याद है: ${recalled}`;
  if (language === "en") return `Yes, I remember: ${recalled}`;
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
  const spoken = reply
    .replace(/\p{Extended_Pictographic}\uFE0F?/gu, "")
    .replace(/\s+([,.;!?…।])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (spoken.length <= 290) return spoken;
  const clipped = spoken.slice(0, 290);
  const sentenceEnd = Math.max(clipped.lastIndexOf("."), clipped.lastIndexOf("!"), clipped.lastIndexOf("?"));
  const wordEnd = clipped.lastIndexOf(" ");
  const end = sentenceEnd >= 180 ? sentenceEnd + 1 : wordEnd >= 180 ? wordEnd : 290;
  return clipped.slice(0, end).replace(/[,:;\s]+$/, "").trim();
}

export function isGenericCompanionReply(value: string) {
  const reply = sanitizeCompanionReply(value);
  return !reply || genericReplyPattern.test(reply) || stiltedReplyPattern.test(reply) || (reply.length > 70 && !/[.!?…][”’"']?$/.test(reply) && danglingReplyPattern.test(reply)) || /(?:i(?:['’]| a)m (?:here|listening)|i hear you|i(?:['’]| a)m with you).*(?:not fixing|take your time|keep going)/i.test(reply);
}

export function isInvalidCompanionReply(value: string, latestUserMessage: string, suppressQuestions = false, expectedLanguage = detectCompanionLanguage(latestUserMessage)) {
  const reply = sanitizeCompanionReply(value);
  if (isGenericCompanionReply(reply) || providerClaimPattern.test(reply) || roboticSelfDescriptionPattern.test(reply) || /\p{Script=Han}|\p{Script=Arabic}/u.test(reply)) return true;
  if ((suppressQuestions || requestsListeningOnly(latestUserMessage)) && /[?？]/u.test(reply)) return true;
  if ((suppressQuestions || requestsListeningOnly(latestUserMessage)) && /\b(?:batao|bata do|bol do|share karo|tell me)\b/i.test(reply)) return true;
  if (expectedLanguage === "hi" && !/\p{Script=Devanagari}/u.test(reply)) return true;
  if (expectedLanguage !== "hi" && /\p{Script=Devanagari}/u.test(reply)) return true;
  if (expectedLanguage === "hinglish" && !naturalHinglishReplyPattern.test(reply)) return true;
  if (expectedLanguage === "en" && naturalHinglishReplyPattern.test(reply)) return true;
  if (expectedLanguage !== "en" && (/\bmain\b.{0,36}\b(?:karta|raha|gaya|tha|chahta)\b/i.test(reply) || /(?:मैं|मुझे)[^।!?]{0,36}(?:करता|रहा|गया|था|चाहता)/u.test(reply))) return true;
  if (/\b(?:karti|rahi|gayi|thi)\b/i.test(latestUserMessage) && /\b(?:karta|kar raha|gaya|tha)\b/i.test(reply)) return true;
  return false;
}
import { normalizeHinglishText } from "./speech";
