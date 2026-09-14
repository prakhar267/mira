# Recovery preparation and release-gate continuation — 14 September 2026

Payments remain disabled. No infrastructure, authority, archive key, provider request or production routing change was made by this continuation.

## Merged work, not a new live release

[PR #2](https://github.com/prakhar267/mira/pull/2) merged at `09067ba93ee06d57ae21267fb75d7141203ad111` after [final PR CI 34816635097](https://github.com/prakhar267/mira/actions/runs/34816635097) passed. That run included 336 web tests, 32 actual Worker tests, 90 browser cases, built-artifact smoke and the 323-file sealed artifact round trip.

[Main CI 34817358284](https://github.com/prakhar267/mira/actions/runs/34817358284) then passed workspace checks, asset checks, Worker integration and all 90 browser cases, but failed the separate cold-start artifact smoke. Local health returned 200 and the inference kill switch returned the required 503. The first homepage request returned 500, followed by a closed socket and connection refusals; Wrangler printed an empty error and exited. GitHub executed the tests; this is not the earlier Actions billing/access block. **No artifact from this failed run was deployed.**

The last verified live version remains `47d4a3bb-a44a-48fd-82aa-281a30655916`, commit `424dad9069e063662ce3379380481e87276d7fe3`. Its fresh five read-only checks passed before this attempted promotion. These checks make no provider-quality, acoustic or backup-availability claim.

## New implemented preparation

[Authority-backed preparation](AUTHORITY-QUARANTINE.md) now imports an encrypted snapshot and independently retained suppression journal after physically destroying the synthetic source before retirement. Archive/writer/target/challenge binding, bounded replay, exact retries, credential invalidation, cancellation and nonempty-target refusal are tested. A prepared target remains permanently unavailable with `coverageVerified:false` and `servingAllowed:false`. The existing finalizer cannot open this mode.

This code is internal only. It does not supply independent authority hosting/authentication, historical protection coverage, serving leases/drain, recovery admission or protected target-writer handoff.

## Investigating the local runtime crash

Installed Wrangler 4.127.1 wraps some serialized proxy errors in an Error with an empty message, keeping the original under `cause`. Its normal console can therefore be blank while its debug log contains the cause. This identifies why the console was unhelpful, **not the root cause of the failed homepage request**. HTML postprocessing and downstream connection failure remain hypotheses until the cause is captured.

The isolated smoke helper now gives Wrangler an exact log path inside its own temporary directory, keeps log sanitization enabled, and retains at most 64 KiB of debug-log tail plus 16,000 console characters on failure. It never reads global user logs or inherits owner credentials. GitHub retains that structured failure evidence. [Cloudflare documents the logging environment variables](https://developers.cloudflare.com/workers/wrangler/system-environment-variables/).

CI now requires three fixed independent cold starts of the built artifact. The **first failure stops the job**; this is not retry-until-green. Every run still checks the inference refusal, full public smoke and release identity. No deployment guard is skipped, artifact rebuilt after verification, or dependency upgraded based on an unconfirmed cause.

## Verification and remaining gates

The isolated preparation branch passed all 345 web tests and 32 actual Worker integration tests. After integrating four runtime-diagnostics regressions, the primary workspace passed **349/349 web tests across 44 files**, full zero-warning web lint and route generation/TypeScript checks. Fresh compiled-browser/CI results for this new head must be checked separately; the parent commit's 90 passing browser cases are not substituted for that verification.

Remaining: resolve and verify the cold-start artifact failure; complete protection bootstrap/provenance, serving/drain fencing and source-loss admission/handoff; provision approved independent resources and key custody without spending; verify real email/alert receipt; physical voice/video, screen-reader and independent legal/security/provider review. Passing internal tests does not complete those gates.
