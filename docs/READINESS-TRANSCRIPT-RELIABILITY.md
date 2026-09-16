# Short-turn and transcription reliability follow-up

17 September 2026. Source/test evidence is not a production release claim. The
PR promotion record must identify the exact main artifact and live version.

## Reproducible defects fixed

- The primary STT filter rejected every one-word answer, including names,
  locations, numbers, agreement, rejection and spoken language choices. Those
  are now kept, with Unicode combining marks preserved. Empty audio/filler and
  known leaked-hint/boilerplate filtering remains; a genuine "I'm not sure what
  you're talking about" is no longer discarded as a hallucination.
- The fallback transcriber now applies the same content filter as the primary.
- The browser's en-IN recognizer could displace a still-pending multilingual
  transcript after 1.6 seconds, even when the confident English guess was
  wrong. It is now only a last resort after transport/provider failure, and
  only finalized high-confidence phrases are eligible. Consent, quota,
  malformed-recording and no-speech responses cannot be bypassed by that path.
- Successful server transcripts no longer wait up to 260 ms for the separate
  browser recognition session to end. This removes an application-side wait;
  it is not a claim of universally faster STT. Waiting for a slower accurate
  primary result can take longer than the old premature English guess.
- Bare language choices recognized in Devanagari (such as `अंग्रेज़ी`) now switch
  correctly. Brief thanks/apologies preserve the current conversational
  language. The colloquial spellings `achha`, `achhi` and `achhe` no longer
  accidentally route a Hinglish reaction to English.

Priya, TTS/STT providers, the chat model, VAD, quota/deadline limits and avatar
assets are unchanged. No new processor, paid plan or wider credential is added.

## Verification boundary

Unit tests cover ready/delayed transcripts, all protected error statuses,
fallback uncertainty, cancellation, Unicode short replies and language choices.
Worker tests use the actual routes, consent/capacity/storage boundaries and
synthetic primary/fallback provider bindings. Browser tests exercise real
MediaRecorder and WebAudio with a synthetic oscillator and deliberately
conflicting mocked recognizers; they are not human speech/acoustic acceptance.
The existing native streamed-playback checks remain required in all three
browser engines. Use the PR record for final counts and live checks.

The initial new WebKit fixture failed: mutations of retrieved native wrappers
did not intercept media acquisition or reliably count track cleanup. The fixture
now replaces the navigator property and observes native track `readyState`.
Its three WebKit scenarios then passed without relaxing assertions. A failed
diagnostic also ran out of disk space while retaining traces; that is not a
passing test. Only a task-created downloaded archive/header directory was
removed to recover space. Existing user files/caches were not cleaned.

A finite 16-request actual-provider diagnostic compared the current prompt to
one illustrative-example candidate on eight fictional scenarios. The candidate
reduced some unsolicited questions but still invented confidence and predicted
benefits. Neither version handled every case naturally. The candidate was
rejected, not shipped. That diagnostic also exposed the `achha` routing defect.
Raw fictional results must remain attached to the PR, including weak replies;
they are not a semantic-quality pass or production UI timing measurement.

## Rechecked external gates

On 17 September the live site still identified source `9b16d620c0a62a9066c7d611ea287c6264cffa1a`
and Cloudflare version `ab59bfba-011b-41cf-88d9-220b686ee9ed`, with reachable SQLite.
Worker secret **names only** showed `INWORLD_API_KEY` and `MIRA_ADMIN_KEY`.
GitHub's production environment contained `CLOUDFLARE_ACCOUNT_ID`, but no
deployment API token. No sender, incident endpoint or independent backup
activation was present in the reviewed configuration. Secret values were not
printed or committed. This is not proof of provider credits or email delivery.

The remaining gates cannot be certified by this patch: calibrated natural
replies and tail latency; physical microphones/speakers/phones and avatar
acceptance; human accessibility and independent security/legal/provider-data
reviews; approved independent backup resources/retention/key custody and a
real source-loss drill; verified sender/test mailbox; accepted incident owner
and alert destination; appropriately scoped production deployment credentials.
Owner inputs were requested rather than exporting user data, sending messages
or granting account-wide access without the missing scope decisions.
