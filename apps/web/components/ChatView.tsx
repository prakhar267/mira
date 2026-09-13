"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Camera, ImagePlus, Mic, MoreHorizontal, Phone, Plus, RefreshCw, Send, Sparkles, ThumbsDown, ThumbsUp, Trash2, Video, Volume2 } from "lucide-react";
import type { ChatMessage } from "@companion/shared";
import type { DemoState, FeedbackReason } from "@/lib/state";
import { playCompanionSpeech } from "@/lib/speech";
import { Modal } from "./Modal";

interface ChatSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: { results: ArrayLike<{ 0?: { transcript?: string } }> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

type ChatSpeechWindow = Window & typeof globalThis & {
  SpeechRecognition?: new () => ChatSpeechRecognition;
  webkitSpeechRecognition?: new () => ChatSpeechRecognition;
};

export function ChatView({ state, streaming, streamingText = "", processingEnabled, mediaEnabled = false, liveMode = false, onLoadOlder, loadingOlder = false, onSend, onNewConversation, onDeleteConversation, onBack, onCall, onVideoCall, onVoiceNote, onVoiceRecording, onSpeak, onImageUpload, onGenerateImage, onFeedback, onRegenerate, onCamera }: {
  state: DemoState;
  streaming: boolean;
  streamingText?: string;
  processingEnabled: boolean;
  liveMode?: boolean;
  mediaEnabled?: boolean;
  onLoadOlder?: () => Promise<void>;
  loadingOlder?: boolean;
  onSend: (content: string) => Promise<void>;
  onNewConversation: () => void;
  onDeleteConversation: () => void | Promise<void>;
  onBack: () => void;
  onCall: () => void;
  onVideoCall: () => void;
  onVoiceNote: (transcript: string) => Promise<void>;
  onVoiceRecording?: (audioBase64: string, contentType: string) => Promise<void>;
  onSpeak?: (content: string) => Promise<void>;
  onImageUpload: (file: File) => Promise<void>;
  onGenerateImage: (prompt: string) => void | Promise<void>;
  onFeedback: (messageId: string, feedback: "up" | "down", reason?: FeedbackReason) => void;
  onRegenerate: (messageId: string) => void | Promise<void>;
  onUpgrade: () => void;
  onCamera: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [voiceActive, setVoiceActive] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [whyMessage, setWhyMessage] = useState<ChatMessage | null>(null);
  const [imagePromptOpen, setImagePromptOpen] = useState(false);
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageError, setImageError] = useState("");
  const [deleteConversationOpen, setDeleteConversationOpen] = useState(false);
  const [deleteConversationError, setDeleteConversationError] = useState("");
  const [online, setOnline] = useState(true);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const messagesViewport = useRef<HTMLDivElement>(null);
  const voiceRecognition = useRef<ChatSpeechRecognition | null>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const voiceStream = useRef<MediaStream | null>(null);
  const recordingAttempt = useRef(0);
  const recordingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const voicePending = useRef(false);
  const stickToBottom = useRef(true);
  const scrollAnchor = useRef<{ height: number; top: number } | null>(null);
  const messages = useMemo(() => state.messages.filter((message) => message.conversationId === state.activeConversationId), [state.activeConversationId, state.messages]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update(); window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const viewport = messagesViewport.current;
      if (viewport && scrollAnchor.current) { viewport.scrollTop = scrollAnchor.current.top + viewport.scrollHeight - scrollAnchor.current.height; scrollAnchor.current = null; }
      else if (viewport && stickToBottom.current) viewport.scrollTo({ top: viewport.scrollHeight, behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, streaming, streamingText]);

  useEffect(() => {
    const cleanup = () => { recordingAttempt.current++; voicePending.current = false; clearTimeout(recordingTimer.current); voiceRecognition.current?.abort(); if (mediaRecorder.current?.state === "recording") mediaRecorder.current.stop(); voiceStream.current?.getTracks().forEach(track => track.stop()); };
    if (!processingEnabled) cleanup();
    const visibility = () => { if (document.hidden) { cleanup(); setVoiceActive(false); } };
    document.addEventListener("visibilitychange", visibility);
    return () => { document.removeEventListener("visibilitychange", visibility); cleanup(); };
  }, [processingEnabled, state.activeConversationId]);

  const submit = async () => {
    const content = draft.trim();
    if (!content || streaming) return;
    setDraft(""); stickToBottom.current = true;
    try { await onSend(content); } catch (error) { setDraft(content); setVoiceError(error instanceof Error ? error.message : "Your message could not be sent."); }
    textarea.current?.focus();
  };

  const startVoice = async () => {
    if (!processingEnabled || streaming || voicePending.current) return;
    const attempt = ++recordingAttempt.current;
    const current = () => attempt === recordingAttempt.current;
    voicePending.current = true;
    if (onVoiceRecording && "MediaRecorder" in window) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!current()) { stream.getTracks().forEach(track => track.stop()); return; }
        const recorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported("audio/webm") ? { mimeType: "audio/webm" } : undefined);
        const chunks: Blob[] = [];
        let bytes = 0;
        let tooLarge = false;
        recorder.ondataavailable = (event) => {
          bytes += event.data.size;
          if (bytes > 2_500_000) { tooLarge = true; if (recorder.state === "recording") recorder.stop(); return; }
          if (event.data.size && current()) chunks.push(event.data);
        };
        recorder.onerror = () => { if (!current()) return; setVoiceError("The voice note could not be recorded."); setVoiceActive(false); voicePending.current = false; stream.getTracks().forEach(track => track.stop()); clearTimeout(recordingTimer.current); };
        recorder.onstop = () => {
          clearTimeout(recordingTimer.current);
          stream.getTracks().forEach(track => track.stop());
          if (!current()) return;
          voicePending.current = false;
          setVoiceActive(false);
          if (tooLarge) { setVoiceError("This voice note is too large. Please record a shorter note (up to 60 seconds)."); return; }
          const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
          if (!blob.size) return;
          const reader = new FileReader();
          reader.onload = () => { if (!current()) return; const audioBase64 = String(reader.result).split(",")[1] ?? ""; void onVoiceRecording(audioBase64, blob.type).catch((cause) => { if (current()) setVoiceError(cause instanceof Error ? cause.message : "The voice note could not be sent."); }); };
          reader.readAsDataURL(blob);
          stream.getTracks().forEach((track) => track.stop());
          mediaRecorder.current = null;
          voiceStream.current = null;
          setVoiceActive(false);
        };
        mediaRecorder.current = recorder;
        voiceStream.current = stream;
        setVoiceTranscript("");
        setVoiceError("");
        setVoiceActive(true);
        recorder.start(250);
        recordingTimer.current = setTimeout(() => { if (current() && recorder.state === "recording") recorder.stop(); }, 60_000);
        return;
      } catch {
        if (!current()) return;
        voicePending.current = false;
        setVoiceError("I couldn’t access the microphone. Check permission or type your message.");
        return;
      }
    }
    const speechWindow = window as ChatSpeechWindow;
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      voicePending.current = false;
      setVoiceError("Voice transcription is not available in this browser. You can still type your message.");
      textarea.current?.focus();
      return;
    }
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-IN";
    let transcript = "";
    recognition.onresult = (event) => {
      if (!current()) return;
      transcript = Array.from(event.results).map((result) => result[0]?.transcript ?? "").join(" ").trim();
      setVoiceTranscript(transcript);
    };
    recognition.onerror = () => {
      if (!current()) return;
      voicePending.current = false;
      setVoiceActive(false);
      setVoiceError("I couldn’t access the microphone. Check permission or type your message.");
    };
    recognition.onend = () => {
      if (!current()) return;
      clearTimeout(recordingTimer.current); voicePending.current = false;
      voiceRecognition.current = null;
      setVoiceActive(false);
      if (transcript) void onVoiceNote(transcript).catch(cause => { if (current()) setVoiceError(cause instanceof Error ? cause.message : "Voice note failed."); });
    };
    voiceRecognition.current = recognition;
    setVoiceTranscript("");
    setVoiceError("");
    setVoiceActive(true);
    recognition.start();
    recordingTimer.current = setTimeout(() => { if (current()) recognition.stop(); }, 60_000);
  };

  const stopVoice = () => {
    if (mediaRecorder.current?.state === "recording") { mediaRecorder.current.stop(); return; }
    voiceRecognition.current?.stop();
  };

  return (
    <section className="workspace chat" aria-labelledby="chat-title">
      <header className="workspace-header chat__header">
        <button type="button" className="icon-button desktop-hidden" aria-label="Back to home" onClick={onBack}><ArrowLeft aria-hidden="true" /></button>
        <div className="chat__portrait"><img src="/assets/mira/portrait.png" alt="" /><i className={online ? "status-dot" : "status-dot status-dot--offline"} /></div>
        <div className="chat__identity"><span>Your companion</span><h1 id="chat-title">{state.companion.name}</h1><small>{online ? "Here with you" : "Offline · keep this page open for unsaved changes"}</small></div>
        <div className="chat__header-actions">
          <button type="button" className="chat__new-button" onClick={onNewConversation}><Plus aria-hidden="true" /><span>New chat</span></button>
          <button type="button" className="chat__call-button" aria-label={`Start voice call with ${state.companion.name}`} onClick={onCall}><Phone aria-hidden="true" /><span>Voice call</span></button>
          <button type="button" className="chat__call-button chat__call-button--video" aria-label={`Start video call with ${state.companion.name}`} onClick={onVideoCall}><Video aria-hidden="true" /><span>Video call</span></button>
          <button type="button" className="icon-button chat__more-button" aria-label="Conversation tools" aria-expanded={toolsOpen} onClick={() => setToolsOpen((value) => !value)}><MoreHorizontal aria-hidden="true" /></button>
        </div>
      </header>

      <div className="chat__safety"><span><Sparkles aria-hidden="true" /><strong>{state.companion.name} is an AI companion</strong><i aria-hidden="true" /><span className="chat__safety-detail">Replies may be imperfect and are not therapy or emergency support.</span></span></div>
      {toolsOpen ? <div className="chat-tools"><button type="button" onClick={() => { onNewConversation(); setToolsOpen(false); }}><Plus aria-hidden="true" /> New conversation</button><button type="button" disabled={!processingEnabled || !mediaEnabled} onClick={() => fileInput.current?.click()}><ImagePlus aria-hidden="true" /> Share a photo{!mediaEnabled ? " · unavailable" : ""}</button><button type="button" disabled={!processingEnabled || !mediaEnabled} onClick={() => { setImagePromptOpen(true); setToolsOpen(false); }}><Sparkles aria-hidden="true" /> Create an image{!mediaEnabled ? " · unavailable" : ""}</button><button type="button" disabled={!processingEnabled || !mediaEnabled} onClick={() => { onCamera(); setToolsOpen(false); }}><Camera aria-hidden="true" /> Camera understanding{!mediaEnabled ? " · unavailable" : ""}</button><button type="button" onClick={() => { setDeleteConversationOpen(true); setToolsOpen(false); }}><Trash2 aria-hidden="true" /> Delete this conversation</button></div> : null}

      <div ref={messagesViewport} className="chat__messages" aria-live="polite" onScroll={event => { const viewport = event.currentTarget; stickToBottom.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 100; }}>
        {onLoadOlder ? <button type="button" className="button button--ghost" disabled={loadingOlder} onClick={() => { stickToBottom.current = false; const viewport = messagesViewport.current; if (viewport) scrollAnchor.current = { height: viewport.scrollHeight, top: viewport.scrollTop }; void onLoadOlder().catch(cause => { scrollAnchor.current = null; setVoiceError(cause instanceof Error ? cause.message : "Older messages could not load."); }); }}>{loadingOlder ? "Loading earlier messages…" : "Load earlier messages"}</button> : null}
        <div className="day-divider"><span>Today</span></div>
        {messages.map((message) => <MessageBubble key={message.id} message={message} companionName={state.companion.name} onFeedback={onFeedback} onRegenerate={onRegenerate} {...(onSpeak ? { onSpeak } : {})} onWhy={() => setWhyMessage(message)} onReply={() => { setDraft(`Replying to “${message.content.slice(0, 54)}${message.content.length > 54 ? "…" : ""}”\n`); textarea.current?.focus(); }} onEdit={() => { setDraft(message.content); textarea.current?.focus(); }} />)}
        {streamingText ? <div className="message message--assistant message--streaming" role="status" aria-live="polite" aria-atomic="true"><div className="message__bubble"><p>{streamingText}</p><small>Reply in progress · not saved yet</small></div></div> : null}
        {streaming && !streamingText && !messages.some((message) => message.status === "sending") ? <div className="typing" aria-label={`${state.companion.name} is typing`}><i /><i /><i /></div> : null}
      </div>

      <div className="chat__composer-wrap">
        {!processingEnabled ? <div className="voice-note-error" role="status">AI processing is paused in Privacy settings. Your existing history remains available.</div> : null}
        <div className="suggestion-row"><span className="suggestion-row__label">Try asking</span>{["Just listen to me", "Plan banane mein help karo", "एक बात याद रखना"].map((suggestion) => <button type="button" key={suggestion} disabled={!processingEnabled} onClick={() => { setDraft(suggestion); textarea.current?.focus(); }}>{suggestion}</button>)}</div>
        <div className="chat__composer">
          <button type="button" className="icon-button" aria-label={mediaEnabled ? "Attach image" : "Image upload unavailable"} disabled={!processingEnabled || !mediaEnabled} onClick={() => fileInput.current?.click()}><Plus aria-hidden="true" /></button>
          <input ref={fileInput} className="visually-hidden" type="file" aria-label="Upload a photo" tabIndex={-1} disabled={!processingEnabled || !mediaEnabled} accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) { setVoiceError(""); void onImageUpload(file).catch((cause) => setVoiceError(cause instanceof Error ? cause.message : "The image could not be shared.")); } event.target.value = ""; }} />
          <textarea ref={textarea} value={draft} disabled={!processingEnabled} maxLength={8_000} rows={1} aria-label={`Message ${state.companion.name}`} placeholder={processingEnabled ? "Say it in English, Hindi, or Hinglish…" : "AI processing is paused"} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }} />
          <button type="button" className="icon-button" aria-label="Upload a photo" disabled={!processingEnabled || !mediaEnabled} onClick={() => fileInput.current?.click()}><ImagePlus aria-hidden="true" /></button>
          {draft.trim() ? <button type="button" className="send-button" aria-label="Send message" disabled={streaming || !processingEnabled} onClick={() => void submit()}><Send aria-hidden="true" /></button> : <button type="button" disabled={!processingEnabled} className={voiceActive ? "icon-button icon-button--active" : "icon-button"} aria-label={voiceActive ? "Stop recording voice note" : "Record voice note"} onClick={() => { if (voiceActive) stopVoice(); else void startVoice(); }}><Mic aria-hidden="true" /></button>}
        </div>
        <div className="chat__composer-meta"><span className="voice-language-inline">English · Hindi · Hinglish</span><span>Enter to send · Shift + Enter for a new line</span></div>
        {voiceActive ? <div className="voice-note-state"><span className="voice-bars" aria-hidden="true"><i /><i /><i /><i /><i /></span>{voiceTranscript || (onVoiceRecording ? "Recording… tap the microphone when you’re done" : "Listening… tap the microphone when you’re done")}</div> : null}
        {voiceError ? <div className="voice-note-error" role="status">{voiceError}</div> : null}
      </div>

      {whyMessage ? <Modal title={`About this response`} description="Only recorded response information is shown here, not the model’s private reasoning." onClose={() => setWhyMessage(null)}><ul className="reason-list">{(whyMessage.explanation?.length ? whyMessage.explanation : ["No per-response explanation was recorded. You can use feedback to flag an inaccurate or unhelpful answer."]).map((reason) => <li key={reason}>{reason}</li>)}</ul></Modal> : null}
      {imagePromptOpen ? <Modal title={`Create a moment with ${state.companion.name}`} description={liveMode ? "Create a private companion moment from your prompt. Generated media stays clearly labeled." : "This local demo uses a small set of approved companion artwork."} onClose={() => setImagePromptOpen(false)}><form onSubmit={(event) => { event.preventDefault(); const prompt = imagePrompt.trim(); if (!prompt) return; setImageError(""); void Promise.resolve(onGenerateImage(prompt)).then(() => { setImagePrompt(""); setImagePromptOpen(false); }).catch((cause) => setImageError(cause instanceof Error ? cause.message : "The image could not be created.")); }}><label className="field">Describe the scene<input autoFocus required maxLength={1_000} value={imagePrompt} onChange={(event) => setImagePrompt(event.target.value)} placeholder={`${state.companion.name} reading by a moonlit window`} /></label>{imageError ? <p className="form-error" role="alert">{imageError}</p> : null}<div className="modal-actions"><button type="button" className="button button--ghost" onClick={() => setImagePromptOpen(false)}>Cancel</button><button type="submit" className="button button--primary"><Sparkles aria-hidden="true" /> Create image</button></div></form></Modal> : null}
      {deleteConversationOpen ? <Modal title="Delete this conversation?" description="This removes the current transcript. Approved memories stay available separately until you delete them." onClose={() => setDeleteConversationOpen(false)}>{deleteConversationError ? <p className="form-error" role="alert">{deleteConversationError}</p> : null}<div className="modal-actions"><button type="button" className="button button--ghost" onClick={() => setDeleteConversationOpen(false)}>Cancel</button><button type="button" className="button button--danger" onClick={() => { setDeleteConversationError(""); void Promise.resolve(onDeleteConversation()).then(() => setDeleteConversationOpen(false)).catch((cause) => setDeleteConversationError(cause instanceof Error ? cause.message : "The conversation could not be deleted.")); }}><Trash2 aria-hidden="true" /> Delete conversation</button></div></Modal> : null}
    </section>
  );
}

