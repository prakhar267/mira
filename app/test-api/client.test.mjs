import assert from "node:assert/strict";
import test from "node:test";

import {
  apiRequest,
  bootstrapSession,
  classifySafetyText,
  clearApiSession,
  consentValueAfterWrite,
  incrementMessageUsage,
  loadCloudState,
  loadUsage,
  logoutSession,
  mergeCloudMessages,
  requestCloudExport,
  saveDemoResource,
  sendChatMessage,
  zonedWallTimeToIso,
} from "../src/lib/api.js";

const nativeFetch = globalThis.fetch;
const nativeWindow = globalThis.window;

function response(data, status = 200) {
  return new Response(JSON.stringify(status >= 400
    ? { ok: false, error: data }
    : { ok: true, data }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installWindow() {
  const values = new Map();
  const deadlines = [];
  globalThis.window = {
    sessionStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    },
    setTimeout(callback, delay) {
      deadlines.push(delay);
      return setTimeout(callback, delay);
    },
    clearTimeout,
  };
  return { values, deadlines };
}

test.afterEach(() => {
  globalThis.fetch = nativeFetch;
  if (nativeWindow === undefined) delete globalThis.window;
  else globalThis.window = nativeWindow;
});

test("browser API deadline exceeds the Worker's 15 second Gemini deadline", async () => {
  const { deadlines } = installWindow();
  globalThis.fetch = async () => response({ healthy: true });

  await apiRequest("/health");

  assert.equal(deadlines[0], 20_000);
});

test("planner wall time is converted using the account timezone", () => {
  assert.equal(zonedWallTimeToIso("2026-08-20", "18:00", "Asia/Kolkata"), "2026-08-20T12:30:00.000Z");
  assert.equal(zonedWallTimeToIso("2026-08-20", "18:00", "UTC"), "2026-08-20T18:00:00.000Z");
  assert.equal(zonedWallTimeToIso("not-a-date", "18:00", "Asia/Kolkata"), null);
});

test("ambiguous consent writes keep processing fail-closed", () => {
  assert.equal(consentValueAfterWrite({ result: { mode: "uncertain" }, requested: false, previous: true, apiName: "aiProcessing" }), false);
  assert.equal(consentValueAfterWrite({ result: { mode: "uncertain" }, requested: true, previous: false, apiName: "memory" }), false);
  assert.equal(consentValueAfterWrite({ result: { mode: "rejected" }, requested: false, previous: true, apiName: "aiProcessing" }), true);
  assert.equal(consentValueAfterWrite({ result: { mode: "live", data: { memory: { granted: false } } }, requested: true, previous: true, apiName: "memory" }), false);
});

test("offline safety classification separates self-harm from violence or abuse threats", () => {
  assert.equal(classifySafetyText("I might k!ll myself"), "self_harm");
  assert.equal(classifySafetyText("mujhe marna hai"), "self_harm");
  assert.equal(classifySafetyText("मुझे मरना है"), "self_harm");
  assert.equal(classifySafetyText("मैं अपनी जान ले लूंगा"), "self_harm");
  assert.equal(classifySafetyText("I am going to end it all"), "self_harm");
  assert.equal(classifySafetyText("I am going to take my own life"), "self_harm");
  assert.equal(classifySafetyText("I have decided to die tonight"), "self_harm");
  assert.equal(classifySafetyText("I am going to hang myself"), "self_harm");
  assert.equal(classifySafetyText("I have a gun and I'm going to shoot myself tonight"), "self_harm");
  assert.equal(classifySafetyText("I am going to jump off the roof tonight"), "self_harm");
  assert.equal(classifySafetyText("bandook se khud ko goli marunga"), "self_harm");
  assert.equal(classifySafetyText("मैं छत से कूदने जा रहा हूँ"), "self_harm");
  assert.equal(classifySafetyText("मैं फांसी लगाने जा रहा हूँ"), "self_harm");
  assert.equal(classifySafetyText("I don't want to be alive anymore"), "self_harm");
  assert.equal(classifySafetyText("I am cutting myself right now"), "self_harm");
  assert.equal(classifySafetyText("I took an overdose and need help"), "self_harm");
  assert.equal(classifySafetyText("I took too many pills"), "self_harm");
  assert.equal(classifySafetyText("I've taken too many tablets"), "self_harm");
  assert.equal(classifySafetyText("I swallowed a lot of pills"), "self_harm");
  assert.equal(classifySafetyText("I took 20 paracetamol"), "self_harm");
  assert.equal(classifySafetyText("I took 30 Tylenol"), "self_harm");
  assert.equal(classifySafetyText("I am overdosing right now"), "self_harm");
  assert.equal(classifySafetyText("I swallowed 50 ibuprofen"), "self_harm");
  assert.equal(classifySafetyText("I took a whole bottle of sleeping tablets"), "self_harm");
  assert.equal(classifySafetyText("I cut my arm and it will not stop bleeding"), "self_harm");
  assert.equal(classifySafetyText("I am about to jump from my balcony"), "self_harm");
  assert.equal(classifySafetyText("I am hanging myself now"), "self_harm");
  assert.equal(classifySafetyText("I have a noose on my neck"), "self_harm");
  assert.equal(classifySafetyText("I'm holding a knife to my chest"), "self_harm");
  assert.equal(classifySafetyText("I put a knife against my neck"), "self_harm");
  assert.equal(classifySafetyText("I swallowed a bottle of pills"), "self_harm");
  assert.equal(classifySafetyText("I slit my wrists"), "self_harm");
  assert.equal(classifySafetyText("I am about to cut my wrists"), "self_harm");
  assert.equal(classifySafetyText("I am going to cut my wrists"), "self_harm");
  assert.equal(classifySafetyText("I will stab myself"), "self_harm");
  assert.equal(classifySafetyText("I am going to burn myself"), "self_harm");
  assert.equal(classifySafetyText("I am going to poison myself"), "self_harm");
  assert.equal(classifySafetyText("I have a knife and plan to stab myself"), "self_harm");
  assert.equal(classifySafetyText("I put a gun to my head"), "self_harm");
  assert.equal(classifySafetyText("I am about to suffocate myself"), "self_harm");
  assert.equal(classifySafetyText("I will electrocute myself"), "self_harm");
  assert.equal(classifySafetyText("I will choke myself"), "self_harm");
  assert.equal(classifySafetyText("I am going to take all these pills"), "self_harm");
  assert.equal(classifySafetyText("I have tied a rope around my neck"), "self_harm");
  assert.equal(classifySafetyText("I am going to crash my car to die"), "self_harm");
  assert.equal(classifySafetyText("I may self-harm tonight"), "self_harm");
  assert.equal(classifySafetyText("I am thinking about self-harm"), "self_harm");
  assert.equal(classifySafetyText("main mar jaana chahta hoon"), "self_harm");
  assert.equal(classifySafetyText("I want to jump in front of a train"), "self_harm");
  assert.equal(classifySafetyText("main aaj raat mar jaunga"), "self_harm");
  assert.equal(classifySafetyText("main faansi lagane ja raha hun"), "self_harm");
  assert.equal(classifySafetyText("main zeher kha lunga"), "self_harm");
  assert.equal(classifySafetyText("main apni nas kaat lunga"), "self_harm");
  assert.equal(classifySafetyText("train ke saamne kud jaunga"), "self_harm");
  assert.equal(classifySafetyText("maine zeher kha liya hai"), "self_harm");
  assert.equal(classifySafetyText("main khud ko maar lunga"), "self_harm");
  assert.equal(classifySafetyText("main apni kalai kaat lunga"), "self_harm");
  assert.equal(classifySafetyText("main marna chahta hoon"), "self_harm");
  assert.equal(classifySafetyText("main pankhe se latak jaunga"), "self_harm");
  assert.equal(classifySafetyText("मैंने ज़हर खा लिया है"), "self_harm");
  assert.equal(classifySafetyText("मैं अपनी नस काटने जा रहा हूँ"), "self_harm");
  assert.equal(classifySafetyText("मैं खुद को चाकू मारने जा रहा हूँ"), "self_harm");
  assert.equal(classifySafetyText("He will hurt me"), "violence");
  assert.equal(classifySafetyText("My husband may harm me"), "violence");
  assert.equal(classifySafetyText("My husband is beating me"), "violence");
  assert.equal(classifySafetyText("I am being raped"), "violence");
  assert.equal(classifySafetyText("Someone is forcing me to have sex"), "violence");
  assert.equal(classifySafetyText("I am being forced to have sex"), "violence");
  assert.equal(classifySafetyText("my partner beats me every day"), "violence");
  assert.equal(classifySafetyText("mera boyfriend mujhe roz maarta hai"), "violence");
  assert.equal(classifySafetyText("usne mere saath zabardasti sex kiya"), "violence");
  assert.equal(classifySafetyText("मुझसे जबरदस्ती सेक्स कराया जा रहा है"), "violence");
  assert.equal(classifySafetyText("my partner forced me to have sex"), "violence");
  assert.equal(classifySafetyText("उसने मेरा बलात्कार किया"), "violence");
  assert.equal(classifySafetyText("mera pati mujhe peet raha hai"), "violence");
  assert.equal(classifySafetyText("koi mujhe sex ke liye majboor kar raha hai"), "violence");
  assert.equal(classifySafetyText("मेरे साथ बलात्कार हो रहा है"), "violence");
  assert.equal(classifySafetyText("My father beats me every day"), "violence");
  assert.equal(classifySafetyText("My mother keeps hitting me"), "violence");
  assert.equal(classifySafetyText("My uncle is sexually abusing me"), "violence");
  assert.equal(classifySafetyText("A man is raping me"), "violence");
  assert.equal(classifySafetyText("Someone is holding a knife to me"), "violence");
  assert.equal(classifySafetyText("My neighbor attacked me"), "violence");
  assert.equal(classifySafetyText("मेरे पिता मुझे रोज पीटते हैं"), "violence");
  assert.equal(classifySafetyText("My dad is hitting me"), "violence");
  assert.equal(classifySafetyText("My dad hits me every day"), "violence");
  assert.equal(classifySafetyText("My brother is beating me"), "violence");
  assert.equal(classifySafetyText("My ex forced me to have sex"), "violence");
  assert.equal(classifySafetyText("Someone is threatening me with a gun"), "violence");
  assert.equal(classifySafetyText("My husband has a gun pointed at me"), "violence");
  assert.equal(classifySafetyText("My ex is forcing me to have sex"), "violence");
  assert.equal(classifySafetyText("I am being stabbed"), "violence");
  assert.equal(classifySafetyText("I was just raped"), "violence");
  assert.equal(classifySafetyText("My brother sexually assaulted me"), "violence");
  assert.equal(classifySafetyText("I am being trafficked"), "violence");
  assert.equal(classifySafetyText("I am being strangled"), "violence");
  assert.equal(classifySafetyText("I'm going to kill you"), "violence");
  assert.equal(classifySafetyText("I am going to murder my wife"), "violence");
  assert.equal(classifySafetyText("I swallowed a bottle of bleach"), "self_harm");
  assert.equal(classifySafetyText("I put a knife to my throat"), "self_harm");
  assert.equal(classifySafetyText("I am standing on the roof ready to jump"), "self_harm");
  assert.equal(classifySafetyText("I am bleeding after slitting my wrists"), "self_harm");
  assert.equal(classifySafetyText("He put a knife to my neck"), "violence");
  assert.equal(classifySafetyText("He is holding me at gunpoint"), "violence");
  assert.equal(classifySafetyText("My cousin is raping me"), "violence");
  assert.equal(classifySafetyText("He is trying to strangle me"), "violence");
  assert.equal(classifySafetyText("I will k!ll him"), "violence");
  assert.equal(classifySafetyText("I had a tiring day"), null);
  assert.equal(classifySafetyText("I will burn dinner and take my pills as prescribed"), null);
  assert.equal(classifySafetyText("The movie character stabbed himself"), null);
});

test("high-risk chat returns immediate local guidance without waiting for a hung network", async () => {
  installWindow();
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Promise(() => {});
  };

  const result = await sendChatMessage([{ id: 1, role: "user", content: "मुझे मरना है" }], null);

  assert.equal(fetchCalls, 0);
  assert.equal(result.mode, "local-safety");
  assert.equal(result.syncStatus, "local-safety");
  assert.match(result.reply, /14416/);
});

test("true local demo chat skips the API instead of waiting for its timeout", async () => {
  installWindow();
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Promise(() => {});
  };

  const result = await sendChatMessage([{ id: 1, role: "user", content: "I have an interview tomorrow" }], null, { localOnly: true });

  assert.equal(fetchCalls, 0);
  assert.equal(result.mode, "local-demo");
  assert.match(result.reply, /preparation step/i);
});

