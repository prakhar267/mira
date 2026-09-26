// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useLayoutEffect, type ComponentProps, type ReactNode } from "react";
import {
  viewState,
  memoryFixture,
  dialogSupport,
} from "../tests/ui-test-helpers";
import { storageKey, type DemoState } from "@/lib/state";
import { serializeDemo } from "@/lib/demo-storage";
import { CompanionApp } from "./CompanionApp";
import { companionApi } from "@/lib/api-client";
import { accountClient } from "@/lib/account-client";
import { playCompanionSpeech } from "@/lib/speech";
import type { CapabilityContract } from "@/lib/runtime-capabilities";
import type { TurnContext } from "@/lib/conversation-turn";
const harness = vi.hoisted(() => ({
  props: new Map<string, unknown>(),
  state: null as DemoState | null,
  router: { replace: vi.fn(), push: vi.fn() },
}));
vi.mock("next/navigation", () => ({ useRouter: () => harness.router }));
vi.mock("next/link", () => ({
  default: (p: Record<string, unknown>) => <a {...p} />,
}));
vi.mock("@/lib/speech", () => ({
  playCompanionSpeech: vi.fn(),
  stopCompanionSpeech: vi.fn(),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/api-client", async (original) => {
  const m = await original<typeof import("@/lib/api-client")>();
  return {
    companionApi: Object.fromEntries(
      Object.entries(m.companionApi).map(([key, value]) => [
        key,
        typeof value === "function" ? vi.fn() : value,
      ]),
    ),
  };
});
vi.mock("@/lib/account-client", async (original) => {
  const m = await original<typeof import("@/lib/account-client")>();
  return {
    accountClient: Object.fromEntries(
      Object.keys(m.accountClient).map((key) => [key, vi.fn()]),
    ),
  };
});
function Capture({
  name,
  data,
}: {
  name: string;
  data: Record<string, unknown>;
}) {
  useLayoutEffect(() => {
    harness.props.set(name, data);
    if (data.state) harness.state = data.state as DemoState;
  });
  return (
    <section data-testid={name}>
      {data.children as ReactNode}
      {data.reminderPanel as ReactNode}
      {data.reflectionPanel as ReactNode}
    </section>
  );
}
vi.mock("./AppShell", () => ({
  AppShell: (p: Record<string, unknown>) => (
    <Capture name="AppShell" data={p} />
  ),
}));
vi.mock("./HomeView", () => ({
  HomeView: (p: Record<string, unknown>) => (
    <Capture name="HomeView" data={p} />
  ),
}));
vi.mock("./ChatView", () => ({
  ChatView: (p: Record<string, unknown>) => (
    <Capture name="ChatView" data={p} />
  ),
}));
vi.mock("./CompanionView", () => ({
  CompanionView: (p: Record<string, unknown>) => (
    <Capture name="CompanionView" data={p} />
  ),
}));
vi.mock("./ProfileView", () => ({
  ProfileView: (p: Record<string, unknown>) => (
    <Capture name="ProfileView" data={p} />
  ),
}));
vi.mock("./MemoryView", () => ({
  MemoryView: (p: Record<string, unknown>) => (
    <Capture name="MemoryView" data={p} />
  ),
}));
vi.mock("./ActivitiesView", () => ({
  ActivitiesView: (p: Record<string, unknown>) => (
    <Capture name="ActivitiesView" data={p} />
  ),
}));
vi.mock("./MomentsView", () => ({
  MomentsView: (p: Record<string, unknown>) => (
    <Capture name="MomentsView" data={p} />
  ),
}));
vi.mock("./Onboarding", () => ({
  Onboarding: (p: Record<string, unknown>) => (
    <Capture name="Onboarding" data={p} />
  ),
}));
vi.mock("./FirstMeeting", () => ({
  FirstMeeting: (p: Record<string, unknown>) => (
    <Capture name="FirstMeeting" data={p} />
  ),
}));
vi.mock("./AdultDemoGate", () => ({
  AdultDemoGate: (p: Record<string, unknown>) => (
    <Capture name="AdultDemoGate" data={p} />
  ),
}));
vi.mock("./VoiceCallModal", () => ({
  VoiceCallModal: (p: Record<string, unknown>) => (
    <Capture name="VoiceCallModal" data={p} />
  ),
}));
vi.mock("./VideoCallModal", () => ({
  VideoCallModal: (p: Record<string, unknown>) => (
    <Capture name="VideoCallModal" data={p} />
  ),
}));
vi.mock("./CameraConversationModal", () => ({
  CameraConversationModal: (p: Record<string, unknown>) => (
    <Capture name="CameraConversationModal" data={p} />
  ),
}));
vi.mock("./ReminderSettings", () => ({
  ReminderSettings: (p: Record<string, unknown>) => (
    <Capture name="ReminderSettings" data={p} />
  ),
}));
vi.mock("./WeeklyReflection", () => ({
  WeeklyReflection: (p: Record<string, unknown>) => (
    <Capture name="WeeklyReflection" data={p} />
  ),
}));
type Views = {
  AppShell: typeof import("./AppShell").AppShell;
  HomeView: typeof import("./HomeView").HomeView;
  ChatView: typeof import("./ChatView").ChatView;
  CompanionView: typeof import("./CompanionView").CompanionView;
  ProfileView: typeof import("./ProfileView").ProfileView;
  MemoryView: typeof import("./MemoryView").MemoryView;
  ActivitiesView: typeof import("./ActivitiesView").ActivitiesView;
  MomentsView: typeof import("./MomentsView").MomentsView;
  Onboarding: typeof import("./Onboarding").Onboarding;
  FirstMeeting: typeof import("./FirstMeeting").FirstMeeting;
  AdultDemoGate: typeof import("./AdultDemoGate").AdultDemoGate;
  VoiceCallModal: typeof import("./VoiceCallModal").VoiceCallModal;
  VideoCallModal: typeof import("./VideoCallModal").VideoCallModal;
  CameraConversationModal: typeof import("./CameraConversationModal").CameraConversationModal;
  ReminderSettings: typeof import("./ReminderSettings").ReminderSettings;
  WeeklyReflection: typeof import("./WeeklyReflection").WeeklyReflection;
};
const cp = <K extends keyof Views>(name: K) =>
  harness.props.get(name) as ComponentProps<Views[K]>;
const current = () => harness.state!;
const run = async (fn: () => unknown) => {
  await act(async () => {
    await fn();
  });
};
const nav = async (view: DemoState["currentView"]) =>
  run(() => cp("AppShell").onNavigate(view));
const click = async (name: string | RegExp) =>
  run(() => fireEvent.click(screen.getByRole("button", { name })));
function capabilities(): CapabilityContract {
  return {
    runtime: "cloudflare",
    mode: "demo",
    capabilities: {
      chat: true,
      transcription: true,
      speech: true,
      voiceCall: true,
      videoCall: true,
      memoryRetrieval: true,
      imageUpload: false,
      imageGeneration: false,
      imageUnderstanding: false,
      journalReflection: true,
      scheduledNotifications: true,
      billing: false,
    },
    voice: { name: "Priya", customization: true },
  };
}
let caps: CapabilityContract, seed: DemoState;
async function demo(overrides: Partial<DemoState> = {}) {
  seed = viewState(overrides);
  localStorage.setItem(storageKey, serializeDemo(seed));
  const view = render(<CompanionApp forceDemo />);
  await screen.findByTestId("AppShell");
  await run(() => Promise.resolve());
  return view;
}
async function account(overrides: Partial<DemoState> = {}) {
  seed = viewState(overrides);
  vi.mocked(accountClient.load).mockResolvedValue({
    state: seed,
    revision: 4,
    policy: { termsVersion: "2026-09-13" },
  } as never);
  const view = render(<CompanionApp productionAccount />);
  await screen.findByTestId(
    overrides.firstMeetingComplete === false ? "FirstMeeting" : "AppShell",
  );
  await run(() => Promise.resolve());
  return view;
}
const context = (id = "call-turn"): TurnContext => ({
  turnId: id,
  signal: new AbortController().signal,
});
beforeEach(() => {
  vi.resetAllMocks();
  harness.props.clear();
  harness.state = null;
  dialogSupport();
  localStorage.clear();
  window.history.replaceState(null, "", "/demo");
  HTMLElement.prototype.scrollTo = vi.fn();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: new EventTarget(),
  });
  caps = capabilities();
  Object.defineProperty(companionApi, "enabled", {
    configurable: true,
    value: false,
  });
  vi.mocked(companionApi.demoReply).mockImplementation(
    async (_input, _signal, delta) => {
      delta?.("A thoughtful ");
      delta?.("reply.");
      return "A thoughtful reply.";
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url === "/api/billing/status"
        ? Response.json({ enabled: false })
        : Response.json(caps),
    ),
  );
  vi.mocked(accountClient.save).mockImplementation(async (state, revision) => ({
    state,
    revision: revision + 1,
    saved: true as const,
  }));
  vi.mocked(accountClient.reauthenticate).mockResolvedValue({
    ok: true,
  } as never);
  vi.mocked(accountClient.exportData).mockResolvedValue({ state: {} } as never);
  vi.mocked(accountClient.deleteAccount).mockResolvedValue({
    ok: true,
  } as never);
  vi.mocked(accountClient.logout).mockResolvedValue({ ok: true } as never);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    () => undefined,
  );
  URL.createObjectURL = vi.fn(() => "blob:qa");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("local app orchestration", () => {
  it("navigates all views and persists consent, preferences and companion edits", async () => {
    await demo();
    await run(() => cp("HomeView").onAmbienceChange());
    expect(current().ambienceEnabled).toBe(!seed.ambienceEnabled);
    await run(() => cp("HomeView").onEnvironmentChange("rainy-cafe"));
    expect(current().activeEnvironment).toBe("rainy-cafe");
    await run(() => cp("HomeView").onMoments());
    expect(cp("MomentsView").defaultTab).toBe("moments");
    await nav("home");
    await run(() => cp("HomeView").onSpendTime());
    expect(cp("MomentsView").defaultTab).toBe("together");
    await run(() => cp("MomentsView").onOpenActivities());
    expect(screen.getByTestId("ActivitiesView")).toBeTruthy();
    await nav("home");
    await run(() => cp("HomeView").onCompanion());
    await run(() =>
      cp("CompanionView").onChange({
        ...cp("CompanionView").companion,
        name: "Mira QA",
      }),
    );
    await run(() => cp("CompanionView").onBackstoryChange("Enjoys sketching"));
    await nav("home");
    expect(current().companion.name).toBe("Mira QA");
    expect(current().companionBackstory).toBe("Enjoys sketching");
    await run(() => cp("HomeView").onMemory());
    await run(() => cp("MemoryView").onToggle());
    expect(cp("MemoryView").enabled).toBe(false);
    await run(() => cp("MemoryView").onToggle());
    await nav("profile");
    await run(() =>
      cp("ProfileView").onChange({
        ...current(),
        theme: "dark",
        memoryEnabled: false,
        aiProcessingConsent: false,
        relationship: { ...current().relationship, romanticOptIn: true },
      }),
    );
    expect(current().companion.relationshipMode).toBe("romantic");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(fetch).toHaveBeenCalledWith(
      "/api/demo/session",
      expect.objectContaining({ method: "DELETE" }),
    );
    await run(() =>
      cp("ProfileView").onChange({
        ...current(),
        aiProcessingConsent: true,
        memoryEnabled: true,
        relationship: { ...current().relationship, romanticOptIn: false },
      }),
    );
    expect(current().companion.relationshipMode).toBe("friend");
    await run(() => cp("ProfileView").onOpenMemory());
    await nav("profile");
    await run(() => cp("ProfileView").onOpenActivities());
    expect(cp("MomentsView").defaultTab).toBe("together");
    await nav("profile");
    await run(() => cp("ProfileView").onExport());
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:qa");
    expect(localStorage.getItem(storageKey)).toContain("Mira QA");
  });
  it("commits only complete chat replies, learns safe memories, retries without duplicating and supports regeneration", async () => {
    await demo({ currentView: "chat" });
    await run(() => cp("ChatView").onSend("I like drawing."));
    expect(current().messages).toHaveLength(2);
    expect(current().memories.length).toBeGreaterThan(0);
    expect(current().messages.at(-1)!.content).toBe("A thoughtful reply.");
    const original = current().messages.at(-1)!;
    await run(() => cp("ChatView").onRegenerate(original.id));
    expect(current().messages).toHaveLength(2);
    await run(() => cp("ChatView").onRegenerate("missing"));
    for (const reason of [
      "too-scripted",
      "too-many-questions",
      "wrong-tone",
      "missed-what-i-said",
    ] as const)
      await run(() => cp("ChatView").onFeedback(original.id, "down", reason));
    await run(() => cp("ChatView").onFeedback(original.id, "up"));
    expect(current().responsePreferences.questionFrequency).toBe("rare");
    expect(current().feedbackSignals).toHaveLength(5);
    vi.mocked(companionApi.demoReply).mockRejectedValueOnce(
      Error("Provider unavailable"),
    );
    await run(() => cp("ChatView").onSend("Remember a quiet morning"));
    expect(current().messages.at(-1)!.status).toBe("failed");
    await click("Okay");
    const failedId = current().messages.at(-1)!.id;
    await click("Retry last message");
    expect(current().messages.filter((m) => m.id === failedId)).toHaveLength(1);
    expect(current().messages.at(-1)!.id).toBe(`${failedId}:reply`);
    await run(() => cp("ChatView").onSpeak?.("Read this"));
    expect(playCompanionSpeech).toHaveBeenCalledWith(
      "Read this",
      expect.objectContaining({ voiceId: seed.companion.voiceId }),
    );
    await run(() => cp("ChatView").onBack());
    expect(current().currentView).toBe("home");
    await run(() => cp("HomeView").onChat());
    await run(() => cp("ChatView").onNewConversation());
    const newId = current().activeConversationId;
    expect(newId).not.toBe(seed.activeConversationId);
    expect(current().messages.at(-1)!.content).toContain("Fresh chat");
    await run(() => cp("ChatView").onDeleteConversation());
    expect(current().messages.some((m) => m.conversationId === newId)).toBe(
      false,
    );
  });
  it("cancels an in-flight reply when navigating and retains no incomplete response", async () => {
    let finish!: (text: string) => void;
    let signal!: AbortSignal;
    vi.mocked(companionApi.demoReply).mockImplementationOnce(
      async (_input, s, delta) => {
        signal = s!;
        delta?.("Unsaved partial");
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    );
    await demo({ currentView: "chat" });
    let pending!: Promise<void>;
    await run(() => {
      pending = cp("ChatView").onSend("A question");
    });
    expect(cp("ChatView").streamingText).toBe("Unsaved partial");
    expect(localStorage.getItem(storageKey)).not.toContain("Unsaved partial");
    await run(() => cp("ChatView").onCall());
    expect(screen.getByText(/Wait for the current reply/)).toBeTruthy();
    await click("Okay");
    await nav("home");
    expect(signal.aborted).toBe(true);
    await run(async () => {
      finish("Late answer");
      await pending;
    });
    expect(current().messages.some((m) => m.content === "Late answer")).toBe(
      false,
    );
  });
  it("requires processing consent and handles capability limitations without opening calls", async () => {
    await demo({ currentView: "chat", aiProcessingConsent: false });
    await run(() => cp("ChatView").onSend("No consent"));
    expect(companionApi.demoReply).not.toHaveBeenCalled();
    await click("Keep paused");
    await run(() => cp("ChatView").onCall());
    await click("Close dialog");
    await run(() => cp("ChatView").onVideoCall());
    expect(
      (
        screen.getByRole("button", {
          name: "Enable AI features",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await run(() => fireEvent.click(screen.getByRole("checkbox")));
    await click("Enable AI features");
    expect(current().aiProcessingConsent).toBe(true);
    caps.capabilities.voiceCall = false;
    caps.capabilities.videoCall = false;
    await run(() => window.dispatchEvent(new Event("focus")));
    await run(() => cp("ChatView").onCall());
    expect(screen.getByText(/Voice calls are unavailable/)).toBeTruthy();
    await click("Okay");
    await run(() => cp("ChatView").onVideoCall());
    expect(screen.getByText(/Avatar calls are unavailable/)).toBeTruthy();
    await click("Close dialog");
  });
  it("creates, edits and deletes explicit memories and cascades journal reflection deletion", async () => {
    await demo({ currentView: "memory" });
    await run(() => cp("MemoryView").onAdd("A drawing goal", "goal"));
    const memory = cp("MemoryView").memories[0]!;
    expect(memory.content).toBe("A drawing goal");
    await run(() =>
      cp("MemoryView").onUpdate({
        ...memory,
        content: "Updated drawing goal",
        pinned: true,
      }),
    );
    expect(cp("MemoryView").memories[0]!.pinned).toBe(true);
    await run(() => cp("MemoryView").onDelete(memory.id));
    expect(cp("MemoryView").memories).toHaveLength(0);
    await nav("activities");
    await run(() =>
      cp("ActivitiesView").onAddJournal({
        title: "Drawing",
        content: "A relaxing hour",
        mood: "calm",
      }),
    );
    const entry = cp("ActivitiesView").journalEntries[0]!;
    await run(() => cp("WeeklyReflection").beforeGenerate?.());
    await run(() =>
      cp("WeeklyReflection").onSave({
        id: "r",
        entryIds: [entry.id],
        summary: "A calm week",
        createdAt: new Date().toISOString(),
      } as never),
    );
    await run(() =>
      cp("WeeklyReflection").onSave({
        id: "other",
        entryIds: ["another"],
        summary: "Another week",
        createdAt: new Date().toISOString(),
      } as never),
    );
    await run(() => cp("WeeklyReflection").onDelete("other"));
    expect(cp("WeeklyReflection").saved).toHaveLength(1);
    await run(() => cp("ActivitiesView").onDeleteJournal(entry.id));
    expect(cp("WeeklyReflection").saved).toHaveLength(0);
    await run(() => cp("ActivitiesView").onReflect(entry));
    expect(
      screen.getByText(/AI journal reflections are unavailable/),
    ).toBeTruthy();
    await click("Okay");
    for (const date of [
      new Date(2026, 9, 1, 4).toISOString(),
      new Date(2026, 9, 1, 15).toISOString(),
    ])
      await run(() =>
        cp("ActivitiesView").onAddEvent({
          description: "Drawing class",
          eventDate: date,
        }),
      );
    expect(cp("ActivitiesView").futureEvents).toHaveLength(2);
    expect(cp("ActivitiesView").nudges).toHaveLength(0);
    const activity = cp("ActivitiesView").activities[0]!;
    await run(() => cp("ActivitiesView").onComplete(activity));
    expect(current().completedActivityIds).toEqual([activity.id]);
    expect(current().walletTransactions).toHaveLength(2);
    await nav("moments");
    await run(() => cp("MomentsView").onCompleteActivity(activity));
    expect(current().completedActivityIds).toHaveLength(1);
  });
  it("enforces wardrobe balances, equips owned items and records calls and shared dates", async () => {
    await demo({
      subscription: { planId: "ultra", status: "active", testMode: true },
      wallet: { coins: 1000, gems: 1000, xp: 0, level: 1 },
      currentView: "companion",
    });
    const base = cp("CompanionView").storeItems[0]!;
    const free = {
        ...base,
        id: "free-qa",
        currency: "free" as const,
        price: 0,
        tierRequired: "free" as const,
      },
      paid = {
        ...base,
        id: "paid-qa",
        currency: "coins" as const,
        price: 10,
        tierRequired: "free" as const,
      };
    await run(async () =>
      expect(await cp("CompanionView").onPurchase(free)).toBeNull(),
    );
    await run(async () =>
      expect(await cp("CompanionView").onPurchase(paid)).toBeNull(),
    );
    await run(() => cp("CompanionView").onPurchase(paid));
    expect(cp("CompanionView").wallet.coins).toBe(990);
    expect(
      cp("CompanionView").ownedItems.filter((item) => item.itemId === paid.id),
    ).toHaveLength(1);
    await run(() => cp("CompanionView").onPurchase({ ...paid, price: 99999 }));
    await run(() => cp("CompanionView").onEquip(base));
    await nav("home");
    await run(() => cp("HomeView").onCall());
    await screen.findByTestId("VoiceCallModal");
    await run(async () =>
      expect(
        await cp("VoiceCallModal").onUserTurn("I like painting.", context()),
      ).toBe("A thoughtful reply."),
    );
    await run(() => cp("VoiceCallModal").onClose(61));
    expect(current().calls[0]!.durationSeconds).toBe(61);
    await run(() => cp("HomeView").onVideoCall());
    await screen.findByTestId("VideoCallModal");
    await run(() =>
      cp("VideoCallModal").onUserTurn("A quiet moment", context("video-turn")),
    );
    await run(async () =>
      expect(
        await cp("VideoCallModal").onAnalyzeFrame?.("frame", "image/jpeg"),
      ).toContain("not available"),
    );
    await run(() => cp("VideoCallModal").onClose(90));
    expect(current().calls[0]!.type).toBe("video");
    await nav("moments");
    await run(() => cp("MomentsView").onStartDate("rooftop", "Rooftop date"));
    expect(screen.getByText(/Unlock/)).toBeTruthy();
    await click("Okay");
    await nav("moments");
    await run(() => cp("MomentsView").onStartDate("window-nook", "Sunny date"));
    await screen.findByTestId("VideoCallModal");
    await run(() => cp("VideoCallModal").onClose(10));
    await run(() => cp("MomentsView").onGenerateSelfie());
    expect(screen.getByText(/AI selfies are unavailable/)).toBeTruthy();
    await click("Okay");
  });
  it("transcribes permitted voice notes and rejects unsupported image operations", async () => {
    await demo({
      currentView: "chat",
      subscription: { planId: "ultra", status: "active", testMode: true },
    });
    vi.mocked(companionApi.edgeTranscribe).mockResolvedValueOnce({
      text: "A spoken thought",
    } as never);
    await run(() => cp("ChatView").onVoiceRecording?.("audio", "audio/webm"));
    expect(current().messages[0]!.content).toBe("A spoken thought");
    await run(() => cp("ChatView").onVoiceNote("A second thought"));
    expect(current().messages).toHaveLength(4);
    vi.mocked(companionApi.edgeTranscribe).mockResolvedValueOnce({
      text: " ",
    } as never);
    await run(async () =>
      expect(
        cp("ChatView").onVoiceRecording?.("audio", "audio/webm"),
      ).rejects.toThrow(/couldn’t hear/),
    );
    await run(async () =>
      expect(
        cp("ChatView").onImageUpload(
          new File(["x"], "q.png", { type: "image/png" }),
        ),
      ).rejects.toThrow(/unavailable/),
    );
    await run(async () =>
      expect(cp("ChatView").onGenerateImage("A landscape")).rejects.toThrow(
        /not available/,
      ),
    );
    await run(() => cp("ChatView").onCamera());
    await screen.findByTestId("CameraConversationModal");
    await run(() => cp("CameraConversationModal").onSessionStart?.());
    await run(async () =>
      expect(
        await cp("CameraConversationModal").onAnalyzeFrame?.("x", "image/jpeg"),
      ).toContain("not available"),
    );
    await run(() => cp("CameraConversationModal").onClose());
  });
  it("shows plan limits, safely resets the demo, and supports restored first-meeting and preview routes", async () => {
    const v = await demo({
      currentView: "chat",
      subscription: { planId: "free", status: "active", testMode: true },
    });
    for (const operation of [
      () => cp("ChatView").onVoiceNote("test"),
      () => cp("ChatView").onVoiceRecording?.("audio", "audio/webm"),
      () => cp("ChatView").onCall(),
      () => cp("ChatView").onVideoCall(),
      () => cp("ChatView").onCamera(),
      () => cp("ChatView").onUpgrade(),
    ]) {
      await run(operation);
      await screen.findByText("Free public beta");
      await click("Continue with Mira");
    }
    await click("Reset demo");
    await click("Export first");
    expect(URL.createObjectURL).toHaveBeenCalled();
    await click("Cancel");
    await click("Reset demo");
    await click("Close dialog");
    await click("Reset demo");
    const resetButtons = screen.getAllByRole("button", { name: "Reset demo" });
    await run(() => fireEvent.click(resetButtons.at(-1)!));
    expect(current().messages).toHaveLength(0);
    v.unmount();
    const v2 = await account({ firstMeetingComplete: false });
    await run(() => cp("FirstMeeting").onComplete());
    expect(screen.getByTestId("HomeView")).toBeTruthy();
    v2.unmount();
    window.history.replaceState(null, "", "/demo?preview=home");
    render(<CompanionApp forceDemo />);
    expect(screen.getByTestId("HomeView")).toBeTruthy();
  });
});

describe("account-backed app coordination", () => {
  it("loads a saved account, serializes revisions, handles memory commands and paginates retained history", async () => {
    await account({ currentView: "chat", memories: [memoryFixture()] });
    expect(localStorage.getItem(storageKey)).toBeNull();
    vi.mocked(accountClient.messages)
      .mockResolvedValueOnce({
        messages: [
          {
            id: "old",
            conversationId: seed.activeConversationId,
            role: "user",
            content: "Earlier discussion",
            createdAt: "2026-09-01T10:00:00Z",
            status: "sent",
          },
        ],
        cursor: "next",
      })
      .mockResolvedValueOnce({ messages: [] });
    await run(() => cp("ChatView").onLoadOlder?.());
    expect(current().messages[0]!.id).toBe("old");
    await run(() => cp("ChatView").onLoadOlder?.());
    expect(accountClient.messages).toHaveBeenLastCalledWith(
      "next",
      seed.activeConversationId,
    );
    expect(cp("ChatView").onLoadOlder).toBeUndefined();
    vi.mocked(accountClient.conversation)
      .mockResolvedValueOnce({
        revision: 7,
        state: {
          ...seed,
          activeConversationId: "next-conversation",
          messages: [],
        },
      })
      .mockResolvedValueOnce({
        revision: 9,
        state: {
          ...seed,
          activeConversationId: "deleted-conversation",
          messages: [],
        },
      });
    await run(() => cp("ChatView").onNewConversation());
    expect(current().activeConversationId).toBe("next-conversation");
    expect(accountClient.save).toHaveBeenCalled();
    await run(() => cp("ChatView").onDeleteConversation());
    expect(accountClient.conversation).toHaveBeenLastCalledWith(
      { action: "delete", id: "next-conversation" },
      8,
    );
    await nav("memory");
    const updated = memoryFixture({ content: "Edited", pinned: true });
    vi.mocked(accountClient.memory)
      .mockResolvedValueOnce({
        revision: 11,
        state: { ...seed, memories: [updated] },
      })
      .mockResolvedValueOnce({ revision: 13, state: { ...seed, memories: [] } })
      .mockResolvedValueOnce({
        revision: 15,
        state: { ...seed, memories: [updated] },
      });
    await run(() => cp("MemoryView").onUpdate(updated));
    expect(cp("MemoryView").memories[0]!.content).toBe("Edited");
    await run(() => cp("MemoryView").onDelete(updated.id));
    expect(cp("MemoryView").memories).toHaveLength(0);
    await run(() => cp("MemoryView").onAdd("Edited", "preference"));
    expect(accountClient.memory).toHaveBeenLastCalledWith(
      { action: "create", content: "Edited", type: "preference" },
      14,
    );
    await nav("activities");
    await run(() => cp("ReminderSettings").beforeSave?.());
    await run(() => cp("WeeklyReflection").beforeGenerate?.());
    const activity = cp("ActivitiesView").activities[0]!;
    await run(() => cp("ActivitiesView").onComplete(activity));
    expect(current().wallet).toEqual(seed.wallet);
    await nav("companion");
    await run(async () =>
      expect(
        await cp("CompanionView").onPurchase(
          cp("CompanionView").storeItems[0]!,
        ),
      ).toContain("unavailable"),
    );
    await run(async () =>
      expect(
        cp("CompanionView").onEquip(cp("CompanionView").storeItems[0]!),
      ).rejects.toThrow("unavailable"),
    );
  });
  it("requires fresh authentication before export/delete and flushes before logout", async () => {
    await account({ currentView: "profile" });
    await run(() => cp("ProfileView").onExport());
    expect(accountClient.exportData).not.toHaveBeenCalled();
    await click("Close dialog");
    await run(() => cp("ProfileView").onExport());
    for (const failure of [Error("Wrong password"), "offline"]) {
      vi.mocked(accountClient.reauthenticate).mockRejectedValueOnce(failure);
      await run(() =>
        fireEvent.change(screen.getByLabelText("Password"), {
          target: { value: "Synthetic-QA-password" },
        }),
      );
      await click("Confirm and continue");
      expect(screen.getByRole("alert").textContent).toMatch(
        /Wrong password|Could not confirm/,
      );
    }
    await click("Confirm and continue");
    expect(accountClient.exportData).toHaveBeenCalledOnce();
    expect(accountClient.save).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    await run(() => cp("ProfileView").onDelete());
    expect(accountClient.deleteAccount).not.toHaveBeenCalled();
    await run(() =>
      fireEvent.change(screen.getByLabelText("Password"), {
        target: { value: "Synthetic-QA-password" },
      }),
    );
    await click("Confirm and continue");
    expect(accountClient.deleteAccount).toHaveBeenCalledOnce();
    expect(harness.router.replace).toHaveBeenCalledWith("/");
    await run(() => cp("ProfileView").onLogout?.());
    expect(accountClient.logout).toHaveBeenCalledOnce();
    expect(harness.router.replace).toHaveBeenCalledWith("/login");
  });
  it("requires current policy consent and consumes only validated reminder deep links", async () => {
    seed = viewState();
    vi.mocked(accountClient.load).mockResolvedValue({
      state: seed,
      revision: 1,
      policy: { termsVersion: "old" },
    } as never);
    vi.mocked(accountClient.acceptPolicy).mockResolvedValue({
      state: { ...seed, aiProcessingConsent: true },
      revision: 3,
    } as never);
    window.history.replaceState(null, "", "/app?tab=reminders");
    render(<CompanionApp productionAccount />);
    await screen.findByText("Review AI processing and access");
    await run(() => fireEvent.click(screen.getByRole("checkbox")));
    await click("Enable AI features");
    expect(accountClient.acceptPolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        adultConfirmed: true,
        termsVersion: "2026-09-13",
      }),
      1,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    await nav("home");
    await run(() =>
      navigator.serviceWorker.dispatchEvent(
        new MessageEvent("message", { data: { type: "unrelated" } }),
      ),
    );
    expect(current().currentView).toBe("home");
    await run(() =>
      navigator.serviceWorker.dispatchEvent(
        new MessageEvent("message", { data: { type: "mira-open-reminders" } }),
      ),
    );
    expect(screen.getByTestId("ActivitiesView")).toBeTruthy();
  });
  it.each(["failed", "offline", "conflict"] as const)(
    "keeps unsaved account state visible during %s and retries only when appropriate",
    async (status) => {
      await account({ currentView: "profile" });
      if (status === "offline")
        Object.defineProperty(navigator, "onLine", {
          configurable: true,
          value: false,
        });
      vi.mocked(accountClient.save).mockRejectedValueOnce(
        status === "conflict"
          ? Object.assign(Error("Conflict"), { status: 409 })
          : Error("Connection failed"),
      );
      await nav("activities");
      await run(async () => {
        await cp("WeeklyReflection")
          .beforeGenerate?.()
          .catch(() => undefined);
      });
      expect(screen.getByRole("status").textContent).toMatch(
        status === "conflict"
          ? /Another tab changed/
          : status === "offline"
            ? /Offline/
            : /could not be saved/,
      );
      if (status === "conflict") {
        vi.spyOn(window, "confirm").mockReturnValue(false);
        await click("Discard unsaved changes and reload");
        expect(window.confirm).toHaveBeenCalled();
      } else {
        await click("Retry save");
        expect(screen.getByRole("status").textContent).toContain(
          "Saved to your account",
        );
      }
    },
  );
  it.each([Error("Session expired"), Error("Service unavailable"), "offline"])(
    "handles account hydration failure: %s",
    async (failure) => {
      vi.mocked(accountClient.load).mockRejectedValueOnce(failure);
      render(<CompanionApp productionAccount />);
      if (failure instanceof Error && /Session/.test(failure.message))
        await waitFor(() =>
          expect(harness.router.replace).toHaveBeenCalledWith("/login"),
        );
      else
        await screen.findByText(
          failure instanceof Error
            ? failure.message
            : "Your account could not be loaded just now.",
        );
    },
  );
  it("ignores late account hydration and saves debounced state only while mounted", async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(accountClient.load).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r as never;
        }),
    );
    const v = render(<CompanionApp productionAccount />);
    expect(screen.getByText("Opening Mira’s room…")).toBeTruthy();
    v.unmount();
    await run(() => resolve({ state: viewState(), revision: 1 }));
    expect(harness.props.has("AppShell")).toBe(false);
    await account();
    vi.useFakeTimers();
    await nav("profile");
    await run(() =>
      cp("ProfileView").onChange({ ...current(), theme: "dark" }),
    );
    await run(() => vi.advanceTimersByTimeAsync(701));
    expect(accountClient.save).toHaveBeenCalledWith(
      expect.objectContaining({ theme: "dark" }),
      4,
      expect.any(AbortSignal),
    );
  });
});

