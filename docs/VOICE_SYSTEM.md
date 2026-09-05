# Voice system

The Cloudflare web experience records short speech turns and sends them to Inworld STT-1 without forcing a language, so English, Hindi in Devanagari, and Roman Hinglish can be recognized turn by turn. Browser recognition is retained only as a fallback, and Workers AI Whisper Large V3 Turbo is the final backup. End-of-speech detection stops after 850 ms of silence and hands-free listening restarts 280 ms after playback ends.

Demo conversation replies first use LLM7's anonymous `fast` selector directly from the browser and immediately use the deterministic local conversation engine if the free request is unavailable or invalid. API-only callers use the Worker route, which tries LLM7, Workers AI, and then returns an explicit service error. The external selectors and free allowances can change and do not provide a production SLA. Inworld TTS-2 Flash with the fixed `Priya` speaker handles lower-latency speech output. Chat playback, voice calls, and video calls all use the same `/api/companion-speech` path and voice. Language is not forced in the TTS request, allowing Priya to preserve Hindi, English, and code-mixed Hinglish within one response. Configure `INWORLD_API_KEY` as a Worker secret; never expose it to the browser. The free Inworld allowance is capped, and there is deliberately no lower-quality or paid fallback voice.

The product includes hands-free microphone capture, automatic listening after each reply, interruption, captions, visible audio controls, and camera consent flow. Transcribed speech and generated reply text are sent to the configured AI processors; a call recording is not saved by the web client.

A production implementation must continue to provide:

- explicit microphone permission and an always-visible recording state;
- provider timeouts, regional routing, quotas, and circuit breakers;
- transcript retention controls and separate consent for stored audio;
- interruption, mute, reconnect, device-change, and call-end handling;
- synthetic-voice disclosure and abuse reporting.

The UI must remain usable through text when any speech or realtime provider is unavailable.
