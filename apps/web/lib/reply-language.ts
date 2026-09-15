// Shared by production validation and the standalone Node evaluation runner.
// These are script/style checks, not a semantic language detector.
export type ReplyLanguage = "en" | "hi" | "hinglish";
export const hasInflectedHindi = (value: string) => (value.match(/\b(?:bhi|dono|rahega|rahegi|karoge|karogi|gaya|gayi|gai|tha|thi|raha|rahi|aap|nahin|waapas|wapas|waise|maine|kis|saath)\b/gi)?.length ?? 0) >= 2
  // New colloquial markers need a compatible verb, not just another name/place
  // (e.g. an English sentence mentioning both Gaya and Sahi).
  || (/\b(?:jayega|jayegi|jaayega|jaayegi|hoga|hogi|chalein)\b/i.test(value)
    && /\b(?:pakka|waapas|wapas|sahi|chalo|ab|ho|toh|na)\b/i.test(value));
const naturalHinglish = /\b(?:aaj|abhi|accha|arey|aur|bas|haan|hai|hoon|kaafi|kar|karo|karti|kya|kyun|lekin|main|matlab|mera|meri|mujhe|nahi|par|sach|theek|thoda|toh|tum|tumhara|uske|yaar|bilkul|badhai|shukriya|saath|chahiye|pasand|bataya)\b/i;
// Short natural imperatives need not contain a filler such as "haan" or "yaar".
// Match a Hindi verb phrase, not a lone token that may be an English name.
const hindiImperative = /\b(?:(?:kar|bol|keh|bata|dikha|bhej|phod|fod)\s+(?:do|dena|dijiye)|dhya+an\s+rakhna|milte\s+hain)\b/i;
const romanHindiWords = /\b(?:aaj|abhi|hoon|haan|hai|hain|mujhe|tum|tumhe|tumhara|tumhari|kaafi|nahi|nahin|yaar|karti|rahi|aap|dono|bhi|rahega|rahegi|karoge|karogi|waapas|wapas|aaoge|thakaan|hoga|hogi|accha|kaise|kya|aur|pakka|jayega|jayegi|jaayega|jaayegi|chalo|chalein|sahi)\b/gi;

export function matchesReplyLanguage(reply: string, language: ReplyLanguage) {
  const devanagari = /\p{Script=Devanagari}/u.test(reply);
  if (language === "hi") {
    // A Hindi opening must not disguise a mostly Roman-Hindi answer. Keep
    // English technical terms/names legal: React, state, props, Kabir, etc.
    const romanGrammar = reply.match(/\b(?:ko|ki|ke|ka|bas|itna|kah|sakte|sakti|ho|mein|mat|kar|karo|karne|koshish|dekhne|jao|liye|toh|tum|mujhe|hai|hain|aaj|abhi|nahi|aur)\b/gi)?.length ?? 0;
    return devanagari && romanGrammar < 3 && (reply.match(romanHindiWords)?.length ?? 0) < 2;
  }
  if (devanagari) return false;
  if (language === "hinglish") return naturalHinglish.test(reply) || hasInflectedHindi(reply) || hindiImperative.test(reply);
  return !hindiImperative.test(reply) && (reply.match(romanHindiWords)?.length ?? 0) < 2;
}
