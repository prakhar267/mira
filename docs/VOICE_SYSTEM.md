# Voice system

The Cloudflare web experience uses the browser's `en-IN` speech-recognition service for low-latency Hinglish call input when it is available. Where it is unavailable, chat voice notes, voice calls, and video calls send a short recording to Inworld STT-1 with Latin-script English/Hinglish bias; Workers AI Whisper Large V3 Turbo is the final backup. This keeps calls usable when a browser lacks speech recognition or the daily Workers AI allowance is unavailable. Inworld TTS-2 with the fixed `Priya` speaker handles speech output. Chat playback, voice calls, and video calls all use the same `/api/companion-speech` path and voice. Language is not forced in the TTS request, allowing Priya to auto-detect and preserve Hindi, English, and code-mixed Hinglish within one response. Configure `INWORLD_API_KEY` as a Worker secret; never expose it to the browser. The free Inworld On-Demand allowance is capped, and there is deliberately no lower-quality or paid fallback voice.

The product includes hands-free microphone capture, automatic listening after each reply, interruption, captions, visible audio controls, and camera consent flow. Transcribed speech and generated reply text are sent to the configured AI processors; a call recording is not saved by the web client.

A production implementation must continue to provide:

- explicit microphone permission and an always-visible recording state;
- provider timeouts, regional routing, quotas, and circuit breakers;
- transcript retention controls and separate consent for stored audio;
- interruption, mute, reconnect, device-change, and call-end handling;
- synthetic-voice disclosure and abuse reporting.

The UI must remain usable through text when any speech or realtime provider is unavailable.
