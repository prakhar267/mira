# Luma voice and video architecture

## Provider boundaries

The platform exposes independent speech-to-text, text-to-speech, realtime conversation, vision, avatar, and moderation contracts. Short-lived credentials are issued server-side; model IDs and provider secrets never reach UI code.

## Realtime path

```text
microphone → permission + visible MIC ON state → VAD → streaming STT
→ companion context → streaming response → TTS → audio output
→ viseme/amplitude lip sync → expression and gesture
```

When VAD detects the user speaking during Luma's audio, the client cancels TTS immediately, resets lip sync, marks Luma as listening, and resumes transcription. This barge-in path is a first-class state transition, not a cosmetic button.

## Calls

Voice and video calls share a session state machine: `connecting`, `listening`, `thinking`, `speaking`, `interrupted`, `reconnecting`, and `ended`. Raw audio/video is not retained by default. Optional summaries and important moments are stored separately from media.

The video surface renders Luma full screen with optional user camera picture-in-picture. Camera is off by default, requires explicit permission, displays a persistent CAMERA ON indicator, samples only permitted frames for vision, and never performs sensitive-attribute inference.

## Mock mode

Mock calls simulate connection, turn-taking, waveform, mouth movement, expressions, barge-in, scene switching, camera consent, activity overlays, call duration, and summary creation without requesting a real microphone or camera stream.
