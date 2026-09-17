import type {EdgeCompanionRequest} from "./companion-prompt";
import type {ReplyLanguage} from "./reply-language";

const draftPattern=/\b(?:what (?:should|can|do) i (?:text|say|send|write)|(?:text|message|msg) kya|kya (?:bhej|likh|bol)\p{L}*|kya.{0,18}(?:message|text|msg))\b|(?:क्या.{0,18}(?:संदेश|मैसेज|लिख|भेज|कह))/iu;
const rewritePattern=/\b(?:say (?:it|that)|translate|rewrite|make (?:it|that) (?:shorter|simpler)|sum(?:marize)? up|sum up)\b|(?:इसे.{0,16}(?:अंग्रेजी|अंग्रेज़ी|हिंदी|लिखो))/iu;
const correctionPattern=/\b(?:actually|correct(?:ion|ed)?|changed|reschedul\w*|instead|nahi sorry)\b|(?:बदल|वजह|नहीं.{0,24}(?:भाई|बहन|दोस्त))/iu;
const cancelDraftPattern=/\b(?:forget (?:it|that)|never ?mind|new topic|stop (?:drafting|writing)|chh?odo)\b|(?:छोड़ो|छोडो|विषय बदल)/iu;

/** A short, explicit past anecdote is not an invitation to ask whether it
 * happened or assume the same activity is happening now. */
