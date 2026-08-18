# Operations and incident runbooks

Last reviewed: 18 August 2026  
Current visitor deployment: synthetic/non-sensitive beta only at `saathkind.pages.dev` (`saathkind.prakhargupta267.workers.dev` remains the bound Worker/backend origin)

## 1. Current operating boundary

The integrated Worker serves assets and `/api/v1`. One SQLite-backed `UserStateCoordinator` Durable Object is authoritative per synthetic account and demo session. Bootstrap schedules that account's alarm for exactly 30 days later; the non-renewable session/cloud account is then irreversibly tombstoned. Separate token-hash coordinator objects hold bootstrap/deletion status, while separate hashed IP/account/global coordinator objects hold short-lived fixed-window counts. `STATE` KV contains only the two opaque routing pointers through account expiry; there is no active registry or `RATE_LIMIT` KV binding.

Export is synchronous JSON. Follow-ups send nothing. There is no active D1, R2, global Cron, Gemini, payment, notification, verified identity, or production support integration. The per-account Durable Object alarm is not Cron and is not a production retention policy. Dormant adapters/bindings do not change this boundary.

The coordinator class migration is forward-only. Incident recovery uses containment plus a compatible forward fix. Never deploy a pre-coordinator Worker, remove the Durable Object binding/migration, or make KV authoritative to “roll back.”

## 2. Incident levels

| Level | Examples | Initial response target |
|---|---|---:|
| SEV-0 | confirmed cross-user exposure; active account takeover; secret with active deploy access | 10 minutes |
| SEV-1 | widespread API outage; deletion/tombstone failure; unsafe crisis regression; persistent state corruption | 30 minutes |
| SEV-2 | elevated errors/latency; isolated coordinator conflict loop; account-size failures | 2 hours |
| SEV-3 | cosmetic issue, documentation drift, non-urgent alert noise | Next business day |

The current team does not yet provide a staffed production on-call service. That is why private/paid launch remains blocked.

## 3. Common incident loop

1. Name an incident commander and scribe; record UTC and IST timestamps.
2. Protect users by disabling the affected route/capability or the synthetic beta. Keep static safety and status information available where safe.
3. Identify Worker version, coordinator behavior, affected route, first/last known time, synthetic accounts affected, and request IDs. Do not paste content or tokens into tickets/chat.
4. Preserve redacted logs, deployment IDs, test results, and configuration evidence.
5. Test one hypothesis at a time against synthetic accounts.
6. Build a storage-compatible forward fix from the current schema/class boundary.
7. Run automated checks and synthetic canaries, deploy the fix, and watch errors before reopening.
8. Document cause, impact, communication, and owned follow-ups.

## 4. Read-only checks and local validation

Resolve the exact account and Worker before acting. Never print secrets.

```bash
npx --yes wrangler@4 deployments status --name saathkind
npx --yes wrangler@4 deployments list --name saathkind
npx --yes wrangler@4 tail --name saathkind
```

`wrangler tail` is sampled/transient, not a durable audit log. Filter by request ID, route, status, and content-free error code.

From the repository:

```bash
cd app
npm ci
npm run build
npm test
npm audit --audit-level=high
npx --yes wrangler@4.123.0 deploy --config wrangler.jsonc --dry-run
```

Do not troubleshoot by copying another person's `.env` or production credentials.

## 5. Deployment regression: forward-fix procedure

### Signals

- root/nested assets return 5xx/404 or the browser is blank;
- `/api/v1/health` is degraded or reports missing coordinated persistence;
- demo bootstrap/session routes fail after cutover;
- all coordinator writes conflict/fail or deletion cannot tombstone;
- new browser/CSP/accessibility regression.

### Contain and diagnose

1. Stop synthetic signups or disable affected write routes if state correctness is uncertain.
2. Record current deployment/version and the exact commit/config.
3. Run the local validation commands against that commit.
4. Verify root, one hashed asset, one nested route, `/api/v1/health`, bootstrap, chat, export, and deletion using synthetic content.
5. Determine whether the fault is asset packaging, Worker routing, KV session mapping, Durable Object class/storage behavior, CORS/header policy, or client runtime.

### Recover