function MessageBubble({ message, companionName, onFeedback, onRegenerate, onSpeak, onWhy, onReply, onEdit }: { message: ChatMessage; companionName: string; onFeedback: (messageId: string, feedback: "up" | "down", reason?: FeedbackReason) => void; onRegenerate: (messageId: string) => void | Promise<void>; onSpeak?: (content: string) => Promise<void>; onWhy: () => void; onReply: () => void; onEdit: () => void }) {
  const assistant = message.role === "assistant";
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const speak = () => { if (onSpeak) { void onSpeak(message.content); return; } playCompanionSpeech(message.content); };
  const reasons: Array<[FeedbackReason, string]> = [["too-scripted", "Too scripted"], ["too-many-questions", "Too many questions"], ["missed-what-i-said", "Missed what I said"], ["wrong-tone", "Wrong tone"]];
  return <article className={assistant ? "message message--assistant" : "message message--user"}>{assistant ? <img src="/assets/mira/portrait.png" alt="" /> : null}<div>{assistant ? <strong>{companionName}</strong> : null}{message.attachments?.map((attachment) => attachment.type === "audio" ? <div key={attachment.id} className="message-attachment message-attachment--audio"><Mic aria-hidden="true" /> Voice note · {attachment.durationMs ? Math.ceil(attachment.durationMs / 1000) : 2}s<span>{attachment.transcript}</span></div> : <img key={attachment.id} className="message-attachment" src={attachment.url} alt={attachment.name ?? "Shared image"} />)}<p>{message.content || <span className="typing"><i /><i /><i /></span>}</p>{feedbackOpen ? <div className="message-feedback" role="group" aria-label={`What should ${companionName} improve?`}><span>What felt off?</span>{reasons.map(([reason, label]) => <button type="button" key={reason} onClick={() => { onFeedback(message.id, "down", reason); setFeedbackOpen(false); }}>{label}</button>)}</div> : null}<footer><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time><span className="message-actions">{assistant && message.content ? <><button type="button" className={message.feedback === "up" ? "is-selected" : ""} aria-label="Good response" onClick={() => { setFeedbackOpen(false); onFeedback(message.id, "up"); }}><ThumbsUp aria-hidden="true" /></button><button type="button" className={message.feedback === "down" || feedbackOpen ? "is-selected" : ""} aria-label="Poor response" aria-expanded={feedbackOpen} onClick={() => setFeedbackOpen((value) => !value)}><ThumbsDown aria-hidden="true" /></button><button type="button" aria-label="Hear response" onClick={speak}><Volume2 aria-hidden="true" /></button><button type="button" onClick={onWhy}>Why?</button><button type="button" aria-label="Regenerate response" onClick={() => void onRegenerate(message.id)}><RefreshCw aria-hidden="true" /></button></> : <button type="button" onClick={onEdit}>Edit</button>}<button type="button" onClick={onReply}>Reply</button></span></footer></div></article>;
}
