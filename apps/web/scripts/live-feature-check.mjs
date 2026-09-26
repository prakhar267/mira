import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { initialState } from "../lib/state.ts";

// Explicit operator invocation only, never CI. Fixed budget: one synthetic
// account, one reflection (<=900 output tokens), one preset preview and one
// short synthesis. No emails or push subscriptions; account erased in finally.
if (!process.argv.includes("--run-live"))
  throw Error("Explicit --run-live required");
const origin = "https://luma-companion.prakhargupta267.workers.dev";
const directory = resolve(
  import.meta.dirname,
  `../test-results/live-features-${Date.now()}`,
);
await mkdir(directory, { recursive: true });
const results = [];
let cookie = "",
  voice = "",
  accountCreated = false;
const call = (path, { method = "GET", body } = {}) =>
  fetch(origin + path, {
    method,
    headers: {
      origin,
      ...(cookie ? { cookie } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(35000),
    redirect: "error",
  });
const check = (condition, message) => {
  if (!condition) throw Error(message);
};
const step = async (name, work) => {
  const start = Date.now();
  try {
    await work();
    results.push({ name, passed: true, ms: Date.now() - start });
    console.log(`PASS ${name}`);
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : "Check failed";
    results.push({ name, passed: false, ms: Date.now() - start, error });
    console.log(`FAIL ${name}: ${error}`);
    process.exitCode = 1;
    if (!accountCreated) throw cause;
  }
};
const json = async (path, options, status = 200) => {
  const response = await call(path, options);
  if (response.status !== status) {
    const detail = await response.json().catch(() => ({}));
    throw Error(
      `${path.split("?")[0]} HTTP ${response.status}: ${detail.code ?? "unknown"} ${String(detail.error ?? "").slice(0, 240)}`,
    );
  }
  return response.json();
};
const password = `Synthetic-only-${randomUUID()}!`;
try {
  let current;
  await step("create isolated synthetic QA account", async () => {
    const state = structuredClone(initialState);
    Object.assign(state, {
      onboardingComplete: true,
      firstMeetingComplete: true,
      messages: [],
      memories: [],
      calls: [],
      journalReflections: [],
      futureEvents: [],
      memoryEnabled: false,
    });
    state.user.adultConfirmed = true;
    state.activeConversationId = randomUUID();
    state.messages = [
      {
        id: "qa-message",
        conversationId: state.activeConversationId,
        role: "user",
        content: "Synthetic QA discussion about Pune",
        createdAt: new Date().toISOString(),
        status: "sent",
      },
    ];
    state.journalEntries = ["selected", "excluded"].map((id) => ({
      id,
      userId: state.user.id,
      title: id === "selected" ? "A small drawing" : "UNSELECTED_QA_CANARY",
      content:
        id === "selected"
          ? "I made a small pencil drawing of a tree today. I enjoyed taking ten minutes for it."
          : "UNSELECTED_QA_CANARY",
      mood: "calm",
      tags: [],
      reflected: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    const response = await call("/api/account/signup", {
      method: "POST",
      body: {
        email: `mira-live-qa-${randomUUID()}@example.test`,
        password,
        name: "Synthetic QA",
        state,
        policy: {
          termsVersion: "2026-09-13",
          adultConfirmed: true,
          aiProcessingConsent: true,
        },
      },
    });
    check(response.status === 201, `Signup HTTP ${response.status}`);
    cookie = response.headers.get("set-cookie").split(";")[0];
    accountCreated = true;
    current = await response.json();
  });
  await step(
    "search persisted transcript and surrounding context",
    async () => {
      const result = await json("/api/account/search?q=Pune");
      check(
        result.messages.length === 1 && result.messages[0].id === "qa-message",
        "Saved search mismatch",
      );
      const context = await json("/api/account/search?messageId=qa-message");
      check(
        context.messages.some((m) => m.id === "qa-message"),
        "Saved context missing",
      );
    },
  );
  await step("real AI reflection on one selected journal", async () => {
    const result = await json("/api/journal-reflection", {
      method: "POST",
      body: { entryIds: ["selected"], language: "English" },
    });
    check(
      result.entryIds.length === 1 &&
        result.entryIds[0] === "selected" &&
        result.summary.length > 40,
      "Reflection incomplete",
    );
    check(
      !result.summary.includes("UNSELECTED_QA_CANARY"),
      "Unselected entry appeared in reflection",
    );
  });
  await step(
    "real system voice catalogue and preset audio preview",
    async () => {
      const result = await json("/api/voices");
      check(
        result.voices.some((v) => v.id === "Priya") && result.voices.length > 1,
        "Voice choices missing",
      );
      voice = result.voices.find((v) => v.id !== "Priya").id;
      const preview = await call(
        `/api/voices/preview?voiceId=${encodeURIComponent(voice)}`,
      );
      check(
        preview.status === 200 &&
          preview.headers.get("content-type") === "audio/mpeg",
        `Preview HTTP ${preview.status}`,
      );
      check(
        (await preview.arrayBuffer()).byteLength > 100,
        "Preview audio empty",
      );
    },
  );
  await step(
    "persist selected voice and synthesize a short real sample",
    async () => {
      check(Boolean(voice), "No voice available from catalogue");
      current = await json("/api/account/state");
      current.state.companion.voiceId = voice;
      await json("/api/account/state", {
        method: "PUT",
        body: { state: current.state, revision: current.revision },
      });
      check(
        (await json("/api/account/state")).state.companion.voiceId === voice,
        "Voice persistence failed",
      );
      const speech = await call("/api/companion-speech", {
        method: "POST",
        body: { text: "Hello, this is a brief test.", voiceId: voice },
      });
      check(speech.status === 200, `Speech HTTP ${speech.status}`);
      check(
        (await speech.arrayBuffer()).byteLength > 100,
        "Speech audio empty",
      );
    },
  );
  await step(
    "reminders stay opt-in and a paused schedule persists",
    async () => {
      const before = await json("/api/account/reminders");
      check(
        !before.devices.length && !before.rules.length,
        "Reminders unexpectedly enabled",
      );
      const rule = {
        id: "daily",
        kind: "daily",
        enabled: false,
        timezone: "UTC",
        time: "19:00",
        quietStart: "22:00",
        quietEnd: "08:00",
        minutesBefore: 30,
      };
      await json("/api/account/reminders", {
        method: "POST",
        body: { action: "save", rule },
      });
      const saved = await json("/api/account/reminders");
      check(
        saved.rules[0]?.enabled === false && saved.rules[0]?.nextAt === null,
        "Paused reminder did not persist",
      );
      const denied = await call("/api/account/reminders", {
        method: "POST",
        body: { action: "save", rule: { ...rule, enabled: true } },
      });
      check(
        denied.status === 400,
        "Enabled reminder accepted without device opt-in",
      );
    },
  );
} catch {
  process.exitCode = 1;
} finally {
  if (accountCreated) {
    try {
      await step("delete QA account and invalidate its session", async () => {
        await json("/api/account/reauth", {
          method: "POST",
          body: { password },
        });
        const removed = await json("/api/account/delete", { method: "DELETE" });
        check(removed.deleted === true, "QA account deletion failed");
        const denied = await call("/api/account/search?q=Pune");
        check(denied.status === 401, "Deleted account session still active");
      });
    } catch {
      process.exitCode = 1;
    }
  }
  await writeFile(
    resolve(directory, "results.json"),
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        origin,
        scope:
          "finite synthetic live API check; no acoustic or physical push-device assertion",
        results,
      },
      null,
      2,
    ),
  );
}
