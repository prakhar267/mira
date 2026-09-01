"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { applyContradictions, assessSafety, buildCompanionContext, extractMemoryCandidates, planCompanionTurn, type CompanionTurn } from "@companion/ai";
import type { ActivityDefinition, ChatMessage, CompanionMood, MemoryRecord, MemoryType, StoreItemRecord } from "@companion/shared";
import { featureEntitlements, type PlanId } from "@companion/config";
import { AppShell } from "./AppShell";
import { ActivitiesView } from "./ActivitiesView";
import { CameraConversationModal } from "./CameraConversationModal";
import { ChatView } from "./ChatView";
import { CompanionView } from "./CompanionView";
import { FirstMeeting } from "./FirstMeeting";
import { HomeView } from "./HomeView";
import { MemoryView } from "./MemoryView";
import { Modal } from "./Modal";
import { MomentsView, type MomentsTab } from "./MomentsView";
import { Onboarding, type OnboardingDraft } from "./Onboarding";
import { PlanModal } from "./PlanModal";
import { ProfileView } from "./ProfileView";
import { VideoCallModal } from "./VideoCallModal";
import { VoiceCallModal } from "./VoiceCallModal";
import { initialState, storageKey, type AppView, type DemoState, type EnvironmentId, type FeedbackReason } from "@/lib/state";
import { canAccessItem, currencyBalance, environmentForItem } from "@/lib/product-rules";
import { companionApi } from "@/lib/api-client";
import { messagesForConversation, previousUserMessage } from "@/lib/conversation-state";

const pause = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
const chooseTypingDelay = (content: string) => Math.min(680, 320 + content.trim().length * 3);
const optional = async <T,>(promise: Promise<T>, fallback: T): Promise<T> => promise.catch(() => fallback);
const livePreferencesKey = (userId: string) => `luma-live-preferences-v1:${userId}`;

