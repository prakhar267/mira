"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Camera,
  CameraSlash,
  ChatCircleDots,
  Heart,
  Microphone,
  MicrophoneSlash,
  PhoneDisconnect,
  SpeakerHigh,
  SpeakerSlash,
  Sparkle,
  VideoCamera,
  Waveform,
} from "@phosphor-icons/react";
import type { EnvironmentId } from "@/lib/state";

const scenes: Array<{ id: EnvironmentId; label: string; image: string }> = [
  { id: "window-nook", label: "Sunny loft", image: "/assets/mira/loft-morning.png" },
  { id: "rainy-cafe", label: "Rainy café", image: "/assets/mira/rainy-cafe.png" },
  { id: "rooftop", label: "Rooftop", image: "/assets/mira/rooftop-evening.png" },
];

const callActivities = ["Would you rather", "Relationship cards", "Plan a date", "Tell me about your day"];

interface VideoSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  abort: () => void;
  onresult: ((event: { results: ArrayLike<{ 0?: { transcript?: string } }> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

type VideoSpeechWindow = Window & typeof globalThis & {
  SpeechRecognition?: new () => VideoSpeechRecognition;
  webkitSpeechRecognition?: new () => VideoSpeechRecognition;
};

function videoRecognitionConstructor() {
  const speechWindow = window as VideoSpeechWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
}

function videoVoiceProfile(voiceId: string) {
  if (voiceId.includes("calm")) return { rate: .88, pitch: .98 };
  if (voiceId.includes("confident")) return { rate: .97, pitch: 1 };
  if (voiceId.includes("warm")) return { rate: .91, pitch: 1.01 };
  return { rate: .98, pitch: 1.04 };
}

function speakLine(text: string, voiceId: string, onStart: () => void, onEnd: () => void) {
  if (!("speechSynthesis" in window)) {
    onEnd();
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices();
  utterance.voice = voices.find((voice) => /^en[-_]/i.test(voice.lang) && /samantha|ava|zira|serena|aria|female|google uk english/i.test(voice.name))
    ?? voices.find((voice) => /^en[-_]/i.test(voice.lang))
    ?? null;
  const profile = videoVoiceProfile(voiceId);
  utterance.rate = profile.rate;
  utterance.pitch = profile.pitch;
  utterance.onstart = onStart;
  utterance.onend = onEnd;
  utterance.onerror = onEnd;
  window.speechSynthesis.speak(utterance);
}

export function VideoCallModal({
  companionName,
  userName,
  voiceId,
  initialEnvironment,
  onUserTurn,
  onAnalyzeFrame,
  onRealtimeConnect,
  onClose,
}: {
  companionName: string;
  userName: string;
  voiceId: string;
  initialEnvironment: EnvironmentId;
  onUserTurn: (content: string) => Promise<string>;
  onAnalyzeFrame: (dataBase64: string, contentType: string) => Promise<string>;
  onRealtimeConnect?: () => Promise<{ peer: RTCPeerConnection; events: RTCDataChannel; audio: HTMLAudioElement; disconnect(): void }>;
  onClose: (durationSeconds: number) => void;
}) {
  const greeting = `Hey ${userName}. You made it—what’s up?`;
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(true);
  const [captions, setCaptions] = useState(true);
  const [heartSent, setHeartSent] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [visionBusy, setVisionBusy] = useState(false);
  const [speechError, setSpeechError] = useState("");
  const [listening, setListening] = useState(false);
  const [environment, setEnvironment] = useState(initialEnvironment);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activity, setActivity] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [companionLine, setCompanionLine] = useState(greeting);
  const [userLine, setUserLine] = useState("");
  const [transport, setTransport] = useState<"connecting" | "realtime" | "fallback">(onRealtimeConnect ? "connecting" : "fallback");
  const realtimeRef = useRef<{ peer: RTCPeerConnection; events: RTCDataChannel; audio: HTMLAudioElement; disconnect(): void } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const greetingSpoken = useRef(false);
  const recognitionRef = useRef<VideoSpeechRecognition | null>(null);
  const realtimeReplyStarted = useRef(false);

  const speak = useCallback((text: string, force = false) => {
    if (transport === "realtime") { setSpeaking(false); return; }
    if (!speaker && !force) {
      setSpeaking(false);
      return;
    }
    speakLine(text, voiceId, () => setSpeaking(true), () => setSpeaking(false));
  }, [speaker, transport, voiceId]);

  useEffect(() => {
    if (!onRealtimeConnect) return;
    let active = true;
    void onRealtimeConnect().then((connection) => {
      if (!active) { connection.disconnect(); return; }
      realtimeRef.current = connection;
      setTransport("realtime");
      connection.events.addEventListener("open", () => connection.events.send(JSON.stringify({ type: "response.create", response: { instructions: `Greet ${userName} naturally in one sentence for this video-avatar call.` } })));
      connection.events.addEventListener("message", (event) => {
        try {
          const payload = JSON.parse(String(event.data)) as { type?: string; delta?: string; transcript?: string };
          if (payload.type === "response.output_audio_transcript.delta" && payload.delta) { setSpeaking(true); setCompanionLine((line) => { const next = realtimeReplyStarted.current ? `${line}${payload.delta}` : payload.delta!; realtimeReplyStarted.current = true; return next; }); }
          if (payload.type === "response.output_audio_transcript.done") { realtimeReplyStarted.current = false; setSpeaking(false); }
          if (payload.type === "conversation.item.input_audio_transcription.completed" && payload.transcript) { setUserLine(payload.transcript); setListening(false); }
        } catch { /* Ignore unknown provider events. */ }
      });
    }).catch((cause) => {
      if (!active) return;
      setTransport("fallback");
      setCameraError(cause instanceof Error ? `${cause.message} Using browser voice fallback.` : "Using browser voice fallback.");
    });
    return () => { active = false; realtimeRef.current?.disconnect(); realtimeRef.current = null; };
  }, [onRealtimeConnect, userName]);

  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1_000);
    return () => {
      window.clearInterval(timer);
      recognitionRef.current?.abort();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      window.speechSynthesis?.cancel();
    };
  }, []);

  useEffect(() => {
    if (greetingSpoken.current) return;
    if (transport !== "fallback") return;
    const connect = window.setTimeout(() => {
      if (greetingSpoken.current) return;
      greetingSpoken.current = true;
      speak(greeting);
    }, 550);
    return () => window.clearTimeout(connect);
  }, [greeting, speak, transport]);

  const toggleCamera = async () => {
    if (cameraOn) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      setCameraOn(false);
      return;
    }
    setCameraError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera preview is unavailable in this browser.");
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
    } catch {
      setCameraError("Camera stayed off. You can keep calling or try again after allowing camera access.");
    }
  };

  const shareCurrentFrame = async () => {
    const video = videoRef.current;
    if (!cameraOn || !video || visionBusy) return;
    setCameraError("");
    setVisionBusy(true);
    try {
      if (!video.videoWidth || !video.videoHeight) throw new Error("The camera is still warming up.");
      const canvas = document.createElement("canvas");
      const maximumWidth = 960;
      const scale = Math.min(1, maximumWidth / video.videoWidth);
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("The current frame could not be prepared.");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const contentType = "image/jpeg";
      const dataBase64 = canvas.toDataURL(contentType, .78).split(",")[1] ?? "";
      if (!dataBase64) throw new Error("The current frame could not be prepared.");
      const reply = await onAnalyzeFrame(dataBase64, contentType);
      setCompanionLine(reply);
      speak(reply);
    } catch (cause) {
      setCameraError(cause instanceof Error ? cause.message : "The current frame could not be shared.");
    } finally {
      setVisionBusy(false);
    }
  };

  const submitContent = async (content: string) => {
    const clean = content.trim();
    if (!clean || thinking) return;
    setUserLine(clean);
    setListening(false);
    setSpeechError("");
    setThinking(true);
    if (transport === "realtime" && realtimeRef.current?.events.readyState === "open") {
      realtimeRef.current.events.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: clean }] } }));
      realtimeRef.current.events.send(JSON.stringify({ type: "response.create" }));
      setThinking(false);
      return;
    }
    try {
      const reply = await onUserTurn(clean);
      setCompanionLine(reply);
      speak(reply);
    } catch {
      setCompanionLine("I missed that for a second—say it once more?");
    } finally {
      setThinking(false);
    }
  };

  const beginListening = () => {
    if (muted || thinking) return;
    if (speaking) {
      window.speechSynthesis?.cancel();
      setSpeaking(false);
      if (realtimeRef.current?.events.readyState === "open") realtimeRef.current.events.send(JSON.stringify({ type: "response.cancel" }));
    }
    if (transport === "realtime") {
      setListening(true);
      setSpeechError("");
      return;
    }
    const Recognition = videoRecognitionConstructor();
    if (!Recognition) {
      setSpeechError("Voice input is unavailable in this browser. Use Chrome or Edge and allow microphone access, then try again.");
      return;
    }
    recognitionRef.current?.abort();
    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    let transcript = "";
    recognition.onresult = (event) => {
      transcript = Array.from(event.results).map((result) => result[0]?.transcript ?? "").join(" ").trim();
      setUserLine(transcript);
    };
    recognition.onerror = (event) => {
      recognitionRef.current = null;
      setListening(false);
      setSpeechError(event.error === "not-allowed" ? "Microphone access is blocked. Allow it in your browser settings, then tap the mic again." : "I couldn’t hear that clearly. Tap the mic and try once more.");
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
      if (transcript) void submitContent(transcript);
    };
    recognitionRef.current = recognition;
    setListening(true);
    setSpeechError("");
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setListening(false);
      setSpeechError("The microphone is already busy. Wait a second, then tap again.");
    }
  };

  const currentScene = scenes.find((scene) => scene.id === environment) ?? scenes[0]!;
  const time = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <motion.div className="live-call live-call--video" role="dialog" aria-modal="true" aria-label={`Video call with ${companionName}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <motion.img key={currentScene.id} className="video-call__avatar" src={currentScene.image} alt={`${companionName} in ${currentScene.label.toLowerCase()}`} initial={{ opacity: 0, scale: 1.03 }} animate={speaking ? { opacity: 1, scale: [1, 1.012, 1], x: [0, 2, 0] } : { opacity: 1, scale: 1, x: 0 }} transition={{ duration: 3.2, repeat: speaking ? Infinity : 0 }} />
      <div className="live-call__veil live-call__veil--video" />
      <header className="live-call__header"><span><i className="status-dot" /> Live together</span><strong>{companionName}</strong><time>{time}</time></header>

      <div className="video-call__status"><Waveform aria-hidden="true" /><span>{thinking ? "Thinking about that" : speaking ? `${companionName} is speaking` : listening ? "Listening to you" : "Here with you"}</span></div>

      <div className="video-call__camera">
        <video ref={videoRef} muted playsInline aria-label="Your local camera preview" />
        {cameraOn ? <span><Camera aria-hidden="true" weight="fill" /> Your camera</span> : <div><CameraSlash aria-hidden="true" /><small>Your camera is off</small><button type="button" onClick={() => void toggleCamera()}>Turn it on</button></div>}
      </div>

      <div className="video-call__tools">
        <label>Scene<select value={environment} onChange={(event) => setEnvironment(event.target.value as EnvironmentId)}>{scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.label}</option>)}</select></label>
        <button type="button" onClick={() => setActivityOpen((value) => !value)} aria-expanded={activityOpen}><Sparkle aria-hidden="true" /> Activity</button>
        <button type="button" disabled={!cameraOn || visionBusy} onClick={() => void shareCurrentFrame()}><Camera aria-hidden="true" /> {visionBusy ? "Looking…" : "Show frame"}</button>
      </div>

      {activityOpen ? <div className="call-activity-menu">{callActivities.map((item) => <button type="button" key={item} onClick={() => { setActivity(item); setActivityOpen(false); }}>{item}</button>)}</div> : null}
      {activity ? <div className="call-activity-card"><span>Playing together</span><strong>{activity}</strong><p>{activity === "Would you rather" ? "Sunrise coffee or a midnight city walk? Tell me why." : "Take turns. There are no perfect answers."}</p><button type="button" onClick={() => setActivity("")}>Close card</button></div> : null}

      <button type="button" className="barge-in" onClick={beginListening} disabled={muted || thinking || listening}><Waveform aria-hidden="true" /> {thinking ? "Thinking…" : listening ? "Listening…" : speaking ? "Speak now to interrupt" : "Tap and talk"}</button>
      {speechError ? <p className="call-speech-error" role="status">{speechError}</p> : null}
      {cameraError ? <p className="camera-error" role="status">{cameraError}</p> : null}
      {captions ? <div className="video-call__captions" aria-live="polite">{userLine ? <p><span>You</span>{userLine}</p> : null}<p><span>{companionName}</span>{thinking ? "…" : companionLine}</p></div> : null}

      <div className="live-call__controls">
        <button type="button" className={muted ? "call-orb call-orb--active" : "call-orb"} onClick={() => { recognitionRef.current?.abort(); setListening(false); setMuted((value) => { const next = !value; realtimeRef.current?.peer.getSenders().forEach((sender) => { if (sender.track?.kind === "audio") sender.track.enabled = !next; }); return next; }); }} aria-label={muted ? "Unmute microphone" : "Mute microphone"}>{muted ? <MicrophoneSlash aria-hidden="true" /> : <Microphone aria-hidden="true" />}</button>
        <button type="button" className={cameraOn ? "call-orb call-orb--active" : "call-orb"} onClick={() => void toggleCamera()} aria-label={cameraOn ? "Turn camera off" : "Turn camera on"}>{cameraOn ? <VideoCamera aria-hidden="true" weight="fill" /> : <CameraSlash aria-hidden="true" />}</button>
        <button type="button" className={speaker ? "call-orb call-orb--active" : "call-orb"} onClick={() => { if (speaker) window.speechSynthesis?.cancel(); else speak(companionLine, true); setSpeaker((value) => { const next = !value; if (realtimeRef.current) realtimeRef.current.audio.muted = !next; return next; }); }} aria-label={speaker ? "Turn speaker off" : "Turn speaker on"}>{speaker ? <SpeakerHigh aria-hidden="true" /> : <SpeakerSlash aria-hidden="true" />}</button>
        <button type="button" className={captions ? "call-orb call-orb--active" : "call-orb"} onClick={() => setCaptions((value) => !value)} aria-label={captions ? "Hide captions" : "Show captions"}><ChatCircleDots aria-hidden="true" /></button>
        <button type="button" className={heartSent ? "call-orb call-orb--heart" : "call-orb"} onClick={() => { setHeartSent(true); window.setTimeout(() => setHeartSent(false), 1_500); }} aria-label="Send heart"><Heart aria-hidden="true" weight={heartSent ? "fill" : "regular"} /></button>
        <button type="button" className="call-orb call-orb--end" onClick={() => onClose(seconds)} aria-label="End video call"><PhoneDisconnect aria-hidden="true" weight="fill" /></button>
      </div>
      <AnimatePresence>{heartSent ? <motion.div className="call-heart" initial={{ opacity: 0, scale: .5, y: 0 }} animate={{ opacity: 1, scale: 1.4, y: -110 }} exit={{ opacity: 0 }}><Heart weight="fill" /></motion.div> : null}</AnimatePresence>
      <small className="live-call__disclosure">Camera stays local until you tap Show frame · raw call media is not recorded · {transport === "realtime" ? "secure realtime audio connected" : transport === "connecting" ? "connecting secure audio…" : "browser voice fallback"}</small>
    </motion.div>
  );
}
