import { beforeEach, describe, expect, it, vi } from "vitest";
import { cloudflareAiError } from "./cloudflare-ai-error";

import type { ChatMessage, JournalEntryRecord } from "@companion/shared";
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("./cloud-store", () => ({
  cloudStore: { get: mocks.get, put: mocks.put },
}));
vi.mock("./provider-fetch", () => ({ providerFetch: mocks.fetch }));
import {
  assertVoiceAvailable,
  getVoiceCatalog,
  normalizeVoiceId,
  parseVoiceCatalog,
  validVoiceId,
} from "./voice-catalog";
import {
  reflectionPrompt,
  selectReflectionEntries,
} from "./journal-reflection";
import { matchesSearch, searchMessages } from "./conversation-search";
import {
  DEFAULT_REMINDER,
  inQuietHours,
  nextDaily,
  nextEvent,
  parsePushDevice,
  parseReminderRule,
  validTimezone,
} from "./reminders";
const journal: JournalEntryRecord = {
  id: "j",
  userId: "u",
  title: "Small win",
  content: "I painted a tree.",
  mood: "calm",
  tags: [],
  reflected: false,
  createdAt: "2026-09-24T10:00:00Z",
  updatedAt: "2026-09-24T10:00:00Z",
};
const message: ChatMessage = {
  id: "m",
  conversationId: "c",
  role: "user",
  content: "Ｃａｆé   TIME",
  createdAt: "2026-09-24T10:00:00Z",
  status: "sent",
};
const rule = {
  ...DEFAULT_REMINDER,
  id: "daily",
  kind: "daily" as const,
  timezone: "UTC",
};
const device = {
  endpoint: "https://fcm.googleapis.com/x",
  keys: {
    p256dh: btoa(String.fromCharCode(4) + "x".repeat(64)).replace(/=/g, ""),
    auth: "a".repeat(22),
  },
};
describe("search filters and exact boundaries", () => {
  it("normalizes compatibility Unicode and whitespace, excludes system/unsent and enforces both date bounds", () => {
    expect(matchesSearch(message, { query: "café time" })).toBe(true);
    for (const change of [
      { role: "system" },
      { status: "sending" },
      { status: "failed" },
    ] as const)
      expect(matchesSearch({ ...message, ...change }, { query: "café" })).toBe(
        false,
      );
    for (const options of [
      { from: "2026-09-25" },
      { to: message.createdAt },
      { conversationId: "other" },
      { role: "assistant" as const },
    ])
      expect(matchesSearch(message, { query: "café", ...options })).toBe(false);
    expect(
      matchesSearch(message, {
        query: "café",
        from: message.createdAt,
        to: "2026-09-25",
      }),
    ).toBe(true);
    expect(
      searchMessages(
        [
          message,
          { ...message },
          { ...message, id: "z", createdAt: "2026-09-23" },
        ],
        { query: "café" },
      ).messages.map((m) => m.id),
    ).toEqual(["m", "m", "z"]);
  });
});
describe("explicit journal selection boundaries", () => {
  it.each([
    null,
    [],
    "bad",
    {},
    { entryIds: [] },
    { entryIds: [1] },
    { entryIds: ["../bad"] },
    { entryIds: Array.from({ length: 15 }, (_, i) => `j${i}`) },
    { entryIds: ["j"], extra: true },
    { entryIds: ["j"], language: "French" },
    { entryIds: ["j"] },
    { entryIds: ["j"], entries: [] },
  ])("rejects malformed selections: %j", (value) =>
    expect(() => selectReflectionEntries(value)).toThrow(),
  );
  it.each([
    { title: 2 },
    { title: "x".repeat(121) },
    { content: null },
    { content: " " },
    { content: "x".repeat(12001) },
    { mood: 2 },
    { mood: "x".repeat(41) },
    { createdAt: 3 },
    { createdAt: "nonsense" },
  ])("rejects invalid journal field: %j", (change) =>
    expect(() =>
      selectReflectionEntries({
        entryIds: ["j"],
        entries: [{ ...journal, ...change }],
      }),
    ).toThrow(/invalid/),
  );
  it("rejects missing and excessive combined content; preserves selection order and all supported languages", () => {
    expect(() =>
      selectReflectionEntries({ entryIds: ["j"], entries: [null] }),
    ).toThrow(/deleted/);
    const large = [journal, { ...journal, id: "k" }].map((e) => ({
      ...e,
      content: "x".repeat(12000),
    }));
    expect(() =>
      selectReflectionEntries({ entryIds: ["k", "j"] }, large),
    ).toThrow(/24,000/);
    for (const language of ["English", "Hindi", "Hinglish"] as const) {
      const selection = selectReflectionEntries({
        entryIds: ["j"],
        entries: [journal],
        language,
      });
      expect(selection.language).toBe(language);
      expect(
        reflectionPrompt(selection.entries, language)[0]!.content,
      ).toContain(
        language === "Hindi"
          ? "Devanagari"
          : language === "Hinglish"
            ? "Roman letters"
            : "English",
      );
    }
  });
});
describe("system voice catalogue and cache", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.get.mockResolvedValue(null);
  });
  const page = (ids: string[], nextPageToken?: string) =>
    Response.json({
      voices: ids.map((voiceId) => ({ source: "SYSTEM", voiceId })),
      ...(nextPageToken ? { nextPageToken } : {}),
    });
  it("normalizes the default and rejects invalid identifiers", () => {
    expect(normalizeVoiceId(undefined)).toBe("Priya");
    expect(normalizeVoiceId("mira-natural-01")).toBe("Priya");
    expect(normalizeVoiceId("Ashley")).toBe("Ashley");
    for (const id of [null, "", "a".repeat(81), "../voice"])
      expect(validVoiceId(id)).toBe(false);
    expect(() => parseVoiceCatalog(null)).toThrow();
    expect(() => parseVoiceCatalog({ voices: {} })).toThrow();
    expect(
      parseVoiceCatalog({
        voices: [
          null,
          1,
          { source: "IVC", voiceId: "private" },
          { source: "SYSTEM", voiceId: "invalid/" },
          {
            source: "SYSTEM",
            voiceId: "Zoe",
            displayName: "Z".repeat(110),
            description: "a".repeat(310),
            languageCode: "en_US",
          },
          { source: "SYSTEM", voiceId: "Alex", langCode: "hi_IN" },
          { source: "SYSTEM", voiceId: "Priya" },
        ],
      }),
    ).toMatchObject([
      { id: "Priya", language: "Multilingual" },
      { id: "Alex", language: "hi-IN" },
      {
        id: "Zoe",
        name: "Z".repeat(100),
        description: "a".repeat(300),
        language: "en-US",
      },
    ]);
  });
  it("loads every page, deduplicates, sorts default first, caches and strips Basic prefix", async () => {
    mocks.fetch
      .mockResolvedValueOnce(page(["Zoe", "Alex"], "next"))
      .mockResolvedValueOnce(page(["Alex", "Priya", "Ashley"]));
    const signal = new AbortController().signal;
    expect(
      (await getVoiceCatalog("Basic secret", signal)).map((v) => v.id),
    ).toEqual(["Priya", "Alex", "Ashley", "Zoe"]);
    expect(mocks.fetch.mock.calls[1]?.[0]).toContain("pageToken=next");
    expect(mocks.fetch.mock.calls[0]?.[1].headers.authorization).toBe(
      "Basic secret",
    );
    expect(mocks.put).toHaveBeenCalledWith(
      "voice-catalog:system:v1",
      expect.any(String),
      { expirationTtl: 3600 },
    );
    mocks.get.mockResolvedValue(mocks.put.mock.calls[0]?.[1]);
    await assertVoiceAvailable("Ashley", "secret");
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    await expect(
      assertVoiceAvailable("Retired", "secret"),
    ).rejects.toMatchObject({ status: 422 });
    await expect(assertVoiceAvailable("../private", "secret")).rejects.toThrow(
      /library/,
    );
    await assertVoiceAvailable("Priya", "secret");
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
  it("fails closed on upstream failures, empty and truncated catalogues", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(getVoiceCatalog("key")).rejects.toMatchObject({ status: 503 });
    mocks.fetch.mockResolvedValueOnce(page([]));
    await expect(getVoiceCatalog("key")).rejects.toThrow(/incomplete/);
    mocks.fetch.mockImplementation(() =>
      Promise.resolve(page(["Ashley"], "endless")),
    );
    await expect(getVoiceCatalog("key")).rejects.toThrow(/incomplete/);
    expect(mocks.put).not.toHaveBeenCalled();
  });
});
describe("reminder input and scheduling limits", () => {
  it.each([
    null,
    [],
    2,
    { ...rule, kind: "other" },
    { ...rule, enabled: 1 },
    { ...rule, timezone: 2 },
    { ...rule, time: 2 },
    { ...rule, minutesBefore: 7 },
    { ...rule, kind: "event" },
    { ...rule, kind: "event", eventId: "../x" },
  ])("rejects malformed schedules: %j", (value) =>
    expect(() => parseReminderRule(value)).toThrow(),
  );
  it("canonicalizes plan IDs and validates timezone lengths", () => {
    expect(parseReminderRule({ ...rule, kind: "event", eventId: "p" }).id).toBe(
      "event:p",
    );
    expect(validTimezone("x".repeat(81))).toBe(false);
    expect(validTimezone(null)).toBe(false);
  });
  it.each([
    null,
    {},
    { ...device, endpoint: "x".repeat(2049) },
    { ...device, endpoint: "not a url" },
    { ...device, endpoint: "https://fcm.googleapis.com/x#fragment" },
    { ...device, keys: null },
    { ...device, keys: { ...device.keys, auth: "bad" } },
    { ...device, keys: { ...device.keys, p256dh: "a".repeat(87) } },
    { ...device, expirationTime: 0 },
    { ...device, expirationTime: Infinity },
  ])("rejects malformed subscriptions: %j", (value) =>
    expect(() => parsePushDevice(value)).toThrow(),
  );
  it.each([
    "fcm.googleapis.com",
    "web.push.apple.com",
    "push.services.mozilla.com",
    "updates.push.services.mozilla.com",
    "wns.notify.windows.com",
  ])("accepts supported HTTPS push service %s", (hostname) =>
    expect(
      parsePushDevice({
        ...device,
        endpoint: `https://${hostname}/x`,
        expirationTime: Date.now() + 60000,
      }).endpoint,
    ).toContain(hostname),
  );
  it("handles daytime quiet hours, disabled quiet hours and expired event schedules", () => {
    expect(inQuietHours("12:00", "12:00", "13:00")).toBe(true);
    expect(inQuietHours("13:00", "12:00", "13:00")).toBe(false);
    expect(inQuietHours("12:00", "12:00", "12:00")).toBe(false);
    expect(nextEvent(rule, Date.now() - 1, Date.now())).toBeNull();
    expect(() =>
      nextDaily({ ...rule, time: "25:00" }, Date.parse("2026-09-24")),
    ).toThrow(/schedule/);
    expect(parsePushDevice(device).expirationTime).toBeNull();
  });
});

