/** Used on both sides of authenticated recovery transport. Byte, chunk and
 * elapsed-time limits also apply to empty/stalled streams; hostile cancellation
 * cannot hold a Worker request open after refusal. */
export async function boundedRecoveryJson(response:Request|Response,limit=300_000):Promise<unknown>{
  const reader=response.body?.getReader();if(!reader)throw new Error("RECOVERY_BODY_INVALID");
  let bytes=0,chunks=0,text="";const decoder=new TextDecoder("utf-8",{fatal:true});
  let timer:ReturnType<typeof setTimeout>;
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("RECOVERY_BODY_TIMEOUT")),4000);});
  try{for(;;){const part=await Promise.race([reader.read(),deadline]);if(part.done)break;if(++chunks>1024)throw new Error("RECOVERY_BODY_CHUNK_LIMIT");bytes+=part.value.byteLength;if(bytes>limit)throw new Error("RECOVERY_BODY_TOO_LARGE");text+=decoder.decode(part.value,{stream:true});}return JSON.parse(text+decoder.decode());}
  finally{clearTimeout(timer!);try{void reader.cancel().catch(()=>{});}catch{/* Best effort only. */}try{reader.releaseLock();}catch{/* A hostile pending stream cannot delay refusal. */}}
}
export function validAuthorityToken(value:string|undefined):value is string{return Boolean(value&&value.length>=32&&value.length<=512&&!/[\r\n]/.test(value));}