1. Keep the current `UserStateCoordinator` class binding and migration tag.
2. Implement the smallest compatible fix.
3. Build/test/dry-run and deploy a new version.
4. Smoke-test with a fresh synthetic account; older pre-coordinator sessions are intentionally invalid and must not be migrated.
5. Watch Cloudflare errors and coordinator conflicts for at least 30 minutes; record the fixed version ID.

Do not use `wrangler rollback` to a pre-coordinator version. A previous static/client version may also assume an incompatible API. Recovery is a validated forward deployment.

## 6. Expected invalid sessions after cutover or 30-day expiry

Pre-coordinator synthetic sessions are intentionally invalidated. Post-cutover sessions are also intentionally non-renewable and expire with cloud state 30 days after bootstrap.

1. Determine whether the session predates the coordinator or whether its fixed 30-day expiry has passed.
2. Confirm new bootstrap succeeds with a different synthetic demo account identity.
3. Tell the tester the earlier demo was disposable and ask them to start fresh; remind them that expiry is irreversible and exports must happen beforehand.
4. Do not copy KV content into the coordinator, extend an expired account, or create a hidden migration path.
5. If a post-cutover session fails before its recorded expiry, treat it as an authentication/persistence incident.

The public beta copy and release notes must not promise continuity across cutover or beyond 30 days.

## 7. Coordinator unavailable, conflict storm, or size limit

### Unavailable (`503`)

1. Verify both `USER_STATE` and required routing KV bindings in the deployed version.
2. Check platform status and Worker exceptions without inspecting content.
3. Disable writes if coordinator availability/correctness is uncertain.
4. Deploy a compatible forward fix or wait for verified platform recovery.

### Conflict (`409 state_conflict`)

1. Confirm two requests used the same prior revision.
2. Ensure the client presents refresh-and-try-again rather than blindly replaying.
3. Reproduce with synthetic concurrent requests and verify the newer committed state remains intact.
4. Investigate a sustained conflict rate as a product/design limitation; do not disable compare-and-swap.

### Size limit (`413 state_limit_reached`)

1. Preserve read/export/delete access.
2. Stop mutations that grow the document and present an honest limit message.
3. Do not truncate history silently or move content into KV.
4. Treat repeated limit hits as evidence that the whole-document beta has reached its design ceiling.

## 8. Suspected cross-user exposure

Always SEV-0 until disproved.

1. Disable affected read/write/export/delete routes.
2. Preserve request IDs, opaque user IDs, Worker version, and authorization decisions—never copy account content broadly.
3. Revoke affected synthetic sessions if session-routing confusion is possible.
4. Test two fresh synthetic accounts against the exact route and coordinator namespace path.
5. Check that tenant/user comes only from the authenticated session pointer and cannot be overridden by request IDs/body.
6. Deploy the compatible forward fix and run the full owner-isolation suite before reopening.
7. Engage privacy/legal if any real/private content might have been submitted despite the warning.

## 9. Export failure or leakage

Current export is a synchronous authenticated JSON response; there is no Queue job, server archive, R2 URL, or polling requirement.

1. Disable export immediately on any cross-user field or secret.
2. Reproduce with two synthetic accounts and inspect field names, not real content.
3. Confirm response uses `Cache-Control: no-store` and content is absent from logs/analytics/errors.
4. Confirm the server does not append export requests to account state or write an object/archive.
5. Patch and deploy a compatible forward fix.
6. Remind testers that downloaded JSON and browser/device backups are under their control.

## 10. Account deletion or tombstone failure

Current deletion requires exact `DELETE`, moves the token coordinator through deleting/deleted status, replaces account content with a content-free coordinator tombstone, best-effort clears the two KV routing pointers, and expires the cookie.

1. Stop new synthetic account creation if deletion or tombstone correctness is uncertain.
2. Verify with a disposable synthetic account that the old session fails after deletion.
3. Attempt a stale revision write and verify it receives the deleted/conflict response rather than recreating state.
4. Verify only the two opaque routing pointers are removed from KV; do not search or expose content.
5. Confirm the browser clears its local demo state after server success.
6. If the synchronous control fails, treat it as SEV-1 and deploy a compatible forward fix.

