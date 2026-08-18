import {
  AlarmClock,
  ArrowLeft,
  ArrowRight,
  Bell,
  BellRing,
  Bot,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Copy,
  Database,
  Download,
  Edit3,
  Ellipsis,
  FileJson,
  Flag,
  Goal,
  HeartHandshake,
  HelpCircle,
  Home,
  Languages,
  LoaderCircle,
  LockKeyhole,
  Menu,
  MessageCircle,
  MoreHorizontal,
  PanelLeftClose,
  Pause,
  Pin,
  Plus,
  RefreshCcw,
  RotateCcw,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, Logo } from "../components/Brand.jsx";
import { bootstrapSession, clearApiSession, hasApiSession, incrementMessageUsage, loadCloudState, loadUsage, logoutSession, mergeCloudMessages, requestCloudExport, saveDemoResource, sendChatMessage, zonedWallTimeToIso } from "../lib/api.js";

const starterMessages = [
  { id: 1, role: "assistant", content: "Good evening, Mira. How are you arriving today?", time: "7:42 PM" },
  { id: 2, role: "user", content: "A little scattered. Kal interview hai and I keep replaying every possible mistake.", time: "7:43 PM" },
  { id: 3, role: "assistant", content: "That pre-interview spiral can get loud. Do you want to empty it out first, or make a tiny preparation plan together?", time: "7:43 PM" },
];

const starterMemories = [
  { id: 2, title: "How to support you", text: "When work feels heavy, Mira prefers to be heard before receiving suggestions.", source: "Approved by you · 12 Aug", confidence: "Confirmed", pinned: true, category: "Preference" },
  { id: 3, title: "Evening reset", text: "A short walk after work usually helps Mira feel more settled.", source: "Conversation · 9 Aug", confidence: "Medium", pinned: false, category: "Pattern" },
];

const starterFollowups = [
  { id: 1, title: "Ask how the interview went", date: "2026-08-19", time: "18:30", enabled: true },
  { id: 2, title: "Friday weekly reflection", date: "2026-08-21", time: "20:00", enabled: true },
];

const starterGoals = [
  { id: 1, title: "Prepare three interview stories", note: "Keep it small: situation, action, result.", status: "active", progress: 2, total: 3 },
  { id: 2, title: "Three evening walks this week", note: "Ten minutes counts.", status: "active", progress: 1, total: 3 },
];

const REVOCATION_PENDING_KEY = "saathkind-revocation-pending";

function syncNotice(result, success) {
  if (result?.mode === "live") return success;
  if (result?.mode === "local") return "Saved on this device only. No cloud sync is active.";
  return "The cloud result could not be confirmed; it may already have applied. Refresh this page before retrying.";
}

function cloudWriteFailed(result, cloudExpected = hasApiSession()) {
  return cloudExpected && result?.mode !== "live";
}

function cloudFailureNotice(result, subject = "change") {
  if (result?.mode === "rejected") {
    return result?.error?.message
      ? `The cloud rejected this ${subject}: ${result.error.message}`
      : `The cloud rejected this ${subject}. Review it and try again.`;
  }
  return `This cloud ${subject} could not be confirmed; it may already have applied. Refresh this page before retrying.`;
}

function timeFallsInQuietHours(time, quietHours) {
  if (!/^\d{2}:\d{2}$/.test(time || "")) return false;
  const { start, end } = quietHours;
  if (start === end) return true;
  return start < end ? time >= start && time < end : time >= start || time < end;
}

function dateInputValue(date = new Date(), timeZone = null) {
  if (timeZone) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const part = (type) => parts.find((item) => item.type === type)?.value || "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function Toggle({ checked, onChange, label, description, disabled = false }) {
  return (
    <label className={`toggle-row ${disabled ? "is-disabled" : ""}`}>
      <span><strong>{label}</strong>{description && <small>{description}</small>}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled} />
      <i aria-hidden="true"><span /></i>
    </label>
  );
}

function Toast({ message, action, onAction, onClose }) {
  const toastRef = useRef(null);
  useEffect(() => {
    if (!message) return undefined;
    try { toastRef.current?.showPopover?.(); } catch { /* Older browsers use the fixed-position fallback. */ }
    const timer = window.setTimeout(onClose, 4500);
    return () => {
      window.clearTimeout(timer);
      try { if (toastRef.current?.matches?.(":popover-open")) toastRef.current.hidePopover(); } catch { /* Already closed. */ }
    };
  }, [message, onClose]);
  if (!message) return null;
  return (
    <div ref={toastRef} popover="manual" className="toast" role="status" aria-live="polite">
      <CheckCircle2 aria-hidden="true" /> <span>{message}</span>
      {action && <button type="button" onClick={onAction}>{action}</button>}
      <button type="button" className="toast__close" aria-label="Dismiss" onClick={onClose}><X aria-hidden="true" /></button>
    </div>
  );
}

function Dialog({ title, description, children, onClose }) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const descriptionId = useId();
  onCloseRef.current = onClose;
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const node = dialogRef.current;
    document.body.style.overflow = "hidden";
    if (node && !node.open) node.showModal();
    const firstControl = node?.querySelector("input, textarea, select, button");
    (firstControl || node)?.focus();
    return () => {
      if (node?.open) node.close();
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, []);
  return (
    <dialog ref={dialogRef} className="dialog" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} onCancel={(event) => { event.preventDefault(); onCloseRef.current(); }} onMouseDown={(event) => { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onCloseRef.current(); }}>
      <button type="button" className="icon-button dialog__close" aria-label="Close dialog" onClick={onClose}><X aria-hidden="true" /></button>
      <h2 id={titleId}>{title}</h2>
      {description && <p id={descriptionId}>{description}</p>}
      {children}
    </dialog>
  );
}

