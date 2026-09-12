import {createHmac} from "node:crypto";
import DodoPayments from "dodopayments";
import {describe,expect,it} from "vitest";
describe("Dodo webhook authenticity",()=>{
  const secret=Buffer.from("synthetic-test-secret-32-characters").toString("base64");
  const client=new DodoPayments({bearerToken:"synthetic-not-a-real-key",webhookKey:`whsec_${secret}`,environment:"test_mode"});
  const body=JSON.stringify({type:"subscription.active",timestamp:new Date().toISOString(),data:{subscription_id:"sub_test"}});
  const id="msg_synthetic",timestamp=String(Math.floor(Date.now()/1000));
  const signature=createHmac("sha256",Buffer.from(secret,"base64")).update(`${id}.${timestamp}.${body}`).digest("base64");
  const headers={"webhook-id":id,"webhook-timestamp":timestamp,"webhook-signature":`v1,${signature}`};
  it("accepts a correctly signed synthetic event",()=>{expect(client.webhooks.unwrap(body,{headers}).type).toBe("subscription.active");});
  it("rejects tampering and unsigned payloads",()=>{expect(()=>client.webhooks.unwrap(body.replace("active","cancelled"),{headers})).toThrow();expect(()=>client.webhooks.unwrap(body,{headers:{}})).toThrow();});
  it("rejects expired replay signatures",()=>{expect(()=>client.webhooks.unwrap(body,{headers:{...headers,"webhook-timestamp":"1"}})).toThrow();});
});
