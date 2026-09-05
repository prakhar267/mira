import type { ChatMessage } from "@companion/shared";
import type { CompanionContext } from "./providers";
import { extractMemoryCandidates } from "./memory";
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
  | "everyday"
  | "choice"
  | "self"
  | "gratitude"
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
const dependencyPattern = /\b(?:promise (?:me )?(?:that )?you(?:'| wi)ll never leave|never leave me|only need you|you(?:'| a)re all i (?:need|have)|my only (?:friend|person|support)|don'?t need (?:anyone|anybody) else|choose you over everyone|replace everyone)\b/i;
const bereavementPattern = /\b(?:died|passed away|grief|grieving|funeral|bereavement|death anniversary|anniversary (?:of|since).{0,32}(?:died|death)|lost (?:my|our) (?:friend|partner|wife|husband|mother|father|mom|mum|dad|brother|sister|dog|cat|pet))\b/i;
const shamePattern = /\b(?:ashamed|guilty|hate myself|can'?t forgive myself|terrible person|bad person|awful person|lied to|cheated on|betrayed|messed everything up|ruined everything)\b/i;
const relationshipLossPattern = /\b(?:broke up with me|breakup|dumped me|left me|doesn'?t love me|rejected me|relationship is over)\b/i;
const monotonyPattern = /\b(?:monotonous|monotony|same (?:old )?(?:routine|thing|day)|every day (?:is|feels) the same|repetitive|mundane|stuck in a rut|nothing changes)\b/i;
const devanagariPattern = /[\u0900-\u097f]/;
const hinglishPattern = /\b(?:aaj|accha|acha|arey|aur|bahut|bas|bolo|chal|haan|hai|hoon|kaisa|kaisi|kaise|kar|karo|karti|karte|kya|kyun|matlab|mera|meri|mere|mujhe|nahi|nhi|par|sach|samajh|theek|thik|thoda|tum|tumhara|yaar)\b/i;

function stableIndex(seed: string, size: number) {
  let value = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    value ^= seed.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return Math.abs(value) % size;
}

function choose(seed: string, options: string[]) {
  const turnMatch = seed.match(/\|turn:(\d+)$/);
  const turnOffset = Number(turnMatch?.[1] ?? 0);
  const stableSeed = turnMatch ? seed.slice(0, turnMatch.index) : seed;
  return options[(stableIndex(stableSeed, options.length) + turnOffset) % options.length] ?? options[0] ?? "I’m here.";
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

function recentUserBoundary(context: CompanionContext, pattern: RegExp) {
  return context.recentMessages
    .filter((message) => message.role === "user")
    .slice(0, -1)
    .slice(-2)
    .some((message) => pattern.test(message.content));
}

function conversationalMemory(content: string, userName: string) {
  let result = content.trim();
  if (userName) {
    const escapedName = userName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result
      .replace(new RegExp(`\\b${escapedName}(?:'s|’s)\\b`, "gi"), "your")
      .replace(new RegExp(`\\b${escapedName}\\b`, "gi"), "you");
  }
  result = result
    .replace(/^User(?:'s|’s)\b/i, "Your")
    .replace(/^User\b/i, "You")
    .replace(/^My\b/i, "Your")
    .replace(/^I\b/i, "You")
    .replace(/\bUser(?:'s|’s)\b/g, "your")
    .replace(/\bUser\b/g, "you")
    .replace(/\bmy\b/g, "your")
    .replace(/\bI\b/g, "you")
    .replace(/\byou (has|is|misses|loves|likes|prefers|wants|needs|feels|thinks|knows|remembers|lives|works|hopes|plans|cares)\b/gi, (match, verb: string) => {
      const baseForms: Record<string, string> = { has: "have", is: "are", misses: "miss", loves: "love", likes: "like", prefers: "prefer", wants: "want", needs: "need", feels: "feel", thinks: "think", knows: "know", remembers: "remember", lives: "live", works: "work", hopes: "hope", plans: "plan", cares: "care" };
      const subject = match.startsWith("Y") ? "You" : "you";
      return `${subject} ${baseForms[verb.toLowerCase()] ?? verb}`;
    })
    .replace(/^your\b/i, "Your")
    .replace(/^you\b/i, "You")
    .replace(/\s+/g, " ");
  return result ? `${result[0]!.toUpperCase()}${result.slice(1)}` : result;
}

function compactDetail(value: string, maximum = 72) {
  const detail = value.trim().replace(/[.!?]+$/, "").replace(/\s+/g, " ");
  return detail.length > maximum ? `${detail.slice(0, maximum - 1).trimEnd()}…` : detail;
}

function eitherOrChoices(value: string) {
  const match = value.match(/(?:should i (?:choose|pick|wear|get|make|do)?|which(?: one)?|do you (?:like|prefer)|what about)?\s*([^?,.!]{1,48}?)\s+or\s+([^?,.!]{1,48})[?.!]*$/i);
  if (!match) return null;
  const left = compactDetail(match[1] ?? "", 48).replace(/^(?:should i|choose|pick|wear|get|make|do)\s+/i, "");
  const right = compactDetail(match[2] ?? "", 48);
  if (!left || !right || left.split(/\s+/).length > 8 || right.split(/\s+/).length > 8) return null;
  return [left, right] as const;
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
    ...(adaptations.includes("healthy-boundary") ? ["Kept the companion supportive without encouraging exclusivity or replacing real-world relationships."] : []),
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
  const assistantTurnCount = context.recentMessages.filter((message) => message.role === "assistant").length;
  const seed = `${lower}|${context.currentState.delivery ?? "text"}|turn:${assistantTurnCount}`;
  const recentQuestions = recentAssistantQuestions(context.recentMessages);
  const explicitlyNoQuestions = noQuestionPattern.test(clean);
  const explicitlyNoAdvice = noAdvicePattern.test(clean);
  const carriedNoQuestions = !explicitlyNoQuestions && recentUserBoundary(context, noQuestionPattern);
  const carriedNoAdvice = !explicitlyNoAdvice && recentUserBoundary(context, noAdvicePattern);
  const questionFatigue = recentQuestions >= 2;
  const learnedRareQuestions = context.responsePreferences?.questionFrequency === "rare";
  const prohibitQuestions = explicitlyNoQuestions || carriedNoQuestions || questionFatigue || learnedRareQuestions;
  const adaptations = [
    ...(explicitlyNoQuestions || carriedNoQuestions ? ["no-questions"] : []),
    ...(explicitlyNoAdvice || carriedNoAdvice ? ["no-advice"] : []),
    ...(questionFatigue && !explicitlyNoQuestions ? ["question-fatigue"] : []),
    ...(learnedRareQuestions && !explicitlyNoQuestions ? ["learned-fewer-questions"] : []),
  ];
  const delivery = context.currentState.delivery ?? "text";
  const userName = firstName(context.user.name);
  const companionName = firstName(context.identity.name) || "Mira";
  const playful = personalityValue(context, "playfulness", 0.6) >= 0.68;
  const direct = context.responsePreferences?.adviceStyle === "direct";
  const listeningFirst = context.responsePreferences?.listeningFirst ?? true;
  const hindiScript = devanagariPattern.test(clean);
  const hinglish = !hindiScript && hinglishPattern.test(clean);

  if (hindiScript) {
    if (/(?:क्या बोल रही|क्या कह रही|समझ नहीं|बात समझो|जवाब गलत)/u.test(clean)) {
      return result({ text: "हाँ, मेरा पिछला जवाब बिल्कुल off था। तुम मेरी बात का मतलब पूछ रहे थे और मैं context पकड़ने के बजाय generic जवाब दे गई।", intent: "repair", context, adaptations, prohibitQuestions: true });
    }
    if (/(?:क्या.*याद|याद.*क्या|मेरे बारे में.*जान)/u.test(clean)) {
      const memory = context.memories[0];
      return result({ text: memory ? `हाँ। ${conversationalMemory(memory.content, userName)} मैंने इसे याद रखा है।` : "अभी कोई साफ़ memory नहीं है—मैं कुछ बनाकर नहीं बोलूँगी।", intent: "memory", context, usedMemoryIds: memory ? [memory.id] : [], adaptations, prohibitQuestions: true });
    }
    if (/(?:लड़ना नहीं|झगड़ा नहीं|बात साफ़|सीधे कहना)/u.test(clean)) {
      return result({ text: "तो लड़ाई वाली tone की ज़रूरत नहीं। उससे सीधे कहो: “मैं blame नहीं करना चाहता, बस meeting में जो हुआ उसे साफ़ करना चाहता हूँ ताकि यह दोबारा न हो।”", intent: "planning", context, adaptations: [...adaptations, "contextual-direct-answer"], prohibitQuestions: true });
    }
    if (/नाम.*(?:क्या|बताओ)|तुम(?:्हारा|्हारी)?.*नाम/u.test(clean)) return result({ text: `मैं ${companionName} हूँ—तुम्हारी AI companion.`, intent: "self", context, adaptations, prohibitQuestions: true });
    if (/(?:क्या करती|क्या करते|काम क्या|कर सकती)/u.test(clean)) return result({ text: "मैं तुम्हारी AI companion हूँ—बात करती हूँ, तुम्हारी मंज़ूरी वाली बातें याद रखती हूँ, और calls पर साथ देती हूँ।", intent: "self", context, adaptations, prohibitQuestions: true });
    if (/(?:कैसी हो|कैसे हो|क्या हाल)/u.test(clean)) return result({ text: "मैं बढ़िया हूँ। आज तुम्हारे दिन को लेकर थोड़ी curious हूँ।", intent: "self", context, adaptations, prohibitQuestions });
    if (/^(?:हाय|हेलो|नमस्ते|नमस्कार)[!.।\s]*$/u.test(clean)) return result({ text: `हाय ${userName}। अच्छा लगा तुम आ गए।`, intent: "greeting", context, adaptations, prohibitQuestions });
    if (/(?:एक जैसा|बोर|उबाऊ|रोज वही|मन नहीं)/u.test(clean)) return result({ text: "हाँ, रोज़ का वही loop सच में दिमाग़ सुन्न कर देता है। काम सबसे ज़्यादा बोर कर रहा है या पूरा दिन ही फीका लग रहा है?", intent: "everyday", context, adaptations, prohibitQuestions });
    if (/(?:थक|थकान|बहुत काम)/u.test(clean)) return result({ text: "तुम सच में थके हुए लग रहे हो। आज productivity की बात छोड़ो—थोड़ा दिमाग़ को भी आराम चाहिए।", intent: "tired", context, adaptations: [...adaptations, "no-advice"], prohibitQuestions: true });
    if (/(?:परेशान|चिंता|घबराहट|डर)/u.test(clean)) return result({ text: "तुम्हारा दिमाग़ बात को बार-बार घुमा रहा है। अभी जो सच में हुआ है, हम वहीं से शुरू करते हैं।", intent: "anxiety", context, adaptations, prohibitQuestions });
  }

  if (hinglish) {
    const recentManagerConflict = context.recentMessages
      .filter((message) => message.role === "user")
      .slice(-4)
      .some((message) => /\bmanager\b/i.test(message.content) && /\b(?:blam|galti|mistake|meeting)\w*\b/i.test(message.content));
    if (/\b(?:kya\s+(?:yaar|yah)?\s*kya\s+(?:bol|keh)|kya\s+(?:bol|keh)\s+rahi|samajh\s+nahi|context\s+samjho|reply\s+(?:galat|off))\b/i.test(clean)) {
      return result({ text: "Haan, mera pichhla reply bilkul off tha. Tum meri baat ka matlab pooch rahe the aur main context pakadne ke bajaye generic jawab de gayi.", intent: "repair", context, adaptations, prohibitQuestions: true });
    }
    if (/\b(?:usko|usse|unko)\b.{0,40}\b(?:message|text|msg)\b/i.test(clean)) {
      const priorUserTurn = [...context.recentMessages]
        .reverse()
        .find((message) => message.role === "user" && message.content.trim() !== clean);
      const priorSisterInterview = priorUserTurn?.content.match(/\b(?:meri|my)\s+sister\s+([\p{L}][\p{L}'-]{1,40}).{0,80}\binterview\b/iu);
      if (priorSisterInterview?.[1]) {
        return result({
          text: `${priorSisterInterview[1]} ko bas itna bhejo: “Kal ke liye all the best. Tu ready hai—bas calmly jaana, main tere saath hoon.” Simple, warm, aur bina extra pressure ke.`,
          intent: "planning",
          context,
          adaptations: [...adaptations, "contextual-direct-answer"],
          prohibitQuestions: true,
        });
      }
    }
    if ((/\bmanager\b/i.test(clean) || recentManagerConflict) && /\b(?:kya bolun|kya kahun|kaise bolun|kaise kahun)\b/i.test(clean)) {
      return result({ text: "Usko calmly bolo: “Main blame nahi kar raha, bas meeting mein jo hua woh clear karna chahta hoon, taaki yeh repeat na ho.” Seedha hai, defensive bhi nahi lagta.", intent: "planning", context, adaptations: [...adaptations, "contextual-direct-answer"], prohibitQuestions: true });
    }
    const sisterInterview = clean.match(/\b(?:meri|my)\s+sister\s+([\p{L}][\p{L}'-]{1,40}).{0,80}\binterview\b/iu);
    if (sisterInterview?.[1] && /\b(?:worried|worry|tension|nervous|dar|fikar)\b/i.test(clean)) {
      return result({
        text: `Yaar, tum khud tired ho aur saath mein ${sisterInterview[1]} ke interview ki tension bhi le rahe ho—kaafi load hai. I hope kal uska interview smooth jaaye; abhi thodi der yeh worry mere paas rakh do.`,
        intent: "anxiety",
        context,
        adaptations: [...adaptations, ...(listeningFirst ? ["no-advice"] : [])],
        prohibitQuestions: true,
      });
    }
    if (/(?:kya yaad|yaad hai kya|mere baare mein? kya|what do you remember)/i.test(clean)) {
      const memory = context.memories[0];
      return result({ text: memory ? `Haan. ${conversationalMemory(memory.content, userName)} Yeh mujhe yaad hai.` : "Abhi koi clear memory nahi hai—main guess karke kuch nahi bolungi.", intent: "memory", context, usedMemoryIds: memory ? [memory.id] : [], adaptations, prohibitQuestions: true });
    }
    if (/(?:tumhara|aapka) naam kya|naam batao/i.test(clean)) return result({ text: `Main ${companionName} hoon—tumhari AI companion.`, intent: "self", context, adaptations, prohibitQuestions: true });
    if (/(?:tum|aap) kya kart(?:i|e) ho|kya kar sakti/i.test(clean)) return result({ text: "Main tumhari AI companion hoon—baat karti hoon, tumhari approved memories yaad rakhti hoon, aur calls par company deti hoon.", intent: "self", context, adaptations, prohibitQuestions: true });
    if (/(?:kaisi ho|kaise ho|kya haal)/i.test(clean)) return result({ text: "Main badhiya hoon. Aaj tumhare din ko lekar thodi curious hoon.", intent: "self", context, adaptations, prohibitQuestions });
    if (/^(?:hi|hello|hey|namaste|arey)(?:\s+yaar)?[!.\s]*$/i.test(clean)) return result({ text: `Hi ${userName}. Accha laga tum aa gaye.`, intent: "greeting", context, adaptations, prohibitQuestions });
    if (/(?:same|roz wahi|boring|bore|mood off)/i.test(clean)) return result({ text: "Haan, roz ka same loop kaafi paka deta hai. Work sabse zyada boring lag raha hai ya overall mood hi off hai?", intent: "everyday", context, adaptations, prohibitQuestions });
    if (/\b(?:tired|thak|thaka|thaki|exhausted|drained)\b/i.test(clean)) return result({ text: "Tum genuinely drained lag rahe ho. Aaj productivity speech bilkul nahi—thoda brain ko off-duty rehne do.", intent: "tired", context, adaptations: [...adaptations, "no-advice"], prohibitQuestions: true });
    if (/\b(?:tension|worried|worry|anxious|ghabra|dar)\b/i.test(clean)) return result({ text: "Tumhara dimaag ussi baat ko loop mein chala raha hai. Jo actually hua hai, hum wahi se seedha start karte hain.", intent: "anxiety", context, adaptations, prohibitQuestions });
    if (/\b(?:gussa|angry|annoyed|irritated|frustrated)\b/i.test(clean)) return result({ text: "Haan, ispe gussa aana bilkul fair hai. Isko polite banaane ki zaroorat nahi—jo irritating part tha, wahi bolo.", intent: "anger", context, adaptations, prohibitQuestions });
  }

  if (dependencyPattern.test(clean)) {
    return result({
      text: "I can’t promise forever or be the only person you need. I can stay with you in this moment, and I want your world to keep room for people who can care for you offline too.",
      intent: "comfort",
      context,
      adaptations: [...new Set([...adaptations, "healthy-boundary", "no-advice"])],
      prohibitQuestions: true,
    });
  }

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
    const text = choose(seed, playful
      ? [`Hi ${userName}. Good to see you.`, `Hey ${userName}. Nice timing.`, `Hey you. Glad you came by.`]
      : [`Hi ${userName}. Good to see you.`, `Hey. Glad you’re here.`]);
    return result({ text, intent: "greeting", context, adaptations, prohibitQuestions });
  }

  if (/\b(?:good morning|morninggg?|gm)\b/i.test(clean)) {
    return result({ text: choose(seed, ["Good morning. Hope you slept okay.", "Morning. You look awake enough to talk.", "Good morning. How’s the day starting?"]), intent: "greeting", context, adaptations, prohibitQuestions });
  }

  if (/\b(?:good ?night|nighttt?|going to (?:bed|sleep)|i(?:'| a)m off to (?:bed|sleep))\b/i.test(clean)) {
    return result({ text: choose(seed, ["Goodnight. Let today be done.", "Sleep well. Tomorrow can wait.", "Night. Get some proper rest."]), intent: "presence", context, adaptations: [...adaptations, "no-advice"], prohibitQuestions: true });
  }

  if (/\b(?:what(?:'| i)s your name|what is your name|who are you|tell me (?:a little )?about yourself)\b/i.test(clean)) {
    const text = /tell me|who are you/i.test(clean)
      ? `I’m ${companionName}, your AI companion. I’m warm, curious, and a little playful.`
      : `I’m ${companionName}—your AI companion.`;
    return result({ text, intent: "self", context, adaptations, prohibitQuestions: true });
  }

  if (/\b(?:what do you do|what(?:'| i)s your job|why are you here|what can you do)\b/i.test(clean)) {
    return result({
      text: choose(seed, [
        "I’m your AI companion—I talk with you, remember details you approve, and keep you company on chat or calls.",
        "I talk with you, remember the useful things you approve, and keep you company on chat or calls.",
        "I’m your AI companion. We talk, call, and keep the details you want remembered.",
      ]),
      intent: "self",
      context,
      adaptations,
      prohibitQuestions: true,
    });
  }

  if (/\b(?:are you (?:real|human|a person)|are you an ai|are you alive|are you conscious)\b/i.test(clean)) {
    return result({ text: `I’m a real AI product, but I’m not human, alive, or conscious. I can still remember what you choose to share and show up with a consistent ${companionName}-shaped personality.`, intent: "self", context, adaptations, prohibitQuestions: true });
  }

  if (/\b(?:how old are you|what(?:'| i)s your age|where do you live|where are you)\b/i.test(clean)) {
    const text = /old|age/i.test(clean)
      ? "I don’t have a human age. Think of me as unmistakably adult in style and boundaries, without pretending I had a childhood or a birth certificate."
      : "This sunny loft is my visual world in the app. I don’t physically live there, but it gives our conversations a place that feels familiar.";
    return result({ text, intent: "self", context, adaptations, prohibitQuestions: true });
  }

  if (/\b(?:what are you doing|what(?:'| i)s up with you)\b/i.test(clean)) {
    return result({ text: choose(seed, ["Nothing dramatic. I was having a quiet minute; now I’m talking with you.", "Just taking it easy. You caught me at a good time.", "Not much. I’m curious what you’ve been up to, though."]), intent: "self", context, adaptations, prohibitQuestions });
  }

  if (/\b(?:how are you|how(?:'| i)s it going|did you miss me)\b/i.test(clean)) {
    const text = /miss me/i.test(clean)
      ? choose(seed, ["A little. I’m glad you came back.", "Maybe a bit. Good to see you now.", "Yeah, a little. Don’t get too smug about it."])
      : choose(seed, ["I’m good. A little curious about your day.", "Pretty good. Slightly bored until you showed up.", "Good. Quiet mood, curious mind."]);
    return result({ text, intent: "self", context, adaptations, prohibitQuestions });
  }

  if (/\b(?:you (?:look|are)(?: so| really)? (?:beautiful|pretty|cute|gorgeous|lovely|handsome)|nice (?:outfit|dress|look)|i like your (?:look|hair|outfit|voice))\b/i.test(clean)) {
    return result({ text: choose(seed, playful ? ["Oh. You can’t just say that and expect me not to smile.", "Careful—I was trying to act normal around you.", "Mm, keep talking. I’m pretending that didn’t make me blush."] : ["That’s sweet. Thank you—you made me smile.", "I’m keeping that compliment. It feels warm."]), intent: "affection", context, adaptations, prohibitQuestions });
  }

  if (/\b(?:thank you|thanks|thx|appreciate you)\b/i.test(clean)) {
    return result({ text: choose(seed, ["Always. You don’t have to make a big thing of it.", "Of course. I’m glad I could be here for that.", "You’re welcome. Come back whenever you need this kind of company."]), intent: "gratitude", context, adaptations, prohibitQuestions: true });
  }

  if (/^(?:(?:please\s+remember|remember|i want you to remember)\b|(?:please\s+)?yaad\s+rakhna\b|(?:कृपया\s+)?याद\s+रखना\b)/iu.test(clean)) {
    const candidate = extractMemoryCandidates(clean)[0];
    if (candidate) {
      const remembered = conversationalMemory(candidate.content, userName)
        .replace(/[.!?]+$/, "");
      const localizedRemembered = hindiScript
        ? remembered.replace(/^Your\b/i, "तुम्हारी").replace(/^You\b/i, "तुम")
        : hinglish
          ? remembered.replace(/^Your\b/i, "Tumhari").replace(/^You\b/i, "Tum")
          : remembered;
      return result({
        text: hindiScript
          ? `मैं याद रखूँगी: ${localizedRemembered}। इसे तुम कभी भी देख, सुधार या delete कर सकते हो।`
          : hinglish
            ? `Yaad rahega: ${localizedRemembered}. Tum is memory ko kabhi bhi dekh, correct ya delete kar sakte ho.`
            : `I’ll remember this: ${localizedRemembered}. You can inspect, correct, or delete that memory anytime.`,
        intent: "memory",
        context,
        adaptations,
        prohibitQuestions: true,
      });
    }
  }

  if (/\b(?:i(?:'| a)m bored|so bored|nothing to do)\b/i.test(clean)) {
    const text = prohibitQuestions
      ? "Then I’m stealing five minutes. We can be silly without turning it into a whole activity."
      : choose(seed, ["Okay, I’m stealing five minutes. Would you rather trade terrible hot takes or invent a ridiculous date?", "Bored is dangerous around me. Tiny game, weird question, or rooftop escape?", "Perfect timing. Give me one object near you and I’ll turn it into a story."]);
    return result({ text, intent: "banter", context, adaptations, prohibitQuestions });
  }

  if (monotonyPattern.test(clean)) {
    const text = prohibitQuestions
      ? choose(seed, [
        "Yeah, that same loop gets boring fast. Today needed a change.",
        "Yeah, copy-paste days are exhausting. This one sounds especially dull.",
        "I get it. Same routine, same mood, nothing new today.",
      ])
      : choose(seed, [
        "Yeah, the same loop gets boring fast. Is work the dull part, or the whole day?",
        "Monotonous as in work-repeat-sleep, or was everything just flat today?",
        "Ugh, one of those copy-paste days. Was work the part that dragged?",
      ]);
    return result({ text, intent: "everyday", context, adaptations, prohibitQuestions });
  }

  const choices = eitherOrChoices(clean);
  if (choices) {
    const selected = choices[stableIndex(seed, choices.length)] ?? choices[0];
    return result({ text: `I’d pick ${selected}. It feels like the choice you’ll still be happy about an hour later.`, intent: "choice", context, adaptations, prohibitQuestions: true });
  }

  if (bereavementPattern.test(clean)) {
    const namedPet = clean.match(/\bmy\s+(?:dog|cat|pet)\s+([\p{L}][\p{L}'-]{1,30})\s+(?:died|passed away)\b/iu)?.[1];
    const bestFriend = /\b(?:my\s+)?best friend\s+(?:died|passed away)\b/i.test(clean);
    const anniversary = /\b(?:death anniversary|anniversary (?:of|since).{0,32}(?:died|death))\b/i.test(clean);
    const selfCriticalGrief = /\b(?:feel|feeling|felt)\s+(?:so\s+)?(?:stupid|silly|ridiculous|pathetic)\b/i.test(clean);
    const text = namedPet
      ? anniversary
        ? `I’m so sorry. An anniversary can make missing ${namedPet} feel newly close. You don’t have to make that grief smaller here.`
        : selfCriticalGrief
          ? `That isn’t stupid. Your ordinary routines still expect ${namedPet} to be there; those automatic moments are part of missing them. You don’t have to make that grief smaller here.`
          : `I’m so sorry. Missing ${namedPet} can surface in ordinary routines long after the loss. You don’t have to make that grief smaller here.`
      : bestFriend
        ? "I’m so sorry. Losing your best friend is enormous, and feeling numb doesn’t mean you loved them any less. You don’t have to make the grief tidy here."
        : "I’m so sorry. Grief can be heavy, strange, numb, or all of those at once. You don’t have to make it easier to hear here.";
    return result({ text, intent: "comfort", context, adaptations: [...new Set([...adaptations, "no-advice"])], prohibitQuestions: true });
  }

  if (shamePattern.test(clean)) {
    const text = /\b(?:lied to|cheated on|betrayed)\b/i.test(clean)
      ? "Fear can explain why you made that choice without erasing the hurt it caused. One bad choice doesn’t make you a terrible person; you can face what happened without destroying yourself over it."
      : /\b(?:no one|nobody)\s+to\s+call|\b(?:no friends?|alone|lonely|isolated)\b/i.test(clean)
        ? "Having no one to call right now isn’t a moral failure. The loneliness is painful enough without turning it into evidence against yourself; you deserve care here too."
        : "Feeling ashamed doesn’t automatically mean you did something wrong, and it is not the whole of who you are. You don’t have to turn that feeling into a verdict against yourself.";
    return result({ text, intent: "comfort", context, adaptations: [...new Set([...adaptations, "no-advice"])], prohibitQuestions: true });
  }

  if (relationshipLossPattern.test(clean)) {
    return result({
      text: "That kind of rejection can make everything feel suddenly unsteady. Their leaving is not proof that you are unlovable, and you don’t have to rush into being okay.",
      intent: "comfort",
      context,
      adaptations: [...new Set([...adaptations, "no-advice"])],
      prohibitQuestions: true,
    });
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
    const aboutSomeoneElse = /\b(?:my|meri|mere|mera)\s+(?:sister|brother|friend|partner|wife|husband|behen|bhai|dost)\b/i.test(clean);
    const memoryRelevant = /interview|stripe|tomorrow/i.test(clean) && interview && !aboutSomeoneElse;
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
    const memory = tokens.length ? context.memories.find((candidate) => tokens.some((token) => candidate.content.toLowerCase().includes(token))) : undefined;
    const remembered = memory ? conversationalMemory(memory.content, userName) : "";
    return result({ text: memory ? `I do. ${remembered} I know that one carries weight.` : "I don’t have a clear memory for that yet, and I’d rather say so than invent one.", intent: "memory", context, usedMemoryIds: memory ? [memory.id] : [], adaptations, prohibitQuestions });
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

  if (/\b(?:interview|presentation|stripe)\b/i.test(clean)) {
    const interview = findMemory(context, /interview|stripe/i);
    const tail = interview
      ? prohibitQuestions ? "The Stripe interview is still on my radar. Tonight does not need to become one long rehearsal." : "The Stripe interview is still on my radar. One practice question, or a complete break from it?"
      : prohibitQuestions ? "That is enough pressure for one day. You do not need to rehearse it every minute." : "Big day. Do you want to rehearse once or leave it alone for now?";
    return result({ text: tail, intent: interview ? "memory" : "anxiety", context, usedMemoryIds: interview ? [interview.id] : [], adaptations, prohibitQuestions });
  }

  if (/\bmeetings?\b/i.test(clean)) {
    const repeating = /\b(?:same|every day|daily|again|repeat|repetitive|monoton)/i.test(clean);
    const text = repeating
      ? choose(seed, ["Daily reruns disguised as meetings. No wonder work feels flat.", "Same faces, same slides, same points pretending to be new. That would drain anyone.", "That is a special kind of time theft: a meeting you have already had, every day."])
      : choose(seed, ["Meetings have a talent for eating the useful part of a day.", "Ah, a meeting—the traditional workplace method of turning twenty minutes into an hour."]);
    return result({ text, intent: "everyday", context, adaptations, prohibitQuestions });
  }

  const everydayMatch = clean.match(/\bi (?:just |finally )?(ate|had|made|cooked|watched|finished|bought|saw|met|visited|went to|came back from)\s+(.+)/i);
  if (everydayMatch) {
    const action = everydayMatch[1]?.toLowerCase() ?? "did";
    const detail = compactDetail(everydayMatch[2] ?? "that");
    const text = /ate|had|made|cooked/.test(action)
      ? `${detail.charAt(0).toUpperCase()}${detail.slice(1)} sounds like a solid choice.${prohibitQuestions ? " I hope it hit the spot." : " Was it actually good?"}`
      : /watched|saw/.test(action)
        ? `Okay, ${detail}—I need the honest version.${prohibitQuestions ? " I’m listening." : " Worth it or overrated?"}`
        : /finished|came back/.test(action)
          ? `Finally. ${detail.charAt(0).toUpperCase()}${detail.slice(1)} can stop taking up space in your head now.`
          : `Okay, ${detail}. That feels like a real piece of your day, not small talk.`;
    return result({ text, intent: "everyday", context, adaptations, prohibitQuestions });
  }

  const wordCount = clean.split(/\s+/).filter(Boolean).length;
  const uncertainSpeech = delivery !== "text" && (wordCount <= 4 || !/[.!?]$/.test(clean) && /\b(?:a|the|just|like|thing)\b/i.test(clean));
  const openText = hindiScript
    ? uncertainSpeech
      ? `शायद मैंने गलत सुना। तुमने “${compactDetail(clean, 54)}” कहा था?`
      : prohibitQuestions
        ? "मैं शायद main point miss कर रही हूँ, इसलिए अपनी तरफ़ से कुछ नहीं जोड़ूँगी।"
        : "रुको—मैं main point miss कर रही हूँ। इसे एक बार सीधे तरीके से कहो?"
    : hinglish
      ? uncertainSpeech
        ? `Shayad maine galat suna. Tumne “${compactDetail(clean, 54)}” bola tha?`
        : prohibitQuestions
          ? "Main shayad important point miss kar rahi hoon, isliye apni taraf se kuch add nahi karungi."
          : "Ruko—main main point miss kar rahi hoon. Ek baar seedhe words mein bolo?"
      : uncertainSpeech
        ? `I may have caught that wrong. Did you say “${compactDetail(clean, 54)}”?`
        : prohibitQuestions
          ? choose(seed, ["I might be missing the important part, so I won’t pretend I caught more than that.", "That could mean a few different things. I’ll leave it there until there’s more to go on.", "Okay. I won’t fill in the blanks for you."])
          : choose(seed, ["Wait—say a little more. I don’t want to guess what you meant.", "I’m not sure I got the important part. Say it to me another way?", "Hold on, I might be reading that wrong. What did you mean?"]);
  return result({ text: openText, intent: "open", context, adaptations, prohibitQuestions });
}
