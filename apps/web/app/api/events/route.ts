import { analyticsEvents } from "@/lib/analytics";
import { storeAction } from "@/lib/cloud-store";
import { assertEdgeSameOrigin, edgeRateLimited, readEdgeJson, edgeError, EdgeRequestError } from "@/lib/edge-security";
export async function POST(request: Request) {
  const started = Date.now(), id = crypto.randomUUID();
  try {
    assertEdgeSameOrigin(request);
    if (await edgeRateLimited(request,"events",60)) throw new EdgeRequestError("Too many events",429);
    const body = await readEdgeJson(request,500) as {event?:string;durationMs?:number};
    if (!body || !analyticsEvents.includes(body.event as typeof analyticsEvents[number])) throw new EdgeRequestError("Unknown event");
    await storeAction({action:"metric",name:`product:${body.event}`,failed:body.event==="reply_misunderstood",duration:typeof body.durationMs === "number" && Number.isFinite(body.durationMs) ? body.durationMs : 0});
    return new Response(null,{status:204,headers:{"cache-control":"no-store"}});
  } catch(cause) { return edgeError(id,"events",started,cause); }
}
