import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { matchesReplyLanguage } from "../lib/reply-language.ts";
import { boundedCallDiagnostic, completedRequestTiming } from "../lib/call-qa-timing.ts";
const require = createRequire(import.meta.url);
const { chromium, expect } = require("@playwright/test");

// Explicit, finite live-provider test. One revocable demo session, never a
// real account; no retries/session renewal to circumvent a quota. Input files
// are the repository's fictional Priya-generated fixtures, not microphone data.
assert.equal(process.env.MIRA_LIVE_CALL_QA, "true", "Explicit owner-approved inference scope required");
const base = process.env.COMPANARO_URL, sha = process.env.MIRA_EXPECTED_SHA;
assert.equal(base, "https://luma-companion.prakhargupta267.workers.dev");
assert.match(sha ?? "", /^[a-f0-9]{40}$/);
assert.ok(process.argv.slice(2).every(arg => arg === "--short-names"), "Unknown live call diagnostic option");
const shortNames = process.argv.includes("--short-names");
const directory = await mkdtemp(join(tmpdir(), "mira-live-call-audio-"));
const report = { at: new Date().toISOString(), expectedSha: sha,
  variant: shortNames ? "contextual place name then negative-control number" : "English Hindi Hinglish clean/noise",
  method: "Actual production call UI, native Chromium MediaRecorder/WebAudio/HTMLAudio, real STT/chat/Priya TTS. Synthetic prerecorded input and muted speaker. NOT physical microphone, accent diversity, echo, subjective voice or phone acceptance.",
  caps: { "companion-chat": shortNames ? 8 : 6, "companion-transcribe": shortNames ? 8 : 6, "companion-speech": shortNames ? 10 : 8 }, requests: {}, turns: [], errors: [], semanticFailures: [], passed: false, sessionRevoked: false };
