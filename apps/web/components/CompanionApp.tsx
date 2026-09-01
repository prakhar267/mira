"use client";

import { useEffect, useMemo, useState } from "react";
import { applyContradictions, assessSafety, buildCompanionContext, extractMemoryCandidates, planCompanionTurn, type CompanionTurn } from "@companion/ai";
import type { ActivityDefinition, ChatMessage, CompanionMood, MemoryRecord, MemoryType, StoreItemRecord } from "@companion/shared";
import type { PlanId } from "@companion/config";
import { AppShell } from "./AppShell";
import { ActivitiesView } from "./ActivitiesView";
import { CameraConversationModal } from "./CameraConversationModal";
import { ChatView } from "./ChatView";
import { CompanionView } from "./CompanionView";
import { FirstMeeting } from "./FirstMeeting";
import { HomeView } from "./HomeView";
import { MemoryView } from "./MemoryView";
import { MomentsView, type MomentsTab } from "./MomentsView";
import { Onboarding, type OnboardingDraft } from "./Onboarding";
import { PlanModal } from "./PlanModal";
import { ProfileView } from "./ProfileView";
import { VideoCallModal } from "./VideoCallModal";
import { VoiceCallModal } from "./VoiceCallModal";
import { initialState, storageKey, type AppView, type DemoState, type EnvironmentId, type FeedbackReason } from "@/lib/state";
import { canAccessItem, currencyBalance } from "@/lib/product-rules";

const pause = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
const chooseTypingDelay = (content: string) => Math.min(680, 320 + content.trim().length * 3);