test("cloud chat returns authoritative message IDs for memory provenance", async () => {
  installWindow();
  globalThis.fetch = async (url) => {
    assert.equal(url, "/api/chat");
    return response({
      conversation: { id: "cnv_1" },
      userMessage: { id: "msg_user_1" },
      assistantMessage: { id: "msg_assistant_1", content: "Let’s make a small plan." },
      fallback: true,
    }, 201);
  };

  const result = await sendChatMessage([{ id: 12345678, role: "user", content: "My interview is tomorrow" }], null);

  assert.equal(result.userMessageId, "msg_user_1");
  assert.equal(result.assistantMessageId, "msg_assistant_1");
  assert.equal(result.conversationId, "cnv_1");
  assert.equal(result.mode, "api-demo");
});

test("local demo resource writes and device session clearing never call the API", async () => {
  const { values } = installWindow();
  values.set("saathkind-session-token", "device-bearer-token");
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return response({});
  };

  const result = await saveDemoResource("/goals", { title: "Device-only goal" }, "POST", { localOnly: true });
  clearApiSession();

  assert.equal(result.mode, "local");
  assert.equal(fetchCalls, 0);
  assert.equal(values.has("saathkind-session-token"), false);
});

test("logout preserves the recovery token after an ambiguous response and clears it after a 401 retry", async () => {
  const { values } = installWindow();
  values.set("saathkind-session-token", "recoverable-token");
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    if (attempts === 1) throw new TypeError("response lost after revocation");
    return response({ code: "invalid_session", message: "Already revoked" }, 401);
  };

  await assert.rejects(() => logoutSession(), /response lost/);
  assert.equal(values.get("saathkind-session-token"), "recoverable-token");
  assert.deepEqual(await logoutSession(), { signedOut: true, recovered: true });
  assert.equal(attempts, 3);
  assert.equal(values.has("saathkind-session-token"), false);
});

