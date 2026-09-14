import { z } from "zod";
import { checkpointSchema, journalEntrySchema, receiptSchema, writerSchema, type Checkpoint, type Writer } from "./suppression-protocol";

const id = writerSchema.shape.source;
export const authorityRestoreBindingSchema = writerSchema.extend({
  target: z.string().regex(/^mira-recovery-[a-z0-9-]{8,80}$/),
  challenge: id, archiveId: id, manifestDigest: checkpointSchema.shape.digest,
}).strict();
export type AuthorityRestoreBinding = z.infer<typeof authorityRestoreBindingSchema>;
// The existing authority pins target+challenge permanently. The target's fresh
// challenge is itself permanently bound to the exact archive digest and writer.
// This is a write fence, NOT a source-response drain or serving/admission permit.
export const authorityWriteFenceSchema = receiptSchema.extend({
  fenced: z.literal(true), target: id, challenge: id,
}).strict();
export type AuthorityWriteFence = z.infer<typeof authorityWriteFenceSchema>;
export const authorityReadPageSchema = z.object({
  entries: z.array(journalEntrySchema).max(128), checkpoint: checkpointSchema,
  head: receiptSchema, fenced: z.literal(true), hasMore: z.boolean(),
}).strict();
export const authorityPreparationSchema = z.object({
  version: z.literal(1), kind: z.literal("authority-quarantine"),
  binding: authorityRestoreBindingSchema, cursor: checkpointSchema,
  fence: authorityWriteFenceSchema.nullable(), prepared: z.boolean(),
}).strict();
export type AuthorityPreparation = z.infer<typeof authorityPreparationSchema>;
export const authorityVerifiedPageSchema = z.object({
  binding: authorityRestoreBindingSchema, before: checkpointSchema,
  entries: z.array(journalEntrySchema).min(1).max(128), after: checkpointSchema,
  digest: checkpointSchema.shape.digest,
}).strict();
export type AuthorityVerifiedPage = z.infer<typeof authorityVerifiedPageSchema>;

/** Internal injected reader only: there is no implemented network endpoint,
 * token handling, operator route or automatic authority deployment. The caller
 * must authenticate the separately surviving authority and supply its expected
 * identity from trusted configuration, never from an archive or request body. */
export interface AuthorityQuarantineReader {
  authorityId: string;
  fence(writer: Writer, target: string, challenge: string, signal: AbortSignal): Promise<unknown>;
  read(writer: Writer, after: Checkpoint, limit: number, signal: AbortSignal): Promise<unknown>;
}
export const AUTHORITY_PREPARATION_MAX_EVENTS = 1_000_000;
export const AUTHORITY_PREPARATION_STEPS = 8;
