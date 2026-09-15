import {afterEach,describe,expect,it,vi} from "vitest";
import {createVideoPreload} from "./video-preload";
afterEach(()=>vi.unstubAllGlobals());
describe("video call intent hints",()=>{
  it("never starts from SSR and respects data saver",()=>{
    const load=vi.fn(async()=>{}),warm=createVideoPreload(load);
    warm();expect(load).not.toHaveBeenCalled();
    vi.stubGlobal("window",{});vi.stubGlobal("navigator",{connection:{saveData:true}});
    warm();expect(load).not.toHaveBeenCalled();
  });
  it("deduplicates focus/hover/pointer hints and contains failures",async()=>{
    vi.stubGlobal("window",{});vi.stubGlobal("navigator",{});
    const load=vi.fn().mockRejectedValueOnce(Error("offline")).mockResolvedValue(undefined),warm=createVideoPreload(load);
    warm();warm();expect(load).toHaveBeenCalledTimes(1);
    await Promise.resolve();warm();warm();expect(load).toHaveBeenCalledTimes(2);
  });
});