function liveSetup(empty = false) {
  seed = viewState();
  seed.companion.relationshipMode = "friend";
  seed.relationship.romanticOptIn = false;
  Object.defineProperty(companionApi, "enabled", {
    configurable: true,
    value: true,
  });
  vi.mocked(companionApi.hasSession).mockReturnValue(true);
  vi.mocked(companionApi.me).mockResolvedValue(seed.user);
  vi.mocked(companionApi.companions).mockResolvedValue([seed.companion]);
  vi.mocked(companionApi.conversations).mockResolvedValue(
    empty ? [] : ([{ id: seed.activeConversationId }] as never),
  );
  vi.mocked(companionApi.createConversation).mockResolvedValue({
    id: "live-conversation",
  } as never);
  vi.mocked(companionApi.messages).mockResolvedValue(
    empty
      ? []
      : [
          {
            id: "live-user",
            conversationId: seed.activeConversationId,
            role: "user",
            content: "A live question",
            createdAt: new Date().toISOString(),
            status: "sent",
          },
        ],
  );
  vi.mocked(companionApi.memories).mockResolvedValue([memoryFixture()]);
  vi.mocked(companionApi.activities).mockResolvedValue(seed.activities);
  vi.mocked(companionApi.wallet).mockResolvedValue({
    ...seed.wallet,
    coins: 5000,
  });
  vi.mocked(companionApi.walletTransactions).mockResolvedValue([
    { type: "earn", currency: "coins", referenceId: seed.activities[0]!.id },
    { type: "purchase", currency: "coins", referenceId: "unknown" },
  ] as never);
  vi.mocked(companionApi.store).mockResolvedValue(seed.storeItems as never);
  vi.mocked(companionApi.inventory).mockResolvedValue(seed.ownedItems);
  vi.mocked(companionApi.subscription).mockResolvedValue({
    subscription: { planId: "ultra", status: "active", testMode: true },
  } as never);
  vi.mocked(companionApi.journal).mockResolvedValue([]);
  vi.mocked(companionApi.events).mockResolvedValue([]);
  vi.mocked(companionApi.nudges).mockResolvedValue([]);
  vi.mocked(companionApi.notifications).mockResolvedValue(seed.notifications);
  vi.mocked(companionApi.calls).mockResolvedValue([
    {
      id: "c",
      type: "voice",
      startedAt: new Date().toISOString(),
      durationMs: 1500,
      summary: "A chat",
    },
    { id: "c2", type: "video", startedAt: new Date().toISOString() },
  ] as never);
  vi.mocked(companionApi.moments).mockResolvedValue([
    { id: "m", title: "Drawing", happenedAt: new Date().toISOString() },
  ] as never);
  vi.mocked(companionApi.photos).mockResolvedValue([
    { id: "p", caption: "Tea", createdAt: new Date().toISOString() },
  ] as never);
  vi.mocked(companionApi.streamChat).mockImplementation(
    async (_payload, delta) => {
      delta("A live reply");
      return { assistantMessageId: "server-reply" };
    },
  );
  for (const method of [
    companionApi.updateCompanion,
    companionApi.updatePersonality,
    companionApi.updateUser,
    companionApi.updateNotifications,
    companionApi.feedback,
    companionApi.deleteConversation,
    companionApi.deleteMemory,
    companionApi.deleteJournal,
    companionApi.deleteAccount,
    companionApi.logout,
  ])
    vi.mocked(method).mockResolvedValue(undefined as never);
}
async function live(empty = false) {
  liveSetup(empty);
  const v = render(<CompanionApp />);
  await screen.findByTestId("HomeView");
  return v;
}
describe("optional API adapter app paths", () => {
  it("hydrates server records, streams and regenerates chat, synchronizes preference changes and starts fresh conversations", async () => {
    await live();
    expect(current().calls).toHaveLength(2);
    expect(current().calls[1]!.summary).toBe("A private companion call.");
    expect(current().completedActivityIds).toEqual([seed.activities[0]!.id]);
    await nav("chat");
    await run(() => cp("ChatView").onSend("A new question"));
    expect(current().messages.at(-1)!).toMatchObject({
      id: "server-reply",
      content: "A live reply",
      status: "sent",
    });
    vi.mocked(companionApi.regenerate).mockResolvedValue({
      ...current().messages.at(-1)!,
      content: "Regenerated",
    });
    await run(() => cp("ChatView").onRegenerate("server-reply"));
    expect(current().messages.at(-1)!.content).toBe("Regenerated");
    await run(() => cp("ChatView").onFeedback("server-reply", "up"));
    expect(companionApi.feedback).toHaveBeenCalled();
    for (const failure of [Error("Inference failed"), "offline"]) {
      vi.mocked(companionApi.streamChat).mockRejectedValueOnce(failure);
      await run(() => cp("ChatView").onSend("Try once"));
      expect(current().messages.at(-1)!.status).toBe("failed");
    }
    await run(() => cp("ChatView").onNewConversation());
    expect(current().activeConversationId).toBe("live-conversation");
    await run(() => cp("ChatView").onDeleteConversation());
    expect(companionApi.deleteConversation).toHaveBeenCalledWith(
      "live-conversation",
    );
    await nav("profile");
    await run(() =>
      cp("ProfileView").onChange({
        ...current(),
        user: {
          ...current().user,
          name: "QA",
          pronouns: "they/them",
          timezone: "Asia/Kolkata",
        },
        notifications: { ...current().notifications, frequency: "low" },
        relationship: { ...current().relationship, romanticOptIn: true },
      }),
    );
    expect(companionApi.updateUser).toHaveBeenCalledWith(
      expect.objectContaining({ name: "QA" }),
    );
    expect(companionApi.updateNotifications).toHaveBeenCalled();
    expect(companionApi.updateCompanion).toHaveBeenCalledWith(
      seed.companion.id,
      { relationshipMode: "romantic" },
    );
    await nav("companion");
    vi.useFakeTimers();
    await run(() =>
      cp("CompanionView").onChange({
        ...cp("CompanionView").companion,
        voiceId: "Ashley",
      }),
    );
    await run(() =>
      cp("CompanionView").onChange({
        ...cp("CompanionView").companion,
        name: "Mira QA",
      }),
    );
    await run(() => vi.advanceTimersByTimeAsync(421));
    expect(companionApi.updatePersonality).toHaveBeenCalledOnce();
    expect(companionApi.updateCompanion).toHaveBeenLastCalledWith(
      seed.companion.id,
      expect.objectContaining({ voiceId: "Ashley", name: "Mira QA" }),
    );
  });
  it("falls back for optional hydration endpoints and missing conversations without losing login state", async () => {
    liveSetup(true);
    localStorage.setItem(
      `mira-live-preferences-v1:${seed.user.id}`,
      "corrupted",
    );
    for (const method of [
      companionApi.memories,
      companionApi.activities,
      companionApi.wallet,
      companionApi.walletTransactions,
      companionApi.store,
      companionApi.inventory,
      companionApi.subscription,
      companionApi.journal,
      companionApi.events,
      companionApi.nudges,
      companionApi.notifications,
      companionApi.calls,
      companionApi.moments,
      companionApi.photos,
    ])
      vi.mocked(method).mockRejectedValueOnce(
        Error("Optional endpoint offline"),
      );
    render(<CompanionApp />);
    await screen.findByTestId("HomeView");
    expect(current().activeConversationId).toBe("live-conversation");
    expect(current().messages[0]!.content).toContain("I’m here");
    expect(current().wallet.coins).toBe(0);
    expect(current().memories).toEqual([]);
  });
  it("persists explicit memories, journal entries, reminders and server wallet changes", async () => {
    await live();
    await nav("memory");
    const edited = memoryFixture({ content: "Corrected", pinned: true });
    vi.mocked(companionApi.updateMemory).mockResolvedValue(edited);
    await run(() => cp("MemoryView").onUpdate(edited));
    expect(cp("MemoryView").memories[0]!.content).toBe("Corrected");
    await run(() => cp("MemoryView").onDelete(edited.id));
    vi.mocked(companionApi.createMemory).mockResolvedValue(edited);
    await run(() => cp("MemoryView").onAdd("Corrected", "preference"));
    expect(cp("MemoryView").memories).toEqual([edited]);
    await nav("activities");
    const entry = {
      id: "entry",
      title: "Drawing",
      content: "A tree",
      mood: "calm",
      createdAt: new Date().toISOString(),
    };
    vi.mocked(companionApi.addJournal).mockResolvedValue(entry as never);
    await run(() => cp("ActivitiesView").onAddJournal(entry as never));
    vi.mocked(companionApi.reflectJournal).mockResolvedValue({
      reflection: "A calm reflection",
    } as never);
    await run(() => cp("ActivitiesView").onReflect(entry as never));
    expect(current().messages.at(-1)!.content).toBe("A calm reflection");
    expect(current().journalEntries[0]!.reflected).toBe(true);
    await nav("activities");
    await run(() => cp("ActivitiesView").onDeleteJournal(entry.id));
    expect(cp("ActivitiesView").journalEntries).toEqual([]);
    for (const nudge of [null, { id: "n", eventId: "e" }]) {
      vi.mocked(companionApi.addEvent).mockResolvedValueOnce({
        event: {
          id: "e",
          description: "Drawing",
          eventDate: "2026-10-01T12:00:00Z",
        },
        nudge,
      } as never);
      await run(() =>
        cp("ActivitiesView").onAddEvent({
          description: "Drawing",
          eventDate: "2026-10-01T12:00:00Z",
        }),
      );
    }
    expect(cp("ActivitiesView").nudges).toHaveLength(1);
    vi.mocked(companionApi.completeActivity).mockResolvedValue({
      coins: 9,
      gems: 2,
      xp: 10,
      level: 1,
    });
    await run(() =>
      cp("ActivitiesView").onComplete(cp("ActivitiesView").activities[1]!),
    );
    expect(current().wallet.coins).toBe(9);
    await nav("companion");
    const item = cp("CompanionView").storeItems[0]!;
    const owned = {
      itemId: item.id,
      equipped: false,
      purchasedAt: new Date().toISOString(),
    };
    vi.mocked(companionApi.purchaseItem).mockResolvedValue({
      wallet: seed.wallet,
      owned,
    } as never);
    await run(() => cp("CompanionView").onPurchase({ ...item, price: 0 }));
    await run(() => cp("CompanionView").onPurchase({ ...item, price: 0 }));
    expect(
      cp("CompanionView").ownedItems.filter((i) => i.itemId === item.id),
    ).toHaveLength(1);
    vi.mocked(companionApi.equipItem).mockResolvedValue([
      { ...owned, equipped: true },
    ]);
    await run(() => cp("CompanionView").onEquip(item));
    expect(cp("CompanionView").ownedItems[0]!.equipped).toBe(true);
  });
  it("validates image uploads, labels generated artifacts and delegates explicit call frames", async () => {
    await live();
    await nav("chat");
    await run(async () =>
      expect(
        cp("ChatView").onImageUpload(
          new File(["x"], "x.gif", { type: "image/gif" }),
        ),
      ).rejects.toThrow("JPEG"),
    );
    await run(async () =>
      expect(
        cp("ChatView").onImageUpload(
          new File([new Uint8Array(8_000_001)], "x.png", { type: "image/png" }),
        ),
      ).rejects.toThrow("8 MB"),
    );
    vi.mocked(companionApi.uploadImage).mockResolvedValue({
      id: "asset",
      url: "/asset.png",
    } as never);
    vi.mocked(companionApi.analyzeImage).mockResolvedValue({
      description: "A drawing",
    } as never);
    await run(() =>
      cp("ChatView").onImageUpload(
        new File(["small image"], "x.png", { type: "image/png" }),
      ),
    );
    expect(current().photos[0]!.kind).toBe("shared");
    expect(current().messages.at(-1)!.content).toBe("A drawing");
    for (const result of [
      { artifactBase64: "IMAGE", contentType: "image/png" },
      { assetUrl: "https://example.test/image.png" },
    ]) {
      vi.mocked(companionApi.generateImage).mockResolvedValueOnce(
        result as never,
      );
      await run(() => cp("ChatView").onGenerateImage("A landscape"));
      expect(current().photos[0]!.kind).toBe("selfie");
    }
    expect(current().photos[0]!.imageUrl).toBe(
      "https://example.test/image.png",
    );
    vi.mocked(companionApi.transcribe).mockResolvedValue({
      text: "Voice words",
    } as never);
    await run(() => cp("ChatView").onVoiceRecording?.("bytes", "audio/webm"));
    expect(companionApi.transcribe).toHaveBeenCalledWith("bytes", "audio/webm");
    await run(() => cp("ChatView").onCall());
    await screen.findByTestId("VoiceCallModal");
    await run(async () =>
      expect(await cp("VoiceCallModal").onUserTurn("Hello", context())).toBe(
        "A live reply",
      ),
    );
    await run(async () =>
      expect(cp("ChatView").onSend("chat during call")).rejects.toThrow(
        "Finish the call",
      ),
    );
    await run(() => cp("VoiceCallModal").onClose(12));
    await run(() => cp("ChatView").onVideoCall());
    await screen.findByTestId("VideoCallModal");
    await run(async () =>
      expect(
        await cp("VideoCallModal").onAnalyzeFrame?.("frame", "image/jpeg"),
      ).toBe("A drawing"),
    );
    await run(() => cp("VideoCallModal").onClose(4));
    await run(() => cp("ChatView").onCamera());
    await run(() => cp("CameraConversationModal").onSessionStart?.());
    await run(async () =>
      expect(
        await cp("CameraConversationModal").onAnalyzeFrame?.(
          "frame",
          "image/jpeg",
        ),
      ).toBe("A drawing"),
    );
    await run(() => cp("CameraConversationModal").onClose());
    await nav("moments");
    vi.mocked(companionApi.generateImage).mockResolvedValue({
      assetUrl: "/selfie.png",
    } as never);
    await run(() => cp("MomentsView").onGenerateSelfie());
    expect(cp("MomentsView").defaultTab).toBe("photos");
    await nav("profile");
    vi.mocked(companionApi.exportData).mockResolvedValue({
      user: seed.user,
    } as never);
    await run(() => cp("ProfileView").onExport());
    expect(companionApi.exportData).toHaveBeenCalled();
    await run(() => cp("ProfileView").onDelete());
    expect(companionApi.deleteAccount).toHaveBeenCalledWith("DELETE");
    await run(() => cp("ProfileView").onLogout?.());
    expect(companionApi.logout).toHaveBeenCalled();
  });
  it.each(["none", "missing-companion", "expired", "failure"])(
    "handles failed live session hydration: %s",
    async (failure) => {
      liveSetup();
      if (failure === "none")
        vi.mocked(companionApi.hasSession).mockReturnValue(false);
      else if (failure === "missing-companion")
        vi.mocked(companionApi.companions).mockResolvedValue([]);
      else {
        vi.mocked(companionApi.me).mockRejectedValue("unavailable");
        if (failure === "expired")
          vi.mocked(companionApi.hasSession)
            .mockReturnValueOnce(true)
            .mockReturnValue(false);
      }
      render(<CompanionApp />);
      if (["none", "expired"].includes(failure))
        await waitFor(() =>
          expect(harness.router.replace).toHaveBeenCalledWith("/login"),
        );
      else
        await screen.findByText(
          failure === "missing-companion"
            ? "Companion not found"
            : "Your account could not be loaded just now.",
        );
    },
  );
});

