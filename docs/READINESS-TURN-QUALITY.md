# Brief-turn quality and diagnostic follow-through

18 September 2026 (India). This document describes source changes, not a live
release claim; the PR promotion record must identify the deployed main artifact.
Payments, voice/provider choices, storage identities and quotas are unchanged.

## Changes

- A standalone thank-you receives the model's own brief acknowledgement without
  an extra question or invitation to keep talking. A complete first sentence is
  kept; open quotes and first-sentence questions are not blindly truncated.
  Additional requests such as "thanks, what should I pack?" and answers such as
  "yes" are not closure and retain their normal full reply.
- Voice/video thank-you turns finish inference after one complete sentence,
  rather than waiting for an unwanted second sentence or an open provider tail.
  Ordinary call turns keep the two-sentence policy; text streaming still observes
  its completion/safety protocol. This is a bounded application-side latency
  change, not a claim that all provider tail latency is eliminated.
- A user's own unquoted progressive verb supplies turn-local grammatical
  agreement: `ja rahi hoon` should be reflected as `tum ... ja rahi ho`. This is
  linguistic agreement, not gender inference or a saved profile attribute.
  Quotes, relatives, group/unknown inflections and drafting remain excluded.
- Standalone `shukriya` / `dhanyavaad` and complete phrases such as `ja rahe hain`
  now route to Roman Hinglish. English thank-you variants preserve the active
  language. English references to a film/title do not match standalone rules.
- `scripts/short-speech-qa.mjs` adds a finite, explicit live diagnostic with
  retained fictional audio. Five fixed isolated words (or two punctuation
  variants with `--sentence-boundary`) each run once. Semantic failures remain
  failures; auth/quota/transport errors stop. It never renews sessions or retries
  inference, and revokes the owned demo session afterward.

## Verification and failures retained

The first new Worker test revealed a real standalone `shukriya` routing gap;
the application was fixed rather than changing the expected language. A paired
16-request direct Workers AI diagnostic (eight fictional cases, baseline and
candidate once each) corrected the observed feminine Roman-Hindi disagreement
and removed the extra question after a Hindi thank-you. One Hindi reply remained
awkward/mixed with English names. The probe also exposed `shukriya` and plural
progressive routing; those fixes were added afterward and require final live
verification. A direct binding probe is not call-interface or acoustic latency.
Do not generalize this small sample into perfect conversational quality.

On deployed source `64c165377bc9fd518517e12534ad277203bd4314`, the new audio
diagnostic passed `नहीं`, `one`, and `English`, but failed both `Pune` and `पुणे`.
Adding final punctuation did not fix either city. The exact same retained city
clips also failed the already-configured Cloudflare Whisper fallback in a
separate two-request check. Therefore no unproven provider swap, language lock,
vocabulary bias or `One`→`Pune` text replacement is shipped. Those could hide a
pronunciation defect or corrupt a legitimate number. The short-name failure
remains open pending acoustic/recognition evaluation; these tests alone cannot
isolate the responsible component. Priya remains the selected voice.

Unit and Worker regressions cover closure boundaries, language preservation,
agreement-cue exclusions, complete/quoted/split streaming sentences, early
cancellation, and text/voice/video routes with consent/capacity/storage intact.
Use the PR's final CI and production report for actual test counts, release
identity and live acceptance, including any failures.

## External completion gates

The owner was asked for approved independent archive storage/key custody and
retention; a verified sender/test inbox; an incident destination and accepted
owner; and action-time approval for a 90-day Mira-only deployment token. No
customer data export, recipient selection, identity/access grant, on-call
commitment or paid resource is inferred from "complete everything".
Physical device/echo/accent/lip-sync acceptance and independent human
accessibility, legal, security and provider-data reviews are not completed by
automated fixtures. Independent source-loss recovery is not just a missing
environment variable: its authority/admission and activation gates remain in
[the recovery contract](PROTECTED-RECOVERY-V2.md).