function Onboarding({ onComplete, initialNotice = "" }) {
  const cardRef = useRef(null);
  const birthDateRef = useRef(null);
  const [step, setStep] = useState(0);
  const [birthDate, setBirthDate] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [name, setName] = useState("Mira");
  const [language, setLanguage] = useState("Hinglish");
  const [pronouns, setPronouns] = useState("She / her");
  const [quietStart, setQuietStart] = useState("22:00");
  const [quietEnd, setQuietEnd] = useState("08:00");
  const [consents, setConsents] = useState({ chat: false, memory: false, mood: false, notifications: false, ai: false });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [bootstrapUnconfirmed, setBootstrapUnconfirmed] = useState(false);

  useEffect(() => {
    if (step === 0) return;
    const heading = cardRef.current?.querySelector("h1");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus();
    }
  }, [step]);

  const next = () => { setError(""); setStep((value) => Math.min(5, value + 1)); };
  const back = () => { setError(""); setStep((value) => Math.max(0, value - 1)); };
  const finish = async () => {
    if (submitting) return;
    if (window.localStorage.getItem(REVOCATION_PENDING_KEY)) {
      setBootstrapUnconfirmed(true);
      setError("A previous cloud-session revocation is still unconfirmed. Retry after the service reconnects, or continue with a device-only demo.");
      return;
    }
    setSubmitting(true);
    setError("");
    setBootstrapUnconfirmed(false);
    const profile = { name: name.trim() || "Mira", language, pronouns, quietStart, quietEnd, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata", consents };
    let sessionMode = "local-demo";
    let connectionNotice = "";
    try {
      const session = await bootstrapSession(profile);
      sessionMode = session?.capabilities?.gemini ? "live" : "api-demo";
      connectionNotice = session?.warning?.message || "";
    } catch (bootstrapError) {
      setSubmitting(false);
      setBootstrapUnconfirmed(bootstrapError?.code === "bootstrap_unconfirmed");
      setError(bootstrapError?.message || "Cloud setup failed before a session could be confirmed. Please try again.");
      return;
    }
    const savedProfile = { ...profile, sessionMode, connectionNotice };
    window.localStorage.setItem("saathkind-demo-profile", JSON.stringify(savedProfile));
    setSubmitting(false);
    onComplete(savedProfile);
  };
  const continueOnDevice = async () => {
    if (submitting) return;
    setSubmitting(true);
    const profile = { name: name.trim() || "Mira", language, pronouns, quietStart, quietEnd, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata", consents: { ...consents } };
    let unconfirmedCloudSession = false;
    try {
      await logoutSession();
      window.localStorage.removeItem(REVOCATION_PENDING_KEY);
    } catch {
      // Preserve the provisional token so Settings can retry revocation. The
      // device-only product path never sends content with it.
      unconfirmedCloudSession = true;
      window.localStorage.setItem(REVOCATION_PENDING_KEY, String(Date.now()));
    }
    const savedProfile = {
      ...profile,
      sessionMode: "local-demo",
      unconfirmedCloudSession,
      connectionNotice: unconfirmedCloudSession
        ? "Device-only demo selected. Cloud setup may retain the entered profile and consent metadata, but no messages; session revocation is unconfirmed and Settings will retry it. Any setup account expires after 30 days."
        : "Device-only demo selected. Any recoverable cloud setup session was revoked; no messages will sync.",
    };
    window.localStorage.setItem("saathkind-demo-profile", JSON.stringify(savedProfile));
    setSubmitting(false);
    onComplete(savedProfile);
  };

  if (step === 0) {
    return (
      <main className="app-entry">
        <img src="/assets/saathkind-horizon.png" alt="" aria-hidden="true" />
        <div className="app-entry__top"><Logo /><Link to="/">Back to website</Link></div>
        <section className="entry-card" aria-labelledby="entry-title">
          <div className="companion-avatar companion-avatar--large" aria-hidden="true">S</div>
          <span className="eyebrow">A thoughtful beta to explore</span>
          <h1 id="entry-title">What’s on your mind?</h1>
          {initialNotice && <p className="form-error" role="status">{initialNotice}</p>}
          <p>Saathkind is an AI companion demo for thoughtful conversation, memory you control, and gentle follow-through. Use non-sensitive test content only.</p>
          <button type="button" className="button button--primary button--wide" onClick={next}>Start demo setup <ArrowRight aria-hidden="true" /></button>
          <p className="entry-note"><LockKeyhole aria-hidden="true" /> Unverified synthetic demo · No email collected</p>
          <div className="entry-legal">Review the beta <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy notice</Link>. Both are pre-launch drafts; use non-sensitive test content only. Connected beta accounts and cloud state expire automatically 30 days after creation; export or delete sooner.</div>
        </section>
      </main>
    );
  }

  const steps = ["Eligibility", "About you", "Boundaries", "Consent", "Ready"];
  return (
    <main className="onboarding-page">
      <header className="onboarding-header"><Logo /><span>Synthetic demo setup</span></header>
      <div className="onboarding-progress" role="progressbar" aria-label="Setup progress" aria-valuemin="1" aria-valuemax="5" aria-valuenow={step}><i style={{ width: `${step * 20}%` }} /></div>
      <section className="onboarding-card" ref={cardRef}>
        <div className="onboarding-step-label"><span>Step {step} of 5</span><span>{steps[step - 1]}</span></div>
        {step === 1 && (
          <div className="onboarding-content">
            <div className="onboarding-icon"><UserRound aria-hidden="true" /></div>
            <h1>Saathkind is for adults.</h1>
            <p>Because conversations may be personal, we confirm eligibility before collecting anything more.</p>
            <label>Date of birth<input ref={birthDateRef} type="date" value={birthDate} onInput={(event) => setBirthDate(event.currentTarget.value)} onChange={(event) => setBirthDate(event.currentTarget.value)} aria-describedby={error ? "eligibility-error" : undefined} /></label>
            <label className="check-row"><input type="checkbox" checked={ageConfirmed} onChange={(event) => setAgeConfirmed(event.target.checked)} aria-describedby={error ? "eligibility-error" : undefined} /><span>I confirm I am 18 or older.</span></label>
            {error && <p id="eligibility-error" className="form-error" role="alert">{error}</p>}
            <button type="button" className="button button--primary button--wide" onClick={() => {
              const selectedBirthDate = birthDate || birthDateRef.current?.value || "";
              if (!selectedBirthDate || !ageConfirmed) return setError("Add your date of birth and confirm you are 18 or older.");
              const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 18);
              if (new Date(selectedBirthDate) > cutoff) return setError("You must be 18 or older to use Saathkind.");
              next();
            }}>Continue <ArrowRight aria-hidden="true" /></button>
          </div>
        )}
        {step === 2 && (
          <div className="onboarding-content">
            <div className="onboarding-icon"><Languages aria-hidden="true" /></div>
            <h1>Make the conversation feel natural.</h1>
            <p>You can change these choices later in Settings.</p>
            <label>What should we call you?<input value={name} onChange={(event) => setName(event.target.value)} maxLength="40" /></label>
            <fieldset><legend>Conversation style</legend><div className="choice-grid">{["English", "Hindi", "Hinglish"].map((item) => <button type="button" className={language === item ? "is-selected" : ""} aria-pressed={language === item} onClick={() => setLanguage(item)} key={item}>{item}</button>)}</div></fieldset>
            <label>Pronouns<select value={pronouns} onChange={(event) => setPronouns(event.target.value)}><option>She / her</option><option>He / him</option><option>They / them</option><option>Prefer not to say</option></select></label>
            <button type="button" className="button button--primary button--wide" onClick={next}>Continue <ArrowRight aria-hidden="true" /></button>
          </div>
        )}
        {step === 3 && (
          <div className="onboarding-content">
            <div className="onboarding-icon"><Clock3 aria-hidden="true" /></div>
            <h1>Set a quiet boundary.</h1>
            <p>Save hours the planner should protect if notification delivery is enabled after beta.</p>
            <div className="form-grid form-grid--two"><label>Quiet from<input type="time" value={quietStart} onChange={(event) => setQuietStart(event.target.value)} /></label><label>Until<input type="time" value={quietEnd} onChange={(event) => setQuietEnd(event.target.value)} /></label></div>
            <div className="boundary-note"><ShieldCheck aria-hidden="true" /><span>You can snooze or disable every follow-up. There are no streaks or guilt messages.</span></div>
            <button type="button" className="button button--primary button--wide" onClick={next}>Continue <ArrowRight aria-hidden="true" /></button>
          </div>
        )}
        {step === 4 && (
          <div className="onboarding-content onboarding-content--wide">
            <div className="onboarding-icon"><ShieldCheck aria-hidden="true" /></div>
            <h1>Choose what Saathkind can do.</h1>
            <p>Each permission is separate. Optional choices can be changed or withdrawn later.</p>
            <div className="consent-list">
              <Toggle checked={consents.chat} onChange={(checked) => setConsents({ ...consents, chat: checked })} label="Store conversation history" description="Lets this demo restore only the latest cloud conversation; a full conversation library is not available." />
              <Toggle checked={consents.memory} onChange={(checked) => setConsents({ ...consents, memory: checked })} label="Suggest useful memories" description="You review memory receipts and can edit or forget them." />
              <Toggle checked={consents.mood} onChange={(checked) => setConsents({ ...consents, mood: checked })} label="Offer optional reflections" description="Saathkind may suggest a pattern with uncertainty; you correct it." />
              <Toggle checked={consents.notifications} onChange={(checked) => setConsents({ ...consents, notifications: checked })} label="Save follow-up plans" description="Planner records only; this beta does not deliver notifications." />
              <Toggle checked={consents.ai} onChange={(checked) => setConsents({ ...consents, ai: checked })} label="Allow AI processing for demo replies" description="Required for cloud demo replies. Gemini is not connected in this release; replies use a limited deterministic fallback that is not safety-evaluated." />
            </div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button type="button" className="button button--primary button--wide" onClick={() => {
              if (!consents.chat || !consents.ai) return setError("Conversation storage and AI-processing consent are required for this demo.");
              next();
            }}>Save choices <ArrowRight aria-hidden="true" /></button>
          </div>
        )}
        {step === 5 && (
          <div className="onboarding-content onboarding-ready">
            <div className="ready-mark"><Check aria-hidden="true" /></div>
            <span className="eyebrow">All set, {name.trim() || "Mira"}</span>
            <h1>You lead the conversation.</h1>
            <p>Talk naturally. When Saathkind notices something that could help later, you will see exactly what it wants to remember.</p>
            <div className="ready-summary"><span><MessageCircle aria-hidden="true" /> {language} conversation</span><span><Clock3 aria-hidden="true" /> Quiet {quietStart}–{quietEnd}</span><span><Database aria-hidden="true" /> Memory {consents.memory ? "on" : "off"}</span></div>
            {error && <p className="form-error" role="status">{error}</p>}
            <button type="button" className="button button--primary button--wide" onClick={finish} disabled={submitting}>{submitting ? <><LoaderCircle className="spin" aria-hidden="true" /> Connecting…</> : <>Enter Saathkind <ArrowRight aria-hidden="true" /></>}</button>
            {bootstrapUnconfirmed && <button type="button" className="button button--ghost button--wide" disabled={submitting} onClick={continueOnDevice}>{submitting ? "Confirming device-only mode…" : "Continue on this device only"}</button>}
          </div>
        )}
        <div className="onboarding-back">{step >= 1 && <button type="button" disabled={submitting} onClick={() => step === 1 ? setStep(0) : back()}><ArrowLeft aria-hidden="true" /> Back</button>}</div>
      </section>
      <p className="onboarding-disclosure"><Bot aria-hidden="true" /> Beta demo: use non-sensitive content. AI, not therapy or emergency care. Connected cloud state expires after 30 days.</p>
    </main>
  );
}

