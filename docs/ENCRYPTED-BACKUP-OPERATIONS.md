# Encrypted account archives and deletion-safe recovery

Updated 14 September 2026. This implementation is an operator-driven encrypted archive and **controlled transfer/recovery** path, with a dormant independent suppression-authority/acknowledgement implementation. It is not a claim that offsite disaster recovery is active. No real account data has been exported, no key/destination provisioned, no recovery routing changed, and no production source retired by this implementation work.

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

## Source-loss admission design and indispensable activation decisions

The current implementation implements the ordered authority journal and source acknowledgement portion below, **not the complete recovery protocol**. [The September 14 implementation and evidence](SUPPRESSION-AUTHORITY.md) distinguish tested code from the missing activation, serving/drain fence and recovery-admission engineering. There is no production enrollment route or configured independent authority.

### Why another signed checkpoint is insufficient

Without activated independent protection, `RecoveryJournal.append` commits only to the source SQLite database. The operator's `ledger` command copies the current journal later. Consider an intact snapshot and ledger ending at sequence N: in one execution no further deletion occurs; in another, the source acknowledges deletion N+1 and then disappears before the next export. Both executions leave exactly the same independently retained archive bytes. No inspection of those bytes—including authenticated encryption, a hash chain, a newly written `latest.json`, or a recent timestamp—distinguishes them. Accepting the archive as current in the first execution would also permit resurrection in the second.

Shorter backup intervals reduce the possible gap, but do not close it. The account-content RPO may be nonzero; the recovery requirement for **acknowledged deletion/suppression** cannot use that same loss allowance. Requiring email reverification or new passwords does not make deleted content safe to restore. A separate object or directory is also not, by itself, proof of a separate disaster/failure domain.

### Required authority contract

An owner-approved independently surviving service must provide durable, linearizable, authenticated operations, not just blob upload or eventual-consistency listing. The dormant SQL core implements ordered append, checked retries and permanent writer revocation. Authenticated operator serving, independent placement/encryption at rest, bootstrap activation and complete live recovery integration still need to be built and tested:

1. **Establish coverage before claiming protection.** While the existing source is safely fenced against relevant mutations, seed its complete suppression history and source generation into the authority, validate a contiguous head, and atomically activate the protected writer epoch. Deploy and verify the live acknowledgement gate before lifting the fence. A source lost before this coverage barrier remains unrecoverable through this protocol.
2. **Persist independently before acknowledgement.** Validate ownership, schema and revision; commit the local restrictive change and its minimal journal event in one transaction. The implemented local-commit/pre-response strategy then replicates that contiguous sequence to the authority under its fixed source generation and writer epoch. The app must not report success until the authority confirms persistence. `(source, epoch, sequence)` and the content-checked hash chain identify retries. Never hold a SQLite transaction open over network I/O. A failed response can mean the change committed locally or remotely; its pending checkpoint survives retries and crashes. Source loss may lose an unacknowledged local change, but must not lose a successfully acknowledged suppression. Corrections suppress old memory without retaining replacement text. Restrictive events are never undone by later opt-in or retry reconciliation. This differs from the earlier proposed pre-local-commit intent staging, without weakening the acknowledged-deletion guarantee; full recovery admission is still unimplemented.
3. **Cover every mutation path.** Account/conversation deletion, memory forgetting/correction, privacy withdrawal, support/operator erasure and migration/cleanup paths must all use the same gate. Background jobs, old releases, direct store actions and delayed writes cannot bypass it. Re-enabling processing/history/memory must not reuse old data or remove an earlier suppression event. The existing blanket password reset, session invalidation and reverification on restoration must remain in place.
4. **Fence the lost writer without contacting it.** Recovery calls the surviving authority, which atomically revokes the previous writer epoch and binds a new recovery epoch to the specific source generation, empty target, archive and fresh target challenge. Every serving writer must consult that authority, or a rigorously bounded authority-issued lease, so an old source that later reappears cannot continue serving or acknowledging changes. Routing changes alone are not fencing. Lease expiry/clock assumptions and partitions require explicit tests; no unbounded cached authorization is safe.
5. **Read the current head from the authority.** The target verifies a fresh, target-bound response through independently configured authority authentication, then reads every suppression event through the fenced final head. Archive-contained assertions, user-supplied head numbers and the archive encryption key alone are not authority authentication. Require contiguous sequence/digest validation and matching generation/epoch; replay all newer suppression before the target can serve. A rollback, gap, unknown epoch or unavailable authority leaves it quarantined.
6. **Resume protected operation after cutover.** The authority must also receive new target-side suppressions before acknowledgement. A restored account snapshot plus the current authority history establishes a new validated generation/baseline without losing prior tombstones. Only after this handoff and authentication invalidation may a separately reviewed routing change expose the target. Restoring the authority itself from an uncertain old checkpoint must not silently create a new “latest” head.

The failure policy must be designed alongside this protocol:

