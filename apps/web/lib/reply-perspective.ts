import type { EdgeCompanionRequest } from "./companion-prompt";
import { isClosingThanks, isDraftingRequest, isFactCorrection } from "./conversation-focus";

/** A summary of the user's offline plans is not Mira joining those plans.
 * Only normalize explicit summary/translation tasks and concrete travel verbs;
 * ordinary in-character first-person conversation and authored drafts survive. */
export function groundReplyPerspective(input: Pick<EdgeCompanionRequest, "messages">, reply: string) {
  // Preserve the model's own acknowledgement, not a canned replacement. Never
  // cut an open quotation or a first sentence that itself asks a question.
  if (isClosingThanks(input) && !/["“”`]/u.test(reply)) {
    const first=reply.match(/^[^.!?।]+[.!।](?=\s|$)/u)?.[0]?.trim();
    if(first&&first.length>=3)reply=first;
  }
  // A fact correction needs an acknowledgement, not a second invented benefit
  // or another question. Keep a substantive complete first sentence; never
  // cut a quote, a short acknowledgement, or an explicit additional request.
  if (isFactCorrection(input) && !/["“”`]/u.test(reply)) {
    const first = reply.match(/^[^.!?।]+[.!।](?=\s|$)/u)?.[0]?.trim();
    if (first && first.length >= 24) reply = first;
  }
  const latest = input.messages.at(-1)?.content ?? "";
  if (isDraftingRequest(input) || /\b(?:first.person|my voice|my perspective|as me|quote|verbatim)\b|मेरी ओर से/iu.test(latest)) return reply;
  if (!/\b(?:sum(?:marize)? up|summari[sz]e|recap|translate|say (?:it|that))\b|(?:सारांश|संक्षेप)/iu.test(latest)) return reply;
  if (!input.messages.some(turn => turn.role === "user" && /\b(?:trip|travel\w*|depart\w*|leave|leaving|journey)\b|(?:यात्रा|सफर|निकल)/iu.test(turn.content))) return reply;
  // Quoted wording belongs to its speaker, including an unfinished streamed quote.
  return reply.split(/("[^"\n]*(?:"|$)|“[^”\n]*(?:”|$)|`[^`\n]*(?:`|$))/u).map((part, index) => {
    if (index % 2) return part;
    return part
      .replace(/\band I (are (?:leaving|going|travell?ing|departing|visiting|heading)|will (?:leave|go|travel|depart|visit|head))\b/gu, "and you $1")
      .replace(/\b(?:we are|we['’]re|I am|I['’]m) (leaving|going|travell?ing|departing|visiting|heading)\b/giu,
        (match: string, verb: string) => `${match.charAt(0) === match.charAt(0).toUpperCase() ? "You" : "you"} are ${verb}`)
      .replace(/\b(?:we will|we['’]ll|I will|I['’]ll) (leave|go|travel|depart|visit|head)\b/giu,
        (match: string, verb: string) => `${match.charAt(0) === match.charAt(0).toUpperCase() ? "You" : "you"} will ${verb}`)
      .replace(/\b(?:our|my) (trip|journey|departure|cousin|brother|sister)\b/giu,
        (match: string, noun: string) => `${match.charAt(0) === match.charAt(0).toUpperCase() ? "Your" : "your"} ${noun}`);
  }).join("");
}
