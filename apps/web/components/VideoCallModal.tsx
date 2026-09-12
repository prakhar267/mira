"use client";

import { useEffect, useRef, useState } from "react";
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
import { LiveAvatar3D } from "@/components/LiveAvatar3D";
import { useCompanionCall } from "./useCompanionCall";

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
  const { phase, companionLine, userLine, error: speechError, muted, speaker, talkOver, seconds, mouthPose, call } = useCompanionCall(userName, onUserTurn);
  const speaking = phase === "speaking";
  const thinking = phase === "thinking" || phase === "transcribing";
  const preparingSpeech = phase === "preparing";
  const listening = phase === "listening";
  const [captions, setCaptions] = useState(true);
  const [heartSent, setHeartSent] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [visionBusy, setVisionBusy] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activity, setActivity] = useState("");
  const [blinking, setBlinking] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const activeRef = useRef(true);
  const cameraAttempt = useRef(0);
  useEffect(() => {
    activeRef.current = true;
    const attemptRef = cameraAttempt;
    let blinkTimer = 0, releaseTimer = 0;
    const blink = () => {
      blinkTimer = window.setTimeout(() => {
        setBlinking(true);
        releaseTimer = window.setTimeout(() => { setBlinking(false); blink(); }, 115);
      }, 3400 + Math.round(Math.random() * 4200));
    };
    blink();
    return () => {
      activeRef.current = false;
      attemptRef.current++;
      streamRef.current?.getTracks().forEach(track => track.stop());
      window.clearTimeout(blinkTimer);
      window.clearTimeout(releaseTimer);
    };
  }, []);
  const interrupt = () => call.current?.interrupt();
  const beginListening = () => call.current?.retry();
  const speak = (text: string) => call.current?.say(text);

  const toggleCamera = async () => {
    if (cameraOn) {
      cameraAttempt.current++;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      setCameraOn(false);
      return;
    }
    setCameraError("");
    const attempt = ++cameraAttempt.current;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera preview is unavailable in this browser.");
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      if (!activeRef.current || attempt !== cameraAttempt.current) { stream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
    } catch {
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      if (!activeRef.current) return;
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
      if (activeRef.current) speak(reply);
    } catch (cause) {
      setCameraError(cause instanceof Error ? cause.message : "The current frame could not be shared.");
    } finally {
      setVisionBusy(false);
    }
  };

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
        <span className="video-call__avatar-label">English · Hindi · Hinglish · Priya</span>
        <button type="button" aria-pressed={talkOver} onClick={() => call.current?.setTalkOver(!talkOver)}>Talk-over · headphones beta · {talkOver ? "On" : "Off"}</button>
        <button type="button" onClick={() => setActivityOpen((value) => !value)} aria-expanded={activityOpen}><Sparkle aria-hidden="true" /> Activity</button>
        <button type="button" disabled={!cameraOn || visionBusy} onClick={() => void shareCurrentFrame()}><Camera aria-hidden="true" /> {visionBusy ? "Looking…" : "Show frame"}</button>
      </div>

      {activityOpen ? <div className="call-activity-menu">{callActivities.map((item) => <button type="button" key={item} onClick={() => { setActivity(item); setActivityOpen(false); }}>{item}</button>)}</div> : null}
      {activity ? <div className="call-activity-card"><span>Playing together</span><strong>{activity}</strong><p>{activity === "Would you rather" ? "Sunrise coffee or a midnight city walk? Tell me why." : "Take turns. There are no perfect answers."}</p><button type="button" onClick={() => setActivity("")}>Close card</button></div> : null}

      <button type="button" className="barge-in" onClick={speaking || preparingSpeech ? interrupt : beginListening} disabled={muted || thinking || phase === "opening-mic"}><Waveform aria-hidden="true" /> {thinking ? phase === "transcribing" ? "Understanding your words…" : "Thinking…" : preparingSpeech ? "Cancel voice & listen" : speaking ? talkOver ? "Speak to interrupt · headphones" : "Tap to interrupt" : listening ? "Listening automatically" : phase === "error" ? "Retry" : phase === "opening-mic" ? "Opening microphone…" : muted ? "Microphone muted" : "Start hands-free listening"}</button>
      {speechError ? <p className="call-speech-error" role="status">{speechError}</p> : null}
      {cameraError ? <p className="camera-error" role="status">{cameraError}</p> : null}
      {captions ? <div className="video-call__captions" aria-live="polite">{userLine ? <p><span>You</span>{userLine}</p> : null}<p><span>{companionName}</span>{thinking ? "…" : companionLine}</p></div> : null}

      <div className="live-call__controls">
        <button type="button" className={muted ? "call-orb call-orb--active" : "call-orb"} onClick={() => call.current?.setMuted(!muted)} aria-label={muted ? "Unmute microphone" : "Mute microphone"}>{muted ? <MicrophoneSlash aria-hidden="true" /> : <Microphone aria-hidden="true" />}</button>
        <button type="button" className={cameraOn ? "call-orb call-orb--active" : "call-orb"} onClick={() => void toggleCamera()} aria-label={cameraOn ? "Turn camera off" : "Turn camera on"}>{cameraOn ? <VideoCamera aria-hidden="true" weight="fill" /> : <CameraSlash aria-hidden="true" />}</button>
        <button type="button" className={speaker ? "call-orb call-orb--active" : "call-orb"} onClick={() => call.current?.setSpeaker(!speaker)} aria-label={speaker ? "Turn speaker off" : "Turn speaker on"}>{speaker ? <SpeakerHigh aria-hidden="true" /> : <SpeakerSlash aria-hidden="true" />}</button>
        <button type="button" className={captions ? "call-orb call-orb--active" : "call-orb"} onClick={() => setCaptions((value) => !value)} aria-label={captions ? "Hide captions" : "Show captions"}><ChatCircleDots aria-hidden="true" /></button>
        <button type="button" className={heartSent ? "call-orb call-orb--heart" : "call-orb"} onClick={() => { setHeartSent(true); window.setTimeout(() => setHeartSent(false), 1_500); }} aria-label="Send heart"><Heart aria-hidden="true" weight={heartSent ? "fill" : "regular"} /></button>
        <button type="button" className="call-orb call-orb--end" onClick={() => { activeRef.current = false; cameraAttempt.current++; streamRef.current?.getTracks().forEach(track => track.stop()); call.current?.close(); onClose(seconds); }} aria-label="End video call"><PhoneDisconnect aria-hidden="true" weight="fill" /></button>
      </div>
      <AnimatePresence>{heartSent ? <motion.div className="call-heart" initial={{ opacity: 0, scale: .5, y: 0 }} animate={{ opacity: 1, scale: 1.4, y: -110 }} exit={{ opacity: 0 }}><Heart weight="fill" /></motion.div> : null}</AnimatePresence>
      <small className="live-call__disclosure">Hands-free listening resumes after every reply · voice input uses Inworld STT with browser and Cloudflare fallback · conversation replies use Cloudflare AI · speech uses Inworld Priya · camera preview is local; frame understanding is unavailable · no call recording is saved</small>
    </motion.div>
  );
}