function ChatView({ messages, setMessages, memories, setMemories, apiMode, setApiMode, conversationId, setConversationId, setUsage, setToast, memoryEnabled, aiProcessingEnabled, chatStorageEnabled, cloudExpected, profileName, receiptDismissed, onDismissReceipt, onSendingChange }) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [receiptSaving, setReceiptSaving] = useState(false);
  const [menuId, setMenuId] = useState(null);
  const endRef = useRef(null);
  const requestGeneration = useRef(0);
  const proposedMemoryText = `${profileName || "You"} has an interview tomorrow and wants a calm preparation plan tonight.`;
  const proposedMemoryExists = memories.some((memory) => memory.text === proposedMemoryText || memory.title === "Interview tomorrow");
  const interviewSourceMessage = [...messages].reverse().find((message) => message.role === "user" && /(?:kal\s+interview|interview\s+(?:is\s+)?tomorrow|tomorrow.{0,30}interview)/i.test(message.content));
  const sourceMessageId = interviewSourceMessage?.id == null ? null : String(interviewSourceMessage.id);
  const sourceIsCloudMessage = Boolean(sourceMessageId?.startsWith("msg_"));

  useEffect(() => () => {
    requestGeneration.current += 1;
    onSendingChange(false);
  }, [onSendingChange]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, sending]);

  useEffect(() => {
    if (menuId === null) return undefined;
    const closeMenu = (event) => event.key === "Escape" && setMenuId(null);
    window.addEventListener("keydown", closeMenu);
    return () => window.removeEventListener("keydown", closeMenu);
  }, [menuId]);

  const send = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    if (cloudExpected && (!aiProcessingEnabled || !chatStorageEnabled)) {
      setToast("Cloud conversation sending is paused. Re-enable conversation storage and AI processing in Settings before sending another cloud reply.");
      return;
    }
    const localMessageId = Date.now();
    const userMessage = { id: localMessageId, clientMessageId: String(localMessageId), role: "user", content, time: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), ...(cloudExpected ? { syncStatus: "pending" } : {}) };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setDraft("");
    setSending(true);
    onSendingChange(true);
    const requestId = ++requestGeneration.current;
    const result = await sendChatMessage(nextMessages, conversationId, { localOnly: !cloudExpected });
    if (requestId !== requestGeneration.current) return;
    setApiMode(result.mode);
    if (result.usage) {
      setUsage(result.usage);
    } else if (cloudExpected && ["live", "api-demo"].includes(result.mode)) {
      // Keep the visible allowance responsive, then reconcile against the
      // authoritative cloud counter without delaying the assistant reply.
      setUsage(incrementMessageUsage);
      loadUsage().then((freshUsage) => {
        if (requestId === requestGeneration.current) setUsage(freshUsage);
      }).catch(() => {
        // The optimistic counter remains visible until the next hydration.
      });
    }
    if (result.conversationId) setConversationId(result.conversationId);
    setMessages((items) => [
      ...items.map((item) => item.id === userMessage.id ? {
        ...item,
        ...(result.userMessageId ? { id: result.userMessageId } : {}),
        ...(result.syncStatus ? { syncStatus: result.syncStatus } : { syncStatus: undefined }),
      } : item),
      { id: result.assistantMessageId || Date.now() + 1, clientMessageId: userMessage.clientMessageId, role: "assistant", content: result.reply, time: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), ...(result.syncStatus ? { syncStatus: result.syncStatus } : {}) },
    ]);
    setSending(false);
    onSendingChange(false);
  };

  const approveProposedMemory = async () => {
    if (receiptSaving) return;
    setReceiptSaving(true);
    const result = await saveDemoResource("/memories", {
      content: proposedMemoryText,
      category: "Open loop",
      pinned: true,
      confidence: 1,
      sourceMessageId,
    }, "POST", { localOnly: !cloudExpected });
    if (cloudWriteFailed(result, cloudExpected)) {
      setReceiptSaving(false);
      setToast(cloudFailureNotice(result, "memory approval"));
      return;
    }
    const memory = {
      id: result.mode === "live" ? result.data.id : `demo_${Date.now()}`,
      title: "Interview tomorrow",
      text: proposedMemoryText,
      source: "Approved from this conversation",
      sourceMessageId,
      confidence: "High",
      pinned: true,
      category: "Open loop",
    };
    setMemories((items) => [...items, memory]);
    onDismissReceipt();
    setReceiptSaving(false);
    setToast(syncNotice(result, "Memory approved and saved."));
  };

  return (
    <div className="chat-view">
      <header className="workspace-header chat-header">
        <div><span className="workspace-kicker">Today</span><h1>Conversation demo</h1></div>
        <button type="button" className="header-action" onClick={() => setToast("This is a synthetic beta session, not verified production privacy.")}><LockKeyhole aria-hidden="true" /> Beta demo</button>
      </header>
      <div className="chat-notice"><Bot aria-hidden="true" /><span>Beta demo: avoid sensitive content. Saathkind is AI and may make mistakes. In India, Tele-MANAS is 14416.</span></div>
      {cloudExpected && (!aiProcessingEnabled || !chatStorageEnabled) && <div className="chat-notice" role="status"><ShieldCheck aria-hidden="true" /><span>Cloud conversation sending is paused because {![aiProcessingEnabled, chatStorageEnabled].some(Boolean) ? "conversation storage and AI-processing consent are" : !chatStorageEnabled ? "conversation storage is" : "AI-processing consent is"} off. Re-enable the required choice in Settings when you want another cloud reply.</span></div>}
      <div className="message-list" aria-live="polite">
        <div className="conversation-day"><span>Today</span></div>
        {messages.map((message, index) => (
          <div className={`message-row message-row--${message.role}`} key={message.id}>
            {message.role === "assistant" && <div className="message-avatar" aria-hidden="true">S</div>}
            <article className="message">
              <p lang={/[\u0900-\u097f]/u.test(message.content) ? "hi" : undefined}>{message.content}</p>
              <div className="message__meta"><time>{message.time}</time>
                {message.syncStatus && <span className="message-sync-status">{message.syncStatus === "pending" ? "Sending…" : message.syncStatus === "rejected" ? "Device only · rejected by cloud" : message.syncStatus === "local-safety" ? "Safety guidance · kept on this device only" : "Device copy · cloud unconfirmed"}</span>}
                <button type="button" aria-label="Message options" aria-expanded={menuId === message.id} onClick={() => setMenuId(menuId === message.id ? null : message.id)}><Ellipsis aria-hidden="true" /></button>
              </div>
              {menuId === message.id && (
                <div className="message-menu">
                  <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(message.content); setToast("Message copied."); } catch { setToast("Copy failed. Select the message text and copy it manually."); } finally { setMenuId(null); } }}><Copy aria-hidden="true" /> Copy</button>
                  {message.role === "user" && <button type="button" onClick={() => { setDraft(message.content); setMenuId(null); }}><Edit3 aria-hidden="true" /> Edit & resend</button>}
                  {message.role === "assistant" && <button type="button" onClick={() => { setMenuId(null); setToast("A fresh response will appear after your next message."); }}><RotateCcw aria-hidden="true" /> Try again</button>}
                  <button type="button" onClick={() => { setMenuId(null); setToast("Safety reporting is not connected in this synthetic beta. Do not use sensitive content; call 112 for immediate danger in India."); }}><Flag aria-hidden="true" /> Reporting status</button>
                </div>
              )}
              {message.role === "assistant" && index > 0 && <div className="message-reactions"><button type="button" aria-label="Helpful response" onClick={() => setToast("Feedback sync is not connected in this beta.")}><ThumbsUp aria-hidden="true" /></button><button type="button" aria-label="Unhelpful response" onClick={() => setToast("Feedback sync is not connected in this beta.")}><ThumbsDown aria-hidden="true" /></button></div>}
            </article>
          </div>
        ))}
        {memoryEnabled && interviewSourceMessage && (!cloudExpected || sourceIsCloudMessage) && !receiptDismissed && !proposedMemoryExists && (
          <aside className="chat-receipt" aria-label="Memory receipt">
            <div className="chat-receipt__icon"><Sparkles aria-hidden="true" /></div>
            <div><span>Memory receipt</span><strong>Interview tomorrow</strong><p>{proposedMemoryText}</p><small>Source: this conversation · Confidence: high</small></div>
            <div className="chat-receipt__actions">
              <button type="button" disabled={receiptSaving} onClick={approveProposedMemory}>{receiptSaving ? <LoaderCircle className="spin" aria-hidden="true" /> : <Check aria-hidden="true" />} {receiptSaving ? "Saving…" : "Approve"}</button>
              <button type="button" disabled={receiptSaving} onClick={() => { onDismissReceipt(); setToast("Memory dismissed. Nothing was saved."); }}><X aria-hidden="true" /> Not now</button>
            </div>
          </aside>
        )}
        {sending && <div className="message-row message-row--assistant"><div className="message-avatar" aria-hidden="true">S</div><div className="message message--typing"><LoaderCircle aria-hidden="true" /><span>Thinking with care…</span></div></div>}
        <div ref={endRef} />
      </div>
      <div className="composer-wrap">
        <div className="suggestion-row" aria-label="Prompt suggestions">
          {["Just listen", "Help me make a plan", "I need to untangle something"].map((item) => <button type="button" key={item} disabled={cloudExpected && (!aiProcessingEnabled || !chatStorageEnabled)} onClick={() => setDraft(item)}>{item}</button>)}
        </div>
        <div className="composer">
          <textarea rows="1" value={draft} maxLength="2000" aria-label="Message Saathkind" placeholder={cloudExpected && (!aiProcessingEnabled || !chatStorageEnabled) ? "Re-enable required consent in Settings" : "Write what’s on your mind…"} disabled={cloudExpected && (!aiProcessingEnabled || !chatStorageEnabled)} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} />
          <span>{draft.length}/2000</span>
          <button type="button" className="send-button" aria-label="Send message" disabled={!draft.trim() || sending || (cloudExpected && (!aiProcessingEnabled || !chatStorageEnabled))} onClick={send}><Send aria-hidden="true" /></button>
        </div>
        <p>Enter to send · Shift + Enter for a new line · {apiMode === "live" ? "Gemini connected" : apiMode === "api-demo" ? "Cloud API · limited deterministic fallback" : apiMode === "local-safety" ? "Offline crisis guidance · no cloud sync" : apiMode === "error" ? "Cloud result unconfirmed · device copy" : apiMode === "rejected" ? "Cloud request rejected · device-only turn" : "Local demo · no cloud sync"}</p>
      </div>
    </div>
  );
}