const browser = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 850 } });
const page = await context.newPage(); page.setDefaultTimeout(20_000);
const health = async () => { const response = await context.request.get(`${base}/api/health`); assert.equal(response.status(), 200); const body = await response.json(); assert.equal(body.commitSha, sha); return { commitSha: body.commitSha, versionId: body.versionId }; };
const pending = new Set(); let currentTurn = null, consented = false;
try {
  report.release = await health();
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    const service = url.pathname.split("/").at(-1);
    if (url.pathname.startsWith("/api/companion-") && !Object.hasOwn(report.caps, service)) {
      report.errors.push("Unexpected inference service"); return route.abort();
    }
    if (service in report.caps) {
      report.requests[service] = (report.requests[service] ?? 0) + 1;
      if (report.requests[service] > report.caps[service]) { report.errors.push("Finite request budget exceeded"); return route.abort(); }
      if (service === "companion-transcribe" && currentTurn) currentTurn.vocabulary = route.request().postDataJSON().vocabulary ?? [];
    }
    return route.continue();
  });
  page.on("pageerror", () => report.errors.push("Browser page error (raw exception omitted)"));
  page.on("response", response => {
    const service = new URL(response.url()).pathname.split("/").at(-1), turn = currentTurn;
    if (!(service in report.caps)) return;
    const work = boundedCallDiagnostic(async signal => {
      const item = { service, status: response.status(), requestId: response.headers()["x-request-id"] ?? null, streaming: response.headers()["x-mira-audio-stream"] === "mp3" };
      if (turn) turn.responses.push(item);
      if (!response.ok()) { report.errors.push(`${service}: HTTP ${response.status()}`); return; }
      if (service === "companion-transcribe" || service === "companion-chat") {
        const body = await response.json();
        signal.throwIfAborted();
        if (turn) { if (service === "companion-transcribe") { turn.transcript = body.text ?? body.transcript; turn.language = body.language; } else turn.reply = body.reply; }
      }
      // On live canceled/consumed MP3 fetches Playwright's finished() remained
      // unresolved despite finite responseEnd, ResourceTiming EOF and native
      // audio ended. Use actual network timing, with a finite diagnostic bound.
      const timing = await completedRequestTiming(() => response.request().timing(), signal);
      signal.throwIfAborted();
      item.timingSource = "browser-request-responseEnd";
      item.headersMs = Math.round(timing.responseStart);
      item.completeMs = Math.round(timing.responseEnd);
    }).catch(() => report.errors.push("Response inspection failed or timed out"));
    pending.add(work); void work.finally(() => pending.delete(work));
  });
  await page.addInitScript(() => {
    // Only these fixture audio streams are supplied; no hardware permission is
    // requested. Capture real playback callbacks without emitting room audio.
    const NativeAudio = window.Audio;
    const stats = { requested: 0, stopped: 0, active: 0, played: 0, events: [], destination: null, context: null };
    window.__miraAudioQa = stats;
    window.Audio = function (...args) {
      const audio = new NativeAudio(...args); audio.muted = true;
      audio.addEventListener("playing", () => { stats.played++; stats.events.push({ type: "playing", at: performance.now(), duration: audio.duration }); });
      audio.addEventListener("ended", () => stats.events.push({ type: "ended", at: performance.now(), time: audio.currentTime }));
      return audio;
    };
    window.Audio.prototype = NativeAudio.prototype;
    window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async constraints => {
      if (constraints.video) throw Error("Physical camera excluded from this fixture test");
      stats.context ??= new AudioContext(); await stats.context.resume();
      const destination = stats.context.createMediaStreamDestination(); stats.destination = destination;
      for (const track of destination.stream.getTracks()) {
        stats.requested++; stats.active++;
        const stop = track.stop.bind(track); let stopped = false;
        track.stop = () => { if (!stopped) { stopped = true; stats.stopped++; stats.active--; } stop(); };
      }
      return destination.stream;
    } });
    window.__miraFeedAudio = async base64 => {
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const decoded = await stats.context.decodeAudioData(bytes.buffer);
      const source = stats.context.createBufferSource(); source.buffer = decoded; source.connect(stats.destination);
      const started = performance.now();
      source.onended = () => { stats.events.push({ type: "fixture-ended", at: performance.now() }); source.disconnect(); };
      source.start(); return { started, duration: decoded.duration, previousPlays: stats.played };
    };
  });
  await page.goto(`${base}/demo`);
  await page.getByRole("checkbox").nth(0).check(); await page.getByRole("checkbox").nth(1).check();
  // Optional memory stays off: only the finite STT/chat/TTS scope is authorized.
  await expect(page.getByRole("checkbox").nth(2)).not.toBeChecked();
  consented = true;
  await page.getByRole("button", { name: "Meet Mira", exact: true }).click();
  await expect(page.locator(".app-frame")).toBeVisible();
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  for (const kind of ["voice", "video"]) {
    await page.getByRole("button", { name: `Start ${kind} call with Mira`, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: `${kind === "voice" ? "Voice" : "Video"} call with Mira`, exact: true });
    await expect(dialog).toBeVisible();
    if (kind === "video") await expect(page.locator(".live-avatar-3d--ready")).toBeVisible({ timeout: 35_000 });
    for (const language of (shortNames ? ["hindi", "city-roman", "city-devanagari", "number-one"] : ["english", "hindi", "hinglish"])) {
      assert.equal(report.errors.length, 0);
      await expect(dialog.getByRole("button", { name: "Listening automatically", exact: true })).toBeVisible({ timeout: 35_000 });
      const fixture = new URL(shortNames && language !== "hindi"
        ? `../../../audit/2026-09-18-call-reliability/audio/${language}.mp3`
        : `../../../audit/2026-09-12-followup/final/audio/${language}${kind === "video" ? "-noise.wav" : ".mp3"}`, import.meta.url);
      const turn = { kind, fixture: `${language}-${shortNames && language !== "hindi" ? "isolated" : kind === "video" ? "synthetic-noise" : "clean"}`, responses: [] };
      report.turns.push(turn); currentTurn = turn;
      const input = await page.evaluate(bytes => window.__miraFeedAudio(bytes), (await readFile(fixture)).toString("base64"));
      await expect.poll(() => page.evaluate(() => window.__miraAudioQa.played), { timeout: 35_000 }).toBeGreaterThan(input.previousPlays);
      const playback = await page.evaluate(() => window.__miraAudioQa.events.filter(event => event.type === "playing").at(-1));
      turn.endOfClipToPlaybackMs = Math.round(playback.at - input.started - input.duration * 1000);
      // MSE duration is Infinity until the provider reaches EOF. Verify the
      // completed native playback below instead of mistaking streaming for bad audio.
      turn.streamingAtStart = !Number.isFinite(playback.duration);
      await expect(dialog.getByRole("button", { name: "Listening automatically", exact: true })).toBeVisible({ timeout: 40_000 });
      await Promise.all(pending);
      const ended = await page.evaluate(() => window.__miraAudioQa.events.filter(event => event.type === "ended").at(-1));
      assert.ok(ended.at > playback.at && ended.time > 0 && ended.time < 45);
      turn.playbackSeconds = ended.time;
      assert.equal(report.errors.length, 0); assert.ok(turn.transcript?.trim()); assert.ok(turn.reply?.trim());
      turn.expectedLanguage = { english: "en", hindi: "hi", hinglish: "hinglish" }[language];
      turn.languageMatches = !turn.expectedLanguage || turn.language === turn.expectedLanguage && matchesReplyLanguage(turn.reply, turn.expectedLanguage);
      const groups = language.startsWith("city-") ? [["pune", "पुणे"]] : language === "number-one" ? [["one", "1", "एक", "वन"]] : language === "english" ? [["kabir"], ["interview"], ["brother"]]
        : language === "hindi" ? [["नेहा", "neha"], ["पुणे", "pune"], ["दोस्त", "friend"]]
        : [["boss", "bos", "बॉस"], ["meeting", "मीटिंग"], ["daant", "डांट", "डाँट"]];
      turn.inputAnchorsMatch = shortNames && language !== "hindi"
        ? groups[0].includes(turn.transcript.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu,""))
        : groups.every(group => group.some(word => turn.transcript.toLowerCase().includes(word)));
      turn.passed = turn.languageMatches && turn.inputAnchorsMatch;
      // Complete the already-budgeted voice AND video matrix even when a
      // transcript is wrong. Preserve every semantic failure in the result;
      // provider errors/quotas still stop immediately, never retry or renew.
      if (!turn.passed) report.semanticFailures.push({ kind, fixture: turn.fixture, languageMatches: turn.languageMatches, inputAnchorsMatch: turn.inputAnchorsMatch });
      assert.ok(turn.endOfClipToPlaybackMs >= 0, "Reply started before the input clip ended");
      assert.equal(turn.responses.filter(item => item.service === "companion-chat").length, 1);
      await page.screenshot({ path: join(directory, `${kind}-${language}.png`) });
    }
    currentTurn = null;
    await dialog.getByRole("button", { name: kind === "voice" ? "End call" : "End video call", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__miraAudioQa.active)).toBe(0);
  }
  report.media = await page.evaluate(() => { const s = window.__miraAudioQa; return { requested: s.requested, stopped: s.stopped, active: s.active, events: s.events }; });
  report.finalRelease = await health(); report.passed = report.turns.length === (shortNames ? 8 : 6) && report.errors.length === 0 && report.semanticFailures.length === 0;
  if (!report.passed) process.exitCode = 1;
} catch { report.errors.push("Live call acceptance failed; inspect bounded turn evidence/screenshots"); process.exitCode = 1; }
finally {
  await Promise.all(pending);
  if (consented) {
    try { const revoke = await context.request.delete(`${base}/api/demo/session`, { headers: { origin: base } }); report.sessionRevoked = revoke.ok(); } catch { report.sessionRevoked = false; }
    if (!report.sessionRevoked) { report.passed = false; process.exitCode = 1; }
  }
  await context.close(); await browser.close();
  await writeFile(join(directory, "live-call-audio.json"), JSON.stringify(report, null, 2), { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ directory, passed: report.passed, turns: report.turns.length, errors: report.errors, semanticFailures: report.semanticFailures, requests: report.requests, sessionRevoked: report.sessionRevoked }));
}