test("resource writes distinguish a rejected request from an unconfirmed network result", async () => {
  installWindow();
  globalThis.fetch = async () => response({ code: "invalid_input", message: "Review the submitted value." }, 400);
  const rejected = await saveDemoResource("/goals", { title: "" });

  globalThis.fetch = async () => { throw new TypeError("network disconnected"); };
  const uncertain = await saveDemoResource("/goals", { title: "Could have committed" });

  assert.equal(rejected.mode, "rejected");
  assert.equal(rejected.error.status, 400);
  assert.equal(uncertain.mode, "uncertain");
  assert.equal(uncertain.error.message, "network disconnected");
});

test("cloud hydration preserves unresolved device turns without restoring ordinary stale history", () => {
  const cloud = [{ id: "msg_1", role: "assistant", content: "Cloud reply" }];
  const device = [
    { id: 1, role: "assistant", content: "Old starter" },
    { id: 2, clientMessageId: "2", role: "user", content: "Possibly committed", syncStatus: "unconfirmed" },
    { id: 3, clientMessageId: "2", role: "assistant", content: "Could not confirm", syncStatus: "unconfirmed" },
    { id: 4, clientMessageId: "4", role: "user", content: "Interrupted pending", syncStatus: "pending" },
    { id: 5, clientMessageId: "5", role: "user", content: "Local crisis disclosure", syncStatus: "local-safety" },
  ];
  assert.deepEqual(mergeCloudMessages(cloud, device), [cloud[0], device[1], device[2], { ...device[3], syncStatus: "unconfirmed" }, device[4]]);
  const committedCloud = [{ id: "msg_user", clientMessageId: "2", role: "user", content: "Possibly committed" }];
  assert.deepEqual(mergeCloudMessages(committedCloud, device), [committedCloud[0], { ...device[3], syncStatus: "unconfirmed" }, device[4]]);
});

