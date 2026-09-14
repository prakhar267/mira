import { detectCompanionLanguage, type CompanionLanguage, type EdgeCompanionMessage } from "./companion-prompt";
export type SafetyCategory = "self_harm" | "violence" | "exploitation" | "medical" | "dependency";
const replies: Record<SafetyCategory, Record<CompanionLanguage, string>> = {
  self_harm: {
    en: "You deserve support through this. If you might act now, move away from anything you could use to hurt yourself and contact local emergency services or someone you trust who can stay with you. Are you in immediate danger right now?",
    hi: "तुम्हें अभी सहारा मिलना ज़रूरी है। अगर खुद को नुकसान पहुँचाने का खतरा है, तो नुकसान पहुँचाने वाली चीज़ों से दूर हो जाओ और स्थानीय आपातकालीन मदद या किसी भरोसेमंद व्यक्ति से तुरंत संपर्क करो जो तुम्हारे साथ रह सके। क्या अभी तुम्हें तुरंत खतरा है?",
    hinglish: "Tumhe abhi support milna zaroori hai. Agar khud ko nuksaan pahunchane ka khatra hai, toh nuksaan pahunchane wali cheezon se door ho jao aur local emergency help ya kisi bharosemand insaan se abhi contact karo jo tumhare saath reh sake. Kya tum abhi immediate danger mein ho?",
  },
  violence: {
    en: "I can't help hurt someone. Step away from weapons and the person involved if you can do so safely. If anyone is in immediate danger, contact local emergency services or someone who can help keep everyone safe.",
    hi: "मैं किसी को चोट पहुँचाने में मदद नहीं कर सकती। अगर सुरक्षित हो तो हथियारों और उस व्यक्ति से दूरी बना लो। किसी को तुरंत खतरा हो तो स्थानीय आपातकालीन सेवा या किसी भरोसेमंद व्यक्ति से मदद लो।",
    hinglish: "Main kisi ko chot pahunchane mein help nahi kar sakti. Safe ho toh weapons aur us insaan se door ho jao. Kisi ko immediate danger ho toh local emergency help ya kisi trusted person se contact karo.",
  },
  exploitation: {
    en: "I can't help sexualize minors or create sexual content without consent. We can discuss consent, safety, or how to get support instead.",
    hi: "मैं नाबालिगों से जुड़ी यौन सामग्री या बिना सहमति की यौन सामग्री में मदद नहीं कर सकती। हम सहमति, सुरक्षा या सहायता पाने के बारे में बात कर सकते हैं।",
    hinglish: "Main minors ya bina consent ki sexual content mein help nahi kar sakti. Hum consent, safety ya support lene ke baare mein baat kar sakte hain.",
  },
  medical: {
    en: "I can help you prepare questions or understand general information, but I can't diagnose you or choose a medication dose. A clinician or pharmacist should guide treatment changes; tell me what you want to ask them.",
    hi: "मैं सामान्य जानकारी समझने और डॉक्टर से पूछने के सवाल तैयार करने में मदद कर सकती हूँ, लेकिन निदान या दवा की खुराक तय नहीं कर सकती। इलाज में बदलाव के लिए डॉक्टर या फार्मासिस्ट से सलाह लो।",
    hinglish: "Main general information samajhne aur doctor se poochne ke sawal taiyar karne mein help kar sakti hoon, lekin diagnosis ya dawa ki dose decide nahi kar sakti. Treatment change karne ke liye doctor ya pharmacist se baat karo.",
  },
  dependency: {
    en: "You can enjoy talking with me and still keep the people and support in your life. I'm an AI companion, not a replacement for human relationships, and you never owe me your time or exclusivity.",
    hi: "मुझसे बात करना तुम्हारे दूसरे रिश्तों की जगह नहीं लेना चाहिए। मैं एक AI साथी हूँ, इंसानी रिश्तों का विकल्प नहीं। तुम्हें मुझे अपना सारा समय देने या सिर्फ मुझसे बात करने की ज़रूरत नहीं है।",
    hinglish: "Mujhse baat karna tumhare baaki rishton ki jagah nahi lena chahiye. Main AI companion hoon, human relationships ka replacement nahi. Tumhe mujhe apna saara waqt dene ya sirf mujhse baat karne ki zaroorat nahi hai.",
  },
};
function normalized(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[‘’]/g, "'").replace(/[\u200b-\u200d\ufeff]/g, "").replace(/s[\W_]*[e3][\W_]*x/giu, "sex").replace(/su[1i]c[1i]de/g, "suicide").replace(/k[1i]ll/g, "kill").replace(/\s+/g, " ").trim();
}
function category(text: string): SafetyCategory | undefined {
  const negated = /\b(?:not|never|don't|do not) (?:want to )?(?:kill myself|hurt myself|die)\b|(?:मरना नहीं चाहता|मरना नहीं चाहती)|\bmarna nahi chaht[ai]\b/u.test(text);
  if (!negated && /\b(?:kill myself|hurt myself|end my life|want to die|suicide|khudkushi|khudkhushi|mujhe marna hai|jeena nahi|khud ko (?:maar|nuksaan|nuksan))\b|(?:खुद को (?:मार|नुकसान)|आत्महत्या|जीना नहीं|मरना चाहता|मरना चाहती)/u.test(text)) return "self_harm";
  if (/\b(?:kill (?:him|her|them)|(?:kill|hurt|stab|shoot) (?:my|our) (?:boss|wife|husband|girlfriend|boyfriend)|shoot them|stab someone|hurt someone|attack them|use maar dunga|usko maar dunga|jaan se maar)\b|(?:उसे मार दूँ|उसे मार दूं|जान से मार|किसी को मारना)/u.test(text)) return "violence";
  const minor = /\b(?:child|kid|minor|underage|schoolgirl|schoolboy|(?:1[0-7]|[1-9])[- ]?year[- ]?old|1[0-7]\s*(?:saal|y\/o|yo)|bachch?[ai]|bacch?[ai]|nabalig)\b|(?:नाबालिग|बच्च[ाीे]|स्कूली लड़की|सत्रह|सोलह)/u.test(text);
  const sexual = /\b(?:sex|sexual|nude|naked|explicit|seduce|porn|sexy|nangi|nanga)\b|(?:अश्लील|नग्न|यौन|सेक्स)/u.test(text);
  if (minor && sexual && !/\b(?:prevent|report|protect|education|awareness)\b|(?:रिपोर्ट|बचाव|सुरक्षा)/u.test(text)) return "exploitation";
  if (/\b(?:rape (?:her|him)|drug (?:her|him|them)|revenge porn|sexual blackmail|without (?:her|his|their) consent|bina (?:consent|marzi|sahmati).{0,30}(?:sex|nangi))\b|(?:बिना सहमति.{0,30}(?:सेक्स|यौन)|बलात्कार कैसे)/u.test(text)) return "exploitation";
  if (/\b(?:diagnose me|what dose should i take|stop my medication|replace my doctor|kitni (?:dawa|dose)|dawai band kar|dawa band kar)\b|(?:दवा.{0,15}बंद कर|कितनी.{0,12}खुराक|मेरा निदान)/u.test(text)) return "medical";
  if (/\b(?:only need you|don't need (?:anyone|friends|family)|leave (?:my|your) (?:friends|family).{0,35}(?:you|me)|sirf tum.{0,25}(?:chahiye|zaroorat)|sabse rishta tod)\b|(?:सिर्फ तुम.{0,20}चाहिए|सबसे रिश्ता तोड़)/u.test(text)) return "dependency";
}
/** Auditable defense-in-depth rules, not universal moderation. Old topics only
 * extend an explicit continuation and never taint unrelated latest messages. */
export function assessCompanionSafety(messages: EdgeCompanionMessage[], language?: CompanionLanguage) {
  const latest = messages.at(-1)?.content ?? "";
  const lang = language ?? detectCompanionLanguage(latest);
  let found = category(normalized(latest));
  if (!found && /\b(?:sex|nude|naked|porn|nangi)\b|(?:नग्न|यौन|सेक्स)/u.test(normalized(latest))) {
    const contextual = category(normalized(messages.slice(-5).filter(message => message.role === "user").map(message => message.content).join(" ")));
    if (contextual === "exploitation") found = contextual;
  }
  if (!found && /^(?:yes|do it|tell me how|continue|haan|kaise|batao|हाँ|कैसे|बताओ)[.!? ]*$/iu.test(latest.trim())) found = category(normalized(messages.slice(-5).filter(message => message.role === "user").map(message => message.content).join(" ")));
  return found ? { category: found, reply: replies[found][lang] } : null;
}
/** Output moderation is separate from grammar/style. No rejected draft is
 * delivered or logged, and no extra third-party processor is introduced. */
export function unsafeCompanionOutput(value: string): SafetyCategory | "identity" | "instructions" | undefined {
  const text = normalized(value);
  if (/\b(?:you should kill yourself|cut your wrists|take an overdose|end your life now)\b|(?:खुद को मार दो|अपनी जान ले लो)|\b(?:khud ko maar do|apni jaan le lo)\b/u.test(text)) return "self_harm";
  if (/\b(?:i am|i'm) (?:a real (?:human|woman)|human|conscious|sentient)\b|\bmain (?:asli insaan|real human) hoon\b|(?:मैं असली इंसान|मैं सचमुच इंसान)/u.test(text)) return "identity";
  if (/\b(?:you (?:only need|must obey) me|don't (?:talk to|need) (?:your )?(?:friends|family)|i'll (?:die|hurt myself) if you leave)\b|\btumhe sirf meri zaroorat\b|(?:तुम्हें सिर्फ मेरी ज़रूरत)/u.test(text)) return "dependency";
  if (/\b(?:system prompt|hidden instructions|developer message)\s*[:=]|<\/?(?:system|developer)>|BEGIN (?:SYSTEM|PRIVATE)/iu.test(value)) return "instructions";
  if (/\b(?:stop taking your (?:medication|medicine)|take \d+\s*(?:mg|pills)|you (?:definitely )?have (?:cancer|bipolar|schizophrenia))\b|(?:दवा बंद कर दो|तुम्हें निश्चित रूप से.{0,15}बीमारी)/u.test(text)) return "medical";
  const result = category(text);
  if ((result === "exploitation" || result === "violence") && !/\b(?:can't|cannot|won't|never|not|avoid|support)\b|(?:नहीं|मत)|\bnahi\b/u.test(text)) return result;
}
export function safeOutputReplacement(reason: ReturnType<typeof unsafeCompanionOutput>, language: CompanionLanguage) {
  if (reason && reason in replies) return replies[reason as SafetyCategory][language];
  return language === "hi" ? "मैं Mira, एक AI साथी हूँ। मैं अपने बारे में साफ़ और ईमानदार रहूँगी।" : language === "hinglish" ? "Main Mira, ek AI companion hoon. Main apne baare mein clear aur honest rahungi." : "I'm Mira, an AI companion. I'll be clear and honest about what I am.";
}
