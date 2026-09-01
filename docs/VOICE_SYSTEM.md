# Voice system

The product includes voice-note recording state and mock transcription, browser-local speech playback, realtime-session API contracts, plan gating, a functional mock call state, visible audio controls, and camera consent flow. No microphone or camera data leaves the device in mock mode.

A production implementation must add:

- explicit microphone permission and an always-visible recording state;
- short-lived realtime credentials issued by the API;
- provider timeouts, regional routing, quotas, and circuit breakers;
- transcript retention controls and separate consent for stored audio;
- interruption, mute, reconnect, device-change, and call-end handling;
- synthetic-voice disclosure and abuse reporting.

The UI must remain usable through text when any speech or realtime provider is unavailable.