function MemoryView({ memories, setMemories, enabled, setToast, cloudExpected, consentSaving, changeConsent }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const [editing, setEditing] = useState(null);
  const [forgetting, setForgetting] = useState(null);
  const [draft, setDraft] = useState("");
  const categories = ["All", "Open loop", "Preference", "Pattern"];
  const visible = memories.filter((item) => (filter === "All" || item.category === filter) && `${item.title} ${item.text}`.toLowerCase().includes(query.toLowerCase()));

  const changeMemoryConsent = () => changeConsent({
    apiName: "memory",
    profileName: "memory",
    checked: !enabled,
    subject: "memory setting change",
    enabledMessage: "Memory resumed.",
    disabledMessage: "Memory paused.",
  });

  return (
    <div className="workspace-view">
      <header className="workspace-header"><div><span className="workspace-kicker">Memory centre</span><h1>What Saathkind knows</h1><p>Every saved detail is visible and editable.</p></div><button type="button" className={`button ${enabled ? "button--ghost" : "button--primary"}`} disabled={consentSaving} onClick={changeMemoryConsent}>{consentSaving ? <LoaderCircle className="spin" aria-hidden="true" /> : enabled ? <Pause aria-hidden="true" /> : <RefreshCcw aria-hidden="true" />}{consentSaving ? "Saving…" : enabled ? "Pause memory" : "Resume memory"}</button></header>
      {!enabled && <div className="workspace-alert"><Pause aria-hidden="true" /><div><strong>Memory is paused</strong><span>You can keep chatting. No new memory will be suggested or used.</span></div></div>}
      <div className="workspace-toolbar"><label className="search-field"><span className="sr-only">Search memories</span><input placeholder="Search memories" value={query} onChange={(event) => setQuery(event.target.value)} /></label><div className="filter-pills">{categories.map((item) => <button type="button" key={item} className={filter === item ? "is-active" : ""} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</button>)}</div></div>
      <div className="memory-view-list">
        {visible.map((memory) => (
          <article className="workspace-memory" key={memory.id}>
            <div className="workspace-memory__top"><span className="memory-category">{memory.category}</span><button type="button" className={memory.pinned ? "is-pinned" : ""} aria-label={memory.pinned ? "Unpin memory" : "Pin memory"} onClick={async () => { const pinned = !memory.pinned; const cloudBacked = typeof memory.id === "string" && memory.id.startsWith("mem_"); const result = cloudBacked ? await saveDemoResource(`/memories/${memory.id}/pin`, { pinned }, "POST", { localOnly: !cloudExpected }) : { mode: "local" }; if (cloudWriteFailed(result, cloudExpected && cloudBacked)) return setToast(cloudFailureNotice(result, "memory pin change")); setMemories((items) => items.map((item) => item.id === memory.id ? { ...item, pinned } : item)); setToast(syncNotice(result, pinned ? "Memory pinned." : "Memory unpinned.")); }}><Pin aria-hidden="true" /> {memory.pinned ? "Pinned" : "Pin"}</button></div>
            <h2>{memory.title}</h2><p>{memory.text}</p><small>{memory.source} · {memory.confidence} confidence</small>
            <div className="workspace-memory__actions"><button type="button" onClick={() => { setEditing(memory); setDraft(memory.text); }}><Edit3 aria-hidden="true" /> Edit</button><button type="button" className="danger" onClick={() => setForgetting(memory)}><Trash2 aria-hidden="true" /> Forget</button></div>
          </article>
        ))}
        {!visible.length && <div className="large-empty"><Database aria-hidden="true" /><h2>No matching memories</h2><p>Try another search or filter. Saathkind works normally with an empty memory centre.</p></div>}
      </div>
      <section className="sensitive-controls"><div><ShieldCheck aria-hidden="true" /><span><strong>Sensitive-topic exclusions</strong><small>Planned before any private beta; not active in this synthetic demo.</small></span></div><button type="button" disabled aria-disabled="true">Coming later <ChevronRight aria-hidden="true" /></button></section>
      {editing && <Dialog title="Edit memory" description="Correct the record in your own words." onClose={() => setEditing(null)}><label>Memory<textarea rows="5" maxLength="1000" value={draft} onChange={(event) => setDraft(event.target.value)} /></label><div className="dialog-actions"><button type="button" className="button button--ghost" onClick={() => setEditing(null)}>Cancel</button><button type="button" className="button button--primary" onClick={async () => { const updated = { ...editing, text: draft.trim() || editing.text }; const cloudBacked = typeof editing.id === "string" && editing.id.startsWith("mem_"); const result = cloudBacked ? await saveDemoResource(`/memories/${editing.id}`, { content: updated.text, category: updated.category, pinned: updated.pinned }, "PATCH", { localOnly: !cloudExpected }) : { mode: "local" }; if (cloudWriteFailed(result, cloudExpected && cloudBacked)) return setToast(cloudFailureNotice(result, "memory edit")); setMemories((items) => items.map((item) => item.id === editing.id ? updated : item)); setEditing(null); setToast(syncNotice(result, "Memory updated.")); }}>Save change</button></div></Dialog>}
      {forgetting && <Dialog title="Forget this memory?" description="Saathkind will stop using this detail. This action applies to the memory, not the original conversation." onClose={() => setForgetting(null)}><blockquote>{forgetting.text}</blockquote><div className="dialog-actions"><button type="button" className="button button--ghost" onClick={() => setForgetting(null)}>Keep it</button><button type="button" className="button button--danger" onClick={async () => { const cloudBacked = typeof forgetting.id === "string" && forgetting.id.startsWith("mem_"); const result = cloudBacked ? await saveDemoResource(`/memories/${forgetting.id}`, null, "DELETE", { localOnly: !cloudExpected }) : { mode: "local" }; if (cloudWriteFailed(result, cloudExpected && cloudBacked)) return setToast(cloudFailureNotice(result, "memory deletion")); setMemories((items) => items.filter((item) => item.id !== forgetting.id)); setForgetting(null); setToast(syncNotice(result, "Memory forgotten.")); }}>Forget memory</button></div></Dialog>}
    </div>
  );
}

function FollowUpsView({ followups, setFollowups, quietHours, setQuietHours, setToast, cloudExpected, planningEnabled, timezone }) {
  const viewRef = useRef(null);
  const [formOpen, setFormOpen] = useState(false);
  const [submittingPlan, setSubmittingPlan] = useState(false);
  const [draft, setDraft] = useState(() => { const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000); return { title: "", date: dateInputValue(tomorrow, timezone), time: "18:00" }; });
  useEffect(() => {
    const controls = viewRef.current?.querySelectorAll(".mini-switch input, .followup-settings input, .followup-settings button");
    controls?.forEach((control) => { control.disabled = !planningEnabled; });
  }, [planningEnabled, followups, quietHours]);
  const addPlan = async () => {
    if (submittingPlan) return;
    if (!planningEnabled) return setToast("Follow-up planning is off. Re-enable it in Settings before adding a planner item.");
    const scheduledFor = zonedWallTimeToIso(draft.date, draft.time, timezone);
    if (!scheduledFor || Date.parse(scheduledFor) <= Date.now()) return setToast("Choose a valid future date and time in your account timezone.");
    if (timeFallsInQuietHours(draft.time, quietHours)) return setToast(`Choose a time outside quiet hours ${quietHours.start}–${quietHours.end}.`);
    setSubmittingPlan(true);
    const item = { ...draft, id: Date.now(), enabled: true };
    const result = await saveDemoResource("/followups", { topic: draft.title, scheduledFor }, "POST", { localOnly: !cloudExpected });
    if (cloudWriteFailed(result, cloudExpected)) {
      setSubmittingPlan(false);
      setToast(cloudFailureNotice(result, "planner creation"));
      return;
    }
    const saved = result.mode === "live" ? { ...item, id: result.data.id } : item;
    setFollowups((items) => [...items, saved]);
    setSubmittingPlan(false);
    setFormOpen(false);
    setToast(result.mode === "live" ? "Plan saved to the cloud; notification delivery is off." : "Plan saved on this device; notification delivery is off.");
  };
  return (
    <div className="workspace-view" ref={viewRef}>
      <header className="workspace-header"><div><span className="workspace-kicker">Follow-up planner preview</span><h1>Plan gently, without pretending delivery is live</h1><p>{planningEnabled ? "Plans are stored for the demo. This release does not send email, SMS, WhatsApp, or push notifications." : "Follow-up planning consent is off. Existing items remain visible so you can delete them; re-enable planning in Settings to add or change plans."}</p></div><button type="button" className="button button--primary" disabled={!planningEnabled} title={!planningEnabled ? "Re-enable follow-up planning in Settings" : undefined} onClick={() => setFormOpen(true)}><Plus aria-hidden="true" /> Add to planner</button></header>
      <div className="followup-layout">
        <section className="workspace-panel"><div className="panel-heading"><div><h2>Planner items</h2><p>{followups.filter((item) => item.enabled).length} enabled plans · delivery off</p></div><CalendarPlus aria-hidden="true" /></div><div className="followup-list">{followups.map((item) => <article className="followup-item" key={item.id}><div className="date-tile"><strong>{new Date(`${item.date}T12:00:00`).toLocaleDateString("en-IN", { day: "2-digit" })}</strong><span>{new Date(`${item.date}T12:00:00`).toLocaleDateString("en-IN", { month: "short" })}</span></div><div><h3>{item.title}</h3><p>{item.time} · Planner only; no notification is sent</p></div><label className="mini-switch"><span className="sr-only">Enable {item.title}</span><input type="checkbox" checked={item.enabled} onChange={async () => { const enabled = !item.enabled; const cloudBacked = typeof item.id === "string" && item.id.startsWith("fup_"); const result = cloudBacked ? await saveDemoResource(`/followups/${item.id}`, { status: enabled ? "scheduled" : "cancelled" }, "PATCH", { localOnly: !cloudExpected }) : { mode: "local" }; if (cloudWriteFailed(result, cloudExpected && cloudBacked)) return setToast(cloudFailureNotice(result, "planner status change")); setFollowups((items) => items.map((entry) => entry.id === item.id ? { ...entry, enabled } : entry)); setToast(syncNotice(result, enabled ? "Planner item enabled; delivery remains off." : "Planner item disabled and still visible so you can delete it.")); }} /><i aria-hidden="true" /></label><button type="button" className="icon-button" aria-label={`Delete ${item.title}`} onClick={async () => { const cloudBacked = typeof item.id === "string" && item.id.startsWith("fup_"); const result = cloudBacked ? await saveDemoResource(`/followups/${item.id}`, null, "DELETE", { localOnly: !cloudExpected }) : { mode: "local" }; if (cloudWriteFailed(result, cloudExpected && cloudBacked)) return setToast(cloudFailureNotice(result, "planner deletion")); setFollowups((items) => items.filter((entry) => entry.id !== item.id)); setToast(syncNotice(result, "Planner item permanently removed.")); }}><Trash2 aria-hidden="true" /></button></article>)}{!followups.length && <div className="large-empty"><Bell aria-hidden="true" /><h3>No planner items</h3><p>Add a plan to test the workflow. This beta does not deliver notifications.</p></div>}</div></section>
        <aside className="followup-settings">
          <section className="workspace-panel"><div className="panel-heading"><div><h2>Quiet hours</h2><p>A stored boundary for future delivery</p></div><Clock3 aria-hidden="true" /></div><div className="form-grid form-grid--two"><label>From<input type="time" value={quietHours.start} onChange={(event) => setQuietHours({ ...quietHours, start: event.target.value })} /></label><label>Until<input type="time" value={quietHours.end} onChange={(event) => setQuietHours({ ...quietHours, end: event.target.value })} /></label></div><button type="button" className="button button--ghost button--wide" onClick={async () => { const result = await saveDemoResource("/quiet-hours", quietHours, "PATCH", { localOnly: !cloudExpected }); if (cloudWriteFailed(result, cloudExpected)) return setToast(cloudFailureNotice(result, "quiet-hours change")); setToast(syncNotice(result, "Quiet hours saved for the planner.")); }}>Save quiet hours</button></section>
          <section className="workspace-panel"><div className="panel-heading"><div><h2>Delivery cadence</h2><p>Not connected in this beta</p></div><AlarmClock aria-hidden="true" /></div><label>Check-in frequency<select value="Not available" disabled><option>Not available</option></select></label><p className="panel-footnote">A cadence control will ship only with a real, tested notification provider.</p></section>
        </aside>
      </div>
      {formOpen && <Dialog title="Add a follow-up plan" description={`This tests planning and boundaries only in ${timezone || "your account timezone"}. No notification will be delivered.`} onClose={() => !submittingPlan && setFormOpen(false)}><label>What should the plan remember?<input maxLength="240" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="For example, ask how the call went" disabled={submittingPlan} /></label><div className="form-grid form-grid--two"><label>Date<input type="date" value={draft.date} min={dateInputValue(new Date(), timezone)} onChange={(event) => setDraft({ ...draft, date: event.target.value })} disabled={submittingPlan} /></label><label>Time<input type="time" value={draft.time} onChange={(event) => setDraft({ ...draft, time: event.target.value })} disabled={submittingPlan} /></label></div><div className="dialog-actions"><button type="button" className="button button--ghost" disabled={submittingPlan} onClick={() => setFormOpen(false)}>Cancel</button><button type="button" className="button button--primary" disabled={submittingPlan || !draft.title.trim() || !draft.date || !draft.time} onClick={addPlan}>{submittingPlan ? "Saving…" : "Add plan"}</button></div></Dialog>}
    </div>
  );
}

