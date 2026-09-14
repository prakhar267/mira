import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({env:{} as Record<string,unknown>,fetch:vi.fn(),names:vi.fn((name:string)=>name)}));
vi.mock("cloudflare:workers",()=>({env:mocks.env}));
import {POST} from "../app/api/admin/backup/route";
import {storeAction} from "./cloud-store";
const token="synthetic-operator-"+"a".repeat(40),origin="https://mira.example.test",target="mira-recovery-route-target";
function request(body:unknown,authorization=token,source=origin){return new Request(`${origin}/api/admin/backup`,{method:"POST",headers:{origin:source,authorization:`Bearer ${authorization}`,"content-type":"application/json"},body:JSON.stringify(body)});}
beforeEach(()=>{Object.assign(mocks.env,{MIRA_ADMIN_KEY:token,MIRA_BACKUP_KEY:"synthetic-key-not-used-by-route",MIRA_BACKUP_KEY_ID:"synthetic",MIRA_PROTECTED_RECOVERY_ENABLED:"true",MIRA_STORE:{idFromName:mocks.names,get:()=>({fetch:mocks.fetch})}});mocks.fetch.mockImplementation(async()=>Response.json({accepted:true}));});
afterEach(()=>{for(const key of Object.keys(mocks.env))delete mocks.env[key];vi.clearAllMocks();});
describe("operator-only protected recovery route and server selector",()=>{
  it("dispatches authenticated explicit v2 to the exact isolated object without forwarding client action/version overrides",async()=>{
    const response=await POST(request({version:2,operation:"restoreStep",target,action:"eraseAccount"}));expect(response.status).toBe(200);expect(mocks.names).toHaveBeenCalledWith(target);
    expect(JSON.parse(mocks.fetch.mock.calls[0]![1].body)).toEqual({operation:"restoreStep",target,action:"protectedRecovery"});
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("denies unauthenticated, cross-origin, disabled, missing-key and invalid-target operator requests before storage",async()=>{
    expect((await POST(request({version:2,operation:"begin"},"wrong"))).status).toBe(401);
    expect((await POST(request({version:2,operation:"begin"},token,"https://other.example.test"))).status).toBe(403);
    expect((await POST(request({version:2,operation:"begin",target:"arbitrary-object"}))).status).toBe(400);
    mocks.env.MIRA_PROTECTED_RECOVERY_ENABLED="false";expect((await POST(request({version:2,operation:"begin"}))).status).toBe(503);
    mocks.env.MIRA_PROTECTED_RECOVERY_ENABLED="true";delete mocks.env.MIRA_BACKUP_KEY;expect((await POST(request({version:2,operation:"begin"}))).status).toBe(503);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("takes routing only from server configuration and forwards an authoritative admission-selection check",async()=>{
    mocks.env.MIRA_STORE_OBJECT_NAME=target;await storeAction({action:"stateRead",userId:"synthetic",selectedTarget:"mira-production-v1"});
    expect(mocks.names).toHaveBeenCalledWith(target);expect(JSON.parse(mocks.fetch.mock.calls[0]![1].body)).toMatchObject({selectedTarget:target});
    mocks.env.MIRA_STORE_OBJECT_NAME="bad-name";await expect(storeAction({action:"get"})).rejects.toMatchObject({code:"RECOVERY_TARGET_CONFIGURATION_INVALID"});expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});