Do not claim processor-wide or backup erasure. There are no active external processors, but Cloudflare recovery/log behavior and device copies are not proven by the route.

### Expiry-alarm failure or early expiry

1. For an apparent early expiry, record bootstrap time, intended `expiresAt`, request ID, and content-free account identifier. Do not restore or copy account content.
2. For an overdue expiry, stop new synthetic bootstrap until alarm scheduling/tombstoning is understood.
3. Verify synthetic coordinator tests cover alarm scheduled on initialization, no renewal on activity, no action before due time, irreversible tombstone at/after due time, and stale-write rejection afterward.
4. Deploy a compatible forward fix. Do not attach a global Cron as a shortcut.
5. State the limitation honestly: the 30-day alarm is beta hygiene, not an evidenced production deletion SLA.

## 11. Deterministic chat or safety regression

There is no active Gemini call. Ordinary chat and crisis routing are deterministic.

1. Disable chat while retaining export/delete and static safety information if responses are unsafe or deceptive.
2. Record content-free category, language, route, and version; keep minimum restricted evidence outside general tickets.
3. Reproduce with synthetic English, Hindi, Hinglish, transliteration, and obfuscation cases.
4. Patch the classifier/response and run the full safety regression suite.
5. Deploy a forward fix and canary with synthetic prompts.

Never imply a human, provider, emergency service, or notification was contacted.

## 12. Secret exposure

1. Treat the credential as compromised immediately.
2. Revoke/rotate at the issuer; removing source text is not revocation.
3. Disable the affected deployment/integration if rotation cannot be immediate.
4. Inspect provider audit logs, deploy/config changes, and built artifacts for misuse without printing the secret.
5. Redeploy with the newly scoped credential, scan artifacts, and monitor.
6. Add a prevention control and engage privacy/legal if Restricted data access was possible.

The current release should not contain Gemini, payment, notification, R2, or database credentials. Their presence is a configuration defect, not an enabled feature.

## 13. Free-tier or platform exhaustion

1. Protect export, deletion, and safety information before optional beta interactions.
2. Tighten coarse rate limits/WAF only after verifying legitimate privacy controls remain reachable.
3. Segment by route, authenticated/anonymous state, deployment, and content-free error code.
4. Stop retry loops; there is no generic replay guarantee outside chat `clientMessageId` handling.
5. If demand exceeds the synthetic-beta boundary, close the beta. Do not accept payment or real data to justify an unreviewed upgrade.

## 14. Features that are not active

There is no operational runbook for D1 authority, R2 export, Cron retention, Gemini generation, notification delivery, payment, or verified authentication because those features are not deployed.

Do not “restore” them by uncommenting a binding or adding a credential. Each requires a reviewed architecture decision, privacy/legal changes, threat model, provider terms, tests, monitoring, deletion/restore design, and go-live approval.

## 15. Post-deploy verification

For every synthetic-beta release:

1. Record commit and Cloudflare version/deployment ID.
2. Verify HTTPS root, one nested route, and one hashed asset in a clean browser.
3. Check security headers, content types, no source map/secret exposure, mobile navigation, keyboard path, and reduced motion.
4. Verify `/api/v1/health` reports coordinated demo persistence.
5. Create a fresh synthetic account; do not test continuity with a pre-coordinator session.
6. Exercise deterministic ordinary chat, crisis routing, a memory mutation, synchronous export, deletion/tombstone protection, and the automated alarm lifecycle in tests.
7. Confirm no outbound model, notification, payment, or export-storage request occurs.
8. Watch errors for at least 15 minutes and record the result.

Abort the release on cross-user exposure, missing coordinator/routing binding, tombstone failure, secret exposure, route-wide 5xx, blank UI, missing trust disclosure, or inaccessible export/delete.

## 16. Readiness drills

- forward-fix from a bad Worker release while retaining the coordinator migration;
- stale-revision conflict and stale-write-after-delete;
- cross-user isolation;
- synchronous export leakage;
- credential revocation;
- deterministic English/Hindi/Hinglish safety regression;
- account/document size-limit handling;
- incident communication and beta shutdown.

Capture date, participants, duration, evidence, gaps, owners, and due dates. A runbook not exercised is a hypothesis.
