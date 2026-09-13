"use client";
import Link from "next/link";

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  applyContradictions,
  assessSafety,
  extractMemoryCandidates,
} from "@companion/ai";
import type {
  ActivityDefinition,
  ChatMessage,
  CompanionMood,
  MemoryRecord,
  MemoryType,
  StoreItemRecord,
} from "@companion/shared";
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
import {
  initialState,
  storageKey,
  type AppView,
  type DemoState,
  type EnvironmentId,
  type FeedbackReason,
} from "@/lib/state";
import {
  canAccessItem,
  currencyBalance,
  environmentForItem,
} from "@/lib/product-rules";
import { companionApi } from "@/lib/api-client";
import { accountClient } from "@/lib/account-client";
import {
  messagesForConversation,
  previousUserMessage,
} from "@/lib/conversation-state";
import {
  currentMemoryRecords,
  relevantMemoryContents,
} from "@/lib/memory-relevance";
import { playCompanionSpeech, stopCompanionSpeech } from "@/lib/speech";
import { freshDemo, restoreDemo, serializeDemo } from "@/lib/demo-storage";
import { trackEvent } from "@/lib/analytics";
import { AdultDemoGate } from "./AdultDemoGate";
import { AccountSync, type SyncStatus } from "@/lib/account-sync";
import { ConversationTurns, appendUniqueMessages, assertTurnActive, resolveConversationTurn, type TurnContext } from "@/lib/conversation-turn";
import { CapabilityRefresh, createDemoSession, fetchCapabilities, revokeDemoSession, type CapabilityContract, type RuntimeMode } from "@/lib/runtime-capabilities";
import { assessCompanionSafety } from "@/lib/companion-safety";
const VoiceCallModal = lazy(() => import("./VoiceCallModal").then(module => ({ default: module.VoiceCallModal })));
const VideoCallModal = lazy(() => import("./VideoCallModal").then(module => ({ default: module.VideoCallModal })));

const pause = (milliseconds: number) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds));
const optional = async <T,>(promise: Promise<T>, fallback: T): Promise<T> =>
  promise.catch(() => fallback);
const livePreferencesKey = (userId: string) =>
  `mira-live-preferences-v1:${userId}`;
