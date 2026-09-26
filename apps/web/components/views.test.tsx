// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
vi.mock(
  "framer-motion",
  async () => (await import("../tests/ui-test-helpers")).motionMock,
);
vi.mock("@/lib/video-preload", () => ({ preloadVideoCall: vi.fn() }));
import {
  dialogSupport,
  memoryFixture,
  viewState,
} from "../tests/ui-test-helpers";
import { MemoryView } from "./MemoryView";
import { ActivitiesView } from "./ActivitiesView";
import { CompanionView } from "./CompanionView";
import { ProfileView } from "./ProfileView";
import { HomeView } from "./HomeView";
import { MomentsView } from "./MomentsView";
import { AppShell } from "./AppShell";

const button = (name: string | RegExp) =>
  fireEvent.click(screen.getByRole("button", { name }));
const tab = (name: string) =>
  fireEvent.click(screen.getByRole("tab", { name }));
const change = (name: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(name), { target: { value } });
beforeEach(() => {
  dialogSupport();
  localStorage.clear();
  window.history.replaceState(null, "", "/app");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        voices: [
          { id: "Priya", name: "Priya", language: "Hindi" },
          { id: "Ashley", name: "Ashley", language: "English" },
        ],
      }),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("inspectable memories", () => {
  it("filters, pins, edits, adds and forgets only the selected memory", () => {
    const onUpdate = vi.fn(),
      onAdd = vi.fn(),
      onDelete = vi.fn(),
      onToggle = vi.fn();
    const props = {
      memories: [
        memoryFixture(),
        memoryFixture({
          id: "other",
          type: "episodic",
          content: "A trip",
          pinned: true,
          sourceMessageIds: ["message"],
          lastRetrievedAt: new Date().toISOString(),
          retrievalCount: 1,
        }),
        memoryFixture({ id: "deleted", status: "deleted" }),
      ],
      enabled: true,
      companionName: "Mira",
      onUpdate,
      onAdd,
      onDelete,
      onToggle,
    };
    const view = render(<MemoryView {...props} />);
    expect(screen.queryByText("deleted")).toBeNull();
    change("Search memories", "drawing");
    button("Pin memory");
    expect(onUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "memory", pinned: true }),
    );
    button("Edit memory");
    fireEvent.change(screen.getByRole("textbox", { name: "Memory" }), {
      target: { value: "   Corrected memory   " },
    });
    button("Save correction");
    expect(onUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: "Corrected memory",
        normalizedContent: "corrected memory",
      }),
    );
    button("Edit memory");
    button("Cancel");
    button("Delete memory");
    expect(onDelete).toHaveBeenCalledWith("memory");
    change("Search memories", "");
    tab("Important events");
    expect(screen.getByText("A trip")).toBeTruthy();
    button("Unpin memory");
    tab("Goals");
    expect(screen.getByText("No matching memories")).toBeTruthy();
    tab("All");
    button("Add memory");
    change("Category", "goal");
    change("What should Mira remember?", "  Paint weekly  ");
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Add memory",
      }),
    );
    expect(onAdd).toHaveBeenCalledWith("Paint weekly", "goal");
    button("Add memory");
    button("Cancel");
    button("Add memory");
    button("Close dialog");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit memory" })[0]!);
    button("Close dialog");
    button("Pause memory");
    expect(onToggle).toHaveBeenCalled();
    view.rerender(<MemoryView {...props} enabled={false} automatic />);
    expect(screen.getByText("Memory is paused")).toBeTruthy();
    button("Resume memory");
    view.rerender(
      <MemoryView
        {...props}
        memories={[
          memoryFixture({
            lastRetrievedAt: new Date().toISOString(),
            retrievalCount: 2,
          }),
        ]}
        automatic
      />,
    );
    expect(screen.getByText(/recalled 2 times/)).toBeTruthy();
  });
});