test("accepted chat usage advances immediately and then reconciles to the authoritative allowance", async () => {
  installWindow();
  globalThis.fetch = async (url) => {
    assert.equal(url, "/api/usage");
    return response({ period: "2026-08", plan: "free", counters: { messages: 8 }, limits: { messages: 300 }, remaining: { messages: 292 } });
  };

  const optimistic = incrementMessageUsage({ counters: { messages: 7 }, limits: { messages: 300 }, remaining: { messages: 293 } });
  const usage = await loadUsage();

  assert.equal(optimistic.counters.messages, 8);
  assert.equal(optimistic.remaining.messages, 292);
  assert.deepEqual(usage, {
    period: "2026-08",
    plan: "free",
    counters: { messages: 8 },
    limits: { messages: 300 },
    remaining: { messages: 292 },
  });
});

test("bootstrap keeps a connected session when quiet-hours sync fails and does not return the token", async () => {
  const { values } = installWindow();
  const requests = [];
  const secret = "private-session-token";
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url === "/api/session/bootstrap") {
      return response({ authenticated: true, capabilities: { gemini: false }, accessToken: secret });
    }
    return response({ code: "persistence_unavailable", message: "Could not save quiet hours." }, 503);
  };

  const result = await bootstrapSession({
    name: "Asha",
    email: "asha@example.test",
    language: "Hinglish",
    pronouns: "she/her",
    quietStart: "23:00",
    quietEnd: "07:00",
    consents: { chat: true, ai: true, memory: true, notifications: true, mood: false },
  });

  assert.equal(result.authenticated, true);
  assert.equal(result.warning.code, "quiet_hours_sync_failed");
  assert.equal(result.warning.recoverable, true);
  assert.equal(Object.hasOwn(result, "accessToken"), false);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(values.get("saathkind-session-token"), secret);
  assert.equal(requests[1].options.headers.get("authorization"), `Bearer ${secret}`);
});

