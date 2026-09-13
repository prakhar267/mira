# Encrypted account archives and deletion-safe recovery

Updated 13 September 2026. This implementation is an operator-driven encrypted archive and **controlled transfer/recovery** path. It is not a claim that offsite disaster recovery is active. No real account data has been exported, no key/destination provisioned, no routing changed, and no production source retired by this implementation work.

## What exists

- The existing `MIRA_STORE` remains authoritative. An additive `recovery_events` journal records account deletion, conversation deletion, memory forgetting/correction, and privacy-flag changes in the same SQLite transaction as the change. It contains IDs, flags and sequence/revision numbers, not conversation text, corrected memory, email addresses or credentials. Ordinary autosaves with unchanged privacy flags do not append privacy events.
- `POST /api/admin/backup` requires the existing operator bearer key plus separately configured encryption key/key ID. Responses containing archive material are AES-256-GCM ciphertext, not raw SQL or plaintext account exports. There is no development/default key.
- Snapshot export temporarily freezes ordinary storage reads/writes with a random owner nonce and a 15-minute lease. All pages come from that stable snapshot; there is no async network wait inside a SQL transaction. Successful completion/cancellation reopens the source. An abandoned export expires; an incomplete archive is not restorable.
- Allowlisted tables are accounts, email-to-account lookup, validated profile envelopes, policy evidence, complete bounded transcripts, conversation IDs and privacy/memory suppression. Sessions, demo sessions, password reset/verification tokens, mail, daily profile snapshots, metrics, support tickets, caches and billing records are excluded. This is an account-data backup, not a complete operational database or billing ledger backup.
- Each chunk has an authenticated schema/version, archive/source identity, index, table, row count, digest and byte count. The authenticated manifest lists all chunks. Limits are 1.8 MB plaintext/chunk, 20,000 chunks, one million rows and 4 GB cumulative plaintext; the manifest must also fit the chunk byte bound. Row schemas, account ownership and transcript relationships are revalidated during restore. The application’s smaller per-account limits still apply.
- The Node operator tool writes ciphertext with exclusive creation and restrictive permissions, fsyncs files/manifests, and verifies every chunk. Separate data and suppression vault directories are mandatory during restore. A filesystem directory can be a separately managed mounted vault, but its path alone does **not** prove geographic/offsite or rollback-resistant retention.

## Required owner configuration — currently not activated

1. Generate a cryptographically random 32-byte key in an owner-controlled secret manager. Configure its base64 value as Worker secret `MIRA_BACKUP_KEY`, and its non-secret identifier as `MIRA_BACKUP_KEY_ID`. Grant access only to approved backup/recovery operators. Do not store key material in Git, command arguments, archive directories, logs or evidence. The existing `MIRA_ADMIN_KEY` controls operator API access; it is not an encryption key.
2. Retain a recoverable copy of encryption keys **outside** both account and suppression archive destinations. Rotating the active key requires retaining older key IDs/material for their archives; a restore target must be configured with the matching archive key ID. There is no automatic lost-key recovery or fallback key.
3. Configure an independently managed account vault and a separately retained suppression vault, with access/retention/replication appropriate to the owner’s approved recovery objectives. No R2 bucket, remote vault or trusted independent latest-checkpoint service is established by this code. Same-disk synthetic directories only demonstrate separation from the source SQL file.
4. Configure a verified real recovery-email sender before restoring consumer accounts: all restored passwords are randomized, prior verification is removed, and explicit reset/reverification are required. Provider acceptance alone is not proof of inbox delivery.

The operator tool reads these environment variables without printing their values:

| Variable | Purpose |
| --- | --- |
| `MIRA_BACKUP_SOURCE_URL` | Explicit HTTPS serving-source origin; localhost HTTP is permitted only for isolated tests. |
| `MIRA_BACKUP_TARGET_URL` | Explicit recovery target origin; defaults to the source origin only to address a distinct recovery object through the same binding. |
| `MIRA_BACKUP_OPERATOR_KEY` | Operator bearer credential matching the chosen environment. |
| `MIRA_BACKUP_KEY_ID`, `MIRA_BACKUP_KEY` | Matching decryption/verification key, loaded from the owner’s secret manager. |
| `MIRA_BACKUP_DIRECTORY` | Explicit absolute account archive vault directory. No implicit workspace/home destination. |
| `MIRA_LEDGER_DIRECTORY` | Explicit absolute, separate suppression vault directory. |

## Ordinary archive operation

Run using pinned Node 24 from the repository root:

```sh
node apps/web/scripts/backup-operator.mjs backup
node apps/web/scripts/backup-operator.mjs ledger
node apps/web/scripts/backup-operator.mjs verify /absolute/account-vault/archive-id
```

The `backup` command acquires only the bounded export lease, not source retirement. The `ledger` command captures an immutable sequence watermark without holding account traffic closed. An operator scheduler may invoke these commands against the explicitly configured vaults; no schedule or external vault has been activated here. Review free-tier usage before enabling a schedule. Failed captures leave an incomplete ciphertext directory for inspection and cancel the source lease when possible; restart a failed capture instead of pretending its missing chunk was received. Never delete the only good archive while replacing it.

