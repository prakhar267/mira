import {z} from "zod";
import {SuppressionAuthorityEngine} from "./suppression-authority";
import type {SqlStorage} from "./store-engine";
import {appendRequestSchema,checkpointSchema,writerSchema} from "./suppression-protocol";
import {archiveRegistrationSchema,recoveryHandoffRequestSchema,recoveryHandoffSchema} from "./protected-recovery-protocol";
import {boundedRecoveryJson,validAuthorityToken} from "./recovery-io";

export interface RecoveryAuthorityServiceEnvironment {
  MIRA_SUPPRESSION_AUTHORITY_ID?:string;
  MIRA_SUPPRESSION_AUTHORITY_TOKEN?:string;
  MIRA_RECOVERY_AUTHORITY_TOKEN?:string;
}
async function equalToken(a:string,b:string){const [x,y]=await Promise.all([a,b].map(text=>crypto.subtle.digest("SHA-256",new TextEncoder().encode(text))));const left=new Uint8Array(x!),right=new Uint8Array(y!);let diff=0;for(let i=0;i<left.length;i++)diff|=left[i]!^right[i]!;return diff===0;}
const adminRequest=z.discriminatedUnion("operation",[
  z.object({operation:z.literal("enroll"),source:writerSchema.shape.source,writerId:writerSchema.shape.writerId}).strict(),
  z.object({operation:z.literal("handoff"),request:recoveryHandoffRequestSchema}).strict(),
  z.object({operation:z.literal("read"),writer:writerSchema,after:checkpointSchema,limit:z.number().int().min(1).max(128)}).strict(),
  z.object({operation:z.literal("admit"),handoff:recoveryHandoffSchema,checkpoint:checkpointSchema}).strict(),
]);

/** Source credentials can only append and register source-generated captures.
 * A DIFFERENT operator credential is required for enrollment, replay, permanent
 * fencing/successor creation and admission. No public activation/reset API. */
export async function serveRecoveryAuthority(request:Request,engine:SuppressionAuthorityEngine,environment:RecoveryAuthorityServiceEnvironment){
  const headers={"cache-control":"no-store","content-type":"application/json"};
  try{
    if(request.method!=="POST")return Response.json({code:"METHOD_NOT_ALLOWED"},{status:405,headers});
    const source=environment.MIRA_SUPPRESSION_AUTHORITY_TOKEN,operator=environment.MIRA_RECOVERY_AUTHORITY_TOKEN;
    if(!validAuthorityToken(source)||!validAuthorityToken(operator)||source===operator)throw new Error("RECOVERY_AUTHORITY_CONFIGURATION_REQUIRED");
    const supplied=request.headers.get("authorization")?.replace(/^Bearer /,"");
    if(!validAuthorityToken(supplied))return Response.json({code:"UNAUTHORIZED"},{status:401,headers});
    const isSource=await equalToken(source,supplied),isOperator=await equalToken(operator,supplied);
    if(!isSource&&!isOperator)return Response.json({code:"UNAUTHORIZED"},{status:401,headers});
    const raw=await boundedRecoveryJson(request);
    if(isSource){
      const registration=z.object({operation:z.literal("register"),registration:archiveRegistrationSchema}).strict().safeParse(raw);
      return Response.json(registration.success?engine.registerArchive(registration.data.registration):await engine.append(appendRequestSchema.parse(raw)),{headers});
    }
    const input=adminRequest.parse(raw);
    switch(input.operation){
      case "enroll":return Response.json(await engine.enroll(input.source,input.writerId),{headers});
      case "handoff":return Response.json(await engine.handoff(input.request),{headers});
      case "read":return Response.json(engine.read(input.writer,input.after,input.limit),{headers});
      case "admit":return Response.json(engine.admit(input.handoff,input.checkpoint),{headers});
    }
  }catch(error){const code=error instanceof Error&&/^(?:SUPPRESSION_|RECOVERY_)[A-Z_]+$/.test(error.message)?error.message:"RECOVERY_INVALID_REQUEST";return Response.json({code},{status:code==="RECOVERY_BODY_TOO_LARGE"?413:503,headers});}
}
export class MiraSuppressionAuthority {
  private engine:SuppressionAuthorityEngine;
  constructor(ctx:{storage:{sql:SqlStorage;transactionSync<T>(work:()=>T):T}},private env:RecoveryAuthorityServiceEnvironment){this.engine=new SuppressionAuthorityEngine(ctx.storage.sql,work=>ctx.storage.transactionSync(work),env.MIRA_SUPPRESSION_AUTHORITY_ID??"");}
  fetch(request:Request){return serveRecoveryAuthority(request,this.engine,this.env);}
}