| Failure point | Required safe behavior |
| --- | --- |
| Authority unavailable before a protected request starts | Deny the request; do not claim the requested withdrawal was saved. Existing pending local suppressions stay applied and block successful requests until independent acknowledgement catches up. |
| Authority fails after local mutation commits, or its receipt is lost | Keep the local restriction and durable pending journal; report unavailable, not completed protection. Retry the exact sequence/content. An independently committed suppression is never removed just because the receipt was lost. |
| Source lost after successful acknowledgement | Recover using the independent authority's current fenced head; no call to the lost source may be required. |
| Old source reappears after cutover | Reject its retired writer epoch for serving and mutations; it must never reclaim authority automatically. |
| Independent authority is missing, rolled back, or cannot prove its head | Keep historical restores quarantined. A force/resume flag, operator timestamp, or old signed checkpoint must not override this. |

### Owner configuration that code cannot invent

- **Destination and failure domain:** designate an existing or newly approved independently durable authority and separate encrypted archive vaults, with endpoint/binding access and an approved no-spend capacity plan. No such authority, destination or credentials are configured in this repository's current environment; R2 access was not established by the read-only configuration check. A local test directory is not an operational substitute.
- **Key custody and retention:** designate owners and separately recoverable encryption/authentication keys; define access, rotation and retention for content-free suppression records, encrypted account backups and the authority's own recovery. Never prune a suppression that could apply to a retained archive. Losing both the authority and its trusted latest state must remain an explicit recovery limitation.
- **Availability tradeoff:** approve whether this strict external acknowledgement/serving dependency is acceptable. Timeouts, bounded retries, backpressure, pending-deletion UX and incident escalation must not be chosen by pretending remote failure is success. An asynchronous mirror alone would not satisfy the deletion guarantee.
- **Recovery acceptance:** approve account-data RPO, service RTO, operators, tested authority-failure scenarios, credential reset/email delivery and cutover sign-off. Run a new isolated drill that destroys the source **before** retirement, preserves the independently acknowledged authority, includes late deletion and failed acknowledgements, and rejects stale-head/split-brain attempts. The current transfer timing below does not measure that scenario.

These are infrastructure and protocol integration gates, not payment features. Supplying an approved existing free resource could avoid new spending; it would still require safe bootstrap, serving/drain fencing, recovery admission and the failure testing above. The September 14 code adds dormant source hooks but no production protection row, configuration or external service. Setting environment variables alone cannot activate protection.

## Local verification

`lib/backup-recovery.test.ts` uses the actual operator filesystem adapter and AES-GCM implementation to create distinct account/suppression vaults, physically delete the synthetic source SQLite file, then restore another SQLite file using fresh previously captured source-retirement proof. It tests stale-ledger rejection, missing key, tampering, wrong purpose, nonempty targets, unknown tables and lease/quarantine behavior. The timing is local synthetic import/replay/validation, not a production RTO.

The additional pre-retirement-loss regression independently captures authentic snapshot/ledger files, commits a newer account deletion, physically deletes the source SQLite file **without** retirement proof, and invokes the actual restore orchestrator. It verifies that intact ciphertext and `latest.json` do not cause a fallback: the target stays quarantined. Even manually importing the old snapshot/ledger cannot use a ledger as cutover proof. This is evidence of denial safety, **not** a successful source-loss restore; the fixture writes `source-loss-admission-evidence.json` with metadata only.

`tests/worker/backup-recovery.test.mjs` uses actual Worker SQL/actions and the operator route, with mock credentials and forbidden external fetch. It verifies ciphertext transport, default-disabled operator export, quarantine, post-backup memory suppression, preserved transcripts and reset/reverification gates. It is separate from the independent filesystem evidence; its in-memory ciphertext fixture is not an offsite service.

Fresh focused results on 13 September 2026, using Node 24 and the installed locked test runtime:

| Check | Observed result |
| --- | --- |
| Independent filesystem/crypto/CLI recovery tests | 6 / 6 passed; focused suite duration 1.37 s |
| Worker backup route/storage tests | 2 / 2 passed before final combined Worker rerun |
| Earlier combined backup + account-state + store-engine tests | 40 / 40 passed; final fifth backup case then passed separately |
| TypeScript and scoped backup/Worker/operator lint | Passed |
| Source-file-loss fixture | 3 accounts; 3,000 original transcript rows; 600 unaffected rows preserved; deleted account/history/memory absent |
| Snapshot input before encryption | 999,209 bytes; 7 independently archived journal events |
| Local import/replay/finalization time | 126.77 ms in the latest focused run; earlier 125.22 ms / 127.82 ms runs used the same fixture |
| Source lost before retirement | Authentic archive head 1; acknowledged deletion head 2; source file removed; target remained quarantined |

These timings exclude archive creation, offsite transfer, human coordination, email delivery, deployment and routing cutover. They are neither an approved RTO nor proof of source-loss recovery without fresh cutover evidence. Synthetic encrypted files/evidence are retained in task-specific temporary directories; keys are generated in test memory, not committed fixtures. No production credentials, recipients, conversations or inference providers were used.