export function CompanionApp({ forceDemo = false }: { forceDemo?: boolean }) {
  const router = useRouter();
  const liveMode = companionApi.enabled && !forceDemo;
  const [state, setState] = useState<DemoState>(initialState);
  const [hydrated, setHydrated] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [voiceCallOpen, setVoiceCallOpen] = useState(false);
  const [videoCallOpen, setVideoCallOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [plansOpen, setPlansOpen] = useState(false);
  const [processingNoticeOpen, setProcessingNoticeOpen] = useState(false);
  const [actionError, setActionError] = useState("");
  const [hydrationError, setHydrationError] = useState("");
  const [momentsTab, setMomentsTab] = useState<MomentsTab>("moments");
  const companionSyncTimer = useRef<number | null>(null);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const preview = query.get("preview");
    const onboarding = query.get("onboarding");
    if (preview === "home") {
      setState({ ...initialState, onboardingComplete: true, firstMeetingComplete: true, currentView: "home" });
      setHydrated(true);
      return;
    }
    if (onboarding === "1") {
      setState({ ...initialState, firstMeetingComplete: false });
      setHydrated(true);
      return;
    }
    if (forceDemo) {
      try {
        const saved = window.localStorage.getItem(storageKey);
        if (saved) {
          const parsed = JSON.parse(saved) as Partial<DemoState>;
          const restored = {
            ...initialState,
            ...parsed,
            onboardingComplete: true,
            firstMeetingComplete: true,
            relationship: { ...initialState.relationship, ...parsed.relationship },
            responsePreferences: { ...initialState.responsePreferences, ...parsed.responsePreferences },
          };
          if (!restored.messages.length) {
            const conversationId = crypto.randomUUID();
            restored.activeConversationId = conversationId;
            restored.messages = [{ id: crypto.randomUUID(), conversationId, role: "assistant", content: "Fresh start. What would feel good to talk about now?", createdAt: new Date().toISOString(), status: "sent" }];
          }
          setState(restored);
        } else {
          setState({ ...initialState, onboardingComplete: true, firstMeetingComplete: true });
        }
      } catch {
        setState({ ...initialState, onboardingComplete: true, firstMeetingComplete: true });
      }
      setHydrated(true);
      return;
    }
    if (liveMode && companionApi.hasSession()) {
      void (async () => {
        try {
          const [user, companions, conversations] = await Promise.all([companionApi.me(), companionApi.companions(), companionApi.conversations()]);
          const companion = companions[0];
          if (!companion) throw new Error("Companion not found");
          const conversation = conversations[0] ?? await companionApi.createConversation(companion.id);
          const [messages, memories, activities, wallet, walletTransactions, store, ownedItems, subscriptionResult, journalEntries, futureEvents, nudges, notifications, calls, moments, photos] = await Promise.all([
            companionApi.messages(conversation.id),
            optional(companionApi.memories(), []),
            optional(companionApi.activities(), []),
            optional(companionApi.wallet(), { xp: 0, level: 1, coins: 0, gems: 0 }),
            optional(companionApi.walletTransactions(), []),
            optional(companionApi.store(), []),
            optional(companionApi.inventory(), []),
            optional(companionApi.subscription(), { subscription: { planId: "free", status: "active", testMode: true } }),
            optional(companionApi.journal(), []),
            optional(companionApi.events(), []),
            optional(companionApi.nudges(), []),
            optional(companionApi.notifications(), { ...initialState.notifications, timezone: user.timezone }),
            optional(companionApi.calls(), []),
            optional(companionApi.moments(), []),
            optional(companionApi.photos(), []),
          ]);
          let savedPreferences: Partial<DemoState> = {};
          try { savedPreferences = JSON.parse(window.localStorage.getItem(livePreferencesKey(user.id)) ?? "{}") as Partial<DemoState>; } catch { /* Use safe defaults. */ }
          setState((current) => ({
            ...current,
            ...savedPreferences,
            onboardingComplete: true,
            firstMeetingComplete: true,
            user,
            companion,
            relationship: { ...current.relationship, ...savedPreferences.relationship },
            responsePreferences: { ...current.responsePreferences, ...savedPreferences.responsePreferences },
            activeConversationId: conversation.id,
            messages: messages.length ? messages : [{ id: crypto.randomUUID(), conversationId: conversation.id, role: "assistant", content: `I’m here, ${user.name}. What kind of company would feel good right now?`, createdAt: new Date().toISOString(), status: "sent" }],
            memories,
            activities: activities.length ? activities : current.activities,
            completedActivityIds: [...new Set(walletTransactions.filter((transaction) => transaction.type === "earn" && transaction.currency === "coins").map((transaction) => transaction.referenceId).filter((id) => activities.some((activity) => activity.id === id)))],
            wallet,
            walletTransactions,
            storeItems: store.map((item) => ({ id: item.id, name: item.name, description: item.description, category: item.category, assetUrl: item.assetUrl, currency: item.currency, price: item.price, tierRequired: item.tierRequired, metadata: item.metadata, active: item.active })),
            ownedItems,
            subscription: subscriptionResult.subscription,
            journalEntries,
            futureEvents,
            nudges,
            notifications,
            calls: calls.map((call) => ({ id: call.id, type: call.type, startedAt: call.startedAt, durationSeconds: Math.round((call.durationMs ?? 0) / 1_000), summary: call.summary ?? "A private companion call." })),
            moments: moments.map((moment) => ({ id: moment.id, title: moment.title, description: moment.description, date: moment.happenedAt, imageUrl: moment.mediaUrl, kind: moment.type })),
            photos: photos.map((photo) => ({ id: photo.id, imageUrl: photo.mediaUrl, caption: photo.caption, createdAt: photo.createdAt, kind: photo.type })),
            companionReflections: [],
            mediaLibrary: [],
            currentView: "home",
          }));
        } catch (cause) {
          if (!companionApi.hasSession()) router.replace("/login");
          else setHydrationError(cause instanceof Error ? cause.message : "Your account could not be loaded just now.");
        } finally {
          setHydrated(true);
        }
      })();
      return;
    }
    if (liveMode) {
      router.replace("/login");
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
  }, [forceDemo, liveMode, router]);

  useEffect(() => {
    if (!hydrated) return;
    if (liveMode) {
      try {
        window.localStorage.setItem(livePreferencesKey(state.user.id), JSON.stringify({
          relationship: state.relationship,
          responsePreferences: state.responsePreferences,
          companionBackstory: state.companionBackstory,
          memoryEnabled: state.memoryEnabled,
          aiProcessingConsent: state.aiProcessingConsent,
          conversationStorageEnabled: state.conversationStorageEnabled,
          theme: state.theme,
          activeEnvironment: state.activeEnvironment,
          ambienceEnabled: state.ambienceEnabled,
          proactiveCalls: state.proactiveCalls,
        }));
      } catch { /* Keep the signed session usable without browser preference storage. */ }
      document.documentElement.dataset.theme = state.theme;
      return;
    }
    try {
      const persistedState = state.conversationStorageEnabled ? state : { ...state, messages: [] };
      window.localStorage.setItem(storageKey, JSON.stringify(persistedState));
    } catch {
      // The current session stays usable without persistent browser storage.
    }
    document.documentElement.dataset.theme = state.theme;
  }, [hydrated, liveMode, state]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(".app-main")?.scrollTo({ top: 0, behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [state.currentView]);

  useEffect(() => () => {
    if (companionSyncTimer.current !== null) window.clearTimeout(companionSyncTimer.current);
  }, []);

  const activeMemories = useMemo(() => state.memories.filter((memory) => memory.status === "active"), [state.memories]);
  const connectVoiceRealtime = useCallback(() => companionApi.connectRealtime("voice", state.companion.id), [state.companion.id]);
  const connectVideoRealtime = useCallback(() => companionApi.connectRealtime("video", state.companion.id), [state.companion.id]);
  const navigate = (view: AppView) => setState((current) => ({ ...current, currentView: view }));
  const processingAllowed = () => {
    if (state.aiProcessingConsent) return true;
    setProcessingNoticeOpen(true);
    return false;
  };
  const runAction = (action: Promise<unknown>, fallback: string) => {
    void action.catch((cause) => setActionError(cause instanceof Error ? cause.message : fallback));
  };

  const openMoments = (tab: MomentsTab) => {
    setMomentsTab(tab);
    navigate("moments");
  };

  const changeCompanion = (companion: DemoState["companion"]) => {
    setState((current) => ({ ...current, companion }));
    if (!liveMode) return;
    if (companionSyncTimer.current !== null) window.clearTimeout(companionSyncTimer.current);
    companionSyncTimer.current = window.setTimeout(() => {
      runAction(Promise.all([
        companionApi.updateCompanion(companion.id, { name: companion.name, relationshipMode: companion.relationshipMode, voiceId: companion.voiceId }),
        companionApi.updatePersonality(companion.id, companion.personality),
      ]), "The companion settings could not be saved.");
    }, 420);
  };

  const changeProfile = (next: DemoState) => {
    const notificationsChanged = JSON.stringify(next.notifications) !== JSON.stringify(state.notifications);
    const userChanged = next.user.name !== state.user.name || next.user.pronouns !== state.user.pronouns || next.user.timezone !== state.user.timezone;
    const relationshipMode: DemoState["companion"]["relationshipMode"] = next.relationship.romanticOptIn ? "romantic" : next.companion.relationshipMode === "romantic" ? "friend" : next.companion.relationshipMode;
    const normalized = relationshipMode === next.companion.relationshipMode ? next : { ...next, companion: { ...next.companion, relationshipMode } };
    const relationshipChanged = normalized.companion.relationshipMode !== state.companion.relationshipMode;
    setState(normalized);
    if (liveMode && notificationsChanged) runAction(companionApi.updateNotifications(normalized.notifications), "Notification settings could not be saved.");
    if (liveMode && userChanged) runAction(companionApi.updateUser({ name: normalized.user.name, pronouns: normalized.user.pronouns, timezone: normalized.user.timezone }), "Profile changes could not be saved.");
    if (liveMode && relationshipChanged) runAction(companionApi.updateCompanion(normalized.companion.id, { relationshipMode }), "Relationship mode could not be saved.");
  };

  const completeOnboarding = async (draft: OnboardingDraft) => {
    let liveAccount: Awaited<ReturnType<typeof companionApi.signup>> | null = null;
    let liveConversationId: string | null = null;
    if (liveMode) {
      liveAccount = await companionApi.signup({
        email: draft.email,
        password: draft.password,
        name: draft.name.trim(),
        birthday: draft.birthday,
        pronouns: draft.pronouns,
        adultConfirmed: true,
        goals: draft.intentions,
        interests: draft.interests,
        companionName: draft.companionName.trim() || "Luma",
        companionPronouns: draft.companionPronouns,
        relationshipMode: draft.relationshipMode,
      });
      await Promise.all([
        companionApi.updateCompanion(liveAccount.companion.id, { name: draft.companionName.trim() || "Luma", relationshipMode: draft.relationshipMode, voiceId: draft.voiceId }),
        companionApi.updatePersonality(liveAccount.companion.id, { warmth: draft.warmth / 100, playfulness: draft.playfulness / 100, energy: draft.energy / 100, humor: draft.humor / 100, verbosity: draft.expressiveness / 100 }),
      ]);
      liveConversationId = (await companionApi.createConversation(liveAccount.companion.id)).id;
    }
    setState((current) => ({
      ...current,
      onboardingComplete: true,
      firstMeetingComplete: false,
      currentView: "home",
      activeConversationId: liveConversationId ?? current.activeConversationId,
      user: { ...current.user, ...(liveAccount?.user ?? {}), name: draft.name.trim(), birthday: draft.birthday, pronouns: draft.pronouns, interests: draft.interests, adultConfirmed: draft.adultConfirmed },
      companion: {
        ...current.companion,
        ...(liveAccount?.companion ?? {}),
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
        conversationId: liveConversationId ?? current.activeConversationId,
        role: "assistant",
        content: `Hi ${draft.name.trim()}. I’m ${draft.companionName.trim() || "Luma"}. What makes an ordinary day feel good to you?`,
        createdAt: new Date().toISOString(),
        status: "sent",
      }],
    }));
  };

  const createCompanionTurn = (content: string, messages: ChatMessage[], now: Date, delivery: "text" | "voice" | "video" = "text"): CompanionTurn => {
    const conversationMessages = messagesForConversation(messages, state.activeConversationId);
    const context = buildCompanionContext({
      user: state.user,
      companion: state.companion,
      relationship: { mode: state.companion.relationshipMode, startedAt: state.companion.createdAt, interactionCount: conversationMessages.length, sharedExperiences: state.moments.map((moment) => moment.title) },
      memories: state.memoryEnabled ? activeMemories : [],
      messages: conversationMessages,
      timezone: state.user.timezone,
      now,
      delivery,
      companionBackstory: state.companionBackstory,
      responsePreferences: state.responsePreferences,
    });
    return planCompanionTurn(content, context);
  };

  const sendMessage = async (content: string) => {
    if (!processingAllowed()) return;
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

    if (liveMode) {
      const assistantId = `pending:${crypto.randomUUID()}`;
      setState((current) => ({ ...current, messages: [...current.messages, { id: assistantId, conversationId: current.activeConversationId, role: "assistant", content: "", createdAt: new Date().toISOString(), status: "sending" }] }));
      try {
        const result = await companionApi.streamChat({ conversationId: state.activeConversationId, companionId: state.companion.id, clientMessageId: userMessage.id, content, memoryEnabled: state.memoryEnabled }, (delta) => {
          setState((current) => ({ ...current, messages: current.messages.map((message) => message.id === assistantId ? { ...message, content: `${message.content}${delta}` } : message) }));
        });
        setState((current) => ({ ...current, messages: current.messages.map((message) => message.id === assistantId ? { ...message, id: result.assistantMessageId || assistantId, status: "sent" } : message) }));
      } catch (cause) {
        setState((current) => ({ ...current, messages: current.messages.map((message) => message.id === assistantId ? { ...message, content: cause instanceof Error ? cause.message : `${current.companion.name} could not respond just now.`, status: "failed" } : message) }));
      } finally {
        setStreaming(false);
      }
      return;
    }

    const safety = assessSafety(content);
    const turn = createCompanionTurn(content, [...messagesForConversation(state.messages, state.activeConversationId), userMessage], now);
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

  const newConversation = async () => {
    const conversationId = liveMode ? (await companionApi.createConversation(state.companion.id)).id : crypto.randomUUID();
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

  const deleteConversation = async () => {
    const deletedId = state.activeConversationId;
    if (liveMode) await companionApi.deleteConversation(deletedId);
    const conversationId = liveMode ? (await companionApi.createConversation(state.companion.id)).id : crypto.randomUUID();
    setState((current) => ({ ...current, activeConversationId: conversationId, messages: [...current.messages.filter((message) => message.conversationId !== deletedId), { id: crypto.randomUUID(), conversationId, role: "assistant", content: "Clean slate. What would feel good to talk about now?", createdAt: new Date().toISOString(), status: "sent" }] }));
  };

  const addMockExchange = (userMessage: ChatMessage, assistantMessage: ChatMessage) => setState((current) => ({ ...current, messages: [...current.messages, userMessage, assistantMessage] }));

  const sendVoiceNote = async (transcript: string) => {
    if (!processingAllowed()) return;
    if (!featureEntitlements.has(state.subscription.planId, "voiceNotes")) { setPlansOpen(true); return; }
    if (liveMode) { await sendMessage(transcript); return; }
    const now = new Date();
    const userMessage: ChatMessage = { id: crypto.randomUUID(), conversationId: state.activeConversationId, role: "user", content: transcript, createdAt: now.toISOString(), status: "sent", attachments: [{ id: crypto.randomUUID(), type: "audio", url: "browser://voice-transcript", name: "Voice note", transcript, durationMs: Math.max(1_000, transcript.split(/\s+/).length * 420) }] };
    const turn = createCompanionTurn(transcript, [...messagesForConversation(state.messages, state.activeConversationId), userMessage], now, "voice");
    const reply = turn.text;
    await pause(250);
    const assistantMessage: ChatMessage = { id: crypto.randomUUID(), conversationId: state.activeConversationId, role: "assistant", content: reply, createdAt: new Date().toISOString(), status: "sent", explanation: turn.explanation, attachments: [{ id: crypto.randomUUID(), type: "audio", url: "browser://speech-synthesis", name: `${state.companion.name} voice reply`, transcript: reply, durationMs: Math.max(1_500, reply.split(/\s+/).length * 360) }] };
    addMockExchange(userMessage, assistantMessage);
  };

  const sendVoiceRecording = async (audioBase64: string, contentType: string) => {
    if (!processingAllowed()) return;
    if (!featureEntitlements.has(state.subscription.planId, "voiceNotes")) { setPlansOpen(true); return; }
    const transcription = await companionApi.transcribe(audioBase64, contentType);
    if (!transcription.text.trim()) throw new Error("I couldn’t hear words in that voice note.");
    await sendMessage(transcription.text);
  };

  const speakWithProvider = async (content: string) => {
    const speech = await companionApi.synthesize(content, state.companion.voiceId);
    if (speech.mock) {
      if (!("speechSynthesis" in window)) throw new Error("Speech playback is unavailable in this browser.");
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(content));
      return;
    }
    const audio = new Audio(`data:${speech.contentType};base64,${speech.audioBase64}`);
    await audio.play();
  };

  const uploadImage = async (file: File) => {
    if (!processingAllowed()) return;
    if (!file.type.match(/^image\/(jpeg|png|webp)$/)) throw new Error("Choose a JPEG, PNG, or WebP image.");
    if (file.size > 8_000_000) throw new Error("Choose an image smaller than 8 MB.");
    const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
    if (liveMode) {
      const dataBase64 = dataUrl.split(",")[1] ?? "";
      const [asset, analysis] = await Promise.all([
        companionApi.uploadImage(file.name, file.type, dataBase64),
        companionApi.analyzeImage(dataBase64, file.type, "Describe what is visible and respond naturally to the person who shared it."),
      ]);
      const now = new Date().toISOString();
      setState((current) => ({ ...current, mediaLibrary: [...current.mediaLibrary, { id: asset.id, type: "image", name: file.name, url: asset.url, createdAt: now }], photos: [{ id: asset.id, imageUrl: asset.url, caption: file.name, createdAt: now, kind: "shared" }, ...current.photos], messages: [...current.messages, { id: crypto.randomUUID(), conversationId: current.activeConversationId, role: "user", content: "Look at this.", createdAt: now, status: "sent", attachments: [{ id: asset.id, type: "image", url: asset.url, name: file.name }] }, { id: crypto.randomUUID(), conversationId: current.activeConversationId, role: "assistant", content: analysis.description, createdAt: new Date().toISOString(), status: "sent" }] }));
      return;
    }
    const now = new Date().toISOString();
    const attachmentId = crypto.randomUUID();
    const userMessage: ChatMessage = { id: crypto.randomUUID(), conversationId: state.activeConversationId, role: "user", content: "Look at this.", createdAt: now, status: "sent", attachments: [{ id: attachmentId, type: "image", url: dataUrl, name: file.name }] };
    const assistantMessage: ChatMessage = { id: crypto.randomUUID(), conversationId: state.activeConversationId, role: "assistant", content: "Okay, I’m looking. I won’t guess who anyone is or infer sensitive details—what do you want me to notice?", createdAt: new Date(Date.now() + 1).toISOString(), status: "sent" };
    setState((current) => ({ ...current, mediaLibrary: [...current.mediaLibrary, { id: attachmentId, type: "image", name: file.name, url: dataUrl, createdAt: now }], photos: [{ id: attachmentId, imageUrl: dataUrl, caption: file.name, createdAt: now, kind: "shared" }, ...current.photos], messages: [...current.messages, userMessage, assistantMessage] }));
  };

  const generateImage = async (prompt: string) => {
    if (!processingAllowed()) return;
    if (!featureEntitlements.has(state.subscription.planId, "imageGeneration")) { setPlansOpen(true); return; }
    if (liveMode) {
      const result = await companionApi.generateImage(prompt, `${state.companion.name}, ${state.companion.presentation}, original stylized-realistic 3D companion`);
      const imageUrl = result.artifactBase64 ? `data:${result.contentType};base64,${result.artifactBase64}` : result.assetUrl;
      const now = new Date().toISOString();
      const attachmentId = crypto.randomUUID();
      setState((current) => ({ ...current, mediaLibrary: [{ id: attachmentId, type: "generated-image", name: prompt, url: imageUrl, createdAt: now }, ...current.mediaLibrary], photos: [{ id: attachmentId, imageUrl, caption: prompt, createdAt: now, kind: "selfie" }, ...current.photos], messages: [...current.messages, { id: crypto.randomUUID(), conversationId: current.activeConversationId, role: "assistant", content: `I made this for you—“${prompt}.”`, createdAt: now, status: "sent", attachments: [{ id: attachmentId, type: "generated-image", url: imageUrl, name: prompt }] }] }));
      return;
    }
    const now = new Date().toISOString();
    const attachmentId = crypto.randomUUID();
    const imageUrl = prompt.toLowerCase().includes("rooftop") ? "/assets/luma/rooftop-date.png" : "/assets/luma/cafe-selfie.png";
    const assistantMessage: ChatMessage = { id: crypto.randomUUID(), conversationId: state.activeConversationId, role: "assistant", content: `I took this for you—“${prompt}.”`, createdAt: now, status: "sent", attachments: [{ id: attachmentId, type: "generated-image", url: imageUrl, name: prompt }] };
    setState((current) => ({ ...current, mediaLibrary: [{ id: attachmentId, type: "generated-image", name: prompt, url: imageUrl, createdAt: now }, ...current.mediaLibrary], photos: [{ id: attachmentId, imageUrl, caption: prompt, createdAt: now, kind: "selfie" }, ...current.photos], messages: [...current.messages, assistantMessage] }));
  };

  const addSelfie = () => {
    if (!processingAllowed()) return;
    if (!featureEntitlements.has(state.subscription.planId, "aiSelfies")) { setPlansOpen(true); return; }
    if (liveMode) {
      runAction(generateImage(`A warm, candid selfie from ${state.companion.name} during a quiet coffee break, natural expression, private companion moment`).then(() => setMomentsTab("photos")), "The selfie could not be created.");
      return;
    }
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    setState((current) => ({
      ...current,
      photos: [{ id, imageUrl: "/assets/luma/cafe-selfie.png", caption: "Rainy coffee break—just for you", createdAt: now, kind: "selfie" }, ...current.photos],
      mediaLibrary: [{ id, type: "generated-image", name: `${current.companion.name} coffee selfie`, url: "/assets/luma/cafe-selfie.png", createdAt: now }, ...current.mediaLibrary],
    }));
    setMomentsTab("photos");
  };

  const recordFeedback = (messageId: string, feedback: "up" | "down", reason?: FeedbackReason) => {
    setState((current) => ({
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
    if (liveMode) runAction(companionApi.feedback(state.activeConversationId, messageId, feedback, reason), "Your feedback could not be saved.");
  };

  const regenerateResponse = async (messageId: string) => {
    const source = previousUserMessage(state.messages, messageId, state.activeConversationId);
    if (!source) return;
    if (liveMode) {
      const updated = await companionApi.regenerate(state.activeConversationId, messageId, state.memoryEnabled);
      setState((current) => ({ ...current, messages: current.messages.map((message) => message.id === messageId ? updated : message) }));
      return;
    }
    const now = new Date();
    const activeMessages = messagesForConversation(state.messages, state.activeConversationId);
    const sourceIndex = activeMessages.findIndex((message) => message.id === source.id);
    const turn = createCompanionTurn(source.content, activeMessages.slice(0, sourceIndex + 1), now);
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

  const purchaseItem = async (item: StoreItemRecord): Promise<string | null> => {
    if (!canAccessItem(state.subscription.planId, item)) { setPlansOpen(true); return `${item.tierRequired[0]?.toUpperCase()}${item.tierRequired.slice(1)} is required for this item.`; }
    if (currencyBalance(item, state.wallet) < item.price) return `Not enough ${item.currency}. Try an activity together to earn more.`;
    if (liveMode) {
      const result = await companionApi.purchaseItem(item.id);
      setState((current) => ({ ...current, wallet: result.wallet, ownedItems: current.ownedItems.some((owned) => owned.itemId === result.owned.itemId) ? current.ownedItems : [...current.ownedItems, result.owned] }));
      return null;
    }
    const now = new Date().toISOString();
    setState((current) => {
      if (current.ownedItems.some((owned) => owned.itemId === item.id)) return current;
      const wallet = item.currency === "free" ? current.wallet : { ...current.wallet, [item.currency]: current.wallet[item.currency] - item.price };
      const transactions = item.currency === "free" ? current.walletTransactions : [...current.walletTransactions, { id: crypto.randomUUID(), userId: current.user.id, type: "purchase" as const, currency: item.currency, amount: -item.price, balanceAfter: wallet[item.currency], referenceId: item.id, idempotencyKey: `web:${item.id}:${now}`, createdAt: now }];
      return { ...current, wallet, walletTransactions: transactions, ownedItems: [...current.ownedItems, { itemId: item.id, purchasedAt: now, equipped: false }] };
    });
    return null;
  };

  const equipItem = async (item: StoreItemRecord) => {
    const liveOwnedItems = liveMode ? await companionApi.equipItem(item.id) : null;
    setState((current) => {
      const environment = environmentForItem(item) as EnvironmentId | null;
      return {
        ...current,
        ...(environment ? { activeEnvironment: environment } : {}),
        ownedItems: liveOwnedItems ?? current.ownedItems.map((owned) => {
          const ownedItem = current.storeItems.find((candidate) => candidate.id === owned.itemId);
          return ownedItem?.metadata.slot === item.metadata.slot ? { ...owned, equipped: owned.itemId === item.id } : owned;
        }),
      };
    });
  };

  const choosePlan = async (planId: PlanId) => {
    const subscription = liveMode ? (await companionApi.mockUpgrade(planId)).subscription : { planId, status: "active" as const, testMode: true, renewsAt: new Date(Date.now() + 30 * 86_400_000).toISOString() };
    setState((current) => ({ ...current, subscription }));
    setPlansOpen(false);
  };

  const addJournal = async (entry: { title: string; content: string; mood: CompanionMood }) => {
    const created = liveMode ? await companionApi.addJournal(entry) : { id: crypto.randomUUID(), userId: state.user.id, ...entry, tags: [], reflected: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    setState((current) => ({ ...current, journalEntries: [created, ...current.journalEntries] }));
  };
  const deleteJournal = async (entryId: string) => { if (liveMode) await companionApi.deleteJournal(entryId); setState((current) => ({ ...current, journalEntries: current.journalEntries.filter((entry) => entry.id !== entryId) })); };
  const reflectOnJournal = async (entry: DemoState["journalEntries"][number]) => {
    const reflection = liveMode ? (await companionApi.reflectJournal(entry.id)).reflection : `I notice ${entry.mood} energy in “${entry.title}.” What part would you like me to sit with?`;
    setState((current) => ({ ...current, currentView: "chat", journalEntries: current.journalEntries.map((candidate) => candidate.id === entry.id ? { ...candidate, reflected: true, updatedAt: new Date().toISOString() } : candidate), messages: [...current.messages, { id: crypto.randomUUID(), conversationId: current.activeConversationId, role: "assistant", content: reflection, createdAt: new Date().toISOString(), status: "sent" }] }));
  };
  const addFutureEvent = async (event: { description: string; eventDate: string }) => {
    if (liveMode) {
      const result = await companionApi.addEvent(event.description, event.eventDate);
      setState((current) => ({ ...current, futureEvents: [result.event, ...current.futureEvents], nudges: result.nudge ? [result.nudge, ...current.nudges] : current.nudges }));
      return;
    }
    setState((current) => { const eventId = crypto.randomUUID(); const scheduled = new Date(new Date(event.eventDate).getTime() - 3_600_000); if (scheduled.getHours() >= 22 || scheduled.getHours() < 8) scheduled.setHours(8, 0, 0, 0); return { ...current, futureEvents: [{ id: eventId, userId: current.user.id, companionId: current.companion.id, ...event, status: "confirmed", createdAt: new Date().toISOString() }, ...current.futureEvents], nudges: current.notifications.frequency === "off" ? current.nudges : [{ id: crypto.randomUUID(), userId: current.user.id, eventId, content: `You mentioned ${event.description}. Want a calm check-in before it?`, scheduledFor: scheduled.toISOString(), status: "planned" }, ...current.nudges] }; });
  };
  const updateMemory = async (updated: MemoryRecord) => { const saved = liveMode ? await companionApi.updateMemory(updated.id, { content: updated.content, pinned: updated.pinned, status: updated.status }) : updated; setState((current) => ({ ...current, memories: current.memories.map((memory) => memory.id === saved.id ? saved : memory) })); };
  const deleteMemory = async (memoryId: string) => { if (liveMode) await companionApi.deleteMemory(memoryId); setState((current) => ({ ...current, memories: current.memories.map((memory) => memory.id === memoryId ? { ...memory, status: "deleted", updatedAt: new Date().toISOString() } : memory) })); };
  const addMemory = async (content: string, type: MemoryType) => { const now = new Date().toISOString(); const memory = liveMode ? await companionApi.createMemory(state.companion.id, type, content) : { id: crypto.randomUUID(), userId: state.user.id, companionId: state.companion.id, type, content, normalizedContent: content.toLowerCase(), importance: 0.8, confidence: 1, sourceMessageIds: [], createdAt: now, updatedAt: now, retrievalCount: 0, status: "active" as const, pinned: false }; setState((current) => ({ ...current, memories: [...current.memories, memory] })); };

  const completeActivity = async (activity: ActivityDefinition) => {
    if (state.completedActivityIds.includes(activity.id)) return;
    const liveWallet = liveMode ? await companionApi.completeActivity(activity.id) : null;
    setState((current) => {
      if (current.completedActivityIds.includes(activity.id)) return current;
      const xp = current.wallet.xp + activity.xp;
      const coins = current.wallet.coins + activity.coinReward;
      const completedAt = new Date().toISOString();
      return {
        ...current,
        currentView: "chat",
        completedActivityIds: [...current.completedActivityIds, activity.id],
        wallet: liveWallet ?? { ...current.wallet, xp, level: Math.max(current.wallet.level, Math.floor(xp / 100) + 1), coins },
        walletTransactions: liveMode ? current.walletTransactions : [...current.walletTransactions,
          { id: crypto.randomUUID(), userId: current.user.id, type: "earn", currency: "xp", amount: activity.xp, balanceAfter: xp, referenceId: activity.id, idempotencyKey: `activity:${activity.id}:xp`, createdAt: completedAt },
          { id: crypto.randomUUID(), userId: current.user.id, type: "earn", currency: "coins", amount: activity.coinReward, balanceAfter: coins, referenceId: activity.id, idempotencyKey: `activity:${activity.id}:coins`, createdAt: completedAt },
        ],
        messages: [...current.messages, { id: crypto.randomUUID(), conversationId: current.activeConversationId, role: "assistant", content: `Let’s do “${activity.title}.” ${activity.description} I’ll go first.`, createdAt: completedAt, status: "sent" }],
      };
    });
  };

  const startDate = (environment: EnvironmentId, title: string) => {
    const environmentItem = state.storeItems.find((item) => environmentForItem(item) === environment);
    if (environmentItem && !state.ownedItems.some((owned) => owned.itemId === environmentItem.id)) {
      setActionError(`Unlock ${environmentItem.name} in Companion before starting this date.`);
      navigate("companion");
      return;
    }
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
    if (!processingAllowed()) return;
    if (!featureEntitlements.has(state.subscription.planId, "voiceCalls")) setPlansOpen(true);
    else setVoiceCallOpen(true);
  };
  const openVideoCall = () => {
    if (!processingAllowed()) return;
    if (!featureEntitlements.has(state.subscription.planId, "videoCalls")) setPlansOpen(true);
    else setVideoCallOpen(true);
  };
  const analyzeSharedCallFrame = async (dataBase64: string, contentType: string) => {
    if (liveMode) return (await companionApi.analyzeImage(dataBase64, contentType, "React naturally to the single camera frame the user explicitly shared during a video call. Describe only visible, non-sensitive details and do not identify people.")).description;
    await pause(280);
    return "Okay, I can see the frame you chose to share. I won’t guess anything sensitive about you, but I’m here for the story behind what you’re showing me.";
  };

  const replyDuringCall = (content: string, delivery: "voice" | "video") => {
    if (liveMode) {
      let reply = "";
      return companionApi.streamChat({ conversationId: state.activeConversationId, companionId: state.companion.id, clientMessageId: crypto.randomUUID(), content, memoryEnabled: state.memoryEnabled }, (delta) => { reply += delta; }).then(() => reply);
    }
    const now = new Date();
    const userTurn: ChatMessage = {
      id: crypto.randomUUID(),
      conversationId: state.activeConversationId,
      role: "user",
      content,
      createdAt: now.toISOString(),
      status: "sent",
    };
    return Promise.resolve(createCompanionTurn(content, [...messagesForConversation(state.messages, state.activeConversationId), userTurn], now, delivery).text);
  };

  const exportData = async () => {
    const payload = liveMode ? await companionApi.exportData() : { exportedAt: new Date().toISOString(), source: "luma-local-mock", ...state };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = liveMode ? "luma-account-export.json" : "luma-demo-export.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const deleteDemo = async () => {
    if (liveMode) {
      await companionApi.deleteAccount("DELETE");
      router.replace("/");
      return;
    }
    window.localStorage.removeItem(storageKey);
    setState({ ...initialState, firstMeetingComplete: false });
  };

  const logout = async () => {
    await companionApi.logout();
    router.replace("/login");
  };

  if (!hydrated) return <div className="app-loader"><span /><p>Opening Luma’s room…</p></div>;
  if (hydrationError) return <div className="app-loader"><p>{hydrationError}</p><button type="button" className="button button--primary" onClick={() => window.location.reload()}>Try again</button></div>;
  if (!state.onboardingComplete) return <Onboarding onComplete={completeOnboarding} />;
  if (!state.firstMeetingComplete) return <FirstMeeting userName={state.user.name} companionName={state.companion.name} onComplete={() => setState((current) => ({ ...current, firstMeetingComplete: true }))} />;

  const renderView = () => {
    switch (state.currentView) {
      case "home": return <HomeView state={state} onChat={() => navigate("chat")} onCall={openVoiceCall} onVideoCall={openVideoCall} onMoments={() => openMoments("moments")} onCompanion={() => navigate("companion")} onSpendTime={() => openMoments("together")} onEnvironmentChange={(activeEnvironment) => setState((current) => ({ ...current, activeEnvironment }))} onAmbienceChange={() => setState((current) => ({ ...current, ambienceEnabled: !current.ambienceEnabled }))} />;
      case "chat": return <ChatView state={state} streaming={streaming} processingEnabled={state.aiProcessingConsent} liveMode={liveMode} onSend={sendMessage} onNewConversation={() => runAction(newConversation(), "A new conversation could not be started.")} onDeleteConversation={deleteConversation} onBack={() => navigate("home")} onCall={openVoiceCall} onVideoCall={openVideoCall} onVoiceNote={sendVoiceNote} {...(liveMode ? { onVoiceRecording: sendVoiceRecording, onSpeak: (content: string) => speakWithProvider(content).catch((cause) => setActionError(cause instanceof Error ? cause.message : "Speech playback failed.")) } : {})} onImageUpload={uploadImage} onGenerateImage={generateImage} onFeedback={recordFeedback} onRegenerate={(messageId) => runAction(regenerateResponse(messageId), "The response could not be regenerated.")} onUpgrade={() => setPlansOpen(true)} onCamera={() => { if (!processingAllowed()) return; if (!featureEntitlements.has(state.subscription.planId, "cameraConversation")) setPlansOpen(true); else setCameraOpen(true); }} />;
      case "moments": return <MomentsView key={momentsTab} defaultTab={momentsTab} state={state} liveMode={liveMode} onCompleteActivity={(activity) => runAction(completeActivity(activity), "The activity could not be completed.")} onStartDate={startDate} onGenerateSelfie={addSelfie} onVideoCall={openVideoCall} />;
      case "companion": return <CompanionView companion={state.companion} backstory={state.companionBackstory} storeItems={state.storeItems} ownedItems={state.ownedItems} wallet={state.wallet} subscription={state.subscription} onChange={changeCompanion} onBackstoryChange={(companionBackstory) => setState((current) => ({ ...current, companionBackstory }))} onPurchase={purchaseItem} onEquip={equipItem} onUpgrade={() => setPlansOpen(true)} />;
      case "memory": return <MemoryView memories={state.memories} enabled={state.memoryEnabled} companionName={state.companion.name} onToggle={() => setState((current) => ({ ...current, memoryEnabled: !current.memoryEnabled }))} onUpdate={(memory) => runAction(updateMemory(memory), "The memory could not be updated.")} onDelete={(memoryId) => runAction(deleteMemory(memoryId), "The memory could not be deleted.")} onAdd={(content, type) => runAction(addMemory(content, type), "The memory could not be added.")} />;
      case "activities": return <ActivitiesView activities={state.activities} completedIds={state.completedActivityIds} wallet={state.wallet} journalEntries={state.journalEntries} futureEvents={state.futureEvents} nudges={state.nudges} companionName={state.companion.name} liveMode={liveMode} onComplete={(activity) => runAction(completeActivity(activity), "The activity could not be completed.")} onAddJournal={(entry) => runAction(addJournal(entry), "The journal entry could not be saved.")} onDeleteJournal={(entryId) => runAction(deleteJournal(entryId), "The journal entry could not be deleted.")} onReflect={(entry) => runAction(reflectOnJournal(entry), "The reflection could not be created.")} onAddEvent={(event) => runAction(addFutureEvent(event), "The future plan could not be saved.")} />;
      case "profile": return <ProfileView state={state} liveMode={liveMode} onChange={changeProfile} onExport={() => runAction(exportData(), "Your data export could not be created.")} onDelete={() => runAction(deleteDemo(), "Your account could not be deleted.")} {...(liveMode ? { onLogout: () => runAction(logout(), "You could not be signed out.") } : {})} onUpgrade={() => setPlansOpen(true)} onOpenMemory={() => navigate("memory")} onOpenActivities={() => openMoments("together")} />;
    }
  };

  return (
    <>
      <AppShell active={state.currentView} onNavigate={navigate} onCall={openVoiceCall} companionName={state.companion.name} relationshipStage={state.relationship.stage} relationshipLevel={state.relationship.level} immersive={state.currentView === "home"}>{renderView()}</AppShell>
      {voiceCallOpen ? <VoiceCallModal companionName={state.companion.name} userName={state.user.name} voiceId={state.companion.voiceId} onUserTurn={(content) => replyDuringCall(content, "voice")} {...(liveMode ? { onRealtimeConnect: connectVoiceRealtime } : {})} onClose={(seconds) => finishCall("voice", seconds)} /> : null}
      {videoCallOpen ? <VideoCallModal companionName={state.companion.name} userName={state.user.name} voiceId={state.companion.voiceId} initialEnvironment={state.activeEnvironment} onUserTurn={(content) => replyDuringCall(content, "video")} onAnalyzeFrame={analyzeSharedCallFrame} {...(liveMode ? { onRealtimeConnect: connectVideoRealtime } : {})} onClose={(seconds) => finishCall("video", seconds)} /> : null}
      {cameraOpen ? <CameraConversationModal companionName={state.companion.name} onSessionStart={liveMode ? companionApi.startCameraSession : async () => ({ mock: true })} onAnalyzeFrame={liveMode ? async (dataBase64: string, contentType: string) => (await companionApi.analyzeImage(dataBase64, contentType, "Discuss the visible object or surroundings naturally and safely.")).description : async () => { await pause(280); return "I can see the frame you chose to share. Tell me what matters about it to you, and I’ll stay with that rather than making assumptions."; }} onClose={() => setCameraOpen(false)} /> : null}
      {plansOpen ? <PlanModal current={state.subscription.planId} onSelect={(planId) => runAction(choosePlan(planId), "The plan could not be changed.")} onClose={() => setPlansOpen(false)} /> : null}
      {processingNoticeOpen ? <Modal title="AI processing is paused" description="Turn processing consent back on before starting chat, voice, video, camera, or image features." onClose={() => setProcessingNoticeOpen(false)}><div className="modal-actions"><button type="button" className="button button--ghost" onClick={() => setProcessingNoticeOpen(false)}>Keep paused</button><button type="button" className="button button--primary" onClick={() => { setState((current) => ({ ...current, aiProcessingConsent: true })); setProcessingNoticeOpen(false); }}>Enable AI features</button></div></Modal> : null}
      {actionError ? <Modal title="That didn’t work" description={actionError} onClose={() => setActionError("")}><button type="button" className="button button--primary" onClick={() => setActionError("")}>Okay</button></Modal> : null}
    </>
  );
}