function GoalsView({ goals, setGoals, setToast, cloudExpected, reflectionEnabled }) {
  const [adding, setAdding] = useState(false);
  const [submittingGoal, setSubmittingGoal] = useState(false);
  const [draft, setDraft] = useState({ title: "", note: "", total: 3 });
  const [mood, setMood] = useState("");

  useEffect(() => {
    if (!reflectionEnabled) setMood("");
  }, [reflectionEnabled]);

  const updateGoal = async (goalItem, changes, successMessage) => {
    const cloudBacked = typeof goalItem.id === "string" && goalItem.id.startsWith("gol_");
    const next = { ...goalItem, ...changes };
    const result = cloudBacked
      ? await saveDemoResource(`/goals/${goalItem.id}`, { status: next.status, progress: next.progress, total: next.total }, "PATCH", { localOnly: !cloudExpected })
      : { mode: "local" };
    if (cloudWriteFailed(result, cloudExpected && cloudBacked)) return setToast(cloudFailureNotice(result, "goal change"));
    setGoals((items) => items.map((entry) => entry.id === goalItem.id ? next : entry));
    setToast(syncNotice(result, successMessage));
  };

  const deleteGoal = async (goalItem) => {
    const cloudBacked = typeof goalItem.id === "string" && goalItem.id.startsWith("gol_");
    const result = cloudBacked ? await saveDemoResource(`/goals/${goalItem.id}`, null, "DELETE", { localOnly: !cloudExpected }) : { mode: "local" };
    if (cloudWriteFailed(result, cloudExpected && cloudBacked)) return setToast(cloudFailureNotice(result, "goal deletion"));
    setGoals((items) => items.filter((entry) => entry.id !== goalItem.id));
    setToast(syncNotice(result, "Goal removed without penalty."));
  };

  const addGoal = async () => {
    if (submittingGoal || !draft.title.trim()) return;
    setSubmittingGoal(true);
    const item = { ...draft, id: Date.now(), progress: 0, status: "active" };
    const result = await saveDemoResource("/goals", { title: item.title, description: item.note, total: item.total, progress: 0 }, "POST", { localOnly: !cloudExpected });
    if (cloudWriteFailed(result, cloudExpected)) {
      setSubmittingGoal(false);
      setToast(cloudFailureNotice(result, "goal creation"));
      return;
    }
    const saved = result.mode === "live" ? { ...item, id: result.data.id, total: result.data.total, progress: result.data.progress, status: result.data.status } : item;
    setGoals((items) => [...items, saved]);
    setSubmittingGoal(false);
    setAdding(false);
    setToast(syncNotice(result, "Goal added. No streak required."));
  };

  return (
    <div className="workspace-view">
      <header className="workspace-header"><div><span className="workspace-kicker">Goals & reflection</span><h1>Progress without pressure</h1><p>A gentle place to notice, adjust, pause, or let go.</p></div><button type="button" className="button button--primary" onClick={() => setAdding(true)}><Plus aria-hidden="true" /> Add a small goal</button></header>
      <div className="goals-layout">
        <section className="workspace-panel">
          <div className="panel-heading"><div><h2>Your goals</h2><p>{goals.filter((goalItem) => goalItem.status === "active").length} active</p></div><Goal aria-hidden="true" /></div>
          <div className="goal-list">
            {goals.map((goalItem) => {
              const nextProgress = Math.min(goalItem.total, goalItem.progress + 1);
              return (
                <article className={`goal-card goal-card--${goalItem.status}`} key={goalItem.id}>
                  <div className="goal-card__top"><span>{goalItem.status}</span></div>
                  <h3>{goalItem.title}</h3><p>{goalItem.note}</p>
                  <div className="goal-progress"><i style={{ width: `${Math.min(100, goalItem.progress / goalItem.total * 100)}%` }} /><span>{goalItem.progress} of {goalItem.total}</span></div>
                  <div className="goal-actions">
                    {goalItem.status === "active" && <><button type="button" onClick={() => updateGoal(goalItem, { progress: nextProgress, status: nextProgress >= goalItem.total ? "completed" : "active" }, "Goal progress saved.")}><Check aria-hidden="true" /> Mark progress</button><button type="button" onClick={() => updateGoal(goalItem, { status: "paused" }, "Goal paused.")}><Pause aria-hidden="true" /> Pause</button></>}
                    {goalItem.status === "paused" && <button type="button" onClick={() => updateGoal(goalItem, { status: "active" }, "Goal resumed.")}><RefreshCcw aria-hidden="true" /> Resume</button>}
                    <button type="button" className="danger" onClick={() => deleteGoal(goalItem)}><X aria-hidden="true" /> Let go</button>
                  </div>
                </article>
              );
            })}
            {!goals.length && <div className="large-empty"><Goal aria-hidden="true" /><h3>No goals yet</h3><p>Add one small, pressure-free goal when it helps.</p></div>}
          </div>
        </section>
        <aside className="reflection-card" aria-disabled={!reflectionEnabled}><div className="reflection-card__icon"><HeartHandshake aria-hidden="true" /></div><span className="workspace-kicker">Interaction preview</span><h2>How did this week feel overall?</h2><p>{reflectionEnabled ? "Try the reflection control. This beta does not store the answer." : "Optional reflection is off. Re-enable it in Settings to use this preview."}</p><div className="mood-scale">{["Heavy", "Uneven", "Okay", "Steady", "Light"].map((item) => <button key={item} type="button" className={mood === item ? "is-selected" : ""} aria-pressed={mood === item} disabled={!reflectionEnabled} onClick={() => setMood(item)}>{item}</button>)}</div><label>One thing worth noticing<textarea rows="4" placeholder={reflectionEnabled ? "A small win, a pattern, or nothing at all…" : "Reflection preview is off"} disabled={!reflectionEnabled} /></label><button type="button" className="button button--ghost button--wide" disabled={!reflectionEnabled || !mood} onClick={() => setToast("Reflection preview complete. Nothing was stored.")}>Preview reflection</button><small>{reflectionEnabled ? "Preview only · not stored or synced" : "Disabled by your reflection setting"}</small></aside>
      </div>
      {adding && <Dialog title="Add a small goal" description="Specific and kind beats ambitious and vague." onClose={() => !submittingGoal && setAdding(false)}><label>Goal<input maxLength="160" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="For example, take a ten-minute walk" disabled={submittingGoal} /></label><label>Gentle note<textarea rows="3" maxLength="1000" value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} placeholder="What would make this feel manageable?" disabled={submittingGoal} /></label><label>Small steps<input type="number" min="1" max="30" value={draft.total} onChange={(event) => setDraft({ ...draft, total: Math.min(Math.max(Number(event.target.value) || 1, 1), 30) })} disabled={submittingGoal} /></label><div className="dialog-actions"><button type="button" className="button button--ghost" disabled={submittingGoal} onClick={() => setAdding(false)}>Cancel</button><button type="button" className="button button--primary" disabled={submittingGoal || !draft.title.trim()} onClick={addGoal}>{submittingGoal ? "Saving…" : "Add goal"}</button></div></Dialog>}
    </div>
  );
}

