"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff, ShieldCheck } from "lucide-react";
import { Modal } from "./Modal";

export function CameraConversationModal({ companionName, onSessionStart, onAnalyzeFrame, onClose }: { companionName: string; onSessionStart?: () => Promise<unknown>; onAnalyzeFrame?: (dataBase64: string, contentType: string) => Promise<string>; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<"idle" | "requesting" | "active" | "denied">("idle");
  const [analysis, setAnalysis] = useState("");
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => () => stream.current?.getTracks().forEach((track) => track.stop()), []);

  const enable = async () => {
    setStatus("requesting");
    try {
      await onSessionStart?.();
      const media = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      stream.current = media;
      if (video.current) video.current.srcObject = media;
      setStatus("active");
    } catch { setStatus("denied"); }
  };

  const shareFrame = async () => {
    if (!video.current || !onAnalyzeFrame) return;
    setAnalyzing(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, video.current.videoWidth);
      canvas.height = Math.max(1, video.current.videoHeight);
      canvas.getContext("2d")?.drawImage(video.current, 0, 0, canvas.width, canvas.height);
      const dataBase64 = canvas.toDataURL("image/jpeg", .82).split(",")[1] ?? "";
      setAnalysis(await onAnalyzeFrame(dataBase64, "image/jpeg"));
    } catch (cause) {
      setAnalysis(cause instanceof Error ? cause.message : "The frame could not be discussed.");
    } finally { setAnalyzing(false); }
  };

  return <Modal title={`Camera conversation with ${companionName}`} description="Your camera turns on only after explicit permission. A still frame is shared only when you press Discuss this frame; raw video is never uploaded or recorded." onClose={onClose}><div className="camera-preview">{status === "active" ? <video ref={video} autoPlay muted playsInline aria-label="Local camera preview" /> : <div><CameraOff aria-hidden="true" /><span>{status === "denied" ? "Camera permission was declined. You can keep chatting without it." : "Camera is off"}</span></div>}</div><p className="settings-note"><ShieldCheck aria-hidden="true" /> Sensitive traits are never inferred from camera frames.</p>{analysis ? <p className="settings-note" role="status"><strong>{companionName}:</strong> {analysis}</p> : null}{status !== "active" ? <button type="button" className="button button--primary" disabled={status === "requesting"} onClick={() => void enable()}><Camera aria-hidden="true" /> {status === "requesting" ? "Requesting permission…" : "Allow camera"}</button> : <div className="modal-actions"><button type="button" className="button button--primary" disabled={analyzing || !onAnalyzeFrame} onClick={() => void shareFrame()}><Camera aria-hidden="true" /> {analyzing ? "Looking…" : "Discuss this frame"}</button><button type="button" className="button button--danger" onClick={onClose}><CameraOff aria-hidden="true" /> End camera session</button></div>}</Modal>;
}
