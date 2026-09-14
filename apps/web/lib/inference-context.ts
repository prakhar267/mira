import { EdgeRequestError } from "./edge-security";
import type { InferencePrincipal } from "./inference-policy";

/** Revalidate selected context immediately before downstream work and delivery.
 * A withdrawal cannot undo a request already sent, but prevents a later retry
 * or reply from reusing paused, deleted, or corrected account memory. */
export function assertCurrentMemoryContext(principal: InferencePrincipal, selected: ReadonlyArray<{ content: string; id?: string }>) {
  if (!selected.length) return;
  if (!principal.memoryConsent || (principal.state && selected.some(previous => !principal.state!.memories.some(current =>
    current.status === "active" && current.userId === principal.id && current.content === previous.content && (previous.id === undefined || current.id === previous.id)
  )))) throw new EdgeRequestError("Your memory context changed while Mira was replying. Please retry this turn.", 409, "CONTEXT_CHANGED");
}
