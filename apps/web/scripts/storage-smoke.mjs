import {randomBytes} from "node:crypto";
const base=(process.env.COMPANARO_URL||"http://localhost:3012").replace(/\/$/,"");
const headers={"content-type":"application/json",origin:base};
const password=randomBytes(24).toString("hex"),email=`storage-qa-${Date.now()}@example.invalid`;
let cookie="";const check=(b,m)=>{if(!b)throw new Error(m);console.log(`PASS ${m}`);};
async function call(path,method="GET",body){const r=await fetch(base+path,{method,headers:{...headers,...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return{r,b:await r.json()};}
try{
  const create=await call("/api/account/signup","POST",{email,password,name:"Synthetic QA",state:{user:{name:"Synthetic QA",adultConfirmed:true},companion:{name:"Mira"},messages:[],memories:[]}});
  check(create.r.status===201,`signup ${create.r.status}`);cookie=create.r.headers.get("set-cookie").split(";")[0];
  const state={...create.b.state,messages:[{id:"qa",conversationId:"qa",role:"user",content:"Synthetic private data",createdAt:new Date().toISOString(),status:"sent"}],subscription:{planId:"forged",testMode:false}};
  const write=await call("/api/account/state","PUT",{state});check(write.r.ok,"write state");
  const load=await call("/api/account/state");check(load.b.state.messages[0].content==="Synthetic private data","read after write without stale KV cache");check(load.b.state.subscription.planId==="platinum" && load.b.state.subscription.testMode,"ignore forged plan; preserve free beta call access");
  const exported=await call("/api/account/export");check(exported.r.ok && exported.b.checksum.startsWith("sha256:"),"checksummed export");
  const removed=await call("/api/account/delete","DELETE");check(removed.r.ok,"delete account and application snapshots");
  check((await call("/api/account/state")).r.status===401,"revoked session cannot read");
  check((await call("/api/account/state","PUT",{state})).r.status===401,"late autosave cannot recreate deleted account");
  cookie="";
  const login=await call("/api/account/login","POST",{email,password});check(login.r.status===401,"deleted account cannot sign in");
  check([401,503].includes((await call("/api/admin/operations")).r.status),"operator inbox denies anonymous access");
} finally {if(cookie)await call("/api/account/delete","DELETE").catch(()=>undefined);}