const personalizeMemory = (content: string, name: string) => {
  const personalized = content
    .replace(/\bUser's\b/g, `${name}'s`)
    .replace(/\bUser\b/g, name);
  return personalized
    ? `${personalized[0]!.toUpperCase()}${personalized.slice(1)}`
    : personalized;
};

function rememberConversationMessage(
  current: DemoState,
  content: string,
  sourceMessageId: string,
  now: Date,
) {
  if (!current.memoryEnabled || assessSafety(content).level !== "safe" || assessCompanionSafety([{ role: "user", content }]))
    return current.memories;
  let memories = current.memories;
  for (const candidate of extractMemoryCandidates(content)) {
    memories = applyContradictions(memories, candidate, now);
    if (
      !memories.some(
        (memory) =>
          memory.status === "active" &&
          memory.normalizedContent === candidate.normalizedContent,
      )
    ) {
      memories = [
        ...memories,
        {
          id: crypto.randomUUID(),
          userId: current.user.id,
          companionId: current.companion.id,
          type: candidate.type,
          content: personalizeMemory(candidate.content, current.user.name),
          normalizedContent: candidate.normalizedContent,
          importance: candidate.importance,
          confidence: candidate.confidence,
          sourceMessageIds: [sourceMessageId],
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          retrievalCount: 0,
          status: "active" as const,
          pinned: false,
        },
      ];
    }
  }
  return memories;
}

export function CompanionApp({
  forceDemo = false,
  productionAccount = false,
}: {
  forceDemo?: boolean;
  productionAccount?: boolean;
}) {
  const router = useRouter();
  const accountMode = productionAccount && !forceDemo;
  const liveMode = companionApi.enabled && !forceDemo && !accountMode;
  const cloudBacked = accountMode || liveMode;
  const runtime: RuntimeMode = accountMode ? "cloudflare-account" : liveMode ? "optional-fastify" : "browser-demo";
  const [state, setState] = useState<DemoState>(initialState);
  const [hydrated, setHydrated] = useState(false);
  const [streaming, setStreaming] = useState(false);
  // In-progress text is never part of DemoState, autosave, export or memories.
  const [streamDraft, setStreamDraft] = useState<{ turnId: string; conversationId: string; text: string } | null>(null);
  const [voiceCallOpen, setVoiceCallOpen] = useState(false);
  const [videoCallOpen, setVideoCallOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [plansOpen, setPlansOpen] = useState(false);
  const [processingNoticeOpen, setProcessingNoticeOpen] = useState(false);
  const [policyConfirmed, setPolicyConfirmed] = useState(false);
  const [actionError, setActionError] = useState("");
  const [hydrationError, setHydrationError] = useState("");
  const [legacyDemo, setLegacyDemo] = useState(false);
  const [resetDemoOpen, setResetDemoOpen] = useState(false);
  const [momentsTab, setMomentsTab] = useState<MomentsTab>("moments");
  const companionSyncTimer = useRef<number | null>(null);
  const accountSyncTimer = useRef<number | null>(null);
  const accountReady = useRef(false);
  const accountSync = useRef<AccountSync<DemoState> | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("saved");
  const [capabilities, setCapabilities] = useState<CapabilityContract | null>(null);
  const [failedMessage, setFailedMessage] = useState<ChatMessage | null>(null);
  const [olderMessages, setOlderMessages] = useState<ChatMessage[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | undefined>(undefined);
  const [olderComplete, setOlderComplete] = useState(false);
  const [olderBusy, setOlderBusy] = useState(false);
  const turns = useRef(new ConversationTurns());
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  const [reauthAction, setReauthAction] = useState<"export" | "delete" | null>(null);
  const [reauthPassword, setReauthPassword] = useState("");
  const [reauthError, setReauthError] = useState("");
  const [reauthBusy, setReauthBusy] = useState(false);

  useEffect(() => {
    if (liveMode) return;
    const checks = new CapabilityRefresh(setCapabilities);
    const refresh = () => { void checks.refresh(); };
    refresh();
    window.addEventListener("mira-capabilities-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => { checks.stop(); window.removeEventListener("mira-capabilities-changed", refresh); window.removeEventListener("focus", refresh); };
  }, [liveMode, state.aiProcessingConsent]);

  useEffect(() => {
    if (!state.aiProcessingConsent) { turns.current.cancel(); stopCompanionSpeech(); setStreaming(false); setVoiceCallOpen(false); setVideoCallOpen(false); setCameraOpen(false); }
  }, [state.aiProcessingConsent]);
  useEffect(() => () => { turns.current.cancel(); accountSync.current?.stop(); stopCompanionSpeech(); }, []);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const preview = query.get("preview");
    const onboarding = query.get("onboarding");
    if (preview === "home" && forceDemo) {
      setState({
        ...initialState,
        onboardingComplete: true,
        firstMeetingComplete: true,
        currentView: "home",
      });
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
        const restored = restoreDemo(saved);
        setState(restored.state);
        setLegacyDemo(restored.migrated);
      } catch (cause) {
        setHydrationError(
          cause instanceof Error
            ? cause.message
            : "Saved demo could not be restored. Your data has not been overwritten.",
        );
      }
      setHydrated(true);
      return;
    }
    if (accountMode) {
      const controller = new AbortController();
      void accountClient
        .load(controller.signal)
        .then(({ state: savedState, revision, policy }) => {
          if (controller.signal.aborted) return;
          accountReady.current = true;
          accountSync.current = new AccountSync(revision, accountClient.save, setSyncStatus);
          if (policy?.termsVersion !== "2026-09-13") setProcessingNoticeOpen(true);
          setState({
            ...initialState,
            ...savedState,
            onboardingComplete: true,
            relationship: {
              ...initialState.relationship,
              ...savedState.relationship,
            },
            responsePreferences: {
              ...initialState.responsePreferences,
              ...savedState.responsePreferences,
            },
          });
        })
        .catch((cause) => {
          if (controller.signal.aborted) return;
          if (
            cause instanceof Error &&
            /sign in|session expired/i.test(cause.message)
          )
            router.replace("/login");
          else
            setHydrationError(
              cause instanceof Error
                ? cause.message
                : "Your account could not be loaded just now.",
            );
        })
        .finally(() => { if (!controller.signal.aborted) setHydrated(true); });
      return () => controller.abort();
    }
    if (liveMode && companionApi.hasSession()) {
      void (async () => {
        try {
          const [user, companions, conversations] = await Promise.all([
            companionApi.me(),
            companionApi.companions(),
            companionApi.conversations(),
          ]);
          const companion = companions[0];
          if (!companion) throw new Error("Companion not found");
          const conversation =
            conversations[0] ??
            (await companionApi.createConversation(companion.id));
          const [
            messages,
            memories,
            activities,
            wallet,
            walletTransactions,
            store,
            ownedItems,
            subscriptionResult,
            journalEntries,
            futureEvents,
            nudges,
            notifications,
            calls,
            moments,
            photos,
          ] = await Promise.all([
            companionApi.messages(conversation.id),
            optional(companionApi.memories(), []),
            optional(companionApi.activities(), []),
            optional(companionApi.wallet(), {
              xp: 0,
              level: 1,
              coins: 0,
              gems: 0,
            }),
            optional(companionApi.walletTransactions(), []),
            optional(companionApi.store(), []),
            optional(companionApi.inventory(), []),
            optional(companionApi.subscription(), {
              subscription: {
                planId: "free",
                status: "active",
                testMode: true,
              },
            }),
            optional(companionApi.journal(), []),
            optional(companionApi.events(), []),
            optional(companionApi.nudges(), []),
            optional(companionApi.notifications(), {
              ...initialState.notifications,
              timezone: user.timezone,
            }),
            optional(companionApi.calls(), []),
            optional(companionApi.moments(), []),
            optional(companionApi.photos(), []),
          ]);
          let savedPreferences: Partial<DemoState> = {};
          try {
            savedPreferences = JSON.parse(
              window.localStorage.getItem(livePreferencesKey(user.id)) ?? "{}",
            ) as Partial<DemoState>;
          } catch {
            /* Use safe defaults. */
          }
          setState((current) => ({
            ...current,
            ...savedPreferences,
            onboardingComplete: true,
            firstMeetingComplete: true,
            user,
            companion,
            relationship: {
              ...current.relationship,
              ...savedPreferences.relationship,
            },
            responsePreferences: {
              ...current.responsePreferences,
              ...savedPreferences.responsePreferences,
            },
            activeConversationId: conversation.id,
            messages: messages.length
              ? messages
              : [
                  {
                    id: crypto.randomUUID(),
                    conversationId: conversation.id,
                    role: "assistant",
                    content: `I’m here, ${user.name}. What kind of company would feel good right now?`,
                    createdAt: new Date().toISOString(),
                    status: "sent",
                  },
                ],
            memories,
            activities: activities.length ? activities : current.activities,
            completedActivityIds: [
              ...new Set(
                walletTransactions
                  .filter(
                    (transaction) =>
                      transaction.type === "earn" &&
                      transaction.currency === "coins",
                  )
                  .map((transaction) => transaction.referenceId)
                  .filter((id) =>
                    activities.some((activity) => activity.id === id),
                  ),
              ),
            ],
            wallet,
            walletTransactions,
            storeItems: store.map((item) => ({
              id: item.id,
              name: item.name,
              description: item.description,
              category: item.category,
              assetUrl: item.assetUrl,
              currency: item.currency,
              price: item.price,
              tierRequired: item.tierRequired,
              metadata: item.metadata,
              active: item.active,
            })),
            ownedItems,
            subscription: subscriptionResult.subscription,
            journalEntries,
            futureEvents,
            nudges,
            notifications,
            calls: calls.map((call) => ({
              id: call.id,
              type: call.type,
              startedAt: call.startedAt,
              durationSeconds: Math.round((call.durationMs ?? 0) / 1_000),
              summary: call.summary ?? "A private companion call.",
            })),
            moments: moments.map((moment) => ({
              id: moment.id,
              title: moment.title,
              description: moment.description,
              date: moment.happenedAt,
              imageUrl: moment.mediaUrl,
              kind: moment.type,
            })),
            photos: photos.map((photo) => ({
              id: photo.id,
              imageUrl: photo.mediaUrl,
              caption: photo.caption,
              createdAt: photo.createdAt,
              kind: photo.type,
            })),
            companionReflections: [],
            mediaLibrary: [],
            currentView: "home",
          }));
        } catch (cause) {
          if (!companionApi.hasSession()) router.replace("/login");
          else
            setHydrationError(
              cause instanceof Error
                ? cause.message
                : "Your account could not be loaded just now.",
            );
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
        const restored = restoreDemo(saved);
        setState(restored.state);
        setLegacyDemo(restored.migrated);
      }
    } catch {
      // A clean local demo remains available when saved state is malformed.
    }
    setHydrated(true);
  }, [accountMode, forceDemo, liveMode, router]);

  useEffect(() => {
    if (!hydrated || hydrationError) return;
    if (accountMode) {
      document.documentElement.dataset.theme = state.theme;
      if (!accountReady.current || !state.onboardingComplete) return;
      setSyncStatus(current => ["conflict", "offline", "failed"].includes(current) ? current : "saving");
      if (accountSyncTimer.current !== null)
        window.clearTimeout(accountSyncTimer.current);
      accountSyncTimer.current = window.setTimeout(() => {
        accountSync.current?.enqueue(state);
      }, 700);
      return () => { if (accountSyncTimer.current !== null) window.clearTimeout(accountSyncTimer.current); };
    }
    if (liveMode) {
      try {
        window.localStorage.setItem(
          livePreferencesKey(state.user.id),
          JSON.stringify({
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
          }),
        );
      } catch {
        /* Keep the signed session usable without browser preference storage. */
      }
      document.documentElement.dataset.theme = state.theme;
      return;
    }
    try {
      window.localStorage.setItem(storageKey, serializeDemo(state));
    } catch {
      // The current session stays usable without persistent browser storage.
    }
    document.documentElement.dataset.theme = state.theme;
  }, [accountMode, hydrated, hydrationError, liveMode, state]);

  useEffect(() => {
    if (hydrated) trackEvent(`view_${state.currentView}`);
  }, [hydrated, state.currentView]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(".app-main")
        ?.scrollTo({ top: 0, behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [state.currentView]);

  useEffect(
    () => () => {
      if (companionSyncTimer.current !== null)
        window.clearTimeout(companionSyncTimer.current);
      if (accountSyncTimer.current !== null)
        window.clearTimeout(accountSyncTimer.current);
    },
    [],
  );

  const activeMemories = useMemo(
    () => state.memories.filter((memory) => memory.status === "active"),
    [state.memories],
  );
  const navigate = (view: AppView) => {
    if (view !== state.currentView) { turns.current.cancel(); stopCompanionSpeech(); setStreaming(false); }
    setState((current) => ({ ...current, currentView: view }));
  };
  const processingAllowed = () => {
    if (state.aiProcessingConsent && (liveMode || capabilities?.capabilities.chat)) return true;
    setProcessingNoticeOpen(true);
    return false;
  };
  const runAction = (action: Promise<unknown>, fallback: string) => {
    void action.catch((cause) =>
      setActionError(cause instanceof Error ? cause.message : fallback),
    );
  };

  const openMoments = (tab: MomentsTab) => {
    setMomentsTab(tab);
    navigate("moments");
  };

  const changeCompanion = (companion: DemoState["companion"]) => {
    setState((current) => ({ ...current, companion }));
    if (!liveMode) return;
    if (companionSyncTimer.current !== null)
      window.clearTimeout(companionSyncTimer.current);
    companionSyncTimer.current = window.setTimeout(() => {
      runAction(
        Promise.all([
          companionApi.updateCompanion(companion.id, {
            name: companion.name,
            relationshipMode: companion.relationshipMode,
            voiceId: companion.voiceId,
          }),
          companionApi.updatePersonality(companion.id, companion.personality),
        ]),
        "The companion settings could not be saved.",
      );
    }, 420);
  };

  const changeProfile = (next: DemoState) => {
    if (next.memoryEnabled !== state.memoryEnabled) {
      turns.current.cancel(); stopCompanionSpeech(); setStreaming(false); setVoiceCallOpen(false); setVideoCallOpen(false);
      if (!cloudBacked && state.aiProcessingConsent) runAction(createDemoSession(next.memoryEnabled), "Memory consent could not be updated. Please retry.");
    }
    if (!next.aiProcessingConsent) {
      turns.current.cancel(); stopCompanionSpeech();
      if (!cloudBacked) void revokeDemoSession();
    }
    const notificationsChanged =
      JSON.stringify(next.notifications) !==
      JSON.stringify(state.notifications);
    const userChanged =
      next.user.name !== state.user.name ||
      next.user.pronouns !== state.user.pronouns ||
      next.user.timezone !== state.user.timezone;
    const relationshipMode: DemoState["companion"]["relationshipMode"] = next
      .relationship.romanticOptIn
      ? "romantic"
      : next.companion.relationshipMode === "romantic"
        ? "friend"
        : next.companion.relationshipMode;
    const normalized =
      relationshipMode === next.companion.relationshipMode
        ? next
        : { ...next, companion: { ...next.companion, relationshipMode } };
    const relationshipChanged =
      normalized.companion.relationshipMode !==
      state.companion.relationshipMode;
    setState(normalized);
    if (liveMode && notificationsChanged)
      runAction(
        companionApi.updateNotifications(normalized.notifications),
        "Notification settings could not be saved.",
      );
    if (liveMode && userChanged)
      runAction(
        companionApi.updateUser({
          name: normalized.user.name,
          pronouns: normalized.user.pronouns,
          timezone: normalized.user.timezone,
        }),
        "Profile changes could not be saved.",
      );
    if (liveMode && relationshipChanged)
      runAction(
        companionApi.updateCompanion(normalized.companion.id, {
          relationshipMode,
        }),
        "Relationship mode could not be saved.",
      );
  };

  const completeOnboarding = async (draft: OnboardingDraft) => {
    if (!draft.adultConfirmed || !draft.policyAccepted || !draft.aiProcessingConsent) throw new Error("Confirm the adult declaration, policies and AI-processing consent to continue.");
    let liveAccount: Awaited<ReturnType<typeof companionApi.signup>> | null =
      null;
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
        companionName: draft.companionName.trim() || "Mira",
        companionPronouns: draft.companionPronouns,
        relationshipMode: draft.relationshipMode,
      });
      await Promise.all([
        companionApi.updateCompanion(liveAccount.companion.id, {
          name: draft.companionName.trim() || "Mira",
          relationshipMode: draft.relationshipMode,
          voiceId: draft.voiceId,
        }),
        companionApi.updatePersonality(liveAccount.companion.id, {
          warmth: draft.warmth / 100,
          playfulness: draft.playfulness / 100,
          energy: draft.energy / 100,
          humor: draft.humor / 100,
          verbosity: draft.expressiveness / 100,
        }),
      ]);
      liveConversationId = (
        await companionApi.createConversation(liveAccount.companion.id)
      ).id;
    }
    const nextState: DemoState = {
      ...state,
      onboardingComplete: true,
      firstMeetingComplete: false,
      currentView: "home",
      activeConversationId: liveConversationId ?? crypto.randomUUID(),
      user: {
        ...state.user,
        ...(liveAccount?.user ?? {}),
        name: draft.name.trim(),
        birthday: draft.birthday,
        pronouns: draft.pronouns,
        interests: draft.interests,
        adultConfirmed: draft.adultConfirmed,
      },
      companion: {
        ...state.companion,
        ...(liveAccount?.companion ?? {}),
        id: liveAccount?.companion.id ?? crypto.randomUUID(),
        name: draft.companionName.trim() || "Mira",
        pronouns: draft.companionPronouns,
        presentation: draft.presentation,
        voiceId: draft.voiceId,
        relationshipMode: draft.relationshipMode,
        personality: {
          ...state.companion.personality,
          warmth: draft.warmth / 100,
          playfulness: draft.playfulness / 100,
          energy: draft.energy / 100,
          humor: draft.humor / 100,
          verbosity: draft.expressiveness / 100,
        },
      },
      relationship: {
        ...state.relationship,
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
        sensualOptIn:
          draft.relationshipMode === "romantic" && draft.sensuality > 0,
      },
      memoryEnabled: draft.memoryEnabled,
      aiProcessingConsent: draft.aiProcessingConsent,
      conversationStorageEnabled: draft.conversationStorageEnabled,
      memories: [],
      moments: [],
      photos: [],
      calls: [],
      companionReflections: [],
      feedbackSignals: [],
      completedActivityIds: [],
      wallet: { xp: 0, level: 1, coins: 0, gems: 0 },
      walletTransactions: [],
      ownedItems: [],
      subscription: { planId: "free", status: "active", testMode: true },
      journalEntries: [],
      futureEvents: [],
      nudges: [],
      mediaLibrary: [],
      messages: [
        {
          id: crypto.randomUUID(),
          conversationId: liveConversationId ?? "pending",
          role: "assistant",
          content: `Hi ${draft.name.trim()}. I’m ${draft.companionName.trim() || "Mira"}. We can start with whatever feels easy—even a quiet hello.`,
          createdAt: new Date().toISOString(),
          status: "sent",
        },
      ],
    };
    if (!liveConversationId)
      nextState.messages[0]!.conversationId = nextState.activeConversationId;
    if (accountMode) {
      const created = await accountClient.signup({
        email: draft.email,
        password: draft.password,
        name: draft.name.trim(),
        state: nextState,
        policy: { termsVersion: "2026-09-13", adultConfirmed: true, aiProcessingConsent: draft.aiProcessingConsent },
      });
      accountReady.current = true;
      accountSync.current = new AccountSync(created.revision, accountClient.save, setSyncStatus);
      setState(created.state);
    } else {
      setState(nextState);
    }
    router.replace(forceDemo ? "/demo" : "/app");
  };


  const generateDemoReply = async (
    messages: ChatMessage[],
    delivery: "text" | "voice" | "video",
    signal: AbortSignal,
    onDelta?: (delta: string) => void,
  ) => {
    const replyStartedAt = performance.now();
    try {
      const currentMemories = state.memoryEnabled
        ? currentMemoryRecords(activeMemories)
        : [];
      const lexicalMemories = state.memoryEnabled
        ? relevantMemoryContents(currentMemories, messages)
        : [];
      // Demo calls must not wait on a second remote model before chat inference.
      // The deterministic lexical retriever already selects relevant approved memories.
      const recalledMemories = lexicalMemories;
      const reply = await companionApi.demoReply({
        messages: messagesForConversation(messages, state.activeConversationId)
          .filter(
            (message) =>
              message.role === "user" || message.role === "assistant",
          )
          .slice(-48)
          .map((message) => ({
            role: message.role as "user" | "assistant",
            content: message.content,
          })),
        companion: {
          name: state.companion.name,
          backstory: state.companionBackstory,
          personality: { ...state.companion.personality },
        },
        user: { name: state.user.name },
        relationshipMode: state.companion.relationshipMode,
        memories: recalledMemories,
        responsePreferences: state.responsePreferences,
        delivery,
      }, signal, onDelta);
      trackEvent("reply_received", Math.round(performance.now() - replyStartedAt));
      return reply;
    } catch (error) {
      trackEvent("reply_failed", Math.round(performance.now() - replyStartedAt));
      // Errors are not companion messages. The caller retains the failed turn.
      throw error;
    }
  };

  const sendMessage = async (content: string, retryMessage?: ChatMessage) => {
    if (!processingAllowed()) return;
    if (voiceCallOpen || videoCallOpen) throw new Error("Finish the call before sending a chat message.");
    const context = turns.current.begin(retryMessage?.id);
    if (!context) return;
    trackEvent("chat_send");
    setStreaming(true);
    setStreamDraft(null);
    const now = new Date();
    const userMessage: ChatMessage = retryMessage ?? {
      id: context.turnId,
      conversationId: state.activeConversationId,
      role: "user",
      content,
      createdAt: now.toISOString(),
      status: "sent",
    };
    setState((current) => ({
      ...current,
      messages: appendUniqueMessages(current.messages.map(message => message.id === userMessage.id ? { ...message, status: "sent" } : message), [userMessage]),
    }));

    if (liveMode) {
      const assistantId = `pending:${crypto.randomUUID()}`;
      setState((current) => ({
        ...current,
        messages: [
          ...current.messages,
          {
            id: assistantId,
            conversationId: current.activeConversationId,
            role: "assistant",
            content: "",
            createdAt: new Date().toISOString(),
            status: "sending",
          },
        ],
      }));
      try {
        const result = await companionApi.streamChat(
          {
            conversationId: state.activeConversationId,
            companionId: state.companion.id,
            clientMessageId: userMessage.id,
            content,
            memoryEnabled: state.memoryEnabled,
            responsePreferences: state.responsePreferences,
          },
          (delta) => {
            if (context.signal.aborted) return;
            setState((current) => ({
              ...current,
              messages: current.messages.map((message) =>
                message.id === assistantId
                  ? { ...message, content: `${message.content}${delta}` }
                  : message,
              ),
            }));
          }, context.signal,
        );
        assertTurnActive(context);
        const memories = state.memoryEnabled
          ? await optional(companionApi.memories(), state.memories)
          : state.memories;
        setState((current) => ({
          ...current,
          memories,
          messages: current.messages.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  id: result.assistantMessageId || assistantId,
                  status: "sent",
                }
              : message,
          ),
        }));
      } catch (cause) {
        if (context.signal.aborted) return;
        setState((current) => ({
          ...current,
          messages: current.messages.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  content:
                    cause instanceof Error
                      ? cause.message
                      : `${current.companion.name} could not respond just now.`,
                  status: "failed",
                }
              : message,
          ),
        }));
      } finally {
        turns.current.finish(context);
        setStreaming(false);
      }
      return;
    }

    const conversation = [
      ...messagesForConversation(state.messages, state.activeConversationId).filter(message => message.id !== userMessage.id),
      userMessage,
    ];
    try {
      await resolveConversationTurn(context, signal => generateDemoReply(conversation, "text", signal, delta => {
        if (context.signal.aborted) return;
        setStreamDraft(current => context.signal.aborted ? current : { turnId: context.turnId, conversationId: userMessage.conversationId, text: `${current?.turnId === context.turnId ? current.text : ""}${delta}` });
      }), reply => {
        setState(current => {
          if (context.signal.aborted || !current.aiProcessingConsent || current.activeConversationId !== userMessage.conversationId) return current;
          return { ...current,
            memories: accountMode ? current.memories : rememberConversationMessage(current, content, userMessage.id, now),
            messages: appendUniqueMessages(current.messages, [{ id: `${userMessage.id}:reply`, conversationId: userMessage.conversationId, role: "assistant", content: reply, createdAt: new Date().toISOString(), status: "sent" }]),
          };
        });
      });
      setFailedMessage(null);
    } catch (error) {
      if (!context.signal.aborted) {
        setFailedMessage(userMessage);
        setActionError(error instanceof Error ? error.message : "Your message could not be answered. Retry the same message.");
        setState(current => ({ ...current, messages: current.messages.map(message => message.id === userMessage.id ? { ...message, status: "failed" } : message) }));
      }
    } finally {
      setStreamDraft(current => current?.turnId === context.turnId ? null : current);
      turns.current.finish(context);
      if (!context.signal.aborted) setStreaming(false);
    }
  };

  const newConversation = async () => {
    turns.current.cancel(); stopCompanionSpeech(); setStreaming(false); setFailedMessage(null);
    setOlderMessages([]); setOlderCursor(undefined); setOlderComplete(false);
    if (accountMode) { await accountConversation({ action: "create" }); return; }
    const conversationId = liveMode
      ? (await companionApi.createConversation(state.companion.id)).id
      : crypto.randomUUID();
    setState((current) => ({
      ...current,
      activeConversationId: conversationId,
      messages: [
        ...current.messages,
        {
          id: crypto.randomUUID(),
          conversationId,
          role: "assistant",
          content: "Fresh chat. What are we getting into?",
          createdAt: new Date().toISOString(),
          status: "sent",
        },
      ],
    }));
  };

  const deleteConversation = async () => {
    turns.current.cancel(); stopCompanionSpeech(); setStreaming(false); setFailedMessage(null);
    setOlderMessages([]); setOlderCursor(undefined); setOlderComplete(false);
    if (accountMode) { await accountConversation({ action: "delete", id: state.activeConversationId }); return; }
    const deletedId = state.activeConversationId;
    if (liveMode) await companionApi.deleteConversation(deletedId);
    const conversationId = liveMode
      ? (await companionApi.createConversation(state.companion.id)).id
      : crypto.randomUUID();
    setState((current) => ({
      ...current,
      activeConversationId: conversationId,
      messages: [
        ...current.messages.filter(
          (message) => message.conversationId !== deletedId,
        ),
        {
          id: crypto.randomUUID(),
          conversationId,
          role: "assistant",
          content: "Fresh start. Batao, abhi kya baat karni hai?",
          createdAt: new Date().toISOString(),
          status: "sent",
        },
      ],
    }));
  };

  const sendVoiceNote = async (transcript: string) => {
    if (!processingAllowed()) return;
    if (!featureEntitlements.has(state.subscription.planId, "voiceNotes")) {
      setPlansOpen(true);
      return;
    }
    await sendMessage(transcript);
  };

  const sendVoiceRecording = async (
    audioBase64: string,
    contentType: string,
  ) => {
    if (!processingAllowed()) return;
    if (!featureEntitlements.has(state.subscription.planId, "voiceNotes")) {
      setPlansOpen(true);
      return;
    }
    const context = turns.current.begin();
    if (!context) throw new Error("Wait for the current message before sending a voice note.");
    setStreaming(true);
    let transcript = "";
    try {
      const transcription = liveMode
        ? await companionApi.transcribe(audioBase64, contentType)
        : await companionApi.edgeTranscribe(audioBase64, contentType, context.signal);
      assertTurnActive(context);
      transcript = transcription.text.trim();
      if (!transcript) throw new Error("I couldn’t hear words in that voice note.");
    } finally { turns.current.finish(context); if (!context.signal.aborted) setStreaming(false); }
    if (!context.signal.aborted) await sendMessage(transcript);
  };

  const speakWithProvider = async (content: string) => {
    if (!processingAllowed()) return;
    playCompanionSpeech(content, { onError: setActionError });
  };

  const uploadImage = async (file: File) => {
    if (!processingAllowed()) return;
    if (!liveMode) throw new Error("Private image upload and image understanding are unavailable in this beta. Describe the image in a message instead.");
    if (!file.type.match(/^image\/(jpeg|png|webp)$/))
      throw new Error("Choose a JPEG, PNG, or WebP image.");
    if (file.size > 8_000_000)
      throw new Error("Choose an image smaller than 8 MB.");
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    if (liveMode) {
      const dataBase64 = dataUrl.split(",")[1] ?? "";
      const [asset, analysis] = await Promise.all([
        companionApi.uploadImage(file.name, file.type, dataBase64),
        companionApi.analyzeImage(
          dataBase64,
          file.type,
          "Describe what is visible and respond naturally to the person who shared it.",
        ),
      ]);
      const now = new Date().toISOString();
      setState((current) => ({
        ...current,
        mediaLibrary: [
          ...current.mediaLibrary,
          {
            id: asset.id,
            type: "image",
            name: file.name,
            url: asset.url,
            createdAt: now,
          },
        ],
        photos: [
          {
            id: asset.id,
            imageUrl: asset.url,
            caption: file.name,
            createdAt: now,
            kind: "shared",
          },
          ...current.photos,
        ],
        messages: [
          ...current.messages,
          {
            id: crypto.randomUUID(),
            conversationId: current.activeConversationId,
            role: "user",
            content: "Look at this.",
            createdAt: now,
            status: "sent",
            attachments: [
              { id: asset.id, type: "image", url: asset.url, name: file.name },
            ],
          },
          {
            id: crypto.randomUUID(),
            conversationId: current.activeConversationId,
            role: "assistant",
            content: analysis.description,
            createdAt: new Date().toISOString(),
            status: "sent",
          },
        ],
      }));
      return;
    }
  };

  const generateImage = async (prompt: string) => {
    if (!processingAllowed()) return;
    if (!liveMode) throw new Error("Image generation is not available in this beta. Existing companion images are preselected artwork, not newly generated photos.");
    if (
      !featureEntitlements.has(state.subscription.planId, "imageGeneration")
    ) {
      setPlansOpen(true);
      return;
    }
    if (liveMode) {
      const result = await companionApi.generateImage(
        prompt,
        `${state.companion.name}, ${state.companion.presentation}, original stylized-realistic 3D companion`,
      );
      const imageUrl = result.artifactBase64
        ? `data:${result.contentType};base64,${result.artifactBase64}`
        : result.assetUrl;
      const now = new Date().toISOString();
      const attachmentId = crypto.randomUUID();
      setState((current) => ({
        ...current,
        mediaLibrary: [
          {
            id: attachmentId,
            type: "generated-image",
            name: prompt,
            url: imageUrl,
            createdAt: now,
          },
          ...current.mediaLibrary,
        ],
        photos: [
          {
            id: attachmentId,
            imageUrl,
            caption: prompt,
            createdAt: now,
            kind: "selfie",
          },
          ...current.photos,
        ],
        messages: [
          ...current.messages,
          {
            id: crypto.randomUUID(),
            conversationId: current.activeConversationId,
            role: "assistant",
            content: `I made this for you—“${prompt}.”`,
            createdAt: now,
            status: "sent",
            attachments: [
              {
                id: attachmentId,
                type: "generated-image",
                url: imageUrl,
                name: prompt,
              },
            ],
          },
        ],
      }));
      return;
    }
  };

  const addSelfie = () => {
    if (!processingAllowed()) return;
    if (!liveMode) { setActionError("AI selfies are unavailable in this beta. The gallery contains preselected artwork, not photos taken or generated for you."); return; }
    if (!featureEntitlements.has(state.subscription.planId, "aiSelfies")) {
      setPlansOpen(true);
      return;
    }
    if (liveMode) {
      runAction(
        generateImage(
          `A warm, candid selfie from ${state.companion.name} during a quiet coffee break, natural expression, private companion moment`,
        ).then(() => setMomentsTab("photos")),
        "The selfie could not be created.",
      );
      return;
    }
  };

  const recordFeedback = (
    messageId: string,
    feedback: "up" | "down",
    reason?: FeedbackReason,
  ) => {
    if (feedback === "down" && reason === "missed-what-i-said") trackEvent("reply_misunderstood");
    setState((current) => ({
      ...current,
      messages: current.messages.map((message) =>
        message.id === messageId ? { ...message, feedback } : message,
      ),
      feedbackSignals: [
        ...current.feedbackSignals,
        {
          id: crypto.randomUUID(),
          messageId,
          rating: feedback,
          ...(reason ? { reason } : {}),
          createdAt: new Date().toISOString(),
        },
      ],
      responsePreferences:
        feedback === "down"
          ? {
              ...current.responsePreferences,
              listeningFirst:
                reason === "wrong-tone"
                  ? current.responsePreferences.listeningFirst
                  : true,
              responseLength:
                reason === "too-scripted" || reason === "too-many-questions"
                  ? "short"
                  : current.responsePreferences.responseLength,
              adviceStyle: reason === "wrong-tone" ? "gentle" : "ask-first",
              questionFrequency:
                reason === "too-many-questions"
                  ? "rare"
                  : current.responsePreferences.questionFrequency,
            }
          : current.responsePreferences,
    }));
    if (liveMode)
      runAction(
        companionApi.feedback(
          state.activeConversationId,
          messageId,
          feedback,
          reason,
        ),
        "Your feedback could not be saved.",
      );
  };

  const regenerateResponse = async (messageId: string) => {
    if (!processingAllowed()) return;
    const source = previousUserMessage(
      state.messages,
      messageId,
      state.activeConversationId,
    );
    if (!source) return;
    if (liveMode) {
      const updated = await companionApi.regenerate(
        state.activeConversationId,
        messageId,
        state.memoryEnabled,
        state.responsePreferences,
      );
      setState((current) => ({
        ...current,
        messages: current.messages.map((message) =>
          message.id === messageId ? updated : message,
        ),
      }));
      return;
    }
    const activeMessages = messagesForConversation(
      state.messages,
      state.activeConversationId,
    );
    const sourceIndex = activeMessages.findIndex(
      (message) => message.id === source.id,
    );
    const context = turns.current.begin();
    if (!context) throw new Error("Wait for the current reply before regenerating.");
    setStreaming(true);
    try {
      await resolveConversationTurn(context, signal => generateDemoReply(activeMessages.slice(0, sourceIndex + 1), "text", signal), reply => {
        setState(current => context.signal.aborted ? current : { ...current, messages: current.messages.map(message => message.id === messageId ? { ...message, content: reply, status: "sent" } : message) });
      });
    } finally { turns.current.finish(context); if (!context.signal.aborted) setStreaming(false); }
  };

  const purchaseItem = async (
    item: StoreItemRecord,
  ): Promise<string | null> => {
    if (accountMode) return "Wardrobe purchases and reward balances are unavailable in this beta. Your current avatar and background remain available.";
    if (!canAccessItem(state.subscription.planId, item)) {
      setPlansOpen(true);
      return `${item.tierRequired[0]?.toUpperCase()}${item.tierRequired.slice(1)} is required for this item.`;
    }
    if (currencyBalance(item, state.wallet) < item.price)
      return `Not enough ${item.currency}. Try an activity together to earn more.`;
    if (liveMode) {
      const result = await companionApi.purchaseItem(item.id);
      setState((current) => ({
        ...current,
        wallet: result.wallet,
        ownedItems: current.ownedItems.some(
          (owned) => owned.itemId === result.owned.itemId,
        )
          ? current.ownedItems
          : [...current.ownedItems, result.owned],
      }));
      return null;
    }
    const now = new Date().toISOString();
    setState((current) => {
      if (current.ownedItems.some((owned) => owned.itemId === item.id))
        return current;
      const wallet =
        item.currency === "free"
          ? current.wallet
          : {
              ...current.wallet,
              [item.currency]: current.wallet[item.currency] - item.price,
            };
      const transactions =
        item.currency === "free"
          ? current.walletTransactions
          : [
              ...current.walletTransactions,
              {
                id: crypto.randomUUID(),
                userId: current.user.id,
                type: "purchase" as const,
                currency: item.currency,
                amount: -item.price,
                balanceAfter: wallet[item.currency],
                referenceId: item.id,
                idempotencyKey: `web:${item.id}:${now}`,
                createdAt: now,
              },
            ];
      return {
        ...current,
        wallet,
        walletTransactions: transactions,
        ownedItems: [
          ...current.ownedItems,
          { itemId: item.id, purchasedAt: now, equipped: false },
        ],
      };
    });
    return null;
  };

  const equipItem = async (item: StoreItemRecord) => {
    if (accountMode) throw new Error("Wardrobe item changes are unavailable in this beta. Avatar appearance stays fixed.");
    const liveOwnedItems = liveMode
      ? await companionApi.equipItem(item.id)
      : null;
    setState((current) => {
      const environment = environmentForItem(item) as EnvironmentId | null;
      return {
        ...current,
        ...(environment ? { activeEnvironment: environment } : {}),
        ownedItems:
          liveOwnedItems ??
          current.ownedItems.map((owned) => {
            const ownedItem = current.storeItems.find(
              (candidate) => candidate.id === owned.itemId,
            );
            return ownedItem?.metadata.slot === item.metadata.slot
              ? { ...owned, equipped: owned.itemId === item.id }
              : owned;
          }),
      };
    });
  };

  const choosePlan = async (planId: PlanId) => {
    const subscription = liveMode
      ? (await companionApi.mockUpgrade(planId)).subscription
      : {
          planId,
          status: "active" as const,
          testMode: true,
          renewsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        };
    setState((current) => ({ ...current, subscription }));
    setPlansOpen(false);
  };

  const addJournal = async (entry: {
    title: string;
    content: string;
    mood: CompanionMood;
  }) => {
    const created = liveMode
      ? await companionApi.addJournal(entry)
      : {
          id: crypto.randomUUID(),
          userId: state.user.id,
          ...entry,
          tags: [],
          reflected: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
    setState((current) => ({
      ...current,
      journalEntries: [created, ...current.journalEntries],
    }));
  };
  const deleteJournal = async (entryId: string) => {
    if (liveMode) await companionApi.deleteJournal(entryId);
    setState((current) => ({
      ...current,
      journalEntries: current.journalEntries.filter(
        (entry) => entry.id !== entryId,
      ),
    }));
  };
  const reflectOnJournal = async (
    entry: DemoState["journalEntries"][number],
  ) => {
    if (!liveMode) throw new Error("AI journal reflections are unavailable in this beta. You can save a journal entry or share selected text in chat yourself.");
    const reflection = liveMode
      ? (await companionApi.reflectJournal(entry.id)).reflection
      : `I notice ${entry.mood} energy in “${entry.title}.” What part would you like me to sit with?`;
    setState((current) => ({
      ...current,
      currentView: "chat",
      journalEntries: current.journalEntries.map((candidate) =>
        candidate.id === entry.id
          ? {
              ...candidate,
              reflected: true,
              updatedAt: new Date().toISOString(),
            }
          : candidate,
      ),
      messages: [
        ...current.messages,
        {
          id: crypto.randomUUID(),
          conversationId: current.activeConversationId,
          role: "assistant",
          content: reflection,
          createdAt: new Date().toISOString(),
          status: "sent",
        },
      ],
    }));
  };
  const addFutureEvent = async (event: {
    description: string;
    eventDate: string;
  }) => {
    if (liveMode) {
      const result = await companionApi.addEvent(
        event.description,
        event.eventDate,
      );
      setState((current) => ({
        ...current,
        futureEvents: [result.event, ...current.futureEvents],
        nudges: result.nudge
          ? [result.nudge, ...current.nudges]
          : current.nudges,
      }));
      return;
    }
    setState((current) => {
      const eventId = crypto.randomUUID();
      const scheduled = new Date(
        new Date(event.eventDate).getTime() - 3_600_000,
      );
      if (scheduled.getHours() >= 22 || scheduled.getHours() < 8)
        scheduled.setHours(8, 0, 0, 0);
      return {
        ...current,
        futureEvents: [
          {
            id: eventId,
            userId: current.user.id,
            companionId: current.companion.id,
            ...event,
            status: "confirmed",
            createdAt: new Date().toISOString(),
          },
          ...current.futureEvents,
        ],
        nudges: current.nudges,
      };
    });
  };
  const accountConversation = async (command: Parameters<typeof accountClient.conversation>[0]) => {
    const sync = accountSync.current;
    if (!sync) throw new Error("The account is still loading.");
    if (accountSyncTimer.current !== null) window.clearTimeout(accountSyncTimer.current);
    sync.enqueue(stateRef.current); await sync.flush();
    const result = await accountClient.conversation(command, sync.revision);
    sync.revision = result.revision;
    setState(current => ({ ...current, activeConversationId: result.state.activeConversationId, messages: result.state.messages }));
  };

  const loadOlderMessages = async () => {
    if (olderBusy || olderComplete || !accountMode) return;
    const conversationId = state.activeConversationId;
    const oldest = [...olderMessages, ...state.messages].filter(message => message.conversationId === conversationId).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0];
    setOlderBusy(true);
    try {
      const page = await accountClient.messages(olderCursor ?? (oldest ? JSON.stringify([oldest.createdAt, oldest.id]) : undefined), conversationId);
      if (stateRef.current.activeConversationId !== conversationId) return;
      setOlderMessages(current => appendUniqueMessages(page.messages, current));
      setOlderCursor(page.cursor); setOlderComplete(!page.cursor);
    } finally { setOlderBusy(false); }
  };

  const accountMemory = async (command: Parameters<typeof accountClient.memory>[0]) => {
    const sync = accountSync.current;
    if (!sync) throw new Error("The account is still loading.");
    if (accountSyncTimer.current !== null) window.clearTimeout(accountSyncTimer.current);
    sync.enqueue(stateRef.current);
    await sync.flush();
    const result = await accountClient.memory(command, sync.revision);
    sync.revision = result.revision;
    setState(current => ({ ...current, memories: result.state.memories }));
  };

  const updateMemory = async (updated: MemoryRecord) => {
    if (accountMode) { await accountMemory({ action: "edit", id: updated.id, content: updated.content, pinned: updated.pinned }); return; }
    const saved = liveMode
      ? await companionApi.updateMemory(updated.id, {
          content: updated.content,
          pinned: updated.pinned,
          status: updated.status,
        })
      : updated;
    setState((current) => ({
      ...current,
      memories: current.memories.map((memory) =>
        memory.id === saved.id ? saved : memory,
      ),
    }));
  };
  const deleteMemory = async (memoryId: string) => {
    turns.current.cancel(); stopCompanionSpeech(); setStreaming(false); setVoiceCallOpen(false); setVideoCallOpen(false);
    if (accountMode) { await accountMemory({ action: "forget", id: memoryId }); return; }
    if (liveMode) await companionApi.deleteMemory(memoryId);
    setState((current) => ({
      ...current,
      memories: current.memories.filter(memory => memory.id !== memoryId),
    }));
  };
  const addMemory = async (content: string, type: MemoryType) => {
    if (accountMode) { await accountMemory({ action: "create", content, type }); return; }
    const now = new Date().toISOString();
    const memory = liveMode
      ? await companionApi.createMemory(state.companion.id, type, content)
      : {
          id: crypto.randomUUID(),
          userId: state.user.id,
          companionId: state.companion.id,
          type,
          content,
          normalizedContent: content.toLowerCase(),
          importance: 0.8,
          confidence: 1,
          sourceMessageIds: [],
          createdAt: now,
          updatedAt: now,
          retrievalCount: 0,
          status: "active" as const,
          pinned: false,
        };
    setState((current) => ({
      ...current,
      memories: [...current.memories, memory],
    }));
  };

  const completeActivity = async (activity: ActivityDefinition) => {
    if (state.completedActivityIds.includes(activity.id)) return;
    const liveWallet = liveMode
      ? await companionApi.completeActivity(activity.id)
      : null;
    setState((current) => {
      if (current.completedActivityIds.includes(activity.id)) return current;
      const xp = current.wallet.xp + activity.xp;
      const coins = current.wallet.coins + activity.coinReward;
      const completedAt = new Date().toISOString();
      return {
        ...current,
        currentView: "chat",
        completedActivityIds: [...current.completedActivityIds, activity.id],
        wallet: liveWallet ?? (accountMode ? current.wallet : {
          ...current.wallet,
          xp,
          level: Math.max(current.wallet.level, Math.floor(xp / 100) + 1),
          coins,
        }),
        walletTransactions: liveMode || accountMode
          ? current.walletTransactions
          : [
              ...current.walletTransactions,
              {
                id: crypto.randomUUID(),
                userId: current.user.id,
                type: "earn",
                currency: "xp",
                amount: activity.xp,
                balanceAfter: xp,
                referenceId: activity.id,
                idempotencyKey: `activity:${activity.id}:xp`,
                createdAt: completedAt,
              },
              {
                id: crypto.randomUUID(),
                userId: current.user.id,
                type: "earn",
                currency: "coins",
                amount: activity.coinReward,
                balanceAfter: coins,
                referenceId: activity.id,
                idempotencyKey: `activity:${activity.id}:coins`,
                createdAt: completedAt,
              },
            ],
        messages: [
          ...current.messages,
          {
            id: crypto.randomUUID(),
            conversationId: current.activeConversationId,
            role: "assistant",
            content: `Activity card: “${activity.title}.” ${activity.description} Share a message when you’re ready to explore it.`,
            createdAt: completedAt,
            status: "sent",
          },
        ],
      };
    });
  };

  const startDate = (environment: EnvironmentId, title: string) => {
    const environmentItem = state.storeItems.find(
      (item) => environmentForItem(item) === environment,
    );
    if (
      environmentItem &&
      !state.ownedItems.some((owned) => owned.itemId === environmentItem.id)
    ) {
      setActionError(
        `Unlock ${environmentItem.name} in Companion before starting this date.`,
      );
      navigate("companion");
      return;
    }
    setState((current) => ({
      ...current,
      activeEnvironment: environment,
      messages: [
        ...current.messages,
        {
          id: crypto.randomUUID(),
          conversationId: current.activeConversationId,
          role: "assistant",
          content: `${title}. Give me one second to change the scene… okay, ready?`,
          createdAt: new Date().toISOString(),
          status: "sent",
        },
      ],
    }));
    setVideoCallOpen(true);
  };

  const finishCall = (type: "voice" | "video", durationSeconds: number) => {
    const now = new Date().toISOString();
    setState((current) => ({
      ...current,
      calls: [
        {
          id: crypto.randomUUID(),
          type,
          startedAt: now,
          durationSeconds,
          summary:
            type === "video"
              ? "A warm visual check-in with one shared activity."
              : "A quick voice check-in and a calm reset.",
        },
        ...current.calls,
      ],
      relationship: {
        ...current.relationship,
        progress: Math.min(100, current.relationship.progress + 3),
      },
    }));
    setVoiceCallOpen(false);
    setVideoCallOpen(false);
  };

  const openVoiceCall = () => {
    if (!processingAllowed()) return;
    if (turns.current.busy) { setActionError("Wait for the current reply before starting a call."); return; }
    if (!liveMode && !capabilities?.capabilities.voiceCall) { setActionError("Voice calls are unavailable for this session. Review processing consent or try again later."); return; }
    if (!featureEntitlements.has(state.subscription.planId, "voiceCalls"))
      setPlansOpen(true);
    else {
      trackEvent("voice_call_start");
      setVoiceCallOpen(true);
    }
  };
  const openVideoCall = () => {
    if (!processingAllowed()) return;
    if (turns.current.busy) { setActionError("Wait for the current reply before starting a call."); return; }
    if (!liveMode && !capabilities?.capabilities.videoCall) { setActionError("Avatar calls are unavailable for this session. Review processing consent or try again later."); return; }
    if (!featureEntitlements.has(state.subscription.planId, "videoCalls"))
      setPlansOpen(true);
    else {
      trackEvent("video_call_start");
      setVideoCallOpen(true);
    }
  };
  const analyzeSharedCallFrame = async (
    dataBase64: string,
    contentType: string,
  ) => {
    if (liveMode)
      return (
        await companionApi.analyzeImage(
          dataBase64,
          contentType,
          "React naturally to the single camera frame the user explicitly shared during a video call. Describe only visible, non-sensitive details and do not identify people.",
        )
      ).description;
    await pause(280);
    return "Camera-frame understanding is not available in this beta. You can describe what you want to show me, and we can talk about it.";
  };

  const replyDuringCall = (content: string, delivery: "voice" | "video", context: TurnContext) => {
    assertTurnActive(context);
    if (!stateRef.current.aiProcessingConsent) return Promise.reject(new Error("AI processing is paused."));
    if (liveMode) {
      let reply = "";
      return companionApi
        .streamChat(
          {
            conversationId: state.activeConversationId,
            companionId: state.companion.id,
            clientMessageId: context.turnId,
            content,
            memoryEnabled: state.memoryEnabled,
            responsePreferences: state.responsePreferences,
          },
          (delta) => {
            if (!context.signal.aborted) reply += delta;
          }, context.signal,
        )
        .then(() => reply);
    }
    const now = new Date();
    const userTurn: ChatMessage = {
      id: context.turnId,
      conversationId: state.activeConversationId,
      role: "user",
      content,
      createdAt: now.toISOString(),
      status: "sent",
    };
    const conversation = [
      ...messagesForConversation(state.messages, state.activeConversationId).filter(message => message.id !== context.turnId),
      userTurn,
    ];
    // Retain the user turn across a provider failure. A retry uses this same ID.
    setState(current => context.signal.aborted ? current : { ...current, messages: appendUniqueMessages(current.messages, [userTurn]) });
    return resolveConversationTurn(context, signal => generateDemoReply(conversation, delivery, signal), (reply) => {
      const assistantTurn: ChatMessage = {
        id: `${context.turnId}:reply`,
        conversationId: state.activeConversationId,
        role: "assistant",
        content: reply,
        createdAt: new Date(now.getTime() + 1).toISOString(),
        status: "sent",
      };
      setState((current) => context.signal.aborted || !current.aiProcessingConsent || current.activeConversationId !== userTurn.conversationId ? current : ({
        ...current,
        memories: accountMode ? current.memories : rememberConversationMessage(
          current,
          content,
          userTurn.id,
          now,
        ),
        messages: appendUniqueMessages(current.messages, [userTurn, assistantTurn]),
      }));
    });
  };

  const exportData = async (reauthenticated = false) => {
    if (accountMode && !reauthenticated) { setReauthAction("export"); return; }
    if (accountMode) { if (accountSyncTimer.current !== null) window.clearTimeout(accountSyncTimer.current); accountSync.current?.enqueue(stateRef.current); await accountSync.current?.flush(); }
    const payload = accountMode
      ? await accountClient.exportData()
      : liveMode
        ? await companionApi.exportData()
        : {
            exportedAt: new Date().toISOString(),
            source: "companaro-demo",
            ...state,
          };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = cloudBacked
      ? "companaro-account-export.json"
      : "companaro-demo-export.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const deleteDemo = async (reauthenticated = false) => {
    if (accountMode && !reauthenticated) { setReauthAction("delete"); return; }
    turns.current.cancel(); stopCompanionSpeech(); setStreaming(false); setVoiceCallOpen(false); setVideoCallOpen(false);
    if (accountMode) {
      await accountClient.deleteAccount();
      router.replace("/");
      return;
    }
    if (liveMode) {
      await companionApi.deleteAccount("DELETE");
      router.replace("/");
      return;
    }
    window.localStorage.removeItem(storageKey);
    setState(freshDemo());
    setLegacyDemo(false);
    setResetDemoOpen(false);
    trackEvent("demo_reset");
  };

  const logout = async () => {
    turns.current.cancel(); stopCompanionSpeech();
    if (accountMode) {
      if (accountSyncTimer.current !== null) window.clearTimeout(accountSyncTimer.current);
      accountSync.current?.enqueue(stateRef.current); await accountSync.current?.flush(); accountSync.current?.stop();
    }
    if (accountMode) await accountClient.logout();
    else await companionApi.logout();
    router.replace("/login");
  };

  if (!hydrated)
    return (
      <div className="app-loader">
        <span />
        <p>Opening Mira’s room…</p>
      </div>
    );
  if (hydrationError)
    return (
      <div className="app-loader">
        <p>{hydrationError}</p>
        <button
          type="button"
          className="button button--primary"
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
      </div>
    );
  if (!state.onboardingComplete)
    return <Onboarding onComplete={completeOnboarding} />;
  if (!state.firstMeetingComplete)
    return (
      <FirstMeeting
        userName={state.user.name}
        companionName={state.companion.name}
        onComplete={() =>
          setState((current) => ({ ...current, firstMeetingComplete: true }))
        }
      />
    );

  const renderView = () => {
    switch (state.currentView) {
      case "home":
        return (
          <HomeView
            state={state}
            onChat={() => navigate("chat")}
            onCall={openVoiceCall}
            onVideoCall={openVideoCall}
            onMoments={() => openMoments("moments")}
            onMemory={() => navigate("memory")}
            onCompanion={() => navigate("companion")}
            onSpendTime={() => openMoments("together")}
            onEnvironmentChange={(activeEnvironment) =>
              setState((current) => ({ ...current, activeEnvironment }))
            }
            onAmbienceChange={() =>
              setState((current) => ({
                ...current,
                ambienceEnabled: !current.ambienceEnabled,
              }))
            }
          />
        );
      case "chat":
        return (
          <ChatView
            state={olderMessages.length ? { ...state, messages: appendUniqueMessages(olderMessages, state.messages) } : state}
            {...(accountMode && !olderComplete ? { onLoadOlder: loadOlderMessages } : {})}
            loadingOlder={olderBusy}
            streaming={streaming}
            streamingText={streaming && state.aiProcessingConsent && streamDraft?.conversationId === state.activeConversationId ? streamDraft.text : ""}
            processingEnabled={state.aiProcessingConsent}
            liveMode={cloudBacked}
            onSend={sendMessage}
            onNewConversation={() =>
              runAction(
                newConversation(),
                "A new conversation could not be started.",
              )
            }
            onDeleteConversation={deleteConversation}
            onBack={() => navigate("home")}
            onCall={openVoiceCall}
            onVideoCall={openVideoCall}
            onVoiceNote={sendVoiceNote}
            onVoiceRecording={sendVoiceRecording}
            onSpeak={(content: string) =>
              speakWithProvider(content).catch((cause) =>
                setActionError(
                  cause instanceof Error
                    ? cause.message
                    : "Speech playback failed.",
                ),
              )
            }
            onImageUpload={uploadImage}
            onGenerateImage={generateImage}
            onFeedback={recordFeedback}
            onRegenerate={(messageId) =>
              runAction(
                regenerateResponse(messageId),
                "The response could not be regenerated.",
              )
            }
            onUpgrade={() => setPlansOpen(true)}
            onCamera={() => {
              if (!processingAllowed()) return;
              if (
                !featureEntitlements.has(
                  state.subscription.planId,
                  "cameraConversation",
                )
              )
                setPlansOpen(true);
              else setCameraOpen(true);
            }}
          />
        );
      case "moments":
        return (
          <MomentsView
            key={momentsTab}
            defaultTab={momentsTab}
            state={state}
            liveMode={cloudBacked}
            onCompleteActivity={(activity) =>
              runAction(
                completeActivity(activity),
                "The activity could not be completed.",
              )
            }
            onStartDate={startDate}
            onGenerateSelfie={addSelfie}
            onVideoCall={openVideoCall}
          />
        );
      case "companion":
        return (
          <CompanionView
            companion={state.companion}
            backstory={state.companionBackstory}
            storeItems={state.storeItems}
            ownedItems={state.ownedItems}
            wallet={state.wallet}
            subscription={state.subscription}
            onChange={changeCompanion}
            onBackstoryChange={(companionBackstory) =>
              setState((current) => ({ ...current, companionBackstory }))
            }
            onPurchase={purchaseItem}
            onEquip={equipItem}
            onUpgrade={() => setPlansOpen(true)}
          />
        );
      case "memory":
        return (
          <MemoryView
            memories={state.memories}
            enabled={state.memoryEnabled}
            companionName={state.companion.name}
            onToggle={() => {
              turns.current.cancel(); stopCompanionSpeech(); setStreaming(false); setVoiceCallOpen(false); setVideoCallOpen(false);
              if (!cloudBacked && state.aiProcessingConsent) runAction(createDemoSession(!state.memoryEnabled), "Memory consent could not be updated. Please retry.");
              setState((current) => ({
                ...current,
                memoryEnabled: !current.memoryEnabled,
              }));
            }}
            automatic={!accountMode}
            onUpdate={(memory) =>
              runAction(
                updateMemory(memory),
                "The memory could not be updated.",
              )
            }
            onDelete={(memoryId) =>
              runAction(
                deleteMemory(memoryId),
                "The memory could not be deleted.",
              )
            }
            onAdd={(content, type) =>
              runAction(
                addMemory(content, type),
                "The memory could not be added.",
              )
            }
          />
        );
      case "activities":
        return (
          <ActivitiesView
            reflectionEnabled={Boolean(capabilities?.capabilities.journalReflection)}
            activities={state.activities}
            completedIds={state.completedActivityIds}
            wallet={state.wallet}
            journalEntries={state.journalEntries}
            futureEvents={state.futureEvents}
            nudges={state.nudges}
            companionName={state.companion.name}
            liveMode={cloudBacked}
            onComplete={(activity) =>
              runAction(
                completeActivity(activity),
                "The activity could not be completed.",
              )
            }
            onAddJournal={(entry) =>
              runAction(
                addJournal(entry),
                "The journal entry could not be saved.",
              )
            }
            onDeleteJournal={(entryId) =>
              runAction(
                deleteJournal(entryId),
                "The journal entry could not be deleted.",
              )
            }
            onReflect={(entry) =>
              runAction(
                reflectOnJournal(entry),
                "The reflection could not be created.",
              )
            }
            onAddEvent={(event) =>
              runAction(
                addFutureEvent(event),
                "The future plan could not be saved.",
              )
            }
          />
        );
      case "profile":
        return (
          <ProfileView
            state={state}
            liveMode={cloudBacked}
            accountMode={accountMode}
            onChange={changeProfile}
            onExport={() =>
              runAction(exportData(), "Your data export could not be created.")
            }
            onDelete={() =>
              runAction(deleteDemo(), "Your account could not be deleted.")
            }
            {...(cloudBacked
              ? {
                  onLogout: () =>
                    runAction(logout(), "You could not be signed out."),
                }
              : {})}
            onUpgrade={() => setPlansOpen(true)}
            onOpenMemory={() => navigate("memory")}
            onOpenActivities={() => openMoments("together")}
          />
        );
    }
  };

  const appContent = (
    <>
      <AppShell
        active={state.currentView}
        onNavigate={navigate}
        onCall={openVoiceCall}
        companionName={state.companion.name}
        relationshipStage={state.relationship.stage}
        relationshipLevel={state.relationship.level}
        immersive={state.currentView === "home"}
      >
        {accountMode ? <aside className="account-sync-status" role="status" aria-live="polite">
          {syncStatus === "saved" ? "Saved to your account" : syncStatus === "saving" ? "Saving…" : syncStatus === "conflict" ? "Another tab changed this account. Your unsaved changes are kept only in this page; they have not overwritten the newer version." : syncStatus === "offline" ? "Offline. Unsaved changes stay in this page until reconnecting; do not close it." : "Changes could not be saved. Your unsaved work is still in this page."}
          {syncStatus === "failed" || syncStatus === "offline" ? <button type="button" className="button button--ghost" onClick={() => runAction(accountSync.current?.retry() ?? Promise.resolve(), "Account sync failed.")}>Retry save</button> : null}
          {syncStatus === "conflict" ? <button type="button" className="button button--ghost" onClick={() => { if (window.confirm("Discard this page’s unsaved changes and load the newer account version?")) window.location.reload(); }}>Discard unsaved changes and reload</button> : null}
        </aside> : null}
        {failedMessage && !streaming ? <aside className="account-sync-status" role="status">Your last message was not answered. <button type="button" className="button button--ghost" onClick={() => { setActionError(""); void sendMessage(failedMessage.content, failedMessage); }}>Retry last message</button></aside> : null}
        <span className="visually-hidden">Runtime: {runtime}</span>
        {legacyDemo ? (
          <aside className="demo-migration-notice" role="status">
            Your saved conversation is from an earlier Mira version. Old replies
            are history, not new responses.{" "}
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setResetDemoOpen(true)}
            >
              Reset demo
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setLegacyDemo(false)}
            >
              Keep history
            </button>
          </aside>
        ) : null}
        {renderView()}
        {!cloudBacked ? (
          <footer className="demo-migration-notice">
            <span>
              Private browser demo · <Link href="/privacy">Privacy</Link>
            </span>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setResetDemoOpen(true)}
            >
              Reset demo
            </button>
          </footer>
        ) : null}
      </AppShell>
      {reauthAction ? <Modal title="Confirm it’s you" description="Enter your account password to export or delete private account data." onClose={() => { setReauthAction(null); setReauthPassword(""); setReauthError(""); }}><form onSubmit={event => {
        event.preventDefault(); setReauthBusy(true); setReauthError("");
        void accountClient.reauthenticate(reauthPassword).then(async () => { setReauthPassword(""); if (reauthAction === "export") await exportData(true); else await deleteDemo(true); setReauthAction(null); }).catch(cause => setReauthError(cause instanceof Error ? cause.message : "Could not confirm your password.")).finally(() => setReauthBusy(false));
      }}><label className="field">Password<input autoFocus type="password" autoComplete="current-password" required value={reauthPassword} onChange={event => setReauthPassword(event.target.value)} /></label>{reauthError ? <p role="alert" className="form-error">{reauthError}</p> : null}<button className="button button--primary" disabled={reauthBusy}>{reauthBusy ? "Confirming…" : "Confirm and continue"}</button></form></Modal> : null}
      {resetDemoOpen ? (
        <Modal
          title="Reset this browser demo?"
          description="This removes local chats, memories and preferences. It does not delete an online account. Export first if you want to keep your history."
          onClose={() => setResetDemoOpen(false)}
        >
          <div className="modal-actions">
            <button
              className="button button--ghost"
              onClick={() => void exportData()}
            >
              Export first
            </button>
            <button
              className="button button--ghost"
              onClick={() => setResetDemoOpen(false)}
            >
              Cancel
            </button>
            <button
              className="button button--danger"
              onClick={() => void deleteDemo()}
            >
              Reset demo
            </button>
          </div>
        </Modal>
      ) : null}
      <Suspense fallback={<div role="status" className="account-sync-status">Opening call…</div>}>{voiceCallOpen ? (
        <VoiceCallModal
          companionName={state.companion.name}
          userName={state.user.name}
          onUserTurn={(content, context) => replyDuringCall(content, "voice", context)}
          onClose={(seconds) => finishCall("voice", seconds)}
        />
      ) : null}
      {videoCallOpen ? (
        <VideoCallModal
          companionName={state.companion.name}
          userName={state.user.name}
          initialEnvironment={state.activeEnvironment}
          onUserTurn={(content, context) => replyDuringCall(content, "video", context)}
          frameUnderstanding={Boolean(capabilities?.capabilities.imageUnderstanding)}
          onAnalyzeFrame={analyzeSharedCallFrame}
          onClose={(seconds) => finishCall("video", seconds)}
        />
      ) : null}</Suspense>
      {cameraOpen ? (
        <CameraConversationModal
          companionName={state.companion.name}
          onSessionStart={
            liveMode
              ? companionApi.startCameraSession
              : async () => ({ mock: true })
          }
          onAnalyzeFrame={
            liveMode
              ? async (dataBase64: string, contentType: string) =>
                  (
                    await companionApi.analyzeImage(
                      dataBase64,
                      contentType,
                      "Discuss the visible object or surroundings naturally and safely.",
                    )
                  ).description
              : async () => {
                  return "Camera-frame understanding is not available in this beta. You can describe what you want to show me, and we can talk about it.";
                }
          }
          onClose={() => setCameraOpen(false)}
        />
      ) : null}
      {plansOpen ? (
        <PlanModal
          current={state.subscription.planId}
          onSelect={(planId) =>
            runAction(choosePlan(planId), "The plan could not be changed.")
          }
          onClose={() => setPlansOpen(false)}
        />
      ) : null}
      {processingNoticeOpen ? (
        <Modal
          title="Review AI processing and access"
          description="Mira is an AI companion for adults 18+. Messages and voice input are sent to the disclosed providers. Agree to the current policy before enabling AI features."
          onClose={() => setProcessingNoticeOpen(false)}
        >
          <label className="toggle-line"><span>I declare that I am 18 or older, accept the <Link href="/terms" target="_blank">Terms</Link> and <Link href="/privacy" target="_blank">Privacy Policy</Link>, and consent to AI processing.</span><input type="checkbox" checked={policyConfirmed} onChange={event => setPolicyConfirmed(event.target.checked)} /></label>
          <div className="modal-actions">
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setProcessingNoticeOpen(false)}
            >
              Keep paused
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={!policyConfirmed}
              onClick={() => {
                runAction((async () => {
                  if (!cloudBacked) await createDemoSession(state.memoryEnabled);
                  if (accountMode) {
                    const sync = accountSync.current;
                    if (!sync) throw new Error("Account is still loading.");
                    if (accountSyncTimer.current !== null) window.clearTimeout(accountSyncTimer.current);
                    await sync.flush();
                    const result = await accountClient.acceptPolicy({ termsVersion: "2026-09-13", adultConfirmed: true, aiProcessingConsent: true, memoryEnabled: state.memoryEnabled, conversationStorageEnabled: state.conversationStorageEnabled }, sync.revision);
                    sync.revision = result.revision;
                    setState(result.state);
                  } else setState((current) => ({ ...current, aiProcessingConsent: true }));
                  if (!liveMode) setCapabilities(await fetchCapabilities());
                  setProcessingNoticeOpen(false);
                  setPolicyConfirmed(false);
                })(), "Processing could not be enabled. Please retry.");
              }}
            >
              Enable AI features
            </button>
          </div>
        </Modal>
      ) : null}
      {actionError ? (
        <Modal
          title="That didn’t work"
          description={actionError}
          onClose={() => setActionError("")}
        >
          <button
            type="button"
            className="button button--primary"
            onClick={() => setActionError("")}
          >
            Okay
          </button>
        </Modal>
      ) : null}
    </>
  );
  return forceDemo ? <AdultDemoGate onAccess={setCapabilities} onConsent={memoryEnabled => setState(current => ({ ...current, aiProcessingConsent: true, memoryEnabled }))}>{appContent}</AdultDemoGate> : appContent;
}