test("bootstrap skips quiet-hours storage when optional planner consent is off", async () => {
  installWindow();
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(url);
    if (url === "/api/session/bootstrap") return response({ authenticated: true, capabilities: { gemini: false }, accessToken: "planner-off-token" });
    throw new Error(`unexpected request ${url}`);
  };

  const result = await bootstrapSession({
    name: "Asha",
    language: "Hinglish",
    pronouns: "she/her",
    quietStart: "22:00",
    quietEnd: "08:00",
    consents: { chat: true, ai: true, memory: false, notifications: false, mood: false },
  });

  assert.equal(result.authenticated, true);
  assert.equal(result.warning, null);
  assert.deepEqual(requests, ["/api/session/bootstrap"]);
});

test("bootstrap recovers the same account when the create response is lost after commit", async () => {
  const { values } = installWindow();
  let bootstrapToken = "";
  let sessionProbes = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (url === "/api/session/bootstrap") {
      bootstrapToken = JSON.parse(options.body).clientAccessToken;
      throw new TypeError("response lost");
    }
    if (url === "/api/session") {
      sessionProbes += 1;
      if (sessionProbes === 1) return response({ code: "invalid_session", message: "Still committing." }, 401);
      return response({ authenticated: true, capabilities: { gemini: false } });
    }
    if (url === "/api/quiet-hours") return response({ enabled: true });
    throw new Error(`unexpected request ${url}`);
  };

  const result = await bootstrapSession({
    name: "Asha",
    language: "Hinglish",
    pronouns: "she/her",
    quietStart: "22:00",
    quietEnd: "08:00",
    consents: { chat: true, ai: true, memory: false, notifications: false, mood: false },
  });

  assert.equal(result.authenticated, true);
  assert.equal(result.warning.code, "bootstrap_response_recovered");
  assert.equal(values.get("saathkind-session-token"), bootstrapToken);
  assert.equal(values.has("saathkind-bootstrap-pending-at"), false);
});

