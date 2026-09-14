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

[PR CI 34818501864](https://github.com/prakhar267/mira/actions/runs/34818501864) passed the workspace, Worker and 90 browser checks; its first artifact cold start passed 5/5, and the second reproduced the homepage 500 and proxy shutdown. The third was correctly not run. The retained report showed `server exit=null` and stopped before the fatal error was flushed to the debug file: the smoke helper was killing the process group while Wrangler was still completing failure logging. The helper now waits at most four seconds for natural process closure before capturing that file, and also waits for normal shutdown before a subsequent cold start. This is diagnostic/process-cleanup work, not a confirmed fix of the underlying runtime error. Six focused diagnostic tests cover delayed flush, bounded waiting and listener cleanup. Failed homepage response text is printed only by the explicitly marked credential-isolated localhost smoke, never by production smoke.

## Verification and remaining gates

### Reproduced rejected-body failure and bounded fix

[PR CI 34819384528](https://github.com/prakhar267/mira/actions/runs/34819384528) captured the previously missing cause: `ProxyController` / `ProxyWorker` reported `Network connection lost` after a request was rejected before consuming its POST body. Two independent artifact cold starts passed and the third failed. The same failure was reproduced locally by successive 2-byte/8-KiB synthetic POSTs, without credentials or provider access.

The no-bundle artifact does not receive Wrangler's development body-draining middleware. [Cloudflare's merged upstream fix explains why unread rejected POST bodies require cleanup](https://github.com/cloudflare/workers-sdk/pull/5106). The framework also transfers the incoming body to a replacement Request: an outer Worker wrapper alone was tested and **did not fix the reproduction**. Cleanup therefore runs in each of the four inference routes that owns the final Request, as well as the Worker boundary for pre-routing failures. It runs after the handler has authorized or refused the operation, without decoding, logging or retaining content. It stops at 100 ms, 32 chunks or the chunk crossing 64 KiB, and does not await a stalled cancellation. Denial responses and provider isolation are unchanged.

The chat-route fix passed the reproduced 24-POST sequence followed by five public artifact checks. The expanded regression rotates chat, speech, transcription and memory requests with both body sizes; CI requires that sequence on each of three independent cold starts. The new head must pass those checks before promotion. Seven focused cleanup tests cover unchanged responses/errors, already-owned bodies, chunk/byte bounds, stalled bodies/cancellation and disconnected streams; the actual four route tests assert rejected bodies are released and no account, budget or provider access occurs.

Final local verification of the expanded fix passed all **358 web tests**, **32 actual Worker tests**, zero-warning lint, route generation/TypeScript and a new Cloudflare build. Three fixed cold starts each passed all 24 rejected-body probes and all five public checks: **72 expected denials and 15/15 smoke checks**. No production request or inference call was used for that regression. Linux CI is still a separate required gate.

The isolated preparation branch passed all 345 web tests and 32 actual Worker integration tests. After integrating four runtime-diagnostics regressions, the primary workspace passed **349/349 web tests across 44 files**, full zero-warning web lint and route generation/TypeScript checks. Fresh compiled-browser/CI results for this new head must be checked separately; the parent commit's 90 passing browser cases are not substituted for that verification.

Remaining: resolve and verify the cold-start artifact failure; complete protection bootstrap/provenance, serving/drain fencing and source-loss admission/handoff; provision approved independent resources and key custody without spending; verify real email/alert receipt; physical voice/video, screen-reader and independent legal/security/provider review. Passing internal tests does not complete those gates.
