import type {EdgeCompanionRequest} from "./companion-prompt";
import type {ReplyLanguage} from "./reply-language";

/** Turn-local perspective/intent cues, not invented facts or canned answers.
 * Keep the original conversation intact; these cues never grant authority to
 * quoted text, profiles or model output. They sit near the latest utterance so
 * a long mixed-language history cannot silently change its speaker or task. */
export function conversationFocus(input: Pick<EdgeCompanionRequest,"messages">, language: ReplyLanguage) {
  const latest=input.messages.at(-1)?.content.trim()??"";
  const draft=/\b(?:what (?:should|can|do) i (?:text|say|send|write)|(?:text|message|msg) kya|kya (?:bhej|likh|bol)|kya.{0,18}(?:message|text|msg))\b|(?:क्या.{0,18}(?:संदेश|मैसेज|लिख|भेज|कह))/iu.test(latest);
  const rewrite=/\b(?:say (?:it|that)|translate|rewrite|make (?:it|that) (?:shorter|simpler)|sum(?:marize)? up|sum up)\b|(?:इसे.{0,16}(?:अंग्रेजी|अंग्रेज़ी|हिंदी|लिखो))/iu.test(latest);
  const ownExperience=/^I(?:\s|['’](?:m|ve|d|ll)\b)/iu.test(latest)
    || (language==="hinglish"&&/^(?:main|mujhe)\s/iu.test(latest))
    || (language==="hi"&&/^(?:मैं|मैंने|मुझे)(?![\p{L}\p{M}])/u.test(latest));
  const correction=/\b(?:actually|correct(?:ion|ed)?|changed|reschedul\w*|instead|nahi sorry)\b|(?:बदल|वजह|नहीं.{0,24}(?:भाई|बहन|दोस्त))/iu.test(latest);
  const cues=[draft
    ? "Current task: provide the user's ready-to-send wording addressed directly to the recipient. The sender is the user, not Mira."
    : "Perspective: the user's relatives and offline plans belong to the user. Address them as you/your, tum/tumhara, or तुम/तुम्हारा. Mira is not a participant in their offline trip or event."];
  if(rewrite)cues.push("Continue the existing task in the requested language/length. Preserve its meaning and addressee. Use the user's first-person voice only for an explicitly requested draft, not for your own account of their life.");
  if(ownExperience)cues.push(language==="hi"
    ? "वक्ता उपयोगकर्ता है। यहाँ 'मैं/मुझे' उपयोगकर्ता का अपना अनुभव है, किसी और का नहीं। जवाब उन्हें संबोधित करके दें और इसी अनुभव पर रहें।"
    : "The latest speaker is the USER describing their OWN experience. Keep that experience with the user, even if another person in the history has a related interest. Address the user directly.");
  if(correction)cues.push(language==="hi"
    ? "बताया गया बदलाव और उसकी बताई हुई वजह ही स्वीकार करें। अपने-आप कोई नई परिस्थिति न जोड़ें। पहले की गलत जानकारी को दोहराएँ नहीं।"
    : "Current task: acknowledge the corrected fact/timing and retain any stated reason. Replace the old fact; infer no additional circumstance or consequence. Continue the user's existing task.");
  return cues.join(" ");
}