function onboardingDraft(): Parameters<
  ComponentProps<typeof import("./Onboarding").Onboarding>["onComplete"]
>[0] {
  return {
    email: "qa@example.test",
    password: "Synthetic-QA-password",
    name: " QA ",
    birthday: "2000-01-01",
    pronouns: "they/them",
    adultConfirmed: true,
    policyAccepted: true,
    aiProcessingConsent: true,
    conversationStorageEnabled: true,
    intentions: ["Friendship"],
    interests: ["Art"],
    companionName: "Mira QA",
    companionPronouns: "she/her",
    presentation: "warm",
    voiceId: "Ashley",
    relationshipMode: "friend",
    warmth: 80,
    playfulness: 60,
    energy: 50,
    humor: 60,
    expressiveness: 50,
    affection: 50,
    flirtiness: 0,
    romance: 0,
    sensuality: 0,
    memoryEnabled: true,
  };
}
describe("onboarding and restored browser state", () => {
  it.each(["demo", "account", "live"] as const)(
    "builds a coherent new %s state only after confirmed declarations",
    async (mode) => {
      if (mode === "live") {
        liveSetup();
        vi.mocked(companionApi.signup).mockResolvedValue({
          user: seed.user,
          companion: seed.companion,
        } as never);
      }
      vi.mocked(accountClient.signup).mockImplementation(async (payload) => ({
        state: payload.state,
        revision: 1,
        account: { id: "qa", email: payload.email, name: payload.name },
      }));
      window.history.replaceState(null, "", "/app?onboarding=1");
      render(
        <CompanionApp
          forceDemo={mode === "demo"}
          productionAccount={mode === "account"}
        />,
      );
      await screen.findByTestId("Onboarding");
      const draft = onboardingDraft();
      await run(async () =>
        expect(
          cp("Onboarding").onComplete({ ...draft, adultConfirmed: false }),
        ).rejects.toThrow("Confirm the adult"),
      );
      await run(() =>
        cp("Onboarding").onComplete({
          ...draft,
          companionName: mode === "demo" ? "" : draft.companionName,
          relationshipMode: mode === "account" ? "romantic" : "friend",
          sensuality: mode === "account" ? 20 : 0,
        }),
      );
      await screen.findByTestId("FirstMeeting");
      await run(() => cp("FirstMeeting").onComplete());
      expect(current().user.name).toBe("QA");
      expect(current().messages[0]!.conversationId).toBe(
        current().activeConversationId,
      );
      expect(current().memoryEnabled).toBe(true);
      expect(harness.router.replace).toHaveBeenCalledWith(
        mode === "demo" ? "/demo" : "/app",
      );
    },
  );
  it("preserves malformed saved demos and allows earlier-schema history to be kept", async () => {
    localStorage.setItem(storageKey, "invalid JSON");
    const v = render(<CompanionApp forceDemo />);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(localStorage.getItem(storageKey)).toBe("invalid JSON");
    v.unmount();
    localStorage.setItem(storageKey, JSON.stringify(viewState()));
    render(<CompanionApp forceDemo />);
    expect(
      screen.getByText(/saved conversation is from an earlier/),
    ).toBeTruthy();
    await click("Keep history");
    expect(
      screen.queryByText(/saved conversation is from an earlier/),
    ).toBeNull();
  });
  it("keeps a session usable when browser preference storage fails", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw "unavailable";
    });
    const v = render(<CompanionApp forceDemo />);
    expect(screen.getByText(/Saved demo could not be restored/)).toBeTruthy();
    v.unmount();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw Error("full");
    });
    render(<CompanionApp />);
    expect(screen.getByTestId("Onboarding")).toBeTruthy();
  });
});