export function CompanionApp({ forceDemo = false }: { forceDemo?: boolean }) {
  const [state, setState] = useState<DemoState>(initialState);
  const [hydrated, setHydrated] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [voiceCallOpen, setVoiceCallOpen] = useState(false);
  const [videoCallOpen, setVideoCallOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [plansOpen, setPlansOpen] = useState(false);
  const [momentsTab, setMomentsTab] = useState<MomentsTab>("moments");

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const preview = query.get("preview");
    const onboarding = query.get("onboarding");
    if (forceDemo || preview === "home") {
      setState({ ...initialState, onboardingComplete: true, firstMeetingComplete: true, currentView: "home" });
      setHydrated(true);
      return;
    }
    if (onboarding === "1") {
      setState({ ...initialState, firstMeetingComplete: false });
      setHydrated(true);
      return;
    }
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<DemoState>;
        setState({
          ...initialState,
          ...parsed,
          relationship: { ...initialState.relationship, ...parsed.relationship },
          responsePreferences: { ...initialState.responsePreferences, ...parsed.responsePreferences },
        });
      }
    } catch {
      // A clean local demo remains available when saved state is malformed.
    }
    setHydrated(true);
  }, [forceDemo]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // The current session stays usable without persistent browser storage.
    }
    document.documentElement.dataset.theme = state.theme;
  }, [hydrated, state]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(".app-main")?.scrollTo({ top: 0, behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [state.currentView]);

  const activeMemories = useMemo(() => state.memories.filter((memory) => memory.status === "active"), [state.memories]);
  const navigate = (view: AppView) => setState((current) => ({ ...current, currentView: view }));

  const openMoments = (tab: MomentsTab) => {
    setMomentsTab(tab);
    navigate("moments");
  };

  const completeOnboarding = (draft: OnboardingDraft) => {
    setState((current) => ({
      ...current,
      onboardingComplete: true,
      firstMeetingComplete: false,
      currentView: "home",
      user: { ...current.user, name: draft.name.trim(), birthday: draft.birthday, pronouns: draft.pronouns, interests: draft.interests, adultConfirmed: draft.adultConfirmed },
      companion: {
        ...current.companion,
        name: draft.companionName.trim() || "Luma",
        pronouns: draft.companionPronouns,
        presentation: draft.presentation,
        voiceId: draft.voiceId,
        relationshipMode: draft.relationshipMode,
        personality: {
          ...current.companion.personality,
          warmth: draft.warmth / 100,
          playfulness: draft.playfulness / 100,
          energy: draft.energy / 100,
          humor: draft.humor / 100,
          verbosity: draft.expressiveness / 100,
        },
      },
      relationship: {
        ...current.relationship,
        stage: "New",
        level: 1,
        progress: 8,
        affection: draft.affection,
        flirtiness: draft.flirtiness,
        playfulness: draft.playfulness,
        humor: draft.humor,
        romance: draft.relationshipMode === "romantic" ? draft.romance : 10,
        sensuality: draft.sensuality,
        romanticOptIn: draft.relationshipMode === "romantic",
        sensualOptIn: draft.relationshipMode === "romantic" && draft.sensuality > 0,
      },
      messages: [{
        id: crypto.randomUUID(),
        conversationId: current.activeConversationId,
        role: "assistant",
        content: `Hi ${draft.name.trim()}. I’m ${draft.companionName.trim() || "Luma"}. What makes an ordinary day feel good to you?`,
        createdAt: new Date().toISOString(),
        status: "sent",
      }],
    }));
  };

  const createCompanionTurn = (content: string, messages: ChatMessage[], now: Date, delivery: "text" | "voice" | "video" = "text"): CompanionTurn => {
    const context = buildCompanionContext({
      user: state.user,
      companion: state.companion,
      relationship: { mode: state.companion.relationshipMode, startedAt: state.companion.createdAt, interactionCount: state.messages.length, sharedExperiences: state.moments.map((moment) => moment.title) },
      memories: state.memoryEnabled ? activeMemories : [],
      messages,
      timezone: state.user.timezone,
      now,
      delivery,
      companionBackstory: state.companionBackstory,
      responsePreferences: state.responsePreferences,
    });
    return planCompanionTurn(content, context);
  };

  const sendMessage = async (content: string) => {
    if (streaming) return;
    setStreaming(true);
    const now = new Date();
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      conversationId: state.activeConversationId,
      role: "user",
      content,
      createdAt: now.toISOString(),
      status: "sent",
    };
    setState((current) => ({
      ...current,
      messages: [...current.messages, userMessage],
    }));

    const safety = assessSafety(content);
    const turn = createCompanionTurn(content, [...state.messages, userMessage], now);
    const beats = turn.text.split(/\n\n+/).map((beat) => beat.trim()).filter(Boolean);
    await pause(chooseTypingDelay(content));

    for (let beatIndex = 0; beatIndex < beats.length; beatIndex += 1) {
      const assistantId = crypto.randomUUID();
      const beat = beats[beatIndex]!;
      setState((current) => ({ ...current, messages: [...current.messages, {
        id: assistantId,
        conversationId: current.activeConversationId,
        role: "assistant",
        content: "",
        createdAt: new Date(now.getTime() + beatIndex + 1).toISOString(),
        status: "sending",
        explanation: turn.explanation,
      }] }));
      for (const token of beat.split(/(\s+)/).filter(Boolean)) {
        await pause(14);
        setState((current) => ({
          ...current,
          messages: current.messages.map((message) => message.id === assistantId ? { ...message, content: `${message.content}${token}` } : message),
        }));
      }
      setState((current) => ({ ...current, messages: current.messages.map((message) => message.id === assistantId ? { ...message, status: "sent" } : message) }));
      if (beatIndex < beats.length - 1) await pause(320);
    }

    setState((current) => {
      let memories = current.memories;
      if (current.memoryEnabled && safety.level === "safe") {
        for (const candidate of extractMemoryCandidates(content)) {
          memories = applyContradictions(memories, candidate, now);
          if (!memories.some((memory) => memory.status === "active" && memory.normalizedContent === candidate.normalizedContent)) {
            memories = [...memories, {
              id: crypto.randomUUID(),
              userId: current.user.id,
              companionId: current.companion.id,
              type: candidate.type,
              content: candidate.content.replace(/^User/, current.user.name),
              normalizedContent: candidate.normalizedContent,
              importance: candidate.importance,
              confidence: candidate.confidence,
              sourceMessageIds: [userMessage.id],
              createdAt: now.toISOString(),
              updatedAt: now.toISOString(),
              retrievalCount: 0,
              status: "active",
              pinned: false,
            }];
          }
        }
      }
      return {
        ...current,
        memories,
        relationship: { ...current.relationship, progress: Math.min(100, current.relationship.progress + 1) },
        messages: current.messages,
      };
    });
    setStreaming(false);
  };

  const newConversation = () => {
    const conversationId = crypto.randomUUID();
    const memory = [...activeMemories].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
    setState((current) => ({
      ...current,
      activeConversationId: conversationId,
      messages: [...current.messages, {
        id: crypto.randomUUID(),
        conversationId,
        role: "assistant",
        content: memory ? `New chat, same us. I remembered that ${memory.content.charAt(0).toLowerCase()}${memory.content.slice(1)} Where should we start?` : "New chat. Come tell me what’s on your mind.",
        createdAt: new Date().toISOString(),
        status: "sent",
      }],
    }));
  };

  const addMockExchange = (userMessage: ChatMessage, assistantMessage: ChatMessage) => setState((current) => ({ ...current, messages: [...current.messages, userMessage, assistantMessage] }));

  const sendVoiceNote = async (transcript: string) => {
    if (state.subscription.planId === "free") { setPlansOpen(true); return; }
    const now = new Date();
    const userMessage: ChatMessage = { id: crypto.randomUUID(), conversationId: state.activeConversationId, role: "user", content: transcript, createdAt: now.toISOString(), status: "sent", attachments: [{ id: crypto.randomUUID(), type: "audio", url: "browser://voice-transcript", name: "Voice note", transcript, durationMs: Math.max(1_000, transcript.split(/\s+/).length * 420) }] };
    const turn = createCompanionTurn(transcript, [...state.messages, userMessage], now, "voice");
    const reply = turn.text;
    await pause(250);
    const assistantMessage: ChatMessage = { id: crypto.randomUUID(), conversationId: state.activeConversationId, role: "assistant", content: reply, createdAt: new Date().toISOString(), status: "sent", explanation: turn.explanation, attachments: [{ id: crypto.randomUUID(), type: "audio", url: "browser://speech-synthesis", name: `${state.companion.name} voice reply`, transcript: reply, durationMs: Math.max(1_500, reply.split(/\s+/).length * 360) }] };
    addMockExchange(userMessage, assistantMessage);
  };

  const uploadImage = async (file: File) => {
    if (!file.type.match(/^image\/(jpeg|png|webp)$/) || file.size > 8_000_000) return;
    const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
    const now = new Date().toISOString();
    const attachmentId = crypto.randomUUID();
    const userMessage: ChatMessage = { id: crypto.randomUUID(), conversationId: state.activeConversationId, role: "user", content: "Look at this.", createdAt: now, status: "sent", attachments: [{ id: attachmentId, type: "image", url: dataUrl, name: file.name }] };
    const assistantMessage: ChatMessage = { id: crypto.randomUUID(), conversationId: state.activeConversationId, role: "assistant", content: "Okay, I’m looking. I won’t guess who anyone is or infer sensitive details—what do you want me to notice?", createdAt: new Date(Date.now() + 1).toISOString(), status: "sent" };
    setState((current) => ({ ...current, mediaLibrary: [...current.mediaLibrary, { id: attachmentId, type: "image", name: file.name, url: dataUrl, createdAt: now }], photos: [{ id: attachmentId, imageUrl: dataUrl, caption: file.name, createdAt: now, kind: "shared" }, ...current.photos], messages: [...current.messages, userMessage, assistantMessage] }));
  };

  const generateImage = (prompt: string) => {
    if (state.subscription.planId === "free") { setPlansOpen(true); return; }
    const now = new Date().toISOString();
    const attachmentId = crypto.randomUUID();
    const imageUrl = prompt.toLowerCase().includes("rooftop") ? "/assets/luma/rooftop-date.png" : "/assets/luma/cafe-selfie.png";
    const assistantMessage: ChatMessage = { id: crypto.randomUUID(), conversationId: state.activeConversationId, role: "assistant", content: `I took this for you—“${prompt}.”`, createdAt: now, status: "sent", attachments: [{ id: attachmentId, type: "generated-image", url: imageUrl, name: prompt }] };
    setState((current) => ({ ...current, mediaLibrary: [{ id: attachmentId, type: "generated-image", name: prompt, url: imageUrl, createdAt: now }, ...current.mediaLibrary], photos: [{ id: attachmentId, imageUrl, caption: prompt, createdAt: now, kind: "selfie" }, ...current.photos], messages: [...current.messages, assistantMessage] }));
  };

  const addSelfie = () => {
    if (state.subscription.planId === "free") { setPlansOpen(true); return; }
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    setState((current) => ({
      ...current,
      photos: [{ id, imageUrl: "/assets/luma/cafe-selfie.png", caption: "Rainy coffee break—just for you", createdAt: now, kind: "selfie" }, ...current.photos],
      mediaLibrary: [{ id, type: "generated-image", name: "Luma coffee selfie", url: "/assets/luma/cafe-selfie.png", createdAt: now }, ...current.mediaLibrary],
    }));
    setMomentsTab("photos");
  };

  const recordFeedback = (messageId: string, feedback: "up" | "down", reason?: FeedbackReason) => setState((current) => ({
    ...current,
    messages: current.messages.map((message) => message.id === messageId ? { ...message, feedback } : message),
    feedbackSignals: [...current.feedbackSignals, { id: crypto.randomUUID(), messageId, rating: feedback, ...(reason ? { reason } : {}), createdAt: new Date().toISOString() }],
    responsePreferences: feedback === "down" ? {
      ...current.responsePreferences,
      listeningFirst: reason === "wrong-tone" ? current.responsePreferences.listeningFirst : true,
      responseLength: reason === "too-scripted" || reason === "too-many-questions" ? "short" : current.responsePreferences.responseLength,
      adviceStyle: reason === "wrong-tone" ? "gentle" : "ask-first",
      questionFrequency: reason === "too-many-questions" ? "rare" : current.responsePreferences.questionFrequency,
    } : current.responsePreferences,
  }));

  const regenerateResponse = async (messageId: string) => {
    const messageIndex = state.messages.findIndex((message) => message.id === messageId);
    if (messageIndex < 0) return;
    let userIndex = messageIndex - 1;
    while (userIndex >= 0 && state.messages[userIndex]?.role !== "user") userIndex -= 1;
    const source = state.messages[userIndex];
    if (!source) return;
    const now = new Date();
    const turn = createCompanionTurn(source.content, state.messages.slice(0, userIndex + 1), now);
    setState((current) => ({
      ...current,
      messages: current.messages.map((message) => {
        if (message.id !== messageId) return message;
        const next = { ...message, content: turn.text.replace(/\n\n+/g, " "), explanation: turn.explanation, status: "sent" as const };
        delete next.feedback;
        return next;
      }),
    }));
  };

  const purchaseItem = (item: StoreItemRecord): string | null => {
    if (!canAccessItem(state.subscription.planId, item)) { setPlansOpen(true); return `${item.tierRequired[0]?.toUpperCase()}${item.tierRequired.slice(1)} is required for this item.`; }
    if (currencyBalance(item, state.wallet) < item.price) return `Not enough ${item.currency}. Try an activity together to earn more.`;
    const now = new Date().toISOString();
    setState((current) => {
      if (current.ownedItems.some((owned) => owned.itemId === item.id)) return current;
      const wallet = item.currency === "free" ? current.wallet : { ...current.wallet, [item.currency]: current.wallet[item.currency] - item.price };
      const transactions = item.currency === "free" ? current.walletTransactions : [...current.walletTransactions, { id: crypto.randomUUID(), userId: current.user.id, type: "purchase" as const, currency: item.currency, amount: -item.price, balanceAfter: wallet[item.currency], referenceId: item.id, idempotencyKey: `web:${item.id}:${now}`, createdAt: now }];
      return { ...current, wallet, walletTransactions: transactions, ownedItems: [...current.ownedItems, { itemId: item.id, purchasedAt: now, equipped: false }] };
    });
    return null;
  };

  const equipItem = (item: StoreItemRecord) => setState((current) => {
    const environment = item.metadata.environment as EnvironmentId | undefined;
    return {
      ...current,
      ...(environment ? { activeEnvironment: environment } : {}),
      ownedItems: current.ownedItems.map((owned) => {
        const ownedItem = current.storeItems.find((candidate) => candidate.id === owned.itemId);
        return ownedItem?.metadata.slot === item.metadata.slot ? { ...owned, equipped: owned.itemId === item.id } : owned;
      }),
    };
  });

  const choosePlan = (planId: PlanId) => {
    setState((current) => ({ ...current, subscription: { planId, status: "active", testMode: true, renewsAt: new Date(Date.now() + 30 * 86_400_000).toISOString() } }));
    setPlansOpen(false);
  };

  const addJournal = (entry: { title: string; content: string; mood: CompanionMood }) => setState((current) => { const now = new Date().toISOString(); return { ...current, journalEntries: [{ id: crypto.randomUUID(), userId: current.user.id, ...entry, tags: [], reflected: false, createdAt: now, updatedAt: now }, ...current.journalEntries] }; });
  const deleteJournal = (entryId: string) => setState((current) => ({ ...current, journalEntries: current.journalEntries.filter((entry) => entry.id !== entryId) }));
  const reflectOnJournal = (entry: DemoState["journalEntries"][number]) => setState((current) => ({ ...current, currentView: "chat", journalEntries: current.journalEntries.map((candidate) => candidate.id === entry.id ? { ...candidate, reflected: true, updatedAt: new Date().toISOString() } : candidate), messages: [...current.messages, { id: crypto.randomUUID(), conversationId: current.activeConversationId, role: "assistant", content: `I notice ${entry.mood} energy in “${entry.title}.” What part would you like me to sit with?`, createdAt: new Date().toISOString(), status: "sent" }] }));
  const addFutureEvent = (event: { description: string; eventDate: string }) => setState((current) => { const eventId = crypto.randomUUID(); const scheduled = new Date(new Date(event.eventDate).getTime() - 3_600_000); if (scheduled.getHours() >= 22 || scheduled.getHours() < 8) scheduled.setHours(8, 0, 0, 0); return { ...current, futureEvents: [{ id: eventId, userId: current.user.id, companionId: current.companion.id, ...event, status: "confirmed", createdAt: new Date().toISOString() }, ...current.futureEvents], nudges: current.notifications.frequency === "off" ? current.nudges : [{ id: crypto.randomUUID(), userId: current.user.id, eventId, content: `You mentioned ${event.description}. Want a calm check-in before it?`, scheduledFor: scheduled.toISOString(), status: "planned" }, ...current.nudges] }; });
  const updateMemory = (updated: MemoryRecord) => setState((current) => ({ ...current, memories: current.memories.map((memory) => memory.id === updated.id ? updated : memory) }));
  const deleteMemory = (memoryId: string) => setState((current) => ({ ...current, memories: current.memories.map((memory) => memory.id === memoryId ? { ...memory, status: "deleted", updatedAt: new Date().toISOString() } : memory) }));
  const addMemory = (content: string, type: MemoryType) => setState((current) => ({ ...current, memories: [...current.memories, { id: crypto.randomUUID(), userId: current.user.id, companionId: current.companion.id, type, content, normalizedContent: content.toLowerCase(), importance: 0.8, confidence: 1, sourceMessageIds: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), retrievalCount: 0, status: "active", pinned: false }] }));

  const completeActivity = (activity: ActivityDefinition) => setState((current) => {
    if (current.completedActivityIds.includes(activity.id)) return current;
    const xp = current.wallet.xp + activity.xp;
    const coins = current.wallet.coins + activity.coinReward;
    const completedAt = new Date().toISOString();
    return {
      ...current,
      currentView: "chat",
      completedActivityIds: [...current.completedActivityIds, activity.id],
      wallet: { ...current.wallet, xp, level: Math.max(current.wallet.level, Math.floor(xp / 100) + 1), coins },
      walletTransactions: [...current.walletTransactions,
        { id: crypto.randomUUID(), userId: current.user.id, type: "earn", currency: "xp", amount: activity.xp, balanceAfter: xp, referenceId: activity.id, idempotencyKey: `activity:${activity.id}:xp`, createdAt: completedAt },
        { id: crypto.randomUUID(), userId: current.user.id, type: "earn", currency: "coins", amount: activity.coinReward, balanceAfter: coins, referenceId: activity.id, idempotencyKey: `activity:${activity.id}:coins`, createdAt: completedAt },
      ],
      messages: [...current.messages, { id: crypto.randomUUID(), conversationId: current.activeConversationId, role: "assistant", content: `Let’s do “${activity.title}.” ${activity.description} I’ll go first.`, createdAt: completedAt, status: "sent" }],
    };
  });

  const startDate = (environment: EnvironmentId, title: string) => {
    setState((current) => ({
      ...current,
      activeEnvironment: environment,
      messages: [...current.messages, { id: crypto.randomUUID(), conversationId: current.activeConversationId, role: "assistant", content: `${title}. Give me one second to change the scene… okay, ready?`, createdAt: new Date().toISOString(), status: "sent" }],
    }));
    setVideoCallOpen(true);
  };

  const finishCall = (type: "voice" | "video", durationSeconds: number) => {
    const now = new Date().toISOString();
    setState((current) => ({
      ...current,
      calls: [{ id: crypto.randomUUID(), type, startedAt: now, durationSeconds, summary: type === "video" ? "A warm visual check-in with one shared activity." : "A quick voice check-in and a calm reset." }, ...current.calls],
      relationship: { ...current.relationship, progress: Math.min(100, current.relationship.progress + 3) },
    }));
    setVoiceCallOpen(false);
    setVideoCallOpen(false);
  };

  const openVoiceCall = () => {
    if (state.subscription.planId === "free") setPlansOpen(true);
    else setVoiceCallOpen(true);
  };
  const openVideoCall = () => {
    if (state.subscription.planId === "free" || state.subscription.planId === "plus") setPlansOpen(true);
    else setVideoCallOpen(true);
  };

  const replyDuringCall = (content: string, delivery: "voice" | "video") => {
    const now = new Date();
    const userTurn: ChatMessage = {
      id: crypto.randomUUID(),
      conversationId: state.activeConversationId,
      role: "user",
      content,
      createdAt: now.toISOString(),
      status: "sent",
    };
    return Promise.resolve(createCompanionTurn(content, [...state.messages, userTurn], now, delivery).text);
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), source: "luma-local-mock", ...state }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "luma-demo-export.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const deleteDemo = () => {
    window.localStorage.removeItem(storageKey);
    setState({ ...initialState, firstMeetingComplete: false });
  };

  if (!hydrated) return <div className="app-loader"><span /><p>Opening Luma’s room…</p></div>;
  if (!state.onboardingComplete) return <Onboarding onComplete={completeOnboarding} />;
  if (!state.firstMeetingComplete) return <FirstMeeting userName={state.user.name} companionName={state.companion.name} onComplete={() => setState((current) => ({ ...current, firstMeetingComplete: true }))} />;

  const renderView = () => {
    switch (state.currentView) {
      case "home": return <HomeView state={state} onChat={() => navigate("chat")} onCall={openVoiceCall} onVideoCall={openVideoCall} onMoments={() => openMoments("moments")} onCompanion={() => navigate("companion")} onSpendTime={() => openMoments("together")} onEnvironmentChange={(activeEnvironment) => setState((current) => ({ ...current, activeEnvironment }))} onAmbienceChange={() => setState((current) => ({ ...current, ambienceEnabled: !current.ambienceEnabled }))} />;
      case "chat": return <ChatView state={state} streaming={streaming} onSend={sendMessage} onNewConversation={newConversation} onBack={() => navigate("home")} onCall={openVoiceCall} onVideoCall={openVideoCall} onVoiceNote={sendVoiceNote} onImageUpload={uploadImage} onGenerateImage={generateImage} onFeedback={recordFeedback} onRegenerate={regenerateResponse} onUpgrade={() => setPlansOpen(true)} onCamera={() => { if (state.subscription.planId === "free" || state.subscription.planId === "plus") setPlansOpen(true); else setCameraOpen(true); }} />;
      case "moments": return <MomentsView key={momentsTab} defaultTab={momentsTab} state={state} onCompleteActivity={completeActivity} onStartDate={startDate} onGenerateSelfie={addSelfie} onVideoCall={openVideoCall} />;
      case "companion": return <CompanionView companion={state.companion} backstory={state.companionBackstory} storeItems={state.storeItems} ownedItems={state.ownedItems} wallet={state.wallet} subscription={state.subscription} onChange={(companion) => setState((current) => ({ ...current, companion }))} onBackstoryChange={(companionBackstory) => setState((current) => ({ ...current, companionBackstory }))} onPurchase={purchaseItem} onEquip={equipItem} onUpgrade={() => setPlansOpen(true)} />;
      case "memory": return <MemoryView memories={state.memories} enabled={state.memoryEnabled} onToggle={() => setState((current) => ({ ...current, memoryEnabled: !current.memoryEnabled }))} onUpdate={updateMemory} onDelete={deleteMemory} onAdd={addMemory} />;
      case "activities": return <ActivitiesView activities={state.activities} completedIds={state.completedActivityIds} wallet={state.wallet} journalEntries={state.journalEntries} futureEvents={state.futureEvents} nudges={state.nudges} onComplete={completeActivity} onAddJournal={addJournal} onDeleteJournal={deleteJournal} onReflect={reflectOnJournal} onAddEvent={addFutureEvent} />;
      case "profile": return <ProfileView state={state} onChange={setState} onExport={exportData} onDelete={deleteDemo} onUpgrade={() => setPlansOpen(true)} onOpenMemory={() => navigate("memory")} onOpenActivities={() => openMoments("together")} />;
    }
  };

  return (
    <>
      <AppShell active={state.currentView} onNavigate={navigate} onCall={openVoiceCall} companionName={state.companion.name} immersive={state.currentView === "home"}>{renderView()}</AppShell>
      {voiceCallOpen ? <VoiceCallModal companionName={state.companion.name} userName={state.user.name} voiceId={state.companion.voiceId} onUserTurn={(content) => replyDuringCall(content, "voice")} onClose={(seconds) => finishCall("voice", seconds)} /> : null}
      {videoCallOpen ? <VideoCallModal companionName={state.companion.name} userName={state.user.name} voiceId={state.companion.voiceId} initialEnvironment={state.activeEnvironment} onUserTurn={(content) => replyDuringCall(content, "video")} onClose={(seconds) => finishCall("video", seconds)} /> : null}
      {cameraOpen ? <CameraConversationModal companionName={state.companion.name} onClose={() => setCameraOpen(false)} /> : null}
      {plansOpen ? <PlanModal current={state.subscription.planId} onSelect={choosePlan} onClose={() => setPlansOpen(false)} /> : null}
    </>
  );
}
