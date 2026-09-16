import {test, expect} from "@playwright/test";
import {createRequire} from "node:module";
const require = createRequire(import.meta.url);
const {build} = createRequire(require.resolve("vite"))("esbuild");
test.use({serviceWorkers:"block"});

// Chromium uses real recorder/WebAudio with an oscillator, NOT human speech.
// Linux WebKit lacks MediaRecorder and Firefox has no running audio device on
// hosted CI. Those engines exercise the same protocol with explicit media
// fixtures; do not present them as native capture or physical-device acceptance.
// STT responses and browser recognition are deliberate conflicting fixtures.
async function capture(page, context, browserName) {
  const nativeMedia = browserName === "chromium";
  test.info().annotations.push({type:"capture",description:nativeMedia ? "native Chromium recorder/WebAudio, synthetic oscillator" : "synthetic recorder/analyser, real browser protocol"});
  const bundle = await build({entryPoints:[new URL("../../lib/call-listening.ts",import.meta.url).pathname],bundle:true,write:false,platform:"browser",format:"esm"});
  await context.route("**/*", route => new URL(route.request().url()).origin === "http://127.0.0.1:4397" ? route.continue() : route.abort());
  await page.route("**/__qa/capture.js", route => route.fulfill({contentType:"application/javascript",body:bundle.outputFiles[0].text}));
  await page.goto("/");
  await page.evaluate(async ({nativeMedia}) => {
    const {startCallListening} = await import("/__qa/capture.js");
    const qa = {transcripts:[],errors:[],silences:0,requests:0,tracks:[],recognitionAborts:0};
    Object.defineProperty(qa,"active",{get:() => qa.tracks.filter(track => track.readyState !== "ended").length});
    window.__captureQA = qa;
    class Recognition {
      start() { this.onresult?.({results:[{isFinal:true,0:{transcript:"An English guess with the wrong meaning",confidence:.99}}]}); }
      stop() { /* Deliberately never sends onend. */ }
      abort() { qa.recognitionAborts++; this.onend?.(); }
    }
    window.SpeechRecognition = Recognition;
    window.webkitSpeechRecognition = Recognition;
    if (!nativeMedia) {
      window.MediaRecorder = class {
        static isTypeSupported() { return true; }
        state = "inactive"; mimeType = "audio/webm";
        start() { this.state = "recording"; }
        stop() { this.state = "inactive"; queueMicrotask(() => {this.ondataavailable?.({data:new Blob(["synthetic recording"])});this.onstop?.();}); }
      };
      window.AudioContext = class {
        state = "suspended"; began = 0;
        async resume() { this.state = "running"; this.began = performance.now(); }
        async close() { this.state = "closed"; }
        createMediaStreamSource() { return {connect(){},disconnect(){}}; }
        createAnalyser() { const began = this.began; return {fftSize:512,disconnect(){},getFloatTimeDomainData(samples){samples.fill(performance.now()-began<1000 ? .09 : 0);}}; }
      };
    }
    // Replace the navigator property itself: WebKit may expose a fresh native
    // mediaDevices wrapper and bypass a mutation to one retrieved wrapper.
    Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:{getUserMedia:async () => {
      qa.stage = "synthetic-getUserMedia";
      const audio = new AudioContext(); qa.audio = audio; await audio.resume();
      qa.stage = "synthetic-audio-running";
      if (!nativeMedia) {
        const track = {readyState:"live",stop(){this.readyState="ended";}};
        qa.tracks.push(track);
        return {getTracks:()=>[track]};
      }
      const destination = audio.createMediaStreamDestination(), tone = audio.createOscillator(), gain = audio.createGain();
      tone.frequency.value = 440; gain.gain.value = .09; tone.connect(gain).connect(destination);
      tone.start(); tone.stop(audio.currentTime + .8);
      // Observe native track state rather than replacing stop() on a wrapper:
      // WebKit can return a new JS wrapper for the same native media track.
      qa.tracks.push(...destination.stream.getTracks());
      return destination.stream;
    }}});
    const nativeFetch = window.fetch;
    window.fetch = async (url, init) => {
      if (url !== "/api/companion-transcribe") return nativeFetch(url, init);
      qa.requests++; qa.recording = JSON.parse(init.body);
      return new Promise(resolve => {qa.release = (status, text) => resolve(new Response(JSON.stringify(status === 200 ? {text} : {error:"Synthetic blocked response"}),{status,headers:{"content-type":"application/json"}}));});
    };
    const button = document.createElement("button"); button.textContent = "Start synthetic recording";
    button.onclick = async () => {try {qa.stop = new AbortController();qa.session = await startCallListening({signal:qa.stop.signal,onTranscript:text=>qa.transcripts.push(text),onSilence:()=>qa.silences++,onError:error=>qa.errors.push(error)});} catch(error) {qa.errors.push(error.message);}};
    document.body.append(button);
  }, {nativeMedia});
  await page.getByRole("button",{name:"Start synthetic recording"}).click();
  try { await expect.poll(() => page.evaluate(() => window.__captureQA.requests)).toBe(1); }
  catch(error) {console.log("Synthetic capture diagnostic",await page.evaluate(() => ({stage:window.__captureQA.stage,requests:window.__captureQA.requests,errors:window.__captureQA.errors,silences:window.__captureQA.silences,active:window.__captureQA.active,audioState:window.__captureQA.audio?.state})));throw error;}
  await expect.poll(() => page.evaluate(() => window.__captureQA.active)).toBe(0);
}

test("slow multilingual STT is not displaced by the browser's confident English guess",async ({page,context,browserName}) => {
  await capture(page,context,browserName);
  await page.waitForTimeout(2100); // Beyond the removed 260 + 1600ms preemption.
  expect(await page.evaluate(() => window.__captureQA.transcripts)).toEqual([]);
  await page.evaluate(() => window.__captureQA.release(200,"nahi"));
  await expect.poll(() => page.evaluate(() => window.__captureQA.transcripts)).toEqual(["nahi"]);
  expect(await page.evaluate(() => ({requests:window.__captureQA.requests,errors:window.__captureQA.errors,silences:window.__captureQA.silences}))).toEqual({requests:1,errors:[],silences:0});
  await page.evaluate(async () => {window.__captureQA.session.cancel();await window.__captureQA.audio.close();});
});

test("a consent rejection remains authoritative even when browser recognition has text",async ({page,context,browserName}) => {
  await capture(page,context,browserName);
  await page.evaluate(() => window.__captureQA.release(403,""));
  await expect.poll(() => page.evaluate(() => window.__captureQA.errors)).toEqual(["Synthetic blocked response"]);
  expect(await page.evaluate(() => window.__captureQA.transcripts)).toEqual([]);
  await page.evaluate(async () => {window.__captureQA.session.cancel();await window.__captureQA.audio.close();});
});

test("hang-up fences a late transcription without reviving the call",async ({page,context,browserName}) => {
  await capture(page,context,browserName);
  await page.evaluate(async () => {window.__captureQA.stop.abort();window.__captureQA.session.cancel();window.__captureQA.release(200,"late transcript");await window.__captureQA.audio.close();});
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => ({transcripts:window.__captureQA.transcripts,errors:window.__captureQA.errors,active:window.__captureQA.active}))).toEqual({transcripts:[],errors:[],active:0});
});
