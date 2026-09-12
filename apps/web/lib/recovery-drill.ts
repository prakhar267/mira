import type {SqlStorage} from "./store-engine";
interface DrillState {
  storage: {sql:SqlStorage;sync():Promise<void>;getCurrentBookmark():Promise<string>;onNextSessionRestoreBookmark(bookmark:string):Promise<string>};
  abort(reason:string):never;
}
/** Deliberately separate from MiraStore: this class can hold synthetic markers
 * only, has no account/KV import actions, and can never restore user data. */
export class MiraRecoveryDrill {
  constructor(private ctx:DrillState) {ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS drill (key TEXT PRIMARY KEY,value TEXT)");}
  private put(key:string,value:string){this.ctx.storage.sql.exec("INSERT INTO drill VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",key,value);}
  private get(key:string){return this.ctx.storage.sql.exec("SELECT value FROM drill WHERE key=?",key).toArray()[0]?.value;}
  async fetch(request:Request) {
    const {action}=await request.json() as {action:string};
    if(action==="prepare") {
      this.put("marker","synthetic-before");
      await this.ctx.storage.sync();
      const bookmark=await this.ctx.storage.getCurrentBookmark();
      this.put("bookmark",bookmark);this.put("marker","synthetic-after");await this.ctx.storage.sync();
      return Response.json({prepared:true,marker:this.get("marker")});
    }
    if(action==="arm") {
      const bookmark=this.get("bookmark");
      if(typeof bookmark!=="string")return Response.json({error:"Prepare the drill first"},{status:409});
      const undoBookmark=await this.ctx.storage.onNextSessionRestoreBookmark(bookmark);
      return Response.json({armed:true,undoBookmark});
    }
    if(action==="restart")this.ctx.abort("Intentional synthetic-only PITR drill restart");
    if(action==="verify")return Response.json({marker:this.get("marker"),recovered:this.get("marker")==="synthetic-before"});
    return new Response("Invalid drill action",{status:400});
  }
}
