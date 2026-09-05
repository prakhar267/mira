# Voice system

The Cloudflare web experience uses Workers AI Whisper Large V3 Turbo for Hinglish transcription and the hosted open-source Veena model with the fixed `kavya` speaker for speech. Chat playback, voice calls, and video calls all use the same `/api/companion-speech` path and voice. Veena receives the original Hindi, English, or code-mixed text so it can pronounce each language natively. Configure `SEGMIND_API_KEY` as a Worker secret; never expose it to the browser.

The product includes hands-free microphone capture, automatic listening after each reply, interruption, captions, visible audio controls, and camera consent flow. Transcribed speech and generated reply text are sent to the configured AI processors; a call recording is not saved by the web client.

A production implementation must continue to provide:

- explicit microphone permission and an always-visible recording state;
- provider timeouts, regional routing, quotas, and circuit breakers;
- transcript retention controls and separate consent for stored audio;
- interruption, mute, reconnect, device-change, and call-end handling;
- synthetic-voice disclosure and abuse reporting.

The UI must remain usable through text when any speech or realtime provider is unavailable.
