import type { ChatMessage } from "@companion/shared";

export interface TurnContext { signal: AbortSignal; turnId: string }

/** The same failed user turn is retried. Only an active attempt may commit. */
export class ConversationTurns {
  private active: AbortController | null = null;
  private pendingId: string | null = null;
  begin(turnId = crypto.randomUUID()): TurnContext | null {
    if (this.active) return null;
    this.active = new AbortController();
    this.pendingId = turnId;
    return { signal: this.active.signal, turnId };
  }
  finish(context: TurnContext) {
    if (this.active?.signal === context.signal) { this.active = null; this.pendingId = null; }
  }
  cancel() { this.active?.abort(); this.active = null; this.pendingId = null; }
  get busy() { return this.pendingId !== null; }
}

export function assertTurnActive(context: TurnContext) {
  if (context.signal.aborted) throw new DOMException("The conversation turn was cancelled.", "AbortError");
}

export function appendUniqueMessages(messages: ChatMessage[], additions: ChatMessage[]) {
  const ids = new Set(messages.map(message => message.id));
  return [...messages, ...additions.filter(message => !ids.has(message.id))];
}

/** UI adapters use this boundary too, so ignored aborts never mutate app state. */
export async function resolveConversationTurn(
  context: TurnContext,
  request: (signal: AbortSignal) => Promise<string>,
  commit: (reply: string) => void,
) {
  assertTurnActive(context);
  const reply = await request(context.signal);
  assertTurnActive(context);
  if (!reply.trim()) throw new Error("The reply service returned no reply. Retry your last message.");
  commit(reply);
  return reply;
}
