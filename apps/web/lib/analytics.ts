export const analyticsEvents = ["view_home", "view_chat", "view_profile", "view_memory", "view_companion", "view_moments", "view_activities", "voice_call_start", "video_call_start", "chat_send", "reply_received", "reply_failed", "reply_misunderstood", "demo_reset", "call_endpoint_ms", "call_transcribe_ms", "call_reply_ms", "call_speech_ms", "call_roundtrip_ms"] as const;
export const analyticsConsentKey = "mira-analytics-consent-v1";
export function trackEvent(event: typeof analyticsEvents[number], durationMs = 0) {
  try {
    if (navigator.doNotTrack === "1" || localStorage.getItem(analyticsConsentKey) !== "yes") return;
    // No identity, URL, message, memory, email, audio or camera data is sent.
    void fetch("/api/events", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({event,durationMs}),keepalive:true}).catch(()=>undefined);
  } catch { /* Analytics must never interrupt conversation. */ }
}
