/** Ephemeral hints from accepted speech in THIS call only, never saved memory
 * or assistant guesses. Not language instructions and never transcript edits. */
export function speechVocabulary(text: string) {
  const words = text.match(/[\p{L}\p{M}][\p{L}\p{M}'’-]{1,39}/gu) ?? [];
  const stop = /^(?:I|I'm|The|My|We|You|It|That|This|Actually|English|Hindi|Hinglish|Main|Meri|Mera|Mere|Tum|Yaar|मैं|मेरी|मेरा|मेरे|तुम|है|हूँ|हूं|था|थी|और|या|में|की|को|से|के|का|नहीं|कल|आज)$/iu;
  return [...new Set(words.filter(word => !stop.test(word) && (/^\p{Lu}/u.test(word) || /\p{Script=Devanagari}/u.test(word))))].slice(-12);
}
