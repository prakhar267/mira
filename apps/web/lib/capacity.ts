import {storeAction} from "./cloud-store";
import {EdgeRequestError} from "./edge-security";
export async function consumeCapacity(service:"chat"|"speech"|"transcribe") {
  const {env}=await import(/* webpackIgnore: true */ "cloudflare:workers");
  const configured=service==="chat"?env.CHAT_DAILY_LIMIT:service==="speech"?env.SPEECH_DAILY_LIMIT:env.TRANSCRIBE_DAILY_LIMIT;
  const max=Math.max(1,Math.min(10000,Number(configured)||600));
  const result=await storeAction<{limited:boolean}>({action:"rate",key:`capacity:${service}`,max,seconds:86400});
  if(result.limited)throw new EdgeRequestError("Today's shared beta capacity is used up. Please try again after midnight UTC. Your saved data is safe.",429);
}