describe("Cloudflare AI failure classification", () => {
  it.each([
    "3036: account limited",
    "4006: AiError: you have used up your daily free allocation of 10,000 neurons",
  ])(
    "explains a known free-quota error without disclosing provider details",
    (message) => {
      const error = cloudflareAiError(
        new Error(message),
        Date.parse("2026-09-25T23:59:30Z"),
      );
      expect(error).toMatchObject({
        status: 429,
        code: "PROVIDER_DAILY_QUOTA",
        retryAfterSeconds: 30,
      });
      expect(error!.message).toContain("00:00 UTC");
      expect(error!.message).not.toContain("AiError");
    },
  );
  it("distinguishes busy, timed-out and unknown providers, and bounds midnight retry", () => {
    expect(
      cloudflareAiError(new Error("3040: capacity exceeded")),
    ).toMatchObject({ code: "PROVIDER_BUSY", retryAfterSeconds: 2 });
    expect(
      cloudflareAiError(new DOMException("private", "TimeoutError")),
    ).toMatchObject({ code: "PROVIDER_TIMEOUT" });
    expect(
      cloudflareAiError(new Error("3036"), Date.parse("2026-09-26T00:00:00Z")),
    ).toMatchObject({ retryAfterSeconds: 86400 });
    for (const error of [
      null,
      "3036",
      new Error("429 rate limited"),
      new Error("4006 unknown gateway error"),
    ])
      expect(cloudflareAiError(error)).toBeNull();
  });
});
