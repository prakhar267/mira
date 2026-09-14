import type {EdgeCompanionRequest} from "./companion-prompt";
import type {ReplyLanguage} from "./reply-language";

const draftPattern=/\b(?:what (?:should|can|do) i (?:text|say|send|write)|(?:text|message|msg) kya|kya (?:bhej|likh|bol)\p{L}*|kya.{0,18}(?:message|text|msg))\b|(?:क्या.{0,18}(?:संदेश|मैसेज|लिख|भेज|कह))/iu;
const rewritePattern=/\b(?:say (?:it|that)|translate|rewrite|make (?:it|that) (?:shorter|simpler)|sum(?:marize)? up|sum up)\b|(?:इसे.{0,16}(?:अंग्रेजी|अंग्रेज़ी|हिंदी|लिखो))/iu;
const correctionPattern=/\b(?:actually|correct(?:ion|ed)?|changed|reschedul\w*|instead|nahi sorry)\b|(?:बदल|वजह|नहीं.{0,24}(?:भाई|बहन|दोस्त))/iu;
const cancelDraftPattern=/\b(?:forget (?:it|that)|never ?mind|new topic|stop (?:drafting|writing)|chh?odo)\b|(?:छोड़ो|छोडो|विषय बदल)/iu;

/** Turn-local perspective/intent cues, not invented facts or canned answers.
 * Keep the original conversation intact; these cues never grant authority to
 * quoted text, profiles or model output. They sit near the latest utterance so
 * a long mixed-language history cannot silently change its speaker or task. */
export function conversationFocus(input: Pick<EdgeCompanionRequest,"messages">, language: ReplyLanguage) {
  const latest=input.messages.at(-1)?.content.trim()??"";
  let draft=draftPattern.test(latest);
  const rewrite=rewritePattern.test(latest);
  const correction=correctionPattern.test(latest);
  // A correction/translation edits the draft, not the user's biography.
  // Follow only a bounded chain of editing turns; unrelated topics or an
  // explicit cancellation end the task. Assistant text cannot start it.
  if(!draft && (rewrite||correction) && !cancelDraftPattern.test(latest)) {
    for(const turn of input.messages.filter(message=>message.role==="user").slice(-7,-1).reverse()) {
      if(cancelDraftPattern.test(turn.content)) break;
      if(draftPattern.test(turn.content)) {draft=true;break;}
      if(!rewritePattern.test(turn.content)&&!correctionPattern.test(turn.content)) break;
    }
  }
  const ownExperience=/^I(?:\s|['’](?:m|ve|d|ll)\b)/iu.test(latest)
    || (language==="hinglish"&&/^(?:main|mujhe)\s/iu.test(latest))
    || (language==="hi"&&/^(?:मैं|मैंने|मुझे)(?![\p{L}\p{M}])/u.test(latest));
  const cues=[draft
    ? "Current task: provide ONLY the user's ready-to-send wording addressed directly to the recipient, without a preface or quotation marks. The sender is the user, not Mira. Give the actual message, not advice about what to send, 'I think you should', or a factual recap."
    : "Perspective: the user's relatives and offline plans belong to the user. Address them as you/your, tum/tumhara, or तुम/तुम्हारा. Mira is not a participant in their offline trip or event."];
  if(rewrite)cues.push("Continue the existing task in the requested language/length. Preserve its meaning and addressee. Use the user's first-person voice only for an explicitly requested draft, not for your own account of their life.");
  if(ownExperience)cues.push(language==="hi"
    ? "वक्ता उपयोगकर्ता है। यहाँ 'मैं/मुझे' उपयोगकर्ता का अपना अनुभव है, किसी और का नहीं। जवाब उन्हें संबोधित करके दें और इसी अनुभव पर रहें।"
    : "The latest speaker is the USER describing their OWN experience. Keep that experience with the user, even if another person in the history has a related interest. Address the user directly.");
  if(correction)cues.push(draft
    ? "Apply the corrected fact/relationship inside the same draft. Return the revised message to the recipient, not an acknowledgement to the user."
    : language==="hi"
    ? "बताया गया बदलाव और उसकी बताई हुई वजह ही स्वीकार करें। अपने-आप कोई नई परिस्थिति न जोड़ें। पहले की गलत जानकारी को दोहराएँ नहीं।"
    : "Current task: acknowledge the corrected fact/timing and retain any stated reason in ONE short sentence, without a follow-up question. Replace the old fact; infer no additional circumstance or consequence. Continue the user's existing task.");
  return cues.join(" ");
}
