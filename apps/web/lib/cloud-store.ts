export class CloudStoreError extends Error {
  constructor(readonly status:number,readonly code:string){super("Storage is temporarily unavailable");}
}
export async function storeAction<T>(data: Record<string, unknown>): Promise<T> {
  const { env } = await import(/* webpackIgnore: true */ "cloudflare:workers");
  if (!env.MIRA_STORE) throw new Error("Account storage is unavailable");
  const stub = env.MIRA_STORE.get(env.MIRA_STORE.idFromName("mira-production-v1"));
  const response = await stub.fetch("https://store.internal/", { method: "POST", body: JSON.stringify(data) });
  if (!response.ok) {const body=await response.json().catch(()=>({})) as {code?:string};throw new CloudStoreError(response.status,body.code??"STORAGE_UNAVAILABLE");}
  return response.json() as Promise<T>;
}
export const cloudStore = {
  get: async (key: string) => (await storeAction<{value: string | null}>({action:"get",key})).value,
  put: async (key: string, value: string, options?: {expirationTtl?: number}) => { await storeAction({action:"put",key,value,ttl:options?.expirationTtl}); },
  delete: async (key: string) => { await storeAction({action:"delete",key}); },
  list: (options: {prefix?: string; cursor?: string; limit?: number} = {}) => storeAction<{keys:{name:string}[]; list_complete:boolean; cursor?:string}>({action:"list",...options}),
};
