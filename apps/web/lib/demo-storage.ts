import { initialState, type DemoState } from "./state";

export const demoSchemaVersion = 2;
export function freshDemo(): DemoState {
  const state = structuredClone(initialState);
  return {
    ...state,
    user: {
      ...state.user,
      name: "Friend",
      adultConfirmed: false,
      birthday: "",
    },
    companion: { ...state.companion, relationshipMode: "friend" },
    relationship: {
      ...state.relationship,
      stage: "New",
      level: 1,
      progress: 0,
      romanticOptIn: false,
      sensualOptIn: false,
      romance: 0,
      sensuality: 0,
    },
    onboardingComplete: true,
    firstMeetingComplete: true,
    currentView: "home",
    activeConversationId: crypto.randomUUID(),
    messages: [],
    memories: [],
    calls: [],
    journalEntries: [],
    futureEvents: [],
    nudges: [],
    feedbackSignals: [],
    companionReflections: [],
    moments: [],
    photos: [],
    mediaLibrary: [],
  };
}
export function restoreDemo(raw: string | null): {
  state: DemoState;
  migrated: boolean;
} {
  if (!raw) return { state: freshDemo(), migrated: false };
  const envelope = JSON.parse(raw);
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope))
    throw new Error("Invalid saved demo");
  if (
    typeof envelope.schemaVersion === "number" &&
    envelope.schemaVersion > demoSchemaVersion
  )
    throw new Error(
      "This browser has newer demo data. Refresh Mira before using it.",
    );
  const parsed = (
    envelope.schemaVersion ? envelope.state : envelope
  ) as Partial<DemoState>;
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.messages))
    throw new Error(
      "Saved demo is damaged. Export or reset it before continuing.",
    );
  const base = freshDemo();
  const state: DemoState = {
    ...base,
    ...parsed,
    onboardingComplete: true,
    firstMeetingComplete: true,
    user: { ...base.user, ...parsed.user },
    companion: { ...base.companion, ...parsed.companion },
    relationship: { ...base.relationship, ...parsed.relationship },
    responsePreferences: {
      ...base.responsePreferences,
      ...parsed.responsePreferences,
    },
  };
  for (const key of [
    "messages",
    "memories",
    "calls",
    "futureEvents",
    "journalEntries",
    "nudges",
    "feedbackSignals",
    "companionReflections",
  ] as const) {
    if (!Array.isArray(state[key]))
      throw new Error(
        "Saved demo needs a reset. Your saved data has not been overwritten.",
      );
  }
  return { state, migrated: envelope.schemaVersion !== demoSchemaVersion };
}
export function serializeDemo(state: DemoState) {
  return JSON.stringify({
    schemaVersion: demoSchemaVersion,
    savedAt: new Date().toISOString(),
    state: state.conversationStorageEnabled
      ? state
      : { ...state, messages: [] },
  });
}