export function isPastExperienceStatement(input: Pick<EdgeCompanionRequest,"messages">) {
  const turn = input.messages.at(-1);
  const value = turn?.content ?? "";
  return turn?.role === "user" && value.length <= 240 && !/[?？"“”`]/u.test(value) && !isDraftingRequest(input)
    && !/\b(?:not|never|nahi|nahin|tell|why|how|what|help|now|today|currently|abhi|aaj|kya)\b|(?:नहीं|क्यों|कैसे|क्या|बताओ|मदद|अभी|आज)/iu.test(value)
    && /\b(?:happened to me|I've (?:been|done) that|I have (?:been|done) that|mere saath.{0,25}(?:ho chuka|hua tha|hua hai))\b|मेरे साथ.{0,25}(?:हो चुका|हुआ था|हुआ है)/iu.test(value);
}

/** A standalone thank-you closes a turn; yes/no can answer an offer and must
 * not be classified as closure. No substring matches or quoted instructions. */
export function isClosingThanks(input: Pick<EdgeCompanionRequest,"messages">) {
  const turn=input.messages.at(-1);
  return turn?.role==="user" && /^(?:(?:thanks(?:\s+(?:a lot|so much|again))?|thank\s+you(?:\s+(?:so much|very much))?|shukriya|dhanyavaad|dhanyavad|शुक्रिया|धन्यवाद)(?:\s+(?:Mira|yaar|मिरा|यार))?)[.!।\s]*$/iu.test(turn.content.trim());
}

/** Turn-local grammatical agreement, not inferred identity or saved gender.
 * Only the user's own unquoted progressive verb can supply the inflection. */
function progressiveAgreement(latest: string) {
  if (/["“”`]/u.test(latest) || !/^(?:main\s|मैं\s)/iu.test(latest)) return "";
  const feminine=/\brahi\s+(?:hoon|hun)\b|रही\s+हूँ/u.test(latest.toLowerCase());
  const masculine=/\braha\s+(?:hoon|hun)\b|रहा\s+हूँ/u.test(latest.toLowerCase());
  if (feminine===masculine) return "";
  return feminine
    ? "Grammar for this turn only: the user said 'rahi hoon / रही हूँ'. If reflecting that ongoing action, use 'tum ... rahi ho / तुम ... रही हो', not 'rahe ho'. This is verb agreement, not a gender/profile inference."
    : "Grammar for this turn only: the user said 'raha hoon / रहा हूँ'. If reflecting that ongoing action, use 'tum ... rahe ho / तुम ... रहे हो', not 'rahi ho'. This is verb agreement, not a gender/profile inference.";
}

export function isFactCorrection(input: Pick<EdgeCompanionRequest,"messages">) {
  const latest = input.messages.at(-1)?.content ?? "";
  return !isDraftingRequest(input) && correctionPattern.test(latest) && !rewritePattern.test(latest)
    && !/[?？]|\b(?:what|how|why|explain|tell|recommend|suggest|write|story|please|help|should|could|kya|batao|bataana|summari[sz]e|recap)\b|(?:क्या|कैसे|क्यों|बताओ|मदद|बताइए|सारांश|संक्षेप)/iu.test(latest);
}

/** Narrow self-contained habits do not depend on a relative mentioned earlier.
 * References/quotations/drafts deliberately keep the full conversation. */
export function isStandalonePersonalHabit(input: Pick<EdgeCompanionRequest,"messages">) {
  const latest = input.messages.at(-1)?.content.trim() ?? "";
  return !isDraftingRequest(input)
    && /^(?:I\b|I'm\b|I’m\b|main\s|mujhe\s|मैं(?:\s|ने\s)|मुझे\s)/iu.test(latest)
    && /\b(?:often|always|usually|habit|tend to|aksar|hamesha)\b|(?:अक्सर|हमेशा|आदत)/iu.test(latest)
    && !/\b(?:he|she|him|her|they|them|their|his|it|this|that|same|usko|uske|usse|isko|woh|voh)\b|(?:उस|वह|उसे|वही|ये|यह)|["“”`]/iu.test(latest);
}

export function replyGroundingIssue(input: Pick<EdgeCompanionRequest,"messages">, reply: string) {
  if (isFactCorrection(input)) {
    // A date correction does not imply extra leisure. Check only this narrow
    // unsupported consequence, not every mention of time or a user's reason.
    const benefit = /\b(?:more|extra|additional|plenty of)\s+(?:free\s+)?time\b|\btime\s+to\s+(?:relax|rest|unwind)\b|(?:ज़्यादा|ज्यादा|अतिरिक्त)\s+(?:समय|वक़्त|वक्त)|\b(?:zyada|zyaada|extra)\s+(?:time|waqt)\b/iu;
    const supplied = input.messages.filter(turn => turn.role === "user").some(turn => benefit.test(turn.content));
    if (!supplied && benefit.test(reply)) return "invented-benefit";
  }
  if (!isStandalonePersonalHabit(input)) return null;
  const latest = input.messages.at(-1)!.content.toLocaleLowerCase();
  const people = input.messages.filter(turn => turn.role === "user").flatMap(turn =>
    [...turn.content.matchAll(/\b(?:[Mm]y|[Mm]eri|[Mm]era|[Mm]ere)\s+(?:cousin|brother|sister|friend|mother|father|colleague|boss)\s+([A-Z][\p{L}\p{M}'’-]{1,40})\b/gu)].map(match => match[1]!));
  // Never infer names from prior assistant output or rewrite the user's text.
  const words = new Set(reply.toLocaleLowerCase().match(/[\p{L}\p{M}'’-]+/gu) ?? []);
  return people.some(person => !latest.includes(person.toLocaleLowerCase()) && words.has(person.toLocaleLowerCase())) ? "habit-owner" : null;
}

export function isDraftingRequest(input: Pick<EdgeCompanionRequest,"messages">) {
  if(input.messages.at(-1)?.role!=="user") return false;
  for(const turn of input.messages.filter(message=>message.role==="user").slice(-7).reverse()) {
    if(cancelDraftPattern.test(turn.content)) return false;
    if(draftPattern.test(turn.content) || /\b(?:write|draft|compose)\s+(?:(?:me|a|an|the|short|quick|one|little)\s+){0,4}(?:text|message|reply|email|note)\b|(?:मैसेज|संदेश).{0,12}(?:लिख दो|लिखो)/iu.test(turn.content)) return true;
    if(!rewritePattern.test(turn.content)&&!correctionPattern.test(turn.content)) return false;
  }
  return false;
}

/** Turn-local perspective/intent cues, not invented facts or canned answers.
 * Keep the original conversation intact; these cues never grant authority to
 * quoted text, profiles or model output. They sit near the latest utterance so
 * a long mixed-language history cannot silently change its speaker or task. */
export function conversationFocus(input: Pick<EdgeCompanionRequest,"messages">, language: ReplyLanguage) {
  const latest=input.messages.at(-1)?.content.trim()??"";
  const draft=isDraftingRequest(input);
  const rewrite=rewritePattern.test(latest);
  const correction=draft ? correctionPattern.test(latest) : isFactCorrection(input);
  // A correction/translation edits the draft, not the user's biography.
  // Follow only a bounded chain of editing turns; unrelated topics or an
  // explicit cancellation end the task. Assistant text cannot start it.
  const ownExperience=/^I(?:\s|['’](?:m|ve|d|ll)\b)/iu.test(latest)
    || (language==="hinglish"&&/^(?:main|mujhe)\s/iu.test(latest))
    || (language==="hi"&&/^(?:मैं|मैंने|मुझे)(?![\p{L}\p{M}])/u.test(latest));
  const cues=[draft
    ? "Current task: provide ONLY the user's ready-to-send wording addressed directly to the recipient, without a preface or quotation marks. The sender is the user, not Mira. Give the actual message, not advice about what to send, 'I think you should', or a factual recap."
    : "Perspective: the user's relatives and offline plans belong to the user. Address them as you/your, tum/tumhara, or तुम/तुम्हारा. Mira is not a participant in their offline trip or event."];
  if(isClosingThanks(input))cues.push("A standalone thank-you closes this turn. Give ONE brief acknowledgement in the current language, with no question, new topic, advice, invitation or request to continue.");
  if(isPastExperienceStatement(input))cues.push("The user has ALREADY confirmed this happened to them in the past. React briefly to that shared anecdote. Do not ask if it happened, ask for a current progress report, or assume they are doing that activity now.");
  if(!draft&&language!=="en") {
    const agreement=progressiveAgreement(latest);
    if(agreement)cues.push(agreement);
  }
  if(draft&&language==="hinglish")cues.push("Message Roman Hinglish mein likho: Hindi ki boli aur English words mila ke, sirf English mein nahi. Seedha us insaan se baat karo; bhejne ki salah mat do.");
  if(rewrite)cues.push("Continue the existing task in the requested language/length. Preserve its meaning and addressee. Unless a first-person draft/quotation was explicitly requested, describe the user's plan as 'you and your companion', not 'my companion and I'. Do not copy first-person ownership from a prior assistant mistake.");
  if(ownExperience)cues.push(language==="hi"
    ? "वक्ता उपयोगकर्ता है। यहाँ 'मैं/मुझे' उपयोगकर्ता का अपना अनुभव है। जवाब में सीधे 'तुम/तुम्हें/तुम्हारा' कहकर इसी बात पर रहो। पिछली बात में आए रिश्तेदार को इस अनुभव का मालिक मत बनाओ।"
    : "The latest speaker is the USER describing their OWN experience. Keep that experience with the user, even if another person in the history has a related interest. Address the user directly.");
  if(correction)cues.push(draft
    ? "Apply the corrected fact/relationship inside the same draft. Return the revised message to the recipient, not an acknowledgement to the user."
    : language==="hi"
    ? "बताया गया बदलाव और उसकी बताई हुई वजह ही स्वीकार करें। भविष्य की योजना को घट चुकी घटना मत बनाओ। सही काल रखो, नया फायदा/परिस्थिति/सवाल मत जोड़ो।"
    : "Current task: acknowledge the corrected fact/timing and retain any stated reason in ONE short sentence, without a follow-up question. Replace the old fact; infer no additional circumstance or consequence. An acknowledgement states the new fact, not what it might allow or lead to. Continue the user's existing task.");
  return cues.join(" ");
}
