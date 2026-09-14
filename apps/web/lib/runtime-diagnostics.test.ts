import {mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {EventEmitter} from "node:events";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
// @ts-expect-error Independently executable Node diagnostic helper is .mjs.
import {readLogTail,retainRuntimeFailure,waitForRuntimeExit} from "../scripts/runtime-diagnostics.mjs";

let directory:string;
beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),"mira-runtime-diagnostics-test-"));});
afterEach(async()=>{await rm(directory,{recursive:true,force:true});});
describe("bounded isolated-runtime failure evidence",()=>{
  it("waits for the closing runtime to finish flushing its error log",async()=>{
    const child=Object.assign(new EventEmitter(),{exitCode:null as number|null,signalCode:null});
    let finished=false;const pending=waitForRuntimeExit(child).then(()=>{finished=true;});
    await Promise.resolve();expect(finished).toBe(false);
    const path=join(directory,"late.log");await writeFile(path,"The late proxy cause");
    child.exitCode=1;child.emit("close");await pending;
    expect((await readLogTail(path)).text).toBe("The late proxy cause");
    expect(child.listenerCount("close")).toBe(0);
    expect(await waitForRuntimeExit(child)).toBe(true);
  });
  it("bounds a still-running runtime and removes its exit listener",async()=>{
    vi.useFakeTimers();
    try{
      const child=Object.assign(new EventEmitter(),{exitCode:null,signalCode:null});
      const pending=waitForRuntimeExit(child,1000);await vi.advanceTimersByTimeAsync(1000);
      expect(await pending).toBe(false);expect(child.listenerCount("close")).toBe(0);
      await expect(waitForRuntimeExit(child,6000)).rejects.toThrow("Invalid runtime exit deadline");
    }finally{vi.useRealTimers();}
  });
  it("retains the final stack even after a large module table",async()=>{
    const path=join(directory,"wrangler.log"),tail="AggregateError\n at synthetic-proxy-controller:123";
    await writeFile(path,"module table\n".repeat(10000)+tail);
    const result=await readLogTail(path,1024);
    expect(result).toMatchObject({available:true,truncated:true});
    expect(Buffer.byteLength(result.text)).toBe(1024);expect(result.text.endsWith(tail)).toBe(true);
  });
  it("handles absent, empty and non-file logs without hiding the original failure",async()=>{
    expect(await readLogTail(join(directory,"missing.log"))).toMatchObject({available:false,text:""});
    expect(await readLogTail(directory)).toMatchObject({available:false,text:""});
    const path=join(directory,"empty.log");await writeFile(path,"");
    expect(await readLogTail(path)).toEqual({available:true,text:"",truncated:false});
  });
  it("rejects unbounded or invalid read limits",async()=>{
    for(const limit of [0,-1,1.5,Infinity,256*1024+1])await expect(readLogTail(join(directory,"missing.log"),limit)).rejects.toThrow("Invalid diagnostic");
  });
  it("writes bounded structured evidence and preserves missing exit status honestly",async()=>{
    const logPath=join(directory,"wrangler.log");await writeFile(logPath,"Synthetic control-plane stack");
    const output=join(directory,"evidence");
    const report=await retainRuntimeFailure({directory:output,logPath,consoleTail:"x".repeat(20000),exitCode:null,signal:null});
    expect(report).toMatchObject({scope:"isolated-synthetic-runtime",exitCode:null,signal:null,debug:{available:true,text:"Synthetic control-plane stack"}});
    expect(report.consoleTail).toHaveLength(16000);
    expect(JSON.parse(await readFile(join(output,"runtime-diagnostics.json"),"utf8"))).toEqual(report);
  });
});
