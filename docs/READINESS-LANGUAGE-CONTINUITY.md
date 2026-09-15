# Language continuity follow-up

16 September 2026. Implementation evidence is distinct from release evidence;
the PR promotion record identifies the live SHA and actual-provider results.

## Fixed

- Repeated neutral acknowledgements (`okay`, `hmm`, `right`, etc.) now inherit
  the most recent meaningful **user** language, not the previous acknowledgement
  or an assistant reply. Explicit switches and substantive English still switch
  immediately. This shared decision serves chat, voice and video.
- Common inflected Hinglish such as `ab pakka select ho jayegi na?` was being
  classified as English. The existing two-marker heuristic now covers these
  future-tense/colloquial forms. A single name such as Sahi is not sufficient.
  This remains a bounded heuristic, not universal language identification.
- Added an eight-turn acknowledgement/language-switch scenario and review flags
  for unsupported outcome assurances. These flags do not rewrite live replies;
  a language/anchor pass is explicitly not semantic acceptance.
- Actual Worker route fixtures exercise all three delivery modes with repeated
  acknowledgements and explicit Hindi, Hinglish and English choices. Fixtures
  validate wiring and boundaries, not real model or microphone performance.

Priya, STT, the inference model, avatar assets, deadlines and capacity limits are
unchanged. No paid service, new processor or wider account permission is enabled.

## Experiments that were not shipped

Two ordinary-prompt variants were tested in a finite direct-provider diagnostic:
eight baseline turns, eight first-candidate turns and eight second-candidate
turns. Inputs were fictional, including prior failing examples and controls for
explicit older references, named-fact recall and authored first-person drafts.
All 24 attempts returned, but both prompt variants still gave overconfident
outcome claims and weak interpretation of an ambiguous joke reaction. An
authored draft also appended an unrequested sentence. Both prompt variants were
removed; changing wording is not sufficient evidence of a quality fix. Raw
diagnostic outputs and the later production checks belong in the PR evidence.

The direct checks did demonstrate the language defects: a second `hmm` caused
English output before the fix, and the inflected Hinglish interview question
was assigned English. Correcting routing does not certify the resulting prose.

An unrestricted local unit run hit two existing five-second test timeouts in
storage/recovery scenarios. A complete run with four workers passed at the
unchanged timeout; no assertions or production behavior were relaxed. CI is a
separate required check, not inferred from that local run.

## Still open

- Context interpretation, grammar and unsupported reassurance in generated
  replies: the retained failed diagnostics prevent calling this fully solved.
- External provider outages cannot be eliminated by application retries. Keep
  the existing bounded failure/cancellation behavior and report actual failures.
- Cold avatar startup remains about 5.55 seconds in the prior live slow-network
  lab, not instant and not a physical-phone measurement. No new avatar speed
  improvement is claimed by this patch.
- Physical-device/acoustic acceptance, independent human reviews, approved
  independent backup placement/key custody, verified email delivery, incident
  destination/owner and scoped GitHub deployment credentials remain the owner
  gates in [the readiness ledger](READINESS-STATUS.md). Internal code/tests cannot
  truthfully sign these off or invent the missing approvals.
