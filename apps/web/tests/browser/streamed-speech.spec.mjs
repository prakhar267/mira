import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require=createRequire(import.meta.url);
const { build }=createRequire(require.resolve("vite"))("esbuild");
test.use({serviceWorkers:"block"});

async function prepare(page,context) {
  const bundled=await build({entryPoints:[new URL("../../lib/speech.ts",import.meta.url).pathname],bundle:true,write:false,platform:"browser",format:"esm"});
  const audio=(await readFile(new URL("../../../../audit/2026-09-12-followup/final/audio/english.mp3",import.meta.url))).toString("base64");
  await context.route("**/*",route=>new URL(route.request().url()).origin==="http://127.0.0.1:4397"?route.continue():route.abort());
  await page.route("**/__qa/speech.js",route=>route.fulfill({contentType:"application/javascript",body:bundled.outputFiles[0].text}));
  await page.goto("/");
  await page.evaluate(async base64=>{
    const {playCompanionSpeech}=await import("/__qa/speech.js");
    const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),nativeAudio=window.Audio;
    const stats={starts:0,ends:0,errors:[],requests:0,canceled:0,levels:[],streaming:typeof MediaSource!=="undefined"&&MediaSource.isTypeSupported("audio/mpeg"),released:false};
    window.__speechQA=stats;
    window.Audio=function(...args){const audio=new nativeAudio(...args);audio.muted=true;window.__nativeQA=audio;return audio;};window.Audio.prototype=nativeAudio.prototype;
    const nativeFetch=window.fetch;
    window.fetch=async(url,init)=>{
      if(url!=="/api/companion-speech")return nativeFetch(url,init);
      stats.requests++;let controller;
      const body=new ReadableStream({start(c){controller=c;c.enqueue(bytes.slice(0,32_768));},cancel(){stats.canceled++;}});
      stats.release=()=>{stats.released=true;controller.enqueue(bytes.slice(32_768));controller.close();};
      stats.fail=()=>controller.error(Error("Synthetic transport failure"));
      return new Response(body,{headers:{"content-type":"audio/mpeg","x-mira-audio-stream":"mp3"}});
    };
    stats.start=()=>{stats.playback=playCompanionSpeech("My brother has an interview tomorrow.",{onStart:()=>stats.starts++,onEnd:()=>stats.ends++,onError:message=>stats.errors.push(message),onAudioLevel:level=>stats.levels.push(level)});};
  },audio);
  // A real user gesture also covers autoplay-gated native playback engines.
  await page.evaluate(()=>{const button=document.createElement("button");button.textContent="Start native audio QA";button.onclick=()=>window.__speechQA.start();document.body.append(button);});
  await page.getByRole("button",{name:"Start native audio QA"}).click();
}

test("native MP3 plays before EOF when supported; same-response fallback stays playable",async({page,context})=>{
  await prepare(page,context);
  const streaming=await page.evaluate(()=>window.__speechQA.streaming);
  if(streaming)await expect.poll(()=>page.evaluate(()=>window.__speechQA.starts)).toBe(1);
  else expect(await page.evaluate(()=>window.__speechQA.starts)).toBe(0);
  expect(await page.evaluate(()=>window.__speechQA.released)).toBe(false);
  await page.evaluate(()=>window.__speechQA.release());
  await expect.poll(()=>page.evaluate(()=>window.__speechQA.ends),{timeout:20_000}).toBe(1);
  expect(await page.evaluate(()=>({requests:window.__speechQA.requests,errors:window.__speechQA.errors,starts:window.__speechQA.starts,paused:window.__nativeQA.paused}))).toEqual({requests:1,errors:[],starts:1,paused:true});
});

test("canceling while streamed audio is pending releases the reader and native player",async({page,context})=>{
  await prepare(page,context);
  await page.evaluate(()=>window.__speechQA.playback.cancel());
  await expect.poll(()=>page.evaluate(()=>window.__speechQA.canceled)).toBe(1);
  expect(await page.evaluate(()=>({ends:window.__speechQA.ends,errors:window.__speechQA.errors,paused:window.__nativeQA.paused,level:window.__speechQA.levels.at(-1)}))).toEqual({ends:0,errors:[],paused:true,level:0});
});

test("midstream failure stops audio once without silently replaying or reporting completion",async({page,context})=>{
  await prepare(page,context);await page.evaluate(()=>window.__speechQA.fail());
  await expect.poll(()=>page.evaluate(()=>window.__speechQA.errors.length)).toBe(1);
  expect(await page.evaluate(()=>({ends:window.__speechQA.ends,requests:window.__speechQA.requests,paused:window.__nativeQA.paused}))).toEqual({ends:0,requests:1,paused:true});
});
