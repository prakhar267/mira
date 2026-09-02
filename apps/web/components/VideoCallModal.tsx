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
import {
  playCompanionSpeech,
  recognitionLocale,
  speechLanguageOptions,
  type CompanionSpeechPlayback,
  type SpeechLanguage,
} from "@/lib/speech";
import { companionVoiceProfile, companionVoiceProfiles } from "@/lib/voice-profiles";

const callActivities = ["Would you rather", "Relationship cards", "Plan a date", "Tell me about your day"];
const avatarFrames = {
  idle: "/assets/mira/video-call-real-idle.jpg",
  speaking: "/assets/mira/video-call-real-speaking.jpg",
  blink: "/assets/mira/video-call-real-blink.jpg",
};

interface VideoSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
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

export function VideoCallModal({
  companionName,
  userName,
  voiceId,
  onUserTurn,
  onTranscribedTurn,
  onVoiceChange,
  onAnalyzeFrame,
  onRealtimeConnect,
  onClose,
}: {
  companionName: string;
  userName: string;
  voiceId: string;
  initialEnvironment: string;
  onUserTurn: (content: string) => Promise<string>;
  onTranscribedTurn?: (content: string) => Promise<void> | void;
  onVoiceChange?: (voiceId: string) => void;
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
  const [activityOpen, setActivityOpen] = useState(false);
  const [activity, setActivity] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [companionLine, setCompanionLine] = useState(greeting);
  const [userLine, setUserLine] = useState("");
  const [language, setLanguage] = useState<SpeechLanguage>("auto");
  const [activeVoiceId, setActiveVoiceId] = useState(voiceId);
  const [transport, setTransport] = useState<"connecting" | "realtime" | "fallback">(onRealtimeConnect ? "connecting" : "fallback");
  const realtimeRef = useRef<{ peer: RTCPeerConnection; events: RTCDataChannel; audio: HTMLAudioElement; disconnect(): void } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const greetingSpoken = useRef(false);
  const recognitionRef = useRef<VideoSpeechRecognition | null>(null);
  const realtimeReplyStarted = useRef(false);
  const playbackRef = useRef<CompanionSpeechPlayback | null>(null);
  const onTranscribedTurnRef = useRef(onTranscribedTurn);
  const speechTurn = useRef(0);
  const listenTimerRef = useRef<number | null>(null);
  const startListeningRef = useRef<() => void>(() => undefined);
  const mutedRef = useRef(false);
  const activeRef = useRef(true);
  const speakingRef = useRef(false);
  const thinkingRef = useRef(false);
  const ignoredRecognitionsRef = useRef(new WeakSet<VideoSpeechRecognition>());

  useEffect(() => { onTranscribedTurnRef.current = onTranscribedTurn; }, [onTranscribedTurn]);
  useEffect(() => { setActiveVoiceId(voiceId); }, [voiceId]);

  const changeSpeaking = useCallback((next: boolean) => {
    speakingRef.current = next;
    setSpeaking(next);
  }, []);

  const changeThinking = useCallback((next: boolean) => {
    thinkingRef.current = next;
    setThinking(next);
  }, []);

  const stopRecognition = useCallback((ignoreTranscript = true) => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    if (ignoreTranscript) ignoredRecognitionsRef.current.add(recognition);
    recognitionRef.current = null;
    recognition.abort();
  }, []);

  const queueAutoListen = useCallback((delay = 650) => {
    if (listenTimerRef.current) window.clearTimeout(listenTimerRef.current);
    if (transport !== "fallback") return;
    listenTimerRef.current = window.setTimeout(() => {
      listenTimerRef.current = null;
      if (
        activeRef.current
        && !mutedRef.current
        && !recognitionRef.current
        && !speakingRef.current
        && !thinkingRef.current
      ) startListeningRef.current();
    }, delay);
  }, [transport]);

  const speak = useCallback((text: string, force = false, selectedVoiceId = activeVoiceId) => {
    if (transport === "realtime") { changeSpeaking(false); return; }
    if (!speaker && !force) {
      changeSpeaking(false);
      setListening(true);
      queueAutoListen();
      return;
    }
    if (listenTimerRef.current) {
      window.clearTimeout(listenTimerRef.current);
      listenTimerRef.current = null;
    }
    stopRecognition();
    speechTurn.current += 1;
    const turn = speechTurn.current;
    playbackRef.current?.cancel();
    setListening(false);
    changeSpeaking(false);
    playbackRef.current = playCompanionSpeech(text, {
      voiceId: selectedVoiceId,
      language,
      onStart: () => { if (speechTurn.current === turn) changeSpeaking(true); },
      onEnd: () => {
        if (speechTurn.current !== turn || !activeRef.current) return;
        changeSpeaking(false);
        setListening(true);
        queueAutoListen();
      },
    });
  }, [activeVoiceId, changeSpeaking, language, queueAutoListen, speaker, stopRecognition, transport]);

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
          if (payload.type === "response.output_audio_transcript.delta" && payload.delta) { setListening(false); changeThinking(false); changeSpeaking(true); setCompanionLine((line) => { const next = realtimeReplyStarted.current ? `${line}${payload.delta}` : payload.delta!; realtimeReplyStarted.current = true; return next; }); }
          if (payload.type === "response.output_audio_transcript.done") { realtimeReplyStarted.current = false; changeSpeaking(false); setListening(true); }
          if (payload.type === "conversation.item.input_audio_transcription.completed" && payload.transcript) {
            setUserLine(payload.transcript);
            setListening(false);
            changeThinking(true);
            void onTranscribedTurnRef.current?.(payload.transcript);
          }
          if (payload.type === "input_audio_buffer.speech_started") { changeSpeaking(false); changeThinking(false); setListening(true); }
        } catch { /* Ignore unknown provider events. */ }
      });
    }).catch((cause) => {
      if (!active) return;
      setTransport("fallback");
      setCameraError(cause instanceof Error ? `${cause.message} Using browser voice fallback.` : "Using browser voice fallback.");
    });
    return () => { active = false; realtimeRef.current?.disconnect(); realtimeRef.current = null; };
  }, [changeSpeaking, changeThinking, onRealtimeConnect, userName]);

  useEffect(() => {
    activeRef.current = true;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1_000);
    return () => {
      activeRef.current = false;
      window.clearInterval(timer);
      stopRecognition();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      playbackRef.current?.cancel();
      if (listenTimerRef.current) window.clearTimeout(listenTimerRef.current);
    };
  }, [stopRecognition]);

  useEffect(() => {
    Object.values(avatarFrames).forEach((src) => { const image = new Image(); image.src = src; });
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
    if (!clean || thinkingRef.current) return;
    setUserLine(clean);
    setListening(false);
    setSpeechError("");
    changeThinking(true);
    if (transport === "realtime" && realtimeRef.current?.events.readyState === "open") {
      realtimeRef.current.events.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: clean }] } }));
      realtimeRef.current.events.send(JSON.stringify({ type: "response.create" }));
      changeThinking(false);
      return;
    }
    try {
      const reply = await onUserTurn(clean);
      setCompanionLine(reply);
      speak(reply);
    } catch {
      const fallback = "I missed that for a second—say it once more?";
      setCompanionLine(fallback);
      speak(fallback);
    } finally {
      changeThinking(false);
    }
  };

  const beginListening = () => {
    if (listenTimerRef.current) {
      window.clearTimeout(listenTimerRef.current);
      listenTimerRef.current = null;
    }
    if (mutedRef.current || thinkingRef.current) return;
    if (recognitionRef.current) { setListening(true); return; }
    if (speakingRef.current) {
      speechTurn.current += 1;
      playbackRef.current?.cancel();
      changeSpeaking(false);
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
    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = recognitionLocale(language, navigator.language);
    let transcript = "";
    let restartAllowed = true;
    recognition.onresult = (event) => {
      transcript = Array.from(event.results).map((result) => result[0]?.transcript ?? "").join(" ").trim();
      setUserLine(transcript);
    };
    recognition.onerror = (event) => {
      restartAllowed = event.error !== "not-allowed" && event.error !== "service-not-allowed";
      if (!restartAllowed) setSpeechError("Microphone access is blocked. Allow it in your browser settings, then tap the mic again.");
      else if (event.error !== "no-speech" && event.error !== "aborted") setSpeechError("I couldn’t hear that clearly. I’ll keep listening.");
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      if (ignoredRecognitionsRef.current.has(recognition) || !activeRef.current) return;
      if (transcript) void submitContent(transcript);
      else {
        setListening(true);
        if (restartAllowed) queueAutoListen(900);
      }
    };
    recognitionRef.current = recognition;
    setListening(true);
    setSpeechError("");
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setListening(false);
      setSpeechError("The microphone is already busy. I’ll retry in a moment.");
      queueAutoListen(900);
    }
  };
  useEffect(() => { startListeningRef.current = beginListening; });

  const time = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <motion.div className="live-call live-call--video" role="dialog" aria-modal="true" aria-label={`Video call with ${companionName}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className={speaking ? "video-call__avatar-feed video-call__avatar-feed--speaking" : "video-call__avatar-feed"}>
        <img className="video-call__avatar-frame video-call__avatar-frame--base" src={avatarFrames.idle} alt={`${companionName}, a photorealistic animated AI companion, on video`} />
        <img className="video-call__avatar-frame video-call__avatar-frame--breath" src={avatarFrames.idle} alt="" />
        <img className="video-call__avatar-frame video-call__avatar-frame--hair" src={avatarFrames.idle} alt="" />
        <img className="video-call__avatar-frame video-call__avatar-frame--blink video-call__avatar-frame--blink-left" src={avatarFrames.blink} alt="" />
        <img className="video-call__avatar-frame video-call__avatar-frame--blink video-call__avatar-frame--blink-right" src={avatarFrames.blink} alt="" />
        <img className="video-call__avatar-frame video-call__avatar-frame--mouth" src={avatarFrames.speaking} alt="" />
        <span className="video-call__presence-light" aria-hidden="true" />
        <span className="video-call__feed-badge"><i className="status-dot" /> Live animated AI avatar</span>
      </div>
      <div className="live-call__veil live-call__veil--video" />
      <header className="live-call__header"><span><i className="status-dot" /> Live together</span><strong>{companionName}</strong><time>{time}</time></header>

      <div className="video-call__status"><Waveform aria-hidden="true" /><span>{thinking ? "Thinking about that" : speaking ? `${companionName} is speaking` : listening ? "Listening to you" : "Here with you"}</span></div>

      <div className="video-call__camera">
        <video ref={videoRef} muted playsInline aria-label="Your local camera preview" />
        {cameraOn ? <span><Camera aria-hidden="true" weight="fill" /> Your camera</span> : <div><CameraSlash aria-hidden="true" /><small>Your camera is off</small><button type="button" onClick={() => void toggleCamera()}>Turn it on</button></div>}
      </div>

      <div className="video-call__tools">
        <span className="video-call__avatar-label"><VideoCamera aria-hidden="true" /> Animated photoreal avatar</span>
        <label>Language<select aria-label="Video call language" value={language} onChange={(event) => { stopRecognition(); playbackRef.current?.cancel(); changeSpeaking(false); setLanguage(event.target.value as SpeechLanguage); setListening(true); queueAutoListen(); }}>{speechLanguageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label>Voice<select aria-label="Video call voice style" value={activeVoiceId} onChange={(event) => { const next = event.target.value; const profile = companionVoiceProfile(next); setActiveVoiceId(next); onVoiceChange?.(next); if (transport === "realtime") setCompanionLine(`${profile.name} voice will start on your next call.`); else { setCompanionLine(`${profile.name} voice selected.`); speak(`Okay… this is my ${profile.name.toLowerCase()} voice.`, true, next); } }}>{companionVoiceProfiles.map((voice) => <option key={voice.id} value={voice.id}>{voice.name}</option>)}</select></label>
        <button type="button" onClick={() => setActivityOpen((value) => !value)} aria-expanded={activityOpen}><Sparkle aria-hidden="true" /> Activity</button>
        <button type="button" disabled={!cameraOn || visionBusy} onClick={() => void shareCurrentFrame()}><Camera aria-hidden="true" /> {visionBusy ? "Looking…" : "Show frame"}</button>
      </div>

      {activityOpen ? <div className="call-activity-menu">{callActivities.map((item) => <button type="button" key={item} onClick={() => { setActivity(item); setActivityOpen(false); }}>{item}</button>)}</div> : null}
      {activity ? <div className="call-activity-card"><span>Playing together</span><strong>{activity}</strong><p>{activity === "Would you rather" ? "Sunrise coffee or a midnight city walk? Tell me why." : "Take turns. There are no perfect answers."}</p><button type="button" onClick={() => setActivity("")}>Close card</button></div> : null}

      <button type="button" className="barge-in" onClick={beginListening} disabled={muted || thinking}><Waveform aria-hidden="true" /> {thinking ? "Thinking…" : speaking ? "Speak now to interrupt" : listening ? "Listening automatically" : "Start hands-free listening"}</button>
      {speechError ? <p className="call-speech-error" role="status">{speechError}</p> : null}
      {cameraError ? <p className="camera-error" role="status">{cameraError}</p> : null}
      {captions ? <div className="video-call__captions" aria-live="polite">{userLine ? <p><span>You</span>{userLine}</p> : null}<p><span>{companionName}</span>{thinking ? "…" : companionLine}</p></div> : null}

      <div className="live-call__controls">
        <button type="button" className={muted ? "call-orb call-orb--active" : "call-orb"} onClick={() => { const next = !muted; mutedRef.current = next; setMuted(next); if (next) { stopRecognition(); setListening(false); } realtimeRef.current?.peer.getSenders().forEach((sender) => { if (sender.track?.kind === "audio") sender.track.enabled = !next; }); if (!next) { setListening(true); queueAutoListen(220); } }} aria-label={muted ? "Unmute microphone" : "Mute microphone"}>{muted ? <MicrophoneSlash aria-hidden="true" /> : <Microphone aria-hidden="true" />}</button>
        <button type="button" className={cameraOn ? "call-orb call-orb--active" : "call-orb"} onClick={() => void toggleCamera()} aria-label={cameraOn ? "Turn camera off" : "Turn camera on"}>{cameraOn ? <VideoCamera aria-hidden="true" weight="fill" /> : <CameraSlash aria-hidden="true" />}</button>
        <button type="button" className={speaker ? "call-orb call-orb--active" : "call-orb"} onClick={() => { const next = !speaker; setSpeaker(next); if (realtimeRef.current) realtimeRef.current.audio.muted = !next; if (!next) { speechTurn.current += 1; playbackRef.current?.cancel(); changeSpeaking(false); setListening(true); queueAutoListen(); } else if (transport !== "realtime") speak(companionLine, true); }} aria-label={speaker ? "Turn speaker off" : "Turn speaker on"}>{speaker ? <SpeakerHigh aria-hidden="true" /> : <SpeakerSlash aria-hidden="true" />}</button>
        <button type="button" className={captions ? "call-orb call-orb--active" : "call-orb"} onClick={() => setCaptions((value) => !value)} aria-label={captions ? "Hide captions" : "Show captions"}><ChatCircleDots aria-hidden="true" /></button>
        <button type="button" className={heartSent ? "call-orb call-orb--heart" : "call-orb"} onClick={() => { setHeartSent(true); window.setTimeout(() => setHeartSent(false), 1_500); }} aria-label="Send heart"><Heart aria-hidden="true" weight={heartSent ? "fill" : "regular"} /></button>
        <button type="button" className="call-orb call-orb--end" onClick={() => onClose(seconds)} aria-label="End video call"><PhoneDisconnect aria-hidden="true" weight="fill" /></button>
      </div>
      <AnimatePresence>{heartSent ? <motion.div className="call-heart" initial={{ opacity: 0, scale: .5, y: 0 }} animate={{ opacity: 1, scale: 1.4, y: -110 }} exit={{ opacity: 0 }}><Heart weight="fill" /></motion.div> : null}</AnimatePresence>
      <small className="live-call__disclosure">Hands-free listening pauses while {companionName} speaks · camera stays local until Show frame · raw call media is not recorded · {transport === "realtime" ? "secure multilingual audio connected" : transport === "connecting" ? "connecting secure audio…" : "English · हिन्दी · Hinglish"}</small>
    </motion.div>
  );
}
