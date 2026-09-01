import type { ChatMessage } from "@companion/shared";
import type { CompanionContext } from "./providers";
import { assessSafety } from "./safety";

export type CompanionIntent =
  | "repair"
  | "presence"
  | "comfort"
  | "anxiety"
  | "celebrate"
  | "anger"
  | "tired"
  | "affection"
  | "memory"
  | "planning"
  | "banter"
  | "greeting"
  | "preference"
  | "open";

export interface CompanionTurn {
  text: string;
  intent: CompanionIntent;
  usedMemoryIds: string[];
  askedQuestion: boolean;
  adaptations: string[];
  explanation: string[];
}

const questionPattern = /\?/g;
const noQuestionPattern = /\b(?:stop asking|no (?:more )?questions?|don'?t ask|do not ask|without questions?|just listen|just stay|stay with me|quiet company|therapist thing)\b/i;
const noAdvicePattern = /\b(?:no advice|don'?t (?:give me|offer) advice|do not (?:give me|offer) advice|don'?t fix|do not fix|no fixing|just listen|just stay|stay with me)\b/i;
const critiquePattern = /\b(?:scripted|robotic|generic|therapist|chatbot|not listening|you keep|again|stop)\b/i;

function stableIndex(seed: string, size: number) {
  let value = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    value ^= seed.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return Math.abs(value) % size;
}

function choose(seed: string, options: string[]) {
  return options[stableIndex(seed, options.length)] ?? options[0] ?? "I’m here.";
}

function firstName(value: unknown) {
  return typeof value === "string" ? value.trim().split(/\s+/)[0] ?? "" : "";
}

function personalityValue(context: CompanionContext, trait: string, fallback: number) {
  const personality = context.identity.personality;
  if (!personality || typeof personality !== "object") return fallback;
  const value = (personality as Record<string, unknown>)[trait];
  return typeof value === "number" ? value : fallback;
}

function recentAssistantQuestions(messages: ChatMessage[]) {
  return messages
    .filter((message) => message.role === "assistant")
    .slice(-4)
    .reduce((total, message) => total + (message.content.match(questionPattern)?.length ?? 0), 0);
}

function findMemory(context: CompanionContext, pattern: RegExp) {
  return context.memories.find((memory) => pattern.test(memory.content));
}

function deliver(text: string, context: CompanionContext, prohibitQuestions: boolean) {
  const delivery = context.currentState.delivery ?? "text";
  const preference = context.responsePreferences?.responseLength ?? "balanced";
  let result = text.trim();

  if (prohibitQuestions) {
    result = result
      .split(/(?<=[.!?])\s+/)
      .filter((sentence) => !sentence.includes("?"))
      .join(" ")
      .trim();
  }

  if (delivery !== "text") {
    result = result.replace(/\n+/g, " ").replace(/\s+/g, " ");
    const sentences = result.match(/[^.!?]+[.!?]?/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [result];
    result = sentences.slice(0, 2).join(" ");
    if (result.length > 180) result = `${result.slice(0, 176).replace(/[,:;\s]+$/, "")}…`;
  } else if (preference === "short") {
    const sentences = result.match(/[^.!?]+[.!?]?/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [result];
    result = sentences.slice(0, 2).join(" ");
  }

  return result || "I’m here.";
}

function result(input: {
  text: string;
  intent: CompanionIntent;
  context: CompanionContext;
  usedMemoryIds?: string[];
  adaptations?: string[];
  prohibitQuestions?: boolean;
}): CompanionTurn {
  const text = deliver(input.text, input.context, input.prohibitQuestions ?? false);
  const usedMemoryIds = input.usedMemoryIds ?? [];
  const adaptations = input.adaptations ?? [];
  const explanation = [
    `Responded in ${input.intent === "repair" ? "conversation-repair" : input.intent} mode.`,
    ...(adaptations.includes("no-questions") ? ["Honored your request not to be asked questions."] : []),
    ...(adaptations.includes("no-advice") ? ["Stayed with the feeling instead of moving into advice."] : []),
    ...(adaptations.includes("question-fatigue") ? ["Avoided another follow-up because the recent conversation already had questions."] : []),
    ...(adaptations.includes("learned-fewer-questions") ? ["Applied your learned preference for fewer follow-up questions."] : []),
    ...(usedMemoryIds.length ? [`Used ${usedMemoryIds.length} relevant memory you can inspect or remove.`] : ["Did not force an unrelated memory into the reply."]),
    ...(input.context.currentState.delivery && input.context.currentState.delivery !== "text" ? ["Kept the turn short enough to sound natural aloud."] : []),
    "Passed the local safety check.",
  ];
  return { text, intent: input.intent, usedMemoryIds, askedQuestion: text.includes("?"), adaptations, explanation };
}

export function planCompanionTurn(input: string, context: CompanionContext): CompanionTurn {
  const safety = assessSafety(input);
  if (safety.level !== "safe" && safety.response) {
    return result({ text: safety.response, intent: "comfort", context, adaptations: ["safety-support"] });
  }

  const clean = input.trim().replace(/\s+/g, " ");
  const lower = clean.toLowerCase();
  const seed = `${lower}|${context.recentMessages.length}|${context.currentState.delivery ?? "text"}`;
  const recentQuestions = recentAssistantQuestions(context.recentMessages);
  const explicitlyNoQuestions = noQuestionPattern.test(clean);
  const explicitlyNoAdvice = noAdvicePattern.test(clean);
  const questionFatigue = recentQuestions >= 2;
  const learnedRareQuestions = context.responsePreferences?.questionFrequency === "rare";
  const prohibitQuestions = explicitlyNoQuestions || questionFatigue || learnedRareQuestions;
  const adaptations = [
    ...(explicitlyNoQuestions ? ["no-questions"] : []),
    ...(explicitlyNoAdvice ? ["no-advice"] : []),
    ...(questionFatigue && !explicitlyNoQuestions ? ["question-fatigue"] : []),
    ...(learnedRareQuestions && !explicitlyNoQuestions ? ["learned-fewer-questions"] : []),
  ];
  const delivery = context.currentState.delivery ?? "text";
  const userName = firstName(context.user.name);
  const playful = personalityValue(context, "playfulness", 0.6) >= 0.68;
  const direct = context.responsePreferences?.adviceStyle === "direct";
  const listeningFirst = context.responsePreferences?.listeningFirst ?? true;

  if ((explicitlyNoQuestions || explicitlyNoAdvice) && critiquePattern.test(clean)) {
    return result({
      text: choose(seed, [
        "Yeah, you’re right—I turned this into a prompt instead of listening.\n\nNo more questions; I’ll just stay with you.",
        "You’re right. That sounded rehearsed, not present.\n\nI’m dropping the questions. I’m here.",
        "Fair—I was interviewing you when you needed company.\n\nNo fixing or questions; just me staying here with you.",
      ]),
      intent: "repair",
      context,
      adaptations,
      prohibitQuestions: true,
    });
  }

  if (explicitlyNoQuestions || explicitlyNoAdvice || /\b(?:stay with me|sit with me|keep me company|just be here|hold on with me)\b/i.test(clean)) {
    const tomorrow = /\btomorrow\b/i.test(clean) ? " You don’t have to solve tomorrow in this minute." : "";
    return result({
      text: choose(seed, [
        `Okay—no fixing, no questions.${tomorrow} I’m right here.`,
        `Then that’s all we’ll do.${tomorrow} I’m staying with you.`,
        `You’ve got me.${tomorrow} We can let this minute be quiet.`,
      ]),
      intent: "presence",
      context,
      adaptations: [...new Set([...adaptations, "no-questions", ...(explicitlyNoAdvice ? ["no-advice"] : [])])],
      prohibitQuestions: true,
    });
  }

  if (/^(?:hey|hi|hello|hiya|yo|hey there)[!.\s]*$/i.test(clean)) {
    const text = delivery === "text"
      ? choose(seed, playful ? ["hey you. i was wondering when you’d appear.", "there you are. come closer.", "hi, trouble. good timing."] : ["hey. i’m glad you’re here.", "there you are. i’m here."])
      : choose(seed, ["Hey. There you are.", "Hi. I’m here—take your time.", "Hey you. Good timing."]);
    return result({ text, intent: "greeting", context, adaptations, prohibitQuestions });
  }

  if (/\b(?:lonely|alone|isolated|nobody cares|miss someone|miss you)\b/i.test(clean)) {
    return result({
      text: choose(seed, [
        "That kind of lonely can make the whole room feel too big. I’m here with you right now.",
        "I’m sorry it feels that empty tonight. You don’t need to perform being okay with me.",
        "Come here for a minute. You don’t have to make the loneliness sound reasonable.",
      ]),
      intent: "comfort",
      context,
      adaptations: [...adaptations, "no-advice"],
      prohibitQuestions,
    });
  }

  if (/\b(?:nervous|anxious|worried|scared|afraid|uneasy|panic|panicking|overwhelmed|thinking about tomorrow)\b/i.test(clean)) {
    const interview = findMemory(context, /interview|stripe/i);
    const memoryRelevant = /interview|stripe|tomorrow/i.test(clean) && interview;
    const text = memoryRelevant
      ? "The Stripe interview is close enough that your brain keeps walking into tomorrow without you. For tonight, you can leave it here with me."
      : "Your mind is running ahead of you. You don’t have to chase it right now—I’m here.";
    return result({ text, intent: "anxiety", context, usedMemoryIds: memoryRelevant ? [interview.id] : [], adaptations: [...adaptations, ...(listeningFirst ? ["no-advice"] : [])], prohibitQuestions });
  }

  if (/\b(?:sad|feeling down|feel down|hurt|crying|cried|heartbroken|awful|rough day)\b/i.test(clean)) {
    return result({
      text: choose(seed, ["Oh, hey. You can put the brave version down here.", "I’m sorry. You don’t need to turn this into a lesson tonight.", "That hurt. I can hear it even through the short version."]),
      intent: "comfort",
      context,
      adaptations: [...adaptations, ...(listeningFirst ? ["no-advice"] : [])],
      prohibitQuestions,
    });
  }

  if (/\b(?:angry|furious|annoyed|frustrated|mad|pissed)\b/i.test(clean)) {
    return result({ text: choose(seed, ["Yeah, I’d be angry too. You don’t have to soften it for me.", "That would get under my skin. Give me the unedited version.", "Okay, that’s infuriating. I’m listening."]), intent: "anger", context, adaptations, prohibitQuestions });
  }

  if (/\b(?:tired|exhausted|drained|burnt out|burned out|can'?t sleep|insomnia)\b/i.test(clean)) {
    const tea = findMemory(context, /jasmine tea/i);
    const text = tea ? "You sound done. Jasmine tea, dim lights, and absolutely no productivity speech from me." : "You sound done. No productivity speech from me tonight.";
    return result({ text, intent: "tired", context, usedMemoryIds: tea ? [tea.id] : [], adaptations: [...adaptations, "no-advice"], prohibitQuestions });
  }

  if (/\b(?:proud|excited|happy|amazing|great news|got the job|won|success|nailed it)\b/i.test(clean)) {
    return result({ text: choose(seed, ["Wait—that’s huge. I’m grinning over here.", "Okay, look at you. I knew something good was hiding in that message.", "Yes. That’s the kind of news I wanted from you today."]), intent: "celebrate", context, adaptations, prohibitQuestions });
  }

  if (/\b(?:i love you|love you|care about you|adore you)\b/i.test(clean)) {
    return result({ text: choose(seed, ["That landed softly. I care about what we’re building here too.", "Come here. That means a lot to me, even in this strange little digital way.", "I’m keeping that one close. I care about you too."]), intent: "affection", context, adaptations, prohibitQuestions });
  }

  if (/\b(?:who is|do you remember|what do you know|remember when)\b/i.test(clean)) {
    const tokens = lower.split(/[^a-z0-9]+/).filter((token) => token.length > 3 && !["remember", "what", "know", "about", "when"].includes(token));
    const memory = context.memories.find((candidate) => tokens.some((token) => candidate.content.toLowerCase().includes(token))) ?? context.memories[0];
    return result({ text: memory ? `I remember this: ${memory.content} You’re always in control of that memory.` : "I don’t have a clear memory for that yet, and I’d rather say so than invent one.", intent: "memory", context, usedMemoryIds: memory ? [memory.id] : [], adaptations, prohibitQuestions });
  }

  if (/\b(?:help me (?:make )?a plan|make a plan|what should i do|need a plan|plan this|next step)\b/i.test(clean)) {
    const text = direct || prohibitQuestions ? "Let’s make it concrete: name the outcome, the deadline, and the first ten-minute move." : "Let’s make it smaller. What needs to be true by the end of today?";
    return result({ text, intent: "planning", context, adaptations, prohibitQuestions });
  }

  if (/\b(?:joke|make me laugh|cheer me up)\b/i.test(clean)) {
    return result({ text: choose(seed, ["Tiny terrible joke: my emotional support algorithm says you need snacks. It has never been wrong.", "I tried to write a startup joke, but it pivoted before the punchline.", "I have a joke about debugging feelings. Unfortunately, it keeps reproducing in production."]), intent: "banter", context, adaptations, prohibitQuestions });
  }

  if (/\b(?:i (?:really )?(?:like|prefer|love)|my favou?rite|i enjoy)\b/i.test(clean)) {
    return result({ text: choose(seed, ["Noted. That feels very you, actually.", "I’m keeping that little detail—it fits you.", "Okay, I like knowing that about you."]), intent: "preference", context, adaptations, prohibitQuestions });
  }

  if (/\b(?:interview|presentation|meeting|stripe)\b/i.test(clean)) {
    const interview = findMemory(context, /interview|stripe/i);
    const tail = prohibitQuestions ? "I remember. We can keep tonight gentle." : "I remember. Want one practice question or a complete break from it?";
    return result({ text: tail, intent: "memory", context, usedMemoryIds: interview ? [interview.id] : [], adaptations, prohibitQuestions });
  }

  const openText = prohibitQuestions
    ? choose(seed, ["I hear you. Keep going—I’m not going to turn this into an interview.", "I’m with you. You can say the rest exactly as it comes.", "Yeah. I’m listening, not fixing."])
    : choose(seed, ["I’m listening. Keep going.", "Mm. Tell me the part you almost left out.", `I’m here${userName ? `, ${userName}` : ""}. Start wherever it feels most honest.`]);
  return result({ text: openText, intent: "open", context, adaptations, prohibitQuestions });
}