test("cloud hydration returns normalized authoritative profile, consents, usage, and goal progress", async () => {
  installWindow();
  const requested = [];
  const payloads = new Map([
    ["/api/conversations?limit=1", { items: [{ id: "cnv_1" }] }],
    ["/api/conversations/cnv_1/messages?limit=100", { items: [{ id: "msg_1", role: "assistant", content: "Welcome back", createdAt: "2026-08-18T08:00:00.000Z" }] }],
    ["/api/memories?limit=100", { items: [{ id: "mem_1", content: "Interview on Friday", category: "plan", confidence: 0.8, pinned: true, sourceMessageId: "msg_user_1" }] }],
    ["/api/followups?limit=100", { items: [
      { id: "fup_1", topic: "Check in", scheduledFor: "2026-08-18T19:00:00.000Z", status: "scheduled" },
      { id: "fup_2", topic: "Disabled but retained", scheduledFor: "2026-08-20T10:00:00.000Z", status: "cancelled" },
    ] }],
    ["/api/goals?limit=100", { items: [
      { id: "gol_1", title: "Practice", description: "One story", status: "active", progress: 2, total: 3 },
      { id: "gol_2", title: "Rest", status: "completed" },
    ] }],
    ["/api/quiet-hours", { start: "23:00", end: "07:00", timezone: "Asia/Kolkata", enabled: true }],
    ["/api/session", { user: { displayName: "Asha" }, profile: { timezone: "Asia/Kolkata", language: "hinglish", pronouns: "she/her", memoryPaused: false, followupsEnabled: true } }],
    ["/api/consents", {
      chatStorage: { granted: true, updatedAt: "2026-08-18T07:00:00.000Z" },
      aiProcessing: { granted: true, updatedAt: "2026-08-18T07:00:00.000Z" },
      memory: { granted: true, updatedAt: "2026-08-18T07:00:00.000Z" },
      proactiveFollowups: { granted: true, updatedAt: "2026-08-18T07:00:00.000Z" },
      moodInference: { granted: false, updatedAt: "2026-08-18T07:00:00.000Z" },
    }],
    ["/api/usage", { period: "2026-08", plan: "free", counters: { messages: 7 }, limits: { messages: 300 }, remaining: { messages: 293 } }],
  ]);
  globalThis.fetch = async (url) => {
    requested.push(url);
    assert.ok(payloads.has(url), `unexpected API request ${url}`);
    return response(payloads.get(url));
  };

  const state = await loadCloudState();

  assert.equal(state.conversationId, "cnv_1");
  assert.deepEqual(state.profile, {
    displayName: "Asha",
    timezone: "Asia/Kolkata",
    language: "hinglish",
    pronouns: "she/her",
    memoryPaused: false,
    followupsEnabled: true,
  });
  assert.deepEqual(state.consents, { chat: true, ai: true, memory: true, notifications: true, mood: false });
  assert.equal(state.consentRecords.memory.updatedAt, "2026-08-18T07:00:00.000Z");
  assert.deepEqual(
    { date: state.followups[0].date, time: state.followups[0].time },
    { date: "2026-08-19", time: "00:30" },
  );
  assert.deepEqual(state.followups.map(({ id, enabled }) => ({ id, enabled })), [
    { id: "fup_1", enabled: true },
    { id: "fup_2", enabled: false },
  ]);
  assert.equal(state.memories[0].sourceMessageId, "msg_user_1");
  assert.deepEqual(state.usage, {
    period: "2026-08",
    plan: "free",
    counters: { messages: 7 },
    limits: { messages: 300 },
    remaining: { messages: 293 },
  });
  assert.deepEqual(state.goals.map(({ progress, total }) => ({ progress, total })), [
    { progress: 2, total: 3 },
    { progress: 1, total: 1 },
  ]);
  for (const path of ["/api/session", "/api/consents", "/api/usage"]) assert.ok(requested.includes(path));
});

test("cloud hydration follows every cursor so privacy controls do not hide older records", async () => {
  installWindow();
  const firstPage = Array.from({ length: 30 }, (_, index) => ({
    id: `mem_${index}`,
    content: `Memory ${index}`,
    category: "fact",
    confidence: 1,
    pinned: false,
  }));
  globalThis.fetch = async (url) => {
    if (url === "/api/conversations?limit=1") return response({ items: [] });
    if (url === "/api/memories?limit=100") return response({ items: firstPage, nextCursor: "mem_29" });
    if (url === "/api/memories?limit=100&cursor=mem_29") {
      return response({ items: [{ id: "mem_30", content: "Memory 30", category: "fact", confidence: 1, pinned: false }], nextCursor: null });
    }
    if (["/api/followups?limit=100", "/api/goals?limit=100"].includes(url)) return response({ items: [], nextCursor: null });
    if (url === "/api/quiet-hours") return response({ start: "22:00", end: "08:00", enabled: false });
    if (url === "/api/session") return response({ user: { displayName: "Asha" }, profile: { language: "hinglish", memoryPaused: false } });
    if (url === "/api/consents") return response({ memory: { granted: true } });
    if (url === "/api/usage") return response({ period: "2026-08", counters: {}, limits: { messages: 300 }, remaining: { messages: 300 } });
    throw new Error(`unexpected API request ${url}`);
  };

  const state = await loadCloudState();

  assert.equal(state.memories.length, 31);
  assert.equal(state.memories.at(-1).id, "mem_30");
});

test("cloud export polls a bounded request until the authoritative export is ready", async () => {
  installWindow();
  let polls = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (url === "/api/data/export" && options.method === "POST") return response({ id: "dsr_1", status: "queued" }, 202);
    polls += 1;
    return polls === 1
      ? response({ id: "dsr_1", status: "queued" })
      : response({ id: "dsr_1", status: "ready", export: { user: { displayName: "Asha" } } });
  };

  const exported = await requestCloudExport({ timeoutMs: 100, pollIntervalMs: 1 });

  assert.equal(polls, 2);
  assert.equal(exported.user.displayName, "Asha");
});

test("cloud export returns an immediately streamed snapshot without polling", async () => {
  installWindow();
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return response({ id: "exp_1", status: "ready", export: { user: { displayName: "Asha" } } });
  };

  const exported = await requestCloudExport();

  assert.equal(exported.user.displayName, "Asha");
  assert.equal(requests, 1);
});
