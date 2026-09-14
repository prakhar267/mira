import { z } from "zod";
import { recoveryEventSchema, type RecoveryEvent } from "./recovery-journal";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,120}$/);
const sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const writerSchema = z.object({authorityId:id,source:id,writerId:id,epoch:sequence.positive()}).strict();
export const checkpointSchema = z.object({sequence,digest:z.string().regex(/^[A-Za-z0-9+/]{43}=$/)}).strict();
export const receiptSchema = writerSchema.extend(checkpointSchema.shape).strict();
export const journalEntrySchema = z.object({sequence:sequence.positive(),event:recoveryEventSchema}).strict();
export const appendRequestSchema = z.object({writer:writerSchema,after:checkpointSchema,entries:z.array(journalEntrySchema).max(128)}).strict();
export type Writer = z.infer<typeof writerSchema>;
export type Checkpoint = z.infer<typeof checkpointSchema>;
export type Receipt = z.infer<typeof receiptSchema>;
export type JournalEntry = z.infer<typeof journalEntrySchema>;
export type AppendRequest = z.infer<typeof appendRequestSchema>;

/** Fixed field order, independent of property insertion order at the caller.
 * Strict schemas reject content/credentials rather than silently removing them. */
export function canonicalEvent(raw:RecoveryEvent):string {
  const event=recoveryEventSchema.parse(raw);
  switch(event.kind) {
    case "account":return JSON.stringify([event.kind,event.userId]);
    case "conversation":case "memory":return JSON.stringify([event.kind,event.userId,event.id]);
    case "privacy":return JSON.stringify([event.kind,event.userId,event.revision,event.ai,event.history,event.memory]);
  }
}
function identity(writer:Writer) { return [writer.authorityId,writer.source,writer.writerId,writer.epoch]; }
async function digest(value:unknown) {
  const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(value)));
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}
export async function genesisCheckpoint(raw:Writer):Promise<Checkpoint> {
  const writer=writerSchema.parse(raw);
  return {sequence:0,digest:await digest(["mira-suppression-genesis-v1",...identity(writer)])};
}
export async function advanceCheckpoint(raw:Writer, start:Checkpoint, entries:JournalEntry[]):Promise<Checkpoint> {
  const request=appendRequestSchema.parse({writer:raw,after:start,entries});
  let after=request.after;
  for (const entry of request.entries) {
    if (entry.sequence!==after.sequence+1) throw new Error("SUPPRESSION_SEQUENCE_GAP");
    after={sequence:entry.sequence,digest:await digest(["mira-suppression-event-v1",...identity(request.writer),after.digest,entry.sequence,canonicalEvent(entry.event)])};
  }
  return after;
}

/** Trusted, authenticated transport to a separately provisioned authority.
 * A matching digest checks integrity, not independent freshness or authenticity. */
export interface SuppressionTransport { authorityId:string; append(request:AppendRequest):Promise<unknown> }