describe("journals, activities and saved plans", () => {
  function props() {
    const state = viewState();
    return {
      activities: state.activities,
      completedIds: [],
      wallet: state.wallet,
      journalEntries: state.journalEntries,
      futureEvents: state.futureEvents,
      nudges: [],
      companionName: "Mira",
      onComplete: vi.fn(),
      onAddJournal: vi.fn(),
      onDeleteJournal: vi.fn(),
      onReflect: vi.fn(),
      onAddEvent: vi.fn(),
    };
  }
  it("saves entered journal content, clears the form, and routes selected-entry actions", () => {
    const p = props();
    const view = render(<ActivitiesView {...p} reflectionEnabled />);
    const starts = screen.getAllByRole("button", { name: /Begin|Start/ });
    fireEvent.click(starts[0]!);
    expect(p.onComplete).toHaveBeenCalled();
    tab("Journal");
    fireEvent.submit(document.querySelector("form")!);
    expect(p.onAddJournal).not.toHaveBeenCalled();
    change("Title", "A drawing");
    change("Mood", "calm");
    change("Entry", "I drew a tree.");
    fireEvent.submit(document.querySelector("form")!);
    expect(p.onAddJournal).toHaveBeenCalledWith({
      title: "A drawing",
      mood: "calm",
      content: "I drew a tree.",
    });
    const entry = {
      id: "j",
      userId: "u",
      title: "A drawing",
      mood: "calm" as const,
      content: "I drew a tree.",
      tags: [],
      reflected: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    view.rerender(
      <ActivitiesView {...p} journalEntries={[entry]} reflectionEnabled />,
    );
    button("Reflect with Mira");
    expect(p.onReflect).toHaveBeenCalledWith(entry);
    button("Delete A drawing");
    expect(p.onDeleteJournal).toHaveBeenCalledWith("j");
    view.rerender(
      <ActivitiesView
        {...p}
        journalEntries={[{ ...entry, reflected: true }]}
        reflectionEnabled
        reflectionPanel={<p>Selected reflection panel</p>}
        reminderPanel={<p>Reminder panel</p>}
      />,
    );
    button("Reflect with Mira");
    expect(screen.getByText("Selected reflection panel")).toBeTruthy();
    tab("Reminders");
    expect(screen.getByText("Reminder panel")).toBeTruthy();
    tab("Activities");
  });
  it("saves explicit/default dates and opens account reminder management from saved plans", () => {
    const p = props();
    const view = render(<ActivitiesView {...p} />);
    tab("Future plans");
    button("Save plan");
    expect(p.onAddEvent).not.toHaveBeenCalled();
    change("What’s happening?", "Drawing time");
    button("Save plan");
    expect(p.onAddEvent.mock.calls[0]![0].description).toBe("Drawing time");
    change("What’s happening?", "Explicit time");
    change(/Date and time/, "2026-10-01T15:00");
    fireEvent.submit(document.querySelector("form")!);
    expect(p.onAddEvent.mock.calls[1]![0].eventDate).toBe(
      new Date("2026-10-01T15:00").toISOString(),
    );
    const future = {
      id: "e",
      userId: "u",
      companionId: "c",
      description: "Plan",
      eventDate: "2026-10-01T15:00:00Z",
      status: "confirmed" as const,
      createdAt: "2026-09-26T00:00:00Z",
    };
    view.rerender(
      <ActivitiesView
        {...p}
        futureEvents={[future]}
        accountMode
        reminderPanel={<p>Reminders here</p>}
      />,
    );
    button("Manage reminder");
    expect(screen.getByText("Reminders here")).toBeTruthy();
    tab("Future plans");
    view.rerender(<ActivitiesView {...p} futureEvents={[future]} liveMode />);
    expect(screen.getByText("No notification scheduled")).toBeTruthy();
    view.rerender(
      <ActivitiesView
        {...p}
        futureEvents={[future]}
        nudges={[{ eventId: "e" } as never]}
      />,
    );
    expect(screen.getByText("Saved plan")).toBeTruthy();
    tab("Weekly reflection");
    act(() => window.dispatchEvent(new Event("mira-open-reminders")));
    expect(
      screen
        .getByRole("tab", { name: "Reminders" })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });
  it("handles empty activities and reminder deep links", () => {
    window.history.replaceState(
      null,
      "",
      "/app?view=activities&tab=reminders&keep=yes",
    );
    const p = props();
    render(
      <ActivitiesView
        {...p}
        activities={[]}
        reminderPanel={<p>Deep-linked reminder</p>}
      />,
    );
    expect(screen.getByText("Deep-linked reminder")).toBeTruthy();
    expect(window.location.search).toBe("?keep=yes");
    tab("Activities");
    button(/Begin|Start/);
    expect(p.onComplete).not.toHaveBeenCalled();
  });
});

describe("companion customization and profile settings", () => {
  it("edits traits, backstory and voice without claiming unsupported purchase success", async () => {
    const state = viewState();
    const item = state.storeItems[0]!;
    const p = {
      companion: state.companion,
      backstory: "A warm artist",
      storeItems: [item],
      ownedItems: [],
      wallet: state.wallet,
      subscription: state.subscription,
      onChange: vi.fn(),
      onBackstoryChange: vi.fn(),
      onPurchase: vi.fn().mockResolvedValue(null),
      onEquip: vi.fn().mockResolvedValue(undefined),
      onUpgrade: vi.fn(),
    };
    const view = render(<CompanionView {...p} />);
    button("Buy");
    expect((await screen.findByRole("status")).textContent).toContain(
      "added to your collection",
    );
    for (const failure of [Error("Purchase failed"), "offline"]) {
      p.onPurchase.mockRejectedValueOnce(failure);
      button("Buy");
      await waitFor(() =>
        expect(screen.getByRole("status").textContent).toMatch(
          /Purchase failed|could not be purchased/,
        ),
      );
    }
    p.onPurchase.mockResolvedValueOnce("Not enough coins");
    button("Buy");
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("Not enough coins"),
    );
    button("See plan benefits");
    expect(p.onUpgrade).toHaveBeenCalled();
    view.rerender(
      <CompanionView
        {...p}
        ownedItems={[{ itemId: item.id, equipped: false } as never]}
      />,
    );
    button("Equip");
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("equipped"),
    );
    for (const failure of [Error("Equip failed"), "offline"]) {
      p.onEquip.mockRejectedValueOnce(failure);
      button("Equip");
      await waitFor(() =>
        expect(screen.getByRole("status").textContent).toMatch(
          /Equip failed|could not be equipped/,
        ),
      );
    }
    tab("Personality");
    for (const slider of screen.getAllByRole("slider"))
      fireEvent.change(slider, { target: { value: "40" } });
    expect(p.onChange).toHaveBeenCalledTimes(9);
    tab("Backstory");
    change(/Who is/, "An artist who enjoys tea");
    expect(p.onBackstoryChange).toHaveBeenCalledWith(
      "An artist who enjoys tea",
    );
    tab("Voice");
    await screen.findByText("Ashley");
    button("Use Ashley");
    expect(p.onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ voiceId: "Ashley" }),
    );
    tab("Wardrobe & room");
    view.rerender(
      <CompanionView
        {...p}
        ownedItems={[{ itemId: item.id, equipped: true } as never]}
        subscription={{
          ...state.subscription,
          testMode: false,
          planId: "free",
        }}
      />,
    );
    expect(
      (screen.getByRole("button", { name: "Equipped" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
  it("updates active profile settings, routes privacy actions, and requires exact deletion confirmation", () => {
    const p = {
      onExport: vi.fn(),
      onDelete: vi.fn(),
      onLogout: vi.fn(),
      onUpgrade: vi.fn(),
      onOpenMemory: vi.fn(),
      onOpenActivities: vi.fn(),
    };
    function Profile() {
      const [state, setState] = useState(viewState());
      return (
        <ProfileView
          state={state}
          onChange={setState}
          {...p}
          liveMode
          accountMode
        />
      );
    }
    render(<Profile />);
    change("Name", "New QA");
    change("Pronouns", "they/them");
    change("Response length", "short");
    change("Questions", "rare");
    change("Advice style", "direct");
    for (const label of [
      /Listen before advising/,
      /Romantic mode/,
      /Use approved memories/,
      /AI-processing consent/,
      /Server conversation history/,
    ]) {
      const control = screen.getByRole("checkbox", { name: label! });
      fireEvent.click(control);
      fireEvent.click(control);
    }
    button("Dark");
    expect(screen.getByRole("button", { name: "Dark" }).className).toContain(
      "active",
    );
    button("Light");
    button("See beta access");
    button("Plan something together");
    button("Inspect 0 memories");
    button(/See everything/);
    button("Export");
    button("Sign out");
    for (const callback of Object.values(p).filter((x) => x !== p.onDelete))
      expect(callback).toHaveBeenCalled();
    button("Manage reminders");
    expect(window.location.search).toContain("tab=reminders");
    button("Delete");
    expect(
      (
        screen.getByRole("button", {
          name: "Permanently delete",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    button("Cancel");
    button("Delete");
    button("Close dialog");
    button("Delete");
    change("Type DELETE to confirm", "DELETE");
    button("Permanently delete");
    expect(p.onDelete).toHaveBeenCalledOnce();
  });
  it("renders local profile history, active relationship memories and ordered upcoming plans", () => {
    const state = viewState();
    state.subscription.testMode = false;
    state.subscription.planId = "free";
    state.memories = [
      memoryFixture({ id: "deleted", status: "deleted" }),
      memoryFixture(),
      memoryFixture({
        id: "person",
        type: "relationship",
        content: "Anika is my friend",
      }),
    ];
    state.futureEvents = [
      {
        id: "later",
        eventDate: "2099-10-01T12:00:00Z",
        description: "Later plan",
        status: "confirmed" as const,
      },
      {
        id: "sooner",
        eventDate: "2099-09-01T12:00:00Z",
        description: "Sooner plan",
        status: "confirmed" as const,
      },
      {
        id: "old",
        eventDate: "2020-09-01T12:00:00Z",
        description: "Old plan",
        status: "confirmed" as const,
      },
      {
        id: "draft",
        eventDate: "2099-09-01T12:00:00Z",
        description: "Draft plan",
        status: "candidate" as const,
      },
    ].map((event) => ({
      ...event,
      userId: state.user.id,
      companionId: state.companion.id,
      createdAt: "2026-09-26T00:00:00Z",
    }));
    const onDelete = vi.fn(),
      onChange = vi.fn();
    const props = {
      state,
      onChange,
      onDelete,
      onExport: vi.fn(),
      onUpgrade: vi.fn(),
      onOpenMemory: vi.fn(),
      onOpenActivities: vi.fn(),
    };
    const view = render(<ProfileView {...props} />);
    expect(screen.getByRole("heading", { name: "Free plan" })).toBeTruthy();
    expect(screen.getByText("Anika is my friend")).toBeTruthy();
    expect(
      [...view.container.querySelectorAll(".upcoming-row strong")].map(
        (el) => el.textContent,
      ),
    ).toEqual(["Sooner plan", "Later plan"]);
    expect(screen.queryByText("Old plan")).toBeNull();
    expect(screen.queryByText("Draft plan")).toBeNull();
    expect(screen.getByText("Export local demo")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Store conversation history/ }),
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationStorageEnabled: !state.conversationStorageEnabled,
      }),
    );
    button("Delete");
    expect(
      screen.getByRole("heading", { name: "Delete this Mira demo?" }),
    ).toBeTruthy();
    button("Cancel");
    view.rerender(<ProfileView {...props} liveMode />);
    expect(
      (
        screen.getByRole("checkbox", {
          name: /Server conversation history/,
        }) as HTMLInputElement
      ).disabled,
    ).toBe(true);
  });
});

describe("home and shared life", () => {
  const homeProps = () => ({
    state: viewState(),
    onChat: vi.fn(),
    onCall: vi.fn(),
    onVideoCall: vi.fn(),
    onMoments: vi.fn(),
    onMemory: vi.fn(),
    onCompanion: vi.fn(),
    onSpendTime: vi.fn(),
    onEnvironmentChange: vi.fn(),
    onAmbienceChange: vi.fn(),
  });
  it.each([
    [2, /Still awake/],
    [9, /tweaking this sketch/],
    [14, /saved the good chair/],
    [21, /make tea/],
  ])("greets according to local hour %s", (hour, greeting) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 26, hour as number));
    render(<HomeView {...homeProps()} />);
    expect(
      screen.getByRole("button", { name: greeting as RegExp }),
    ).toBeTruthy();
  });
  it("routes home actions, cycles reactions, respects owned rooms and prioritizes confirmed plans", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T08:00:00Z"));
    const p = homeProps();
    p.state.memories = [memoryFixture({ pinned: true })];
    const view = render(<HomeView {...p} />);
    for (const name of [
      "Message",
      "Start a voice call with Mira",
      "Video",
      "Open companion profile",
      "Open shared moments",
      "Open companion settings",
      /I remembered/,
      /Something for us/,
      /Turn ambience/,
    ])
      button(name);
    for (const callback of [
      p.onChat,
      p.onCall,
      p.onVideoCall,
      p.onMoments,
      p.onMemory,
      p.onCompanion,
      p.onSpendTime,
      p.onAmbienceChange,
    ])
      expect(callback).toHaveBeenCalled();
    for (let n = 0; n < 5; n++) button("Get Mira's attention");
    expect(screen.getByText(/come look at this sketch/)).toBeTruthy();
    act(() => vi.advanceTimersByTime(3400));
    expect(screen.queryByText(/come look at this sketch/)).toBeNull();
    button("Sunny loft");
    fireEvent.click(
      screen.getAllByRole("button", { name: /^Sunny loft/ }).at(-1)!,
    );
    expect(p.onEnvironmentChange).toHaveBeenCalledWith("window-nook");
    button("Sunny loft");
    button(/Sunset rooftop/);
    expect(p.onCompanion).toHaveBeenCalledTimes(3);
    p.state.activeEnvironment = "unknown" as never;
    p.state.ambienceEnabled = true;
    p.state.ownedItems.push({ itemId: "missing" } as never);
    p.state.feedbackSignals = [{ rating: "down" } as never];
    p.state.memories = [
      memoryFixture({ status: "deleted", pinned: true }),
      memoryFixture({ pinned: false }),
      memoryFixture({
        type: "episodic",
        pinned: true,
        content: "Drawing class",
      }),
    ];
    view.rerender(<HomeView {...p} />);
    expect(screen.getByText(/No performance today/)).toBeTruthy();
    expect(screen.queryByText("Drawing class")).toBeNull();
    p.state.futureEvents = [
      {
        id: "e",
        status: "confirmed",
        description: "Drawing class",
        eventDate: "2026-09-26T10:00:00Z",
      },
      {
        id: "e2",
        status: "confirmed",
        description: "Tea",
        eventDate: "2026-09-26T11:00:00Z",
      },
      {
        id: "e3",
        status: "cancelled",
        description: "Old",
        eventDate: "2026-09-26T08:00:00Z",
      },
    ] as never;
    p.state.moments = [
      { id: "m1", title: "Older", date: "2026-09-24" },
      { id: "m2", title: "Recent drawing", date: "2026-09-26" },
    ] as never;
    view.rerender(<HomeView {...p} />);
    expect(
      screen.getByRole("button", {
        name: /I remembered Drawing class. We can/,
      }),
    ).toBeTruthy();
    expect(screen.getByText("Drawing class")).toBeTruthy();
    expect(screen.getByText("Recent drawing")).toBeTruthy();
  });
  it("shows empty and populated albums, approved reflections, activities and call history", () => {
    const p = {
      state: viewState(),
      onCompleteActivity: vi.fn(),
      onStartDate: vi.fn(),
      onGenerateSelfie: vi.fn(),
      onVideoCall: vi.fn(),
      onOpenActivities: vi.fn(),
    };
    const view = render(<MomentsView {...p} />);
    button("Make the first one");
    expect(p.onStartDate).toHaveBeenCalledWith("rooftop", "Rooftop date");
    button("Journal, plans & reminders");
    expect(p.onOpenActivities).toHaveBeenCalled();
    tab("Our photos");
    expect(screen.getByText("Your private album is ready.")).toBeTruthy();
    for (const control of screen.getAllByRole("button", {
      name: "AI selfies unavailable",
    }))
      expect((control as HTMLButtonElement).disabled).toBe(true);
    tab("Her thoughts");
    expect(screen.getByText("Nothing reflected yet.")).toBeTruthy();
    tab("Together");
    for (const control of screen.getAllByRole("button", { name: "Start date" }))
      fireEvent.click(control);
    expect(p.onStartDate).toHaveBeenCalledTimes(4);
    button("Use during a call");
    fireEvent.click(screen.getAllByRole("button", { name: "Begin" })[0]!);
    expect(p.onCompleteActivity).toHaveBeenCalledWith(p.state.activities[0]);
    p.state.completedActivityIds = [p.state.activities[0]!.id];
    p.state.moments = [
      {
        id: "m1",
        title: "First",
        date: "2026-09-25",
        detail: "An actual shared date",
      },
      { id: "m2", title: "Second", date: "2026-09-26" },
    ] as never;
    p.state.photos = [
      { id: "p1", caption: "Sketch", createdAt: "2026-09-25" },
      { id: "p2", caption: "Tea", createdAt: "2026-09-26" },
    ] as never;
    p.state.companionReflections = [
      { id: "r1", title: "One", memoryIds: ["m1"], createdAt: "2026-09-25" },
      {
        id: "r2",
        title: "Two",
        memoryIds: ["m1", "m2"],
        createdAt: "2026-09-26",
      },
    ] as never;
    p.state.calls = [
      { id: "c1", type: "video", durationSeconds: 90, startedAt: "2026-09-25" },
      { id: "c2", type: "voice", durationSeconds: 60, startedAt: "2026-09-26" },
    ] as never;
    view.rerender(<MomentsView {...p} liveMode />);
    expect(
      (screen.getByRole("button", { name: "Done" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    tab("Moments");
    expect(screen.getByText("An actual shared date")).toBeTruthy();
    tab("Our photos");
    expect(screen.getByAltText("Sketch")).toBeTruthy();
    tab("Her thoughts");
    expect(screen.getByText(/1 approved memory/)).toBeTruthy();
    expect(screen.getByText(/2 approved memories/)).toBeTruthy();
    tab("Calls");
    button("Start video call");
    expect(p.onVideoCall).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Video call · 2 min/)).toBeTruthy();
    expect(screen.getByText(/never stored by Mira/)).toBeTruthy();
    view.rerender(<MomentsView {...p} />);
    expect(screen.getByText(/never stored in this demo/)).toBeTruthy();
  });
  it("keeps desktop and mobile navigation equivalent and hides redundant call controls", () => {
    const p = {
      active: "moments" as const,
      onNavigate: vi.fn(),
      onCall: vi.fn(),
      companionName: "Mira",
      relationshipStage: "Friend",
      relationshipLevel: 2,
      children: <p>Main content</p>,
    };
    const view = render(<AppShell {...p} immersive />);
    button("Go to Mira home");
    button("Call Mira");
    expect(p.onCall).toHaveBeenCalled();
    for (const [label, id] of [
      ["Home", "home"],
      ["Chat", "chat"],
      ["Moments", "moments"],
      ["Wardrobe", "companion"],
      ["You", "profile"],
    ]) {
      for (const control of screen.getAllByRole("button", { name: label! })) {
        fireEvent.click(control);
        expect(p.onNavigate).toHaveBeenLastCalledWith(id);
      }
    }
    view.rerender(<AppShell {...p} active="home" immersive={false} />);
    expect(screen.queryByRole("button", { name: "Call Mira" })).toBeNull();
    view.rerender(<AppShell {...p} active="chat" />);
    expect(screen.queryByRole("button", { name: "Call Mira" })).toBeNull();
    const { onCall: _call, ...withoutCall } = p;
    void _call;
    view.rerender(<AppShell {...withoutCall} />);
    expect(screen.queryByRole("button", { name: "Call Mira" })).toBeNull();
  });
});
