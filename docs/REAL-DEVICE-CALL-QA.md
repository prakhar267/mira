# Real-device acceptance test — not yet signed off

Use only consenting adult testers. Synthetic TTS-to-STT tests are useful diagnostics but cannot establish human accent recognition, perceived voice quality, physical echo rejection or lip-sync quality.

## Device matrix

Run on Android Chrome, iPhone Safari, Windows Chrome and macOS Chrome/Safari. Include one headset and one speakerphone, quiet-room and fan/traffic noise, and a weak built-in microphone. Ask fluent speakers of English, Hindi and Hinglish with at least three regional Indian accents. Record device/browser/version, network, speaker consent and subjective scores. Do not upload a real person's recordings without permission.

## Shared conversation script

1. “आज तुम्हारा दिन कैसा था?” — a direct, natural Hindi reply, not a misunderstanding message.
2. “My cousin Arjun is visiting Jaipur on Saturday.”
3. “Actually Sunday, Saturday nahi.” — preserve the correction.
4. “वो कहाँ जा रहा है और कब?” — Jaipur and Sunday, in Hindi.
5. “yaar ofis mein boss ne sabke samne daant diya.” — address the workplace incident despite rough transcription.
6. “Bas suno, advice mat dena.” — no unsolicited advice/question.
7. “Okay, now give me one suggestion in English.” — follow the new request without forgetting the context.
8. After twenty unrelated turns, ask about Arjun again; distinguish recent history from explicitly approved saved memory.

## Call controls and measurements

- Allow, deny and revoke microphone permission; retry must be understandable, with no stuck “listening” indicator.
- Speak naturally without pressing a button for each turn. Listening should resume after each completed reply.
- Interrupt using the visible interrupt control, including while voice is being prepared. Then enable **Talk-over · headphones beta** using a headset: start speaking over Mira and check that playback stops without clipping your first words. It is off by default. Automatic speakerphone barge-in and physical echo rejection are **not certified**; do not enable headphone mode on speakers and call that a passing echo test.
- Try short pauses and incomplete sentences. Count clipped turns, missed words, duplicate turns and repeated clarification replies; retain actual examples.
- In speaker mode, verify Mira's own voice is not transcribed as the user. Test at multiple volume levels.
- Allow/deny camera, turn it off and on, background/foreground the app, end the call, and verify camera/mic indicators stop.
- Observe avatar cold load, blink stability, mouth start/stop relative to audible speech, frame-rate drops and a 20-minute call. Audio-amplitude gating is implemented; exact phoneme/viseme alignment is not claimed.
- Disconnect/reconnect Wi-Fi. Report a provider/network failure honestly, without inventing a companion reply or silently switching to another voice.

Suggested beta acceptance targets (not measured results): at least 95% intent understood on the collected samples; fewer than 5% unnecessary clarification turns; no stuck mic/camera, duplicate replies or self-transcription; P95 end-of-speech to audible reply under 5 seconds. Record STT time, generation time, TTS time and playback separately. Current server API latency results do **not** equal this complete acoustic round-trip measurement.

With opt-in analytics, `call_transcribe_ms`, `call_reply_ms`, `call_speech_ms` and `call_roundtrip_ms` measure the client stages without transcripts or recordings. The total starts when the microphone silence detector closes the utterance, so its preceding silence window is not included. DNT and denied analytics consent suppress these events. Local controller regressions exercise both call labels, not physical devices or different browsers.