function SettingsView({ profile, setProfile, memoryEnabled, quietHours, data, usage, onDelete, onClearDevice, setToast, cloudExpected, cloudControlAvailable, consentSaving, changeConsent }) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [resetText, setResetText] = useState("");
  const [profileDraft, setProfileDraft] = useState({ name: profile.name || "", language: profile.language || "Hinglish" });
  const aiProcessing = Boolean(profile.consents?.ai);
  const chatStorage = Boolean(profile.consents?.chat);
  const notifications = Boolean(profile.consents?.notifications);
  const reflection = Boolean(profile.consents?.mood);

  const exportData = async () => {
    let exportPayload = { exportedAt: new Date().toISOString(), source: "device-demo", profile, quietHours, usage, ...data };
    if (cloudExpected) {
      try {
        const cloudExport = await requestCloudExport();
        const deviceOnlyMessages = (data.messages || []).filter((message) => ["pending", "unconfirmed", "rejected", "local-safety"].includes(message.syncStatus));
        exportPayload = {
          ...cloudExport,
          ...(deviceOnlyMessages.length ? {
            deviceOnly: {
              description: "Turns kept only on this browser and not confirmed in the cloud account.",
              messages: deviceOnlyMessages,
            },
          } : {}),
        };
      } catch (error) {
        setToast(error?.message || "Cloud export could not be prepared. Please retry.");
        return;
      }
    }
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "saathkind-export.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setToast(cloudExpected ? "Your beta cloud export, plus any device-only turns, was downloaded." : "Your on-device demo export was downloaded.");
  };

  return (
    <div className="workspace-view settings-view">
      <header className="workspace-header"><div><span className="workspace-kicker">Settings</span><h1>Your account, your boundaries</h1><p>Privacy controls are part of the product—not buried elsewhere.</p></div></header>
      <div className="settings-stack">
        <section className="workspace-panel"><div className="panel-heading"><div><h2>Profile & language</h2><p>How Saathkind speaks with you</p></div><UserRound aria-hidden="true" /></div><div className="form-grid form-grid--two"><label>Name<input maxLength="80" value={profileDraft.name} onChange={(event) => setProfileDraft({ ...profileDraft, name: event.target.value })} /></label><label>Conversation style<select value={profileDraft.language} onChange={(event) => setProfileDraft({ ...profileDraft, language: event.target.value })}><option>English</option><option>Hindi</option><option>Hinglish</option></select></label></div><button type="button" className="button button--ghost" disabled={!profileDraft.name.trim()} onClick={async () => { const language = { English: "en", Hindi: "hi", Hinglish: "hinglish" }[profileDraft.language] || "hinglish"; const result = await saveDemoResource("/profile", { displayName: profileDraft.name.trim(), language }, "PATCH", { localOnly: !cloudExpected }); if (cloudWriteFailed(result, cloudExpected)) return setToast(cloudFailureNotice(result, "profile change")); const nextName = result.mode === "live" ? result.data.user.displayName : profileDraft.name.trim(); const nextLanguageCode = result.mode === "live" ? result.data.profile.language : language; const nextLanguage = { en: "English", hi: "Hindi", hinglish: "Hinglish" }[nextLanguageCode] || profileDraft.language; setProfile((current) => ({ ...current, name: nextName, language: nextLanguage })); setProfileDraft({ name: nextName, language: nextLanguage }); setToast(syncNotice(result, "Profile saved.")); }}>Save profile</button></section>
        <section className="workspace-panel">
          <div className="panel-heading"><div><h2>Consent & privacy</h2><p>Pause optional processing at any time</p></div><ShieldCheck aria-hidden="true" /></div>
          <div className="consent-list">
            <Toggle checked={chatStorage} disabled={consentSaving} onChange={(checked) => changeConsent({ apiName: "chatStorage", profileName: "chat", checked, subject: "conversation-storage consent change", enabledMessage: "Conversation storage enabled for cloud replies.", disabledMessage: "Conversation storage withdrawn; cloud sending is paused. Existing history remains available for export or deletion." })} label="Conversation storage" description="Stores each accepted cloud turn until account deletion or automatic 30-day expiry." />
            <Toggle checked={aiProcessing} disabled={consentSaving} onChange={(checked) => changeConsent({ apiName: "aiProcessing", profileName: "ai", checked, subject: "AI-processing consent change", enabledMessage: "AI-processing consent enabled for demo replies.", disabledMessage: "AI-processing consent withdrawn." })} label="AI-processing consent" description="Allows cloud demo replies. Gemini is not connected in this release; the limited deterministic fallback is not safety-evaluated." />
            <Toggle checked={memoryEnabled} disabled={consentSaving} onChange={(checked) => changeConsent({ apiName: "memory", profileName: "memory", checked, subject: "memory-consent change", enabledMessage: "Memory enabled.", disabledMessage: "Memory paused." })} label="Memory" description="Suggest and use memories you approve." />
            <Toggle checked={notifications} disabled={consentSaving} onChange={(checked) => changeConsent({ apiName: "proactiveFollowups", profileName: "notifications", checked, subject: "planner-consent change", enabledMessage: "Follow-up planning enabled; delivery remains off.", disabledMessage: "Follow-up planning disabled." })} label="Follow-up planning" description={`Stores plans and quiet hours ${quietHours.start}–${quietHours.end}; notifications are not connected.`} />
            <Toggle checked={reflection} disabled={consentSaving} onChange={(checked) => changeConsent({ apiName: "moodInference", profileName: "mood", checked, subject: "reflection-consent change", enabledMessage: "Reflection preview enabled.", disabledMessage: "Reflection preview disabled." })} label="Optional reflection preview" description="Controls the preview; reflection answers are not stored in this beta." />
          </div>
          <Link to="/privacy" className="text-link">Read the full privacy notice <ChevronRight aria-hidden="true" /></Link>
        </section>
        <section className="workspace-panel">
          <div className="panel-heading"><div><h2>Your data</h2><p>Connected beta accounts and cloud state expire after 30 days; export or delete sooner.</p></div><FileJson aria-hidden="true" /></div>
          <div className="data-actions">
            <div><Download aria-hidden="true" /><span><strong>Export your data</strong><small>Download cloud beta state when connected, or this device’s demo state.</small></span><button type="button" className="button button--ghost" onClick={exportData}>Export</button></div>
            <div><RefreshCcw aria-hidden="true" /><span><strong>Clear this device / Start new synthetic demo</strong><small>Revokes the connected cloud session, then clears local demo profile and history. It does not delete the cloud account.</small></span><button type="button" className="button button--ghost" onClick={() => { setResetText(""); setResetOpen(true); }}>Start new demo</button></div>
            <div className="danger-row"><Trash2 aria-hidden="true" /><span><strong>Delete account and data</strong><small>{cloudControlAvailable ? "Attempt to immediately delete connected or recoverable beta state, then clear this device." : "No cloud session is connected; this clears only the local demo state."}</small></span><button type="button" className="button button--danger" onClick={() => { setDeleteText(""); setDeleteOpen(true); }}>Delete</button></div>
          </div>
        </section>
        <section className="workspace-panel"><div className="panel-heading"><div><h2>Plan</h2><p>Free synthetic beta · No billing or payment method</p></div><Sparkles aria-hidden="true" /></div><div className="plan-summary"><div><span>Current access</span><strong>Free beta</strong></div><div><span>Messages in this beta account</span><strong>{usage?.counters?.messages || 0} of {usage?.limits?.messages || 300}</strong></div><Link to="/#pricing" className="button button--primary">View research pricing</Link></div></section>
      </div>
      {resetOpen && <Dialog title="Clear this device and start again?" description="This removes the browser’s local demo state and, when connected, first revokes its cloud session cookie. It does not delete cloud account data, which otherwise expires 30 days after creation." onClose={() => setResetOpen(false)}><label>Type RESET to confirm<input value={resetText} onChange={(event) => setResetText(event.target.value)} /></label><div className="dialog-actions"><button type="button" className="button button--ghost" onClick={() => setResetOpen(false)}>Cancel</button><button type="button" className="button button--danger" disabled={resetText !== "RESET"} onClick={async () => { setResetOpen(false); await onClearDevice(); }}>Clear this device</button></div></Dialog>}
      {deleteOpen && <Dialog title="Delete account and data?" description="If cloud-connected, this immediately deletes the beta account state and active session instead of waiting for automatic expiry 30 days after creation. Otherwise it clears the local demo profile." onClose={() => setDeleteOpen(false)}><label>Type DELETE to confirm<input value={deleteText} onChange={(event) => setDeleteText(event.target.value)} /></label><div className="dialog-actions"><button type="button" className="button button--ghost" onClick={() => setDeleteOpen(false)}>Cancel</button><button type="button" className="button button--danger" disabled={deleteText !== "DELETE"} onClick={onDelete}>Permanently delete</button></div></Dialog>}
    </div>
  );
}

