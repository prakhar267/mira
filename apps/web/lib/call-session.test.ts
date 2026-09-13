import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CallSession, type CallAdapters } from "./call-session";
import type { CallListeningOptions } from "./call-listening";

const tick = () => Promise.resolve().then(() => Promise.resolve());
function setup() {
  let listening!: CallListeningOptions;
  let speech!: Parameters<CallAdapters["speak"]>[1];
  const cancelMic = vi.fn(), cancelSpeech = vi.fn();
  const adapters: CallAdapters = {
    listen: vi.fn(async options => { listening = options; return {cancel:cancelMic}; }),
    speak: vi.fn((_text, options) => { speech = options; return {cancel:cancelSpeech}; }),
    respond: vi.fn(async () => "Sunday morning, not Saturday. Got it."), update:vi.fn(), onTiming:vi.fn(),
  };
  const call = new CallSession(adapters,"Hey, how are you?");
  return {call,adapters,cancelMic,cancelSpeech,get listening(){return listening;},get speech(){return speech;}};
}
beforeEach(()=>vi.useFakeTimers());
afterEach(()=>vi.useRealTimers());
describe.each(["voice","video"])("%s shared call lifecycle",()=>{
  it("automatically opens the mic after playback, not during preparation",async()=>{
    const x=setup();x.call.start();expect(x.call.state.phase).toBe("preparing");
    x.call.setMuted(true);x.call.setMuted(false);await vi.advanceTimersByTimeAsync(200);expect(x.adapters.listen).not.toHaveBeenCalled();
    x.speech.onStart?.();expect(x.call.state.phase).toBe("speaking");x.speech.onEnd?.();
    await vi.advanceTimersByTimeAsync(200);expect(x.adapters.listen).toHaveBeenCalledTimes(1);expect(x.call.state.phase).toBe("listening");
  });
  it("handles one turn and resumes listening without duplicate transcripts",async()=>{
    const x=setup();x.call.listen();await tick();const old=x.listening;
    old.onSpeechEnd?.();expect(x.call.state.phase).toBe("transcribing");old.onTranscript("Actually Sunday, Saturday nahi");old.onTranscript("duplicate");await tick();
    expect(x.adapters.respond).toHaveBeenCalledTimes(1);expect(x.call.state.phase).toBe("preparing");
    x.speech.onStart?.();x.speech.onEnd?.();await vi.advanceTimersByTimeAsync(200);expect(x.adapters.listen).toHaveBeenCalledTimes(2);
    expect(x.adapters.onTiming).toHaveBeenCalledWith("call_reply_ms",expect.any(Number));
  });
  it("does not start audio from a late reply after hanging up",async()=>{
    const x=setup();let resolve!:(text:string)=>void;x.adapters.respond=vi.fn(()=>new Promise<string>(r=>{resolve=r;}));
    x.call.listen();await tick();x.listening.onTranscript("Hello");x.call.close();resolve("Late reply");await tick();
    expect(x.adapters.speak).not.toHaveBeenCalled();expect(x.call.state.phase).toBe("closed");
  });
  it("cancels a mic permission result that arrives after close",async()=>{
    const x=setup();let resolve!:(value:{cancel:()=>void})=>void;x.adapters.listen=vi.fn(()=>new Promise<{cancel:()=>void}>(r=>{resolve=r;}));
    x.call.listen();x.call.listen();expect(x.adapters.listen).toHaveBeenCalledTimes(1);x.call.close();resolve({cancel:x.cancelMic});await tick();expect(x.cancelMic).toHaveBeenCalledOnce();
  });
  it("ignores stale playback and STT callbacks after muting or interruption",async()=>{
    const x=setup();x.call.start();const old=x.speech;x.call.interrupt();old.onStart?.();expect(x.call.state.phase).toBe("idle");
    await vi.advanceTimersByTimeAsync(120);const mic=x.listening;x.call.setMuted(true);mic.onTranscript("late text");expect(x.adapters.respond).not.toHaveBeenCalled();expect(x.cancelMic).toHaveBeenCalledOnce();
  });
  it("speaker off immediately stops playback and resumes input",async()=>{
    const x=setup();x.call.start();x.speech.onStart?.();x.call.setSpeaker(false);expect(x.cancelSpeech).toHaveBeenCalledOnce();await vi.advanceTimersByTimeAsync(200);expect(x.call.state.phase).toBe("listening");
    x.listening.onTranscript("Okay");await tick();expect(x.adapters.speak).toHaveBeenCalledTimes(1);
  });
  it("does not endlessly retry denied permissions or failed STT",async()=>{
    const x=setup();x.adapters.listen=vi.fn(async()=>{throw new Error("Permission denied");});x.call.listen();await tick();await vi.advanceTimersByTimeAsync(30000);expect(x.adapters.listen).toHaveBeenCalledOnce();expect(x.call.state).toMatchObject({phase:"error",error:"Permission denied"});
  });
  it("retries a failed reply using the preserved user message",async()=>{
    const x=setup();x.adapters.respond=vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue("Got it.");x.call.listen();await tick();x.listening.onTranscript("Sunday morning");await tick();expect(x.call.state.phase).toBe("error");expect(x.adapters.speak).not.toHaveBeenCalled();x.call.retry();await tick();expect(x.adapters.respond).toHaveBeenLastCalledWith("Sunday morning", expect.objectContaining({signal: expect.any(AbortSignal), turnId: expect.any(String)}));expect(x.call.state.phase).toBe("preparing");
  });
  it("headphone talk-over stops audio without discarding the first words",async()=>{
    const x=setup();x.call.setTalkOver(true);x.call.start();x.speech.onStart?.();await tick();expect(x.listening.interruption).toBe(true);x.listening.onSpeechStart?.();expect(x.cancelSpeech).toHaveBeenCalledOnce();expect(x.cancelMic).not.toHaveBeenCalled();x.listening.onTranscript("Wait, I meant Sunday");await tick();expect(x.adapters.respond).toHaveBeenCalledWith("Wait, I meant Sunday", expect.objectContaining({signal: expect.any(AbortSignal), turnId: expect.any(String)}));
  });
  it("keeps interruption recording alive when playback naturally finishes",async()=>{
    const x=setup();x.call.setTalkOver(true);x.call.start();x.speech.onStart?.();await tick();x.speech.onEnd?.();await vi.advanceTimersByTimeAsync(300);expect(x.adapters.listen).toHaveBeenCalledOnce();expect(x.call.state.phase).toBe("listening");
  });
  it("stops a headphone monitor when talk-over is disabled",async()=>{
    const x=setup();x.call.setTalkOver(true);x.call.start();x.speech.onStart?.();await tick();const stale=x.listening;x.call.setTalkOver(false);stale.onSpeechStart?.();expect(x.call.state.phase).toBe("speaking");expect(x.cancelMic).toHaveBeenCalledOnce();expect(x.cancelSpeech).not.toHaveBeenCalled();
  });
});