describe("paused and concurrent action boundaries", () => {
  it("blocks every inference entry point while processing is paused", async () => {
    await demo({ currentView: "chat", aiProcessingConsent: false });
    const chat = cp("ChatView");
    for (const action of [
      () => chat.onVoiceNote("A voice message"),
      () => chat.onVoiceRecording?.("audio", "audio/webm"),
      () => chat.onImageUpload(new File(["x"], "x.png", { type: "image/png" })),
      () => chat.onGenerateImage("art"),
      () => chat.onCamera(),
      () => chat.onRegenerate("missing"),
    ]) {
      await run(action);
      expect(screen.getByText("Review AI processing and access")).toBeTruthy();
      await click("Keep paused");
    }
    await nav("moments");
    await run(() => cp("MomentsView").onGenerateSelfie());
    await click("Keep paused");
    expect(companionApi.generateImage).not.toHaveBeenCalled();
    expect(companionApi.transcribe).not.toHaveBeenCalled();
  });
  it("retains a nonromantic relationship, excludes unsafe inferred memories, and handles unknown thrown values", async () => {
    await demo({ currentView: "profile" });
    await run(() =>
      cp("ProfileView").onChange({
        ...current(),
        relationship: { ...current().relationship, romanticOptIn: false },
        companion: { ...current().companion, relationshipMode: "mentor" },
      }),
    );
    expect(current().companion.relationshipMode).toBe("mentor");
    await nav("chat");
    const previous = current().memories.length;
    await run(() => cp("ChatView").onSend("I want to hurt myself"));
    expect(current().memories).toHaveLength(previous);
    vi.mocked(companionApi.demoReply).mockRejectedValueOnce("offline");
    await run(() => cp("ChatView").onSend("A normal question"));
    expect(screen.getByText(/Your message could not be answered/)).toBeTruthy();
  });
  it("does not start a call, voice note or second generation during an active reply", async () => {
    await demo({ currentView: "chat" });
    let finish!: (value: string) => void;
    vi.mocked(companionApi.demoReply).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let pending: unknown;
    await run(() => {
      pending = cp("ChatView").onSend("A question");
    });
    await run(() => cp("ChatView").onCall());
    expect(
      screen.getByText(/Wait for the current reply before starting a call/),
    ).toBeTruthy();
    await run(async () =>
      expect(
        cp("ChatView").onVoiceRecording?.("audio", "audio/webm"),
      ).rejects.toThrow("Wait for the current message"),
    );
    await run(() => {
      finish("A useful response.");
      return pending;
    });
  });
});
