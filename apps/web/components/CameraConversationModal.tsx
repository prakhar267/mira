"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff, ShieldCheck } from "lucide-react";
import { Modal } from "./Modal";

export function CameraConversationModal({ companionName, onClose }: { companionName: string; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<"idle" | "requesting" | "active" | "denied">("idle");

  useEffect(() => () => stream.current?.getTracks().forEach((track) => track.stop()), []);

  const enable = async () => {
    setStatus("requesting");
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      stream.current = media;
      if (video.current) video.current.srcObject = media;
      setStatus("active");
    } catch { setStatus("denied"); }
  };

  return <Modal title={`Camera conversation with ${companionName}`} description="Your camera turns on only after explicit permission. This local demo does not upload or record video." onClose={onClose}><div className="camera-preview">{status === "active" ? <video ref={video} autoPlay muted playsInline aria-label="Local camera preview" /> : <div><CameraOff aria-hidden="true" /><span>{status === "denied" ? "Camera permission was declined. You can keep chatting without it." : "Camera is off"}</span></div>}</div><p className="settings-note"><ShieldCheck aria-hidden="true" /> Sensitive traits are never inferred from camera frames.</p>{status !== "active" ? <button type="button" className="button button--primary" disabled={status === "requesting"} onClick={() => void enable()}><Camera aria-hidden="true" /> {status === "requesting" ? "Requesting permission…" : "Allow camera"}</button> : <button type="button" className="button button--danger" onClick={onClose}><CameraOff aria-hidden="true" /> End camera session</button>}</Modal>;
}
