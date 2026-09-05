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
import { LiveAvatar3D, type AvatarMouthPose } from "@/components/LiveAvatar3D";
import {
  mouthPoseForText,
  playCompanionSpeech,
  type CompanionSpeechPlayback,
} from "@/lib/speech";
import { startCallListening, type CallListeningSession } from "@/lib/call-listening";

const callActivities = ["Would you rather", "Relationship cards", "Plan a date", "Tell me about your day"];

export function VideoCallModal({
  companionName,
  userName,
  onUserTurn,
  onAnalyzeFrame,
  onClose,
}: {
  companionName: string;
  userName: string;
  initialEnvironment: string;
  onUserTurn: (content: string) => Promise<string>;
  onAnalyzeFrame: (dataBase64: string, contentType: string) => Promise<string>;
  onClose: (durationSeconds: number) => void;
}) {
  const greeting = `Hey ${userName}, aa gaye. Batao, kya chal raha hai?`;
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
  const [preparingSpeech, setPreparingSpeech] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [mouthPose, setMouthPose] = useState<AvatarMouthPose>(0);
  const [blinking, setBlinking] = useState(false);
  const [companionLine, setCompanionLine] = useState(greeting);
  const [userLine, setUserLine] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const greetingSpoken = useRef(false);
  const recognitionRef = useRef<CallListeningSession | null>(null);
  const playbackRef = useRef<CompanionSpeechPlayback | null>(null);
  const speechTurn = useRef(0);
  const listenTimerRef = useRef<number | null>(null);
  const startListeningRef = useRef<() => void>(() => undefined);
  const mutedRef = useRef(false);
  const activeRef = useRef(true);
  const speakingRef = useRef(false);
  const thinkingRef = useRef(false);
  const lastMouthBoundaryRef = useRef(0);
  const mouthSequenceRef = useRef(0);
  const listeningAttemptRef = useRef(0);

  const changeSpeaking = useCallback((next: boolean) => {
    speakingRef.current = next;
    setSpeaking(next);
    if (!next) setMouthPose(0);
  }, []);

  const changeThinking = useCallback((next: boolean) => {
    thinkingRef.current = next;
    setThinking(next);
  }, []);

  const stopRecognition = useCallback(() => {
    listeningAttemptRef.current += 1;
    const recognition = recognitionRef.current;
    if (!recognition) return;
    recognitionRef.current = null;
    recognition.cancel();
  }, []);

  const queueAutoListen = useCallback((delay = 650) => {
    if (listenTimerRef.current) window.clearTimeout(listenTimerRef.current);
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
  }, []);

  const speak = useCallback((text: string, force = false) => {
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
    setPreparingSpeech(true);
    playbackRef.current = playCompanionSpeech(text, {
      onStart: () => {
        if (speechTurn.current !== turn) return;
        setSpeechError("");
        setPreparingSpeech(false);
        lastMouthBoundaryRef.current = performance.now();
        setMouthPose(1);
        changeSpeaking(true);
      },
      onBoundary: ({ charIndex }) => {
        if (speechTurn.current !== turn) return;
        lastMouthBoundaryRef.current = performance.now();
        setMouthPose(mouthPoseForText(text, charIndex));
      },
      onEnd: () => {
        if (speechTurn.current !== turn || !activeRef.current) return;
        setPreparingSpeech(false);
        changeSpeaking(false);
        setListening(true);
        queueAutoListen();
      },
      onError: (message) => {
        if (speechTurn.current !== turn || !activeRef.current) return;
        setPreparingSpeech(false);
        setSpeechError(message);
        changeSpeaking(false);
        setListening(true);
        queueAutoListen(400);
      },
    });
  }, [changeSpeaking, queueAutoListen, speaker, stopRecognition]);

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
    let blinkTimer = 0;
    let releaseTimer = 0;
    const scheduleBlink = () => {
      blinkTimer = window.setTimeout(() => {
        setBlinking(true);
        releaseTimer = window.setTimeout(() => {
          setBlinking(false);
          scheduleBlink();
        }, 115);
      }, 3_400 + Math.round(Math.random() * 4_200));
    };
    scheduleBlink();
    return () => {
      window.clearTimeout(blinkTimer);
      window.clearTimeout(releaseTimer);
    };
  }, []);

  useEffect(() => {
    if (!speaking) return;
    const poses = [1, 2, 1, 3, 1, 2] as const;
    const timer = window.setInterval(() => {
      if (performance.now() - lastMouthBoundaryRef.current < 170) return;
      mouthSequenceRef.current = (mouthSequenceRef.current + 1) % poses.length;
      setMouthPose(poses[mouthSequenceRef.current]!);
    }, 125);
    return () => window.clearInterval(timer);
  }, [speaking]);

  useEffect(() => {
    if (greetingSpoken.current) return;
    const connect = window.setTimeout(() => {
      if (greetingSpoken.current) return;
      greetingSpoken.current = true;
      speak(greeting);
    }, 550);
    return () => window.clearTimeout(connect);
  }, [greeting, speak]);

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

  const submitContent = useCallback(async (content: string) => {
    const clean = content.trim();
    if (!clean || thinkingRef.current) return;
    setUserLine(clean);
    setListening(false);
    setSpeechError("");
    changeThinking(true);
    try {
      const reply = await onUserTurn(clean);
      setCompanionLine(reply);
      speak(reply);
    } catch {
      const fallback = "Reply miss ho gaya—ek baar phir bolo?";
      setCompanionLine(fallback);
      speak(fallback);
    } finally {
      changeThinking(false);
    }
  }, [changeThinking, onUserTurn, speak]);

  const beginListening = useCallback(() => {
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
    }
    const attempt = listeningAttemptRef.current + 1;
    listeningAttemptRef.current = attempt;
    setListening(true);
    setUserLine("");
    void startCallListening({
      onSpeechStart: () => { if (listeningAttemptRef.current === attempt) setUserLine("Hearing you…"); },
      onTranscript: (transcript) => {
        if (listeningAttemptRef.current !== attempt || !activeRef.current) return;
        recognitionRef.current = null;
        void submitContent(transcript);
      },
      onSilence: () => {
        if (listeningAttemptRef.current !== attempt || !activeRef.current) return;
        recognitionRef.current = null;
        setUserLine("");
        queueAutoListen(250);
      },
      onError: (message) => {
        if (listeningAttemptRef.current !== attempt || !activeRef.current) return;
        recognitionRef.current = null;
        setUserLine("");
        setSpeechError(message);
        setListening(true);
        queueAutoListen(900);
      },
    }).then((session) => {
      if (listeningAttemptRef.current !== attempt || !activeRef.current) session.cancel();
      else recognitionRef.current = session;
    }).catch((cause) => {
      if (listeningAttemptRef.current !== attempt || !activeRef.current) return;
      recognitionRef.current = null;
      setListening(false);
      setSpeechError(cause instanceof Error ? cause.message : "Microphone access is unavailable.");
    });
  }, [changeSpeaking, queueAutoListen, submitContent]);
  useEffect(() => { startListeningRef.current = beginListening; }, [beginListening]);

  const interrupt = useCallback(() => {
    if (mutedRef.current || thinkingRef.current) return;
    speechTurn.current += 1;
    playbackRef.current?.cancel();
    setPreparingSpeech(false);
    changeSpeaking(false);
    setListening(true);
    window.setTimeout(beginListening, 160);
  }, [beginListening, changeSpeaking]);

  const time = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <motion.div className="live-call live-call--video" role="dialog" aria-modal="true" aria-label={`Video call with ${companionName}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className={speaking ? "video-call__avatar-feed video-call__avatar-feed--speaking" : "video-call__avatar-feed"}>
        <LiveAvatar3D
          companionName={companionName}
          speaking={speaking}
          thinking={thinking}
          listening={listening}
          blinking={blinking}
          mouthPose={mouthPose}
          emotion="natural"
        />
        <span className="video-call__feed-badge"><i className="status-dot" /> Live 3D avatar · expression synced</span>
      </div>
      <div className="live-call__veil live-call__veil--video" />
      <header className="live-call__header"><span><i className="status-dot" /> Live together</span><strong>{companionName}</strong><time>{time}</time></header>

      <div className="video-call__status"><Waveform aria-hidden="true" /><span>{thinking ? "Thinking about that" : preparingSpeech ? "Preparing voice" : speaking ? `${companionName} is speaking` : listening ? "Listening to you" : "Here with you"}</span></div>

      <div className="video-call__camera">
        <video ref={videoRef} muted playsInline aria-label="Your local camera preview" />
        {cameraOn ? <span><Camera aria-hidden="true" weight="fill" /> Your camera</span> : <div><CameraSlash aria-hidden="true" /><small>Your camera is off</small><button type="button" onClick={() => void toggleCamera()}>Turn it on</button></div>}
      </div>

      <div className="video-call__tools">
        <span className="video-call__avatar-label"><VideoCamera aria-hidden="true" /> Open-licensed anime avatar · stable live expressions</span>
        <span className="video-call__avatar-label">Hindi · Hinglish · English · Priya</span>
        <button type="button" onClick={() => setActivityOpen((value) => !value)} aria-expanded={activityOpen}><Sparkle aria-hidden="true" /> Activity</button>
        <button type="button" disabled={!cameraOn || visionBusy} onClick={() => void shareCurrentFrame()}><Camera aria-hidden="true" /> {visionBusy ? "Looking…" : "Show frame"}</button>
      </div>

      {activityOpen ? <div className="call-activity-menu">{callActivities.map((item) => <button type="button" key={item} onClick={() => { setActivity(item); setActivityOpen(false); }}>{item}</button>)}</div> : null}
      {activity ? <div className="call-activity-card"><span>Playing together</span><strong>{activity}</strong><p>{activity === "Would you rather" ? "Sunrise coffee or a midnight city walk? Tell me why." : "Take turns. There are no perfect answers."}</p><button type="button" onClick={() => setActivity("")}>Close card</button></div> : null}

      <button type="button" className="barge-in" onClick={speaking ? interrupt : beginListening} disabled={muted || thinking || preparingSpeech}><Waveform aria-hidden="true" /> {thinking ? "Thinking…" : preparingSpeech ? "Preparing voice…" : speaking ? "Tap to interrupt" : listening ? "Listening automatically" : "Start hands-free listening"}</button>
      {speechError ? <p className="call-speech-error" role="status">{speechError}</p> : null}
      {cameraError ? <p className="camera-error" role="status">{cameraError}</p> : null}
      {captions ? <div className="video-call__captions" aria-live="polite">{userLine ? <p><span>You</span>{userLine}</p> : null}<p><span>{companionName}</span>{thinking ? "…" : companionLine}</p></div> : null}

      <div className="live-call__controls">
        <button type="button" className={muted ? "call-orb call-orb--active" : "call-orb"} onClick={() => { const next = !muted; mutedRef.current = next; setMuted(next); if (next) { stopRecognition(); setListening(false); } if (!next) { setListening(true); queueAutoListen(220); } }} aria-label={muted ? "Unmute microphone" : "Mute microphone"}>{muted ? <MicrophoneSlash aria-hidden="true" /> : <Microphone aria-hidden="true" />}</button>
        <button type="button" className={cameraOn ? "call-orb call-orb--active" : "call-orb"} onClick={() => void toggleCamera()} aria-label={cameraOn ? "Turn camera off" : "Turn camera on"}>{cameraOn ? <VideoCamera aria-hidden="true" weight="fill" /> : <CameraSlash aria-hidden="true" />}</button>
        <button type="button" className={speaker ? "call-orb call-orb--active" : "call-orb"} onClick={() => { const next = !speaker; setSpeaker(next); if (!next) { speechTurn.current += 1; playbackRef.current?.cancel(); setPreparingSpeech(false); changeSpeaking(false); setListening(true); queueAutoListen(); } else speak(companionLine, true); }} aria-label={speaker ? "Turn speaker off" : "Turn speaker on"}>{speaker ? <SpeakerHigh aria-hidden="true" /> : <SpeakerSlash aria-hidden="true" />}</button>
        <button type="button" className={captions ? "call-orb call-orb--active" : "call-orb"} onClick={() => setCaptions((value) => !value)} aria-label={captions ? "Hide captions" : "Show captions"}><ChatCircleDots aria-hidden="true" /></button>
        <button type="button" className={heartSent ? "call-orb call-orb--heart" : "call-orb"} onClick={() => { setHeartSent(true); window.setTimeout(() => setHeartSent(false), 1_500); }} aria-label="Send heart"><Heart aria-hidden="true" weight={heartSent ? "fill" : "regular"} /></button>
        <button type="button" className="call-orb call-orb--end" onClick={() => onClose(seconds)} aria-label="End video call"><PhoneDisconnect aria-hidden="true" weight="fill" /></button>
      </div>
      <AnimatePresence>{heartSent ? <motion.div className="call-heart" initial={{ opacity: 0, scale: .5, y: 0 }} animate={{ opacity: 1, scale: 1.4, y: -110 }} exit={{ opacity: 0 }}><Heart weight="fill" /></motion.div> : null}</AnimatePresence>
      <small className="live-call__disclosure">Hands-free listening resumes after every reply · Inworld Priya synthetic voice · camera stays local until Show frame · speech text is processed by Inworld · no call recording is saved</small>
    </motion.div>
  );
}
