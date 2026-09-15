import { describe, expect, it, vi } from "vitest";
import { readInworldAudioStream } from "./inworld-audio-stream";
import { speechDeliveryStream } from "./speech-delivery-stream";

const frame = (audio: string) => JSON.stringify({result:{audioContent:btoa(audio)}})+"\n";
const encoded = (text: string) => new TextEncoder().encode(text);
const source = (text: string) => new Response(text).body!;
const signal = () => new AbortController().signal;

describe("bounded Priya streaming transport", () => {
  it("handles split JSON, multiple records and MP3 continuation bytes without changing audio", async () => {
    const text = frame("ID3head")+frame("continuation");
    const stream = new ReadableStream<Uint8Array>({start(c){ for(const char of text)c.enqueue(encoded(char)); c.close(); }});
    const values: Uint8Array[]=[];
    expect(await readInworldAudioStream(stream,signal(),async b=>{values.push(b);})).toBe(19);
    expect(new TextDecoder().decode(new Uint8Array(values.flatMap(b=>[...b])))).toBe("ID3headcontinuation");
  });
  it.each(["",'{"error":"denied"}',frame("not mp3"),'{"result":{"audioContent":"!!!!"}}',frame("ID3ok")+'{"result":', '{"result":{"audioContent":""}}'])
    ("rejects malformed/empty upstream instead of claiming successful speech: %s",async text=>{
      await expect(readInworldAudioStream(source(text),signal(),async()=>{})).rejects.toThrow();
    });
  it("bounds unbroken frames and record counts",async()=>{
    await expect(readInworldAudioStream(source("x".repeat(1_500_001)),signal(),async()=>{})).rejects.toThrow("frame exceeds");
    await expect(readInworldAudioStream(source(frame("ID3ok")+'{"result":{}}\n'.repeat(513)),signal(),async()=>{})).rejects.toThrow("Too many");
  });
  it("cancels a stalled upstream on hang-up",async()=>{
    const controller=new AbortController(),cancel=vi.fn();
    const work=readInworldAudioStream(new ReadableStream({cancel}),controller.signal,async()=>{});
    controller.abort();await expect(work).rejects.toThrow();expect(cancel).toHaveBeenCalledOnce();
  });
  it("does not read ahead while playback has no demand",async()=>{
    let forwarded=0,release:(()=>void)|undefined;
    const stream=source(frame("ID3first")+frame("second"));
    const work=readInworldAudioStream(stream,signal(),async()=>{forwarded++;if(forwarded===1)await new Promise<void>(resolve=>{release=resolve;});});
    await vi.waitFor(()=>expect(forwarded).toBe(1));release?.();await work;expect(forwarded).toBe(2);
  });
});

describe("speech delivery consent, backpressure and completion",()=>{
  it("delivers first audio before provider completion and holds the work until the last pull",async()=>{
    const check=vi.fn(async()=>{}),finish=vi.fn();let completed=false;
    const body=speechDeliveryStream({signal:signal(),check,finish,work:async emit=>{await emit(encoded("ID3first"));await emit(encoded("last"));completed=true;}});
    const reader=body.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("ID3first");
    expect(completed).toBe(false);expect(check).toHaveBeenCalledTimes(1);
    await reader.read();await reader.read();expect(completed).toBe(true);expect(finish).toHaveBeenCalledWith(false);
  });
  it("withdrawal prevents the next chunk and reports failure",async()=>{
    const finish=vi.fn();let allowed=true;
    const body=speechDeliveryStream({signal:signal(),check:async()=>{if(!allowed)throw Error("withdrawn");},finish,work:async emit=>{await emit(encoded("first"));await emit(encoded("private"));}});
    const reader=body.getReader();await reader.read();allowed=false;
    await expect(reader.read()).rejects.toThrow("Speech interrupted");expect(finish).toHaveBeenCalledWith(true);
  });
  it("cancel unblocks a waiting producer and cannot emit late bytes",async()=>{
    const finish=vi.fn(),check=vi.fn(async()=>{});
    const body=speechDeliveryStream({signal:signal(),check,finish,work:async emit=>{await emit(encoded("first"));await emit(encoded("late"));}});
    const reader=body.getReader();await reader.read();await reader.cancel();
    await vi.waitFor(()=>expect(finish).toHaveBeenCalledWith(true));expect(check).toHaveBeenCalledTimes(1);
  });
});