function HydrationGate({ status, error, onRetry, onContinueDevice }) {
  const loading = status === "loading";
  return (
    <main className="app-entry">
      <img src="/assets/saathkind-horizon.png" alt="" aria-hidden="true" />
      <div className="app-entry__top"><Logo /><Link to="/">Back to website</Link></div>
      <section className="entry-card" aria-labelledby="hydration-title" aria-live="polite">
        <div className="companion-avatar companion-avatar--large" aria-hidden="true">S</div>
        <span className="eyebrow">Synthetic beta state check</span>
        <h1 id="hydration-title">{loading ? "Loading your cloud demo…" : error?.expired ? "This cloud demo session has expired." : "Your cloud demo could not be loaded."}</h1>
        {loading ? (
          <><p>We are loading the authoritative cloud state before enabling any editable controls.</p><LoaderCircle className="spin" aria-hidden="true" /></>
        ) : (
          <>
            <p>{error?.expired ? "Editing remains off so this device cannot overwrite cloud state with an older local copy." : "Editing remains off until cloud state loads. Retry, or deliberately continue with a device-only copy."}</p>
            <div className="dialog-actions">
              <button type="button" className="button button--ghost" onClick={onRetry}><RefreshCcw aria-hidden="true" /> Retry cloud sync</button>
              <button type="button" className="button button--primary" onClick={onContinueDevice}>Continue device-only</button>
            </div>
            <p className="entry-note"><ShieldCheck aria-hidden="true" /> Device-only mode will not update or delete cloud data. To start clean, continue and use Settings → Clear this device / Start new synthetic demo.</p>
          </>
        )}
        <div className="entry-legal">Connected beta accounts and cloud state expire automatically 30 days after creation; export or delete sooner.</div>
      </section>
    </main>
  );
}

const appNav = [
  ["chat", "Conversation", MessageCircle],
  ["memory", "Memory", Database],
  ["followups", "Follow-ups", BellRing],
  ["goals", "Goals & reflection", Goal],
  ["settings", "Settings", Settings],
];

