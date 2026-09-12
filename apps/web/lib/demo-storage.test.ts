import {describe,expect,it} from "vitest";
import {freshDemo,restoreDemo,serializeDemo,demoSchemaVersion} from "./demo-storage";
describe("demo schema migration",()=>{
  it("starts without another person's conversation or memories",()=>{const s=freshDemo();expect(s.messages).toEqual([]);expect(s.memories).toEqual([]);expect(s.user.name).toBe("Friend");expect(s.user.adultConfirmed).toBe(false);});
  it("preserves legacy user conversations instead of silently wiping them",()=>{const s=freshDemo();s.messages=[{id:"1",conversationId:s.activeConversationId,role:"user",content:"Keep this",createdAt:new Date().toISOString(),status:"sent"}];const restored=restoreDemo(JSON.stringify(s));expect(restored.migrated).toBe(true);expect(restored.state.messages[0]?.content).toBe("Keep this");expect(restoreDemo(serializeDemo(restored.state)).migrated).toBe(false);});
  it("respects disabled transcript storage",()=>{const s=freshDemo();s.conversationStorageEnabled=false;s.messages=[{id:"1",conversationId:"c",role:"user",content:"private",createdAt:"now",status:"sent"}];expect(JSON.parse(serializeDemo(s)).state.messages).toEqual([]);});
  it("refuses malformed and future schemas",()=>{expect(()=>restoreDemo('{"messages":null}')).toThrow();expect(()=>restoreDemo(JSON.stringify({schemaVersion:demoSchemaVersion+1,state:freshDemo()}))).toThrow("newer");});
});
