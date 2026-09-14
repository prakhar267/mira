import { z } from "zod";
import { checkpointSchema, receiptSchema, writerSchema } from "./suppression-protocol";

export const recoveryTargetSchema = z.string().regex(/^mira-recovery-[a-z0-9-]{8,80}$/);
export const archiveRegistrationSchema = z.object({ writer: writerSchema, archiveId: writerSchema.shape.source, manifestDigest: checkpointSchema.shape.digest, checkpoint: checkpointSchema }).strict();
export const archiveRegistrationReceiptSchema = archiveRegistrationSchema.extend({ registered: z.literal(true) }).strict();
export const recoveryHandoffRequestSchema = z.object({ registration: archiveRegistrationSchema, target: recoveryTargetSchema, challenge: writerSchema.shape.source, successor: writerSchema }).strict();
export const recoveryHandoffSchema = recoveryHandoffRequestSchema.extend({ version: z.literal(2), registration: archiveRegistrationReceiptSchema, previous: receiptSchema, fenced: z.literal(true) }).strict();
export const recoveryAdmissionSchema = z.object({ version: z.literal(2), handoff: recoveryHandoffSchema, checkpoint: checkpointSchema, admitted: z.literal(true) }).strict();
export type ArchiveRegistration = z.infer<typeof archiveRegistrationSchema>;
export type ArchiveRegistrationReceipt = z.infer<typeof archiveRegistrationReceiptSchema>;
export type RecoveryHandoffRequest = z.infer<typeof recoveryHandoffRequestSchema>;
export type RecoveryHandoff = z.infer<typeof recoveryHandoffSchema>;
export type RecoveryAdmission = z.infer<typeof recoveryAdmissionSchema>;
export interface RecoveryAuthority {
  authorityId: string;
  enroll(source: string, writerId: string): Promise<unknown>;
  register(registration: ArchiveRegistration): Promise<unknown>;
  handoff(request: RecoveryHandoffRequest): Promise<unknown>;
  read(writer: z.infer<typeof writerSchema>, after: z.infer<typeof checkpointSchema>, limit: number): Promise<unknown>;
  admit(handoff: RecoveryHandoff, checkpoint: z.infer<typeof checkpointSchema>): Promise<unknown>;
}

export const protectedRestoreSchema = z.object({
  version:z.literal(2), registration:archiveRegistrationReceiptSchema,
  successor:writerSchema, handoff:recoveryHandoffSchema.nullable(),
  admission:recoveryAdmissionSchema.nullable(),
}).strict();