function ProductShell({ initialProfile, onSignOut }) {
  const mobileMenuRef = useRef(null);
  const sidebarRef = useRef(null);
  const restoredState = useMemo(() => {
    try { return JSON.parse(window.localStorage.getItem("saathkind-demo-state")) || {}; } catch { return {}; }
  }, []);
  const [view, setView] = useState("chat");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profile, setProfile] = useState(initialProfile);
  const [messages, setMessages] = useState(() => restoredState.messages || starterMessages.map((message) => message.id === 1 ? { ...message, content: `Good evening, ${initialProfile.name || "friend"}. How are you arriving today?` } : message));
  const [conversationId, setConversationId] = useState(() => restoredState.conversationId || null);
  const [chatSessionKey, setChatSessionKey] = useState(0);
  const [chatSending, setChatSending] = useState(false);
  const [memories, setMemories] = useState(() => initialProfile.consents?.memory ? (restoredState.memories || starterMemories.map((memory) => ({ ...memory, text: memory.text.replaceAll("Mira", initialProfile.name || "You") }))) : []);
  const [followups, setFollowups] = useState(() => initialProfile.consents?.notifications ? (restoredState.followups || starterFollowups) : []);
  const [goals, setGoals] = useState(() => restoredState.goals || starterGoals);
  const [dismissedReceipts, setDismissedReceipts] = useState(() => restoredState.dismissedReceipts || []);
  const [memoryEnabled, setMemoryEnabled] = useState(() => Boolean(initialProfile.consents?.memory && (restoredState.memoryEnabled ?? true)));
  const [quietHours, setQuietHours] = useState(() => restoredState.quietHours || { start: initialProfile.quietStart || "22:00", end: initialProfile.quietEnd || "08:00" });
  const [usage, setUsage] = useState(() => restoredState.usage || { counters: { messages: 0 }, limits: { messages: 300 } });
  const [apiMode, setApiMode] = useState(() => initialProfile.sessionMode === "live" ? "live" : initialProfile.sessionMode === "api-demo" ? "api-demo" : "local-demo");
  const [toast, setToast] = useState(initialProfile.connectionNotice || "");
  const [isCompactNav, setIsCompactNav] = useState(() => window.matchMedia("(max-width: 820px)").matches);
  const [cloudExpected, setCloudExpected] = useState(() => initialProfile.sessionMode !== "local-demo");
  const [hydrationStatus, setHydrationStatus] = useState(() => initialProfile.sessionMode !== "local-demo" ? "loading" : "ready");
  const [hydrationError, setHydrationError] = useState(null);
  const [hydrationAttempt, setHydrationAttempt] = useState(0);
  const [consentSaving, setConsentSaving] = useState(false);
  const consentSavingRef = useRef(false);

  useEffect(() => {
    setProfile((current) => {
      const unconfirmedCloudSession = Boolean(initialProfile.unconfirmedCloudSession);
      const connectionNotice = initialProfile.connectionNotice || current.connectionNotice;
      if (current.unconfirmedCloudSession === unconfirmedCloudSession && current.connectionNotice === connectionNotice) return current;
      return { ...current, unconfirmedCloudSession, connectionNotice };
    });
  }, [initialProfile.unconfirmedCloudSession, initialProfile.connectionNotice]);

  useEffect(() => {
    if (!cloudExpected) {
      setHydrationStatus("ready");
      setHydrationError(null);
      return undefined;
    }
    let active = true;
    setHydrationStatus("loading");
    setHydrationError(null);
    loadCloudState().then((cloud) => {
      if (!active) return;
      setConversationId(cloud.conversationId);
      setMessages(mergeCloudMessages(cloud.messages, restoredState.messages || []));
      setMemories(cloud.memories);
      setFollowups(cloud.followups);
      setGoals(cloud.goals);
      setUsage(cloud.usage);
      setMemoryEnabled(Boolean(cloud.consents?.memory && !cloud.profile?.memoryPaused));
      setProfile((current) => ({
        ...current,
        name: cloud.profile?.displayName || current.name,
        language: { en: "English", hi: "Hindi", hinglish: "Hinglish" }[cloud.profile?.language] || current.language,
        pronouns: cloud.profile?.pronouns || current.pronouns,
        timezone: cloud.profile?.timezone || current.timezone,
        consents: cloud.consents,
      }));
      if (cloud.quietHours) setQuietHours({ start: cloud.quietHours.start, end: cloud.quietHours.end });
      setHydrationStatus("ready");
    }).catch((error) => {
      if (!active) return;
      const expired = error?.status === 401 || ["authentication_required", "invalid_session"].includes(error?.code);
      if (expired) clearApiSession();
      setHydrationError({ expired, message: error?.message || "Cloud state could not be loaded." });
      setHydrationStatus("failed");
    });
    return () => { active = false; };
  }, [cloudExpected, hydrationAttempt]);

  useEffect(() => {
    if (hydrationStatus !== "ready") return;
    const persisted = { memories, followups, goals, quietHours, memoryEnabled, dismissedReceipts, usage };
    if (profile.consents?.chat) Object.assign(persisted, { messages, conversationId });
    window.localStorage.setItem("saathkind-demo-state", JSON.stringify(persisted));
  }, [hydrationStatus, messages, conversationId, memories, followups, goals, quietHours, memoryEnabled, dismissedReceipts, usage, profile.consents?.chat]);

  useEffect(() => {
    if (hydrationStatus !== "ready") return;
    window.localStorage.setItem("saathkind-demo-profile", JSON.stringify(profile));
  }, [hydrationStatus, profile]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 820px)");
    const update = () => setIsCompactNav(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!isCompactNav || !sidebarOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const firstControl = sidebarRef.current?.querySelector(".app-sidebar__close") || sidebarRef.current?.querySelector("button, a");
    firstControl?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setSidebarOpen(false);
        return;
      }
      if (event.key !== "Tab" || !sidebarRef.current) return;
      const focusable = [...sidebarRef.current.querySelectorAll("a, button")];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      mobileMenuRef.current?.focus();
    };
  }, [isCompactNav, sidebarOpen]);

  const changeView = (nextView) => { setView(nextView); setSidebarOpen(false); };
  const changeConsent = async ({ apiName, profileName, checked, subject, enabledMessage, disabledMessage }) => {
    if (consentSavingRef.current) return false;
    consentSavingRef.current = true;
    setConsentSaving(true);
    const previous = Boolean(profile.consents?.[profileName]);
    const applyConsent = (value) => {
      setProfile((current) => ({ ...current, consents: { ...current.consents, [profileName]: value } }));
      if (profileName === "memory") setMemoryEnabled(value);
    };
    // Withdrawal closes the dependent surface immediately. If the server
    // definitively rejects it, the prior authoritative value is restored.
    if (!checked) applyConsent(false);
    try {
      const result = await saveDemoResource("/consents", { [apiName]: checked }, "PATCH", { localOnly: !cloudExpected });
      if (cloudWriteFailed(result, cloudExpected)) {
        if (!checked) applyConsent(previous);
        setToast(cloudFailureNotice(result, subject));
        return false;
      }
      const confirmed = result.mode === "live" && result.data?.[apiName]
        ? Boolean(result.data[apiName].granted)
        : checked;
      applyConsent(confirmed);
      setToast(syncNotice(result, confirmed ? enabledMessage : disabledMessage));
      return true;
    } finally {
      consentSavingRef.current = false;
      setConsentSaving(false);
    }
  };
  const clearDeviceState = async ({ sessionAlreadyRevoked = false } = {}) => {
    const needsSessionRevocation = cloudExpected || hasApiSession() || profile.unconfirmedCloudSession;
    // Complete the local privacy action before waiting on the network. A
    // reload or tab close cannot restore content after RESET was confirmed.
    window.localStorage.removeItem("saathkind-demo-profile");
    window.localStorage.removeItem("saathkind-demo-state");
    if (needsSessionRevocation && !sessionAlreadyRevoked) {
      window.localStorage.setItem(REVOCATION_PENDING_KEY, String(Date.now()));
      // Unmount the content-bearing product immediately. ProductDemo owns the
      // durable cookie-only retry so a tab close cannot erase the obligation.
      onSignOut("Local demo data is cleared. Cloud-session revocation is being confirmed before another cloud setup can start.");
      return true;
    }
    window.localStorage.removeItem(REVOCATION_PENDING_KEY);
    clearApiSession();
    onSignOut();
    return true;
  };
  const deleteAccount = async () => {
    const shouldAttemptCloudDelete = cloudExpected || hasApiSession() || profile.unconfirmedCloudSession;
    const result = await saveDemoResource("/data/delete", { confirmation: "DELETE" }, "POST", { localOnly: !shouldAttemptCloudDelete });
    if (cloudWriteFailed(result, shouldAttemptCloudDelete)) {
      setToast("Cloud deletion could not be confirmed; it may already have completed. Retry once, then clear this device if the session is gone.");
      return;
    }
    await clearDeviceState({ sessionAlreadyRevoked: shouldAttemptCloudDelete && result.mode === "live" });
  };

  if (hydrationStatus !== "ready") {
    return (
      <HydrationGate
        status={hydrationStatus}
        error={hydrationError}
        onRetry={() => { setHydrationStatus("loading"); setHydrationAttempt((value) => value + 1); }}
        onContinueDevice={() => {
          clearApiSession();
          setCloudExpected(false);
          setApiMode("local-demo");
          setProfile((current) => ({
            ...current,
            sessionMode: "local-demo",
            unconfirmedCloudSession: true,
            connectionNotice: "Device-only mode. Cloud data was not changed, and session revocation is unconfirmed; Settings will try to revoke it before clearing this device.",
          }));
        }}
      />
    );
  }

  return (
    <main className="product-shell">
      <button ref={mobileMenuRef} type="button" className="app-mobile-menu icon-button" aria-label="Open app menu" aria-expanded={sidebarOpen} aria-controls="app-navigation" inert={isCompactNav && sidebarOpen} aria-hidden={isCompactNav && sidebarOpen ? "true" : undefined} onClick={() => setSidebarOpen(true)}><Menu aria-hidden="true" /></button>
      {sidebarOpen && <button type="button" className="sidebar-scrim" tabIndex="-1" aria-hidden="true" onClick={() => setSidebarOpen(false)} />}
      <aside ref={sidebarRef} id="app-navigation" className={`app-sidebar ${sidebarOpen ? "is-open" : ""}`} inert={isCompactNav && !sidebarOpen} aria-hidden={isCompactNav && !sidebarOpen ? "true" : undefined}>
        <div className="app-sidebar__top"><Logo /><button type="button" className="icon-button app-sidebar__close" aria-label="Close app menu" onClick={() => setSidebarOpen(false)}><PanelLeftClose aria-hidden="true" /></button></div>
        <button type="button" className="new-chat-button" disabled={chatSending} title={chatSending ? "Wait for the current turn to finish" : undefined} onClick={() => { if (chatSending) return; const hasDeviceOnlyTurns = messages.some((message) => ["pending", "unconfirmed", "rejected", "local-safety"].includes(message.syncStatus)); if (((!cloudExpected && messages.length > 1) || hasDeviceOnlyTurns) && !window.confirm("Start a new conversation? Device-only or unresolved turns in this view will be replaced. Export from Settings first if you want a copy.")) return; setChatSessionKey((value) => value + 1); setConversationId(null); setMessages([{ id: Date.now(), role: "assistant", content: "New thread, same boundaries. What would you like to talk about?", time: "Now" }]); changeView("chat"); }}><Plus aria-hidden="true" /> {chatSending ? "Finishing current turn…" : "New conversation"}</button>
        <nav aria-label="App navigation">{appNav.map(([id, label, Icon]) => <button type="button" key={id} className={view === id ? "is-active" : ""} aria-current={view === id ? "page" : undefined} onClick={() => changeView(id)}><Icon aria-hidden="true" /> {label}{id === "memory" && <span className="nav-count">{memories.length}</span>}</button>)}</nav>
        <div className="app-sidebar__foot">
          <div className="demo-status"><i aria-hidden="true" /><span><strong>{apiMode === "live" ? "Gemini connected" : apiMode === "api-demo" ? "Limited fallback" : apiMode === "error" ? "Service unavailable" : apiMode === "rejected" ? "Request rejected" : apiMode === "local-safety" ? "Crisis guidance" : "Local demo"}</strong><small>{apiMode === "live" ? "Live AI responses active" : apiMode === "api-demo" ? "Cloud API · deterministic · not safety-evaluated" : apiMode === "error" ? "Cloud result unconfirmed · device copy" : apiMode === "rejected" ? "Turn kept only on this device" : "No cloud sync active"}</small></span></div>
          <div className="profile-chip"><div aria-hidden="true">{profile.name?.charAt(0).toUpperCase() || "M"}</div><span><strong>{profile.name || "Mira"}</strong><small>Synthetic beta</small></span><button type="button" aria-label="Open account settings" onClick={() => changeView("settings")}><Settings aria-hidden="true" /></button></div>
          <Link to="/" className="back-home"><Home aria-hidden="true" /> Saathkind website</Link>
        </div>
      </aside>
      <section className="app-workspace" inert={isCompactNav && sidebarOpen} aria-hidden={isCompactNav && sidebarOpen ? "true" : undefined}>
        <div hidden={view !== "chat"}>
          <ChatView key={chatSessionKey} messages={messages} setMessages={setMessages} memories={memories} setMemories={setMemories} apiMode={apiMode} setApiMode={setApiMode} conversationId={conversationId} setConversationId={setConversationId} setUsage={setUsage} setToast={setToast} memoryEnabled={memoryEnabled} aiProcessingEnabled={Boolean(profile.consents?.ai)} chatStorageEnabled={Boolean(profile.consents?.chat)} cloudExpected={cloudExpected} profileName={profile.name} receiptDismissed={dismissedReceipts.includes("interview-tomorrow")} onDismissReceipt={() => setDismissedReceipts((items) => items.includes("interview-tomorrow") ? items : [...items, "interview-tomorrow"])} onSendingChange={setChatSending} />
        </div>
        {view === "memory" && <MemoryView memories={memories} setMemories={setMemories} enabled={memoryEnabled} setToast={setToast} cloudExpected={cloudExpected} consentSaving={consentSaving} changeConsent={changeConsent} />}
        {view === "followups" && <FollowUpsView followups={followups} setFollowups={setFollowups} quietHours={quietHours} setQuietHours={setQuietHours} setToast={setToast} cloudExpected={cloudExpected} planningEnabled={Boolean(profile.consents?.notifications)} timezone={profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata"} />}
        {view === "goals" && <GoalsView goals={goals} setGoals={setGoals} setToast={setToast} cloudExpected={cloudExpected} reflectionEnabled={Boolean(profile.consents?.mood)} />}
        {view === "settings" && <SettingsView profile={profile} setProfile={setProfile} memoryEnabled={memoryEnabled} quietHours={quietHours} data={{ messages, memories, followups, goals }} usage={usage} onDelete={deleteAccount} onClearDevice={clearDeviceState} setToast={setToast} cloudExpected={cloudExpected} cloudControlAvailable={cloudExpected || hasApiSession() || profile.unconfirmedCloudSession} consentSaving={consentSaving} changeConsent={changeConsent} />}
      </section>
      <Toast message={toast} onClose={() => setToast("")} />
    </main>
  );
}

export function ProductDemo() {
  const stored = useMemo(() => {
    try { return JSON.parse(window.localStorage.getItem("saathkind-demo-profile")); } catch { return null; }
  }, []);
  const [profile, setProfile] = useState(stored);
  const [entryNotice, setEntryNotice] = useState("");
  useEffect(() => {
    if (!window.localStorage.getItem(REVOCATION_PENDING_KEY)) return undefined;
    let active = true;
    logoutSession().then(() => {
      window.localStorage.removeItem(REVOCATION_PENDING_KEY);
      clearApiSession();
      if (active) {
        if (profile) {
          setProfile((current) => ({ ...current, unconfirmedCloudSession: false, connectionNotice: "The previous cloud demo session was revoked; this demo remains device-only." }));
        } else {
          setEntryNotice("This browser's previous cloud demo session was revoked. You can start a new synthetic demo.");
        }
      }
    }).catch(() => {
      if (active) setEntryNotice("Local demo data is cleared. Cloud-session revocation is still unconfirmed and will be retried when this page opens while the service is reachable.");
    });
    return () => { active = false; };
  }, [profile]);
  return profile
    ? <ProductShell initialProfile={profile} onSignOut={(notice = "") => { setEntryNotice(notice); setProfile(null); }} />
    : <Onboarding initialNotice={entryNotice} onComplete={(nextProfile) => { setEntryNotice(""); setProfile(nextProfile); }} />;
}