`latest.json` is an atomic, content-minimized local pointer for inspection. **Its signature/digest/timestamp is not proof that no newer deletion exists.** A stale or rolled-back signed ledger must never be used as “latest” by assumption.

## Controlled recovery and cutover

The operator must explicitly choose an empty `mira-recovery-...` object. Neither the normal account adapter nor the tool changes production routing. Restoring over the serving/default object or any nonempty destination is rejected.

```sh
node apps/web/scripts/backup-operator.mjs restore /absolute/account-vault/archive-id mira-recovery-approved-target "RETIRE mira-production-v1"
```

This command is deliberately different from ordinary backup:

1. Verify the entire independent archive before creating a quarantined target and its fresh challenge.
2. Require explicit source-retirement confirmation. The surviving source atomically stops ordinary serving/writes and issues authenticated proof bound to the target, challenge, source generation, backup ID and final suppression watermark. Retirement cannot be cancelled or resumed through the backup API. Reissuing proof is allowed only for that same target/challenge/archive, to resume interrupted recovery.
3. Archive the now-final ledger independently, then import the account chunks and exact newer ledger events. A lost source or missing trustworthy latest watermark never falls back to an older ledger.
4. Replay newer account/conversation deletions and memory forgetting/corrections. Corrections conservatively remove the old memory from the restored snapshot without retaining the replacement’s plaintext in the ledger. Disabling history erases restored transcripts/call-derived data even if a later event re-enabled future history storage. The latest AI/memory/history flags are applied.
5. Validate account and transcript ownership in bounded batches. Invalidate all old authentication by excluding tokens, disabling legacy KV imports, randomizing restored passwords, removing email verification and blocking policy acceptance until email is reverified. No old password or subsequently-used reset link can become valid again.
6. Open the restored target only after every chunk, ledger sequence and fresh cutover proof has passed. Failed/expired/wrong-target/incomplete proofs leave it quarantined indefinitely. Then perform a separately reviewed routing release, recovery-email checks and owner-scoped smoke tests. The backup tool does not deploy or perform routing cutover.

If a command fails after retirement, keep both source and target isolated. Re-run against the same archive/target and retained ledger directory to resume; do not invent a new challenge or delete partially restored state. A missing target-bound proof, missing encryption key, or corrupted/incomplete retained archive is an explicit operator incident, not permission to bypass quarantine.

## What this does not solve yet

If the source is lost **before** obtaining current retirement/cutover proof, and no independent trusted latest-ledger authority survives, the implementation refuses to open a historical restore. This is deliberate deletion safety, not completed source-loss disaster recovery. A real independent destination with trustworthy newest-watermark evidence, owner-approved RPO/RTO, retention review and source-loss/offsite drill remain activation gates. The mounted-vault adapter is implementable without buying or provisioning a new service, but an unconfigured offsite destination cannot be represented as operational.

Account backups contain personal data and password verifiers inside encryption. Encryption is not erasure of older physical backup bytes. Access and archive/key-retirement policy need independent legal/security review. Source retirement and target validation do not erase data already processed by chat, speech or email providers. Billing reconciliation, support history and operational monitoring must be restored separately; payments remain disabled.

## Local verification

`lib/backup-recovery.test.ts` uses the actual operator filesystem adapter and AES-GCM implementation to create distinct account/suppression vaults, physically delete the synthetic source SQLite file, then restore another SQLite file using fresh previously captured source-retirement proof. It tests stale-ledger rejection, missing key, tampering, wrong purpose, nonempty targets, unknown tables and lease/quarantine behavior. The timing is local synthetic import/replay/validation, not a production RTO.

`tests/worker/backup-recovery.test.mjs` uses actual Worker SQL/actions and the operator route, with mock credentials and forbidden external fetch. It verifies ciphertext transport, default-disabled operator export, quarantine, post-backup memory suppression, preserved transcripts and reset/reverification gates. It is separate from the independent filesystem evidence; its in-memory ciphertext fixture is not an offsite service.

Fresh focused results on 13 September 2026, using Node 24 and the installed locked test runtime:

| Check | Observed result |
| --- | --- |
| Independent filesystem/crypto/CLI recovery tests | 5 / 5 passed |
| Worker backup route/storage tests | 2 / 2 passed before final combined Worker rerun |
| Earlier combined backup + account-state + store-engine tests | 40 / 40 passed; final fifth backup case then passed separately |
| TypeScript and scoped backup/Worker/operator lint | Passed |
| Source-file-loss fixture | 3 accounts; 3,000 original transcript rows; 600 unaffected rows preserved; deleted account/history/memory absent |
| Snapshot input before encryption | 999,209 bytes; 7 independently archived journal events |
| Local import/replay/finalization time | 125.22 ms in the final focused run; earlier 127.82 ms run used the same fixture |

These timings exclude archive creation, offsite transfer, human coordination, email delivery, deployment and routing cutover. They are neither an approved RTO nor proof of source-loss recovery without fresh cutover evidence. Synthetic encrypted files/evidence are retained in task-specific temporary directories; keys are generated in test memory, not committed fixtures. No production credentials, recipients, conversations or inference providers were used.
