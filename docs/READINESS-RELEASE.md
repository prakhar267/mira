# Release continuation — 14 September 2026

Payments remain disabled. This record distinguishes repository access, CI execution and actual production promotion; passing local tests does not deploy the site.

## Repository access restored

The owner authorized making `prakhar267/mira` public if Actions remained blocked. A fresh attempt 2 of run [34761005490](https://github.com/prakhar267/mira/actions/runs/34761005490), at source `16c89499f522b7fd08206acdf65dc2491c810d5f`, again failed before any job steps with GitHub's account payment/spending-limit annotation. After a bounded exposure audit, the repository was made public on September 14. Attempt 3 then actually executed checkout, Node setup and dependency installation. No billing settings, paid services or repository license were changed.

The pre-publication check covered all 68 locally reachable commits/9 refs, 1,344 blobs (~202 MB), sensitive dump/config paths, 54 text-artifact versions, metadata in 38 audio/video files, and sampled higher-risk demo/call/profile screenshots and contact sheets. No unexpected credential, production dump or private recording was identified. Official Gitleaks 8.30.1 found one generic-key match in a historic browser adult-demo consent storage key; its only uses were localStorage get/set, not authentication. Other signature matches were synthetic fixtures and example URLs. GitHub reported zero retained Actions artifacts. This was a bounded engineering check, not an independent security certification or exhaustive frame-by-frame/media/audio/remote-log review.

## Defects exposed by fresh CI and release review

- Attempt 3 failed at fresh locked installation: `@prisma/client@6.19.0` was in the obsolete `onlyBuiltDependencies` list but absent from the effective `allowBuilds` map. The map now explicitly permits this already-selected dependency's generation hook; the redundant older list is removed. Unknown builds remain blocked and explicit denied hooks remain denied. Cached local install verification passed, but only the next clean CI run can establish the fresh-runner fix. [pnpm build policy](https://pnpm.io/settings/build#allowbuilds).
- The release sealer hashes hidden `.vite/manifest.json` and `.assetsignore` files, but the artifact uploader excluded hidden files by default. The upload now includes the sealed hidden files; credential-file rejection still happens before upload. CI downloads its uploaded artifact into a fresh temporary directory and verifies every sealed byte before success, so archive loss cannot silently pass. [Upload action hidden-file behavior](https://github.com/actions/upload-artifact#uploading-hidden-files).

The focused artifact suite passed 18/18, including omission/restoration of each hidden artifact file, with scoped lint passing. Prisma generation also passed locally. A separate bounded source review of configuration/migration identity, workflow provenance, consent/account/memory boundaries and recovery gates found no further verified release blocker; this is neither an independent security assessment nor proof of live migration behavior.

The clean runner for `751ad78` passed locked installation, Prisma generation, workspace lint/typecheck/tests/build and asset budgets. Its Worker suite passed 23/24: the deletion-during-legacy-import fixture used the fixed date September 14, which now collides with the daily authoritative snapshot created by signup. The legacy read therefore correctly never began. This failure was reproduced locally before editing. The fixture now uses a still-retained previous-week date and asserts that the authoritative row is absent before starting the race; the unchanged deletion and cleanup assertions must still pass. The full local Worker rerun passed 24/24 across all five files, with scoped lint passing. No production deletion behavior is relaxed.

The earlier exact-source local artifact smoke for `16c8949` passed 5/5 with zero provider requests and zero account mutations; its evidence is retained under `audit/readiness-2026-09-13-16c8949/artifact/`. This is not evidence that the same version is live.

## Remaining gates

The open readiness PR must pass CI and review before merge, followed by successful trusted `main` CI and exact-artifact promotion. GitHub repository/production-environment Cloudflare secrets are not configured. Existing owner-authenticated Wrangler can list deployments, but no production deployment has occurred in this continuation yet. Do not bypass source/artifact provenance or silently publish personal OAuth credentials to GitHub.

Independent source-loss recovery authority/storage, actual sender/alert delivery, physical-device voice/video and screen-reader acceptance, and independent legal/security/provider review remain separate unfinished gates. See [the prior continuation](READINESS-CONTINUATION.md), [recovery operations](ENCRYPTED-BACKUP-OPERATIONS.md) and [physical-device protocol](REAL-DEVICE-CALL-QA.md). No new provider traffic, real user export, account migration, payment or external delivery was performed by these checks.
