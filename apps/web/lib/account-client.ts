import type { DemoState } from "@/lib/state";
import type {MemoryCommand} from "./account-state-schema";

export class AccountClientError extends Error {
  constructor(message:string,readonly status:number,readonly code:string,readonly revision?:number){super(message);}
}
export interface AccountStateResult {state:DemoState;revision:number}
export interface AccountPolicyInput {termsVersion:"2026-09-13";adultConfirmed:true;aiProcessingConsent:boolean;memoryEnabled:boolean;conversationStorageEnabled:boolean}

async function decode<T>(response: Response) {
  const body = await response.json().catch(() => ({})) as { error?: string;code?:string;revision?:number } & T;
  if (!response.ok) throw new AccountClientError(body.error ?? `Request failed (${response.status}).`,response.status,body.code??"ACCOUNT_ERROR",body.revision);
  return body;
}

async function accountRequest<T>(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  return decode<T>(await fetch(`/api/account/${path}`, { ...init, headers, credentials: "same-origin", cache: "no-store" }));
}

export const accountClient = {
  login: (email: string, password: string) => accountRequest<{ account: { id: string; email: string; name: string } }>("login", { method: "POST", body: JSON.stringify({ email, password }) }),
  signup: (input: { email: string; password: string; name: string; state: DemoState;policy:{termsVersion:"2026-09-13";adultConfirmed:true;aiProcessingConsent:boolean} }) => accountRequest<{ account: { id: string; email: string; name: string } }&AccountStateResult>("signup", { method: "POST", body: JSON.stringify(input) }),
  load: (signal?:AbortSignal) => accountRequest<{ account: { id: string; email: string; name: string };policy:{termsVersion:string;adultDeclaredAt:string;aiProcessingConsent:boolean;memoryEnabled:boolean;conversationStorageEnabled:boolean}|null }&AccountStateResult>("state",signal?{signal}:{}),
  save: (state: DemoState,revision:number,signal?:AbortSignal) => accountRequest<{ saved: true }&AccountStateResult>("state", { method: "PUT", body: JSON.stringify({ state,revision }),...(signal?{signal}:{}) }),
  memory:(command:MemoryCommand,revision:number)=>accountRequest<AccountStateResult>("memory",{method:"POST",body:JSON.stringify({command,revision})}),
  conversation:(command:{action:"create"}|{action:"delete";id:string},revision:number)=>accountRequest<AccountStateResult>("conversation",{method:"POST",body:JSON.stringify({command,revision})}),
  acceptPolicy:(input:AccountPolicyInput,revision:number)=>accountRequest<AccountStateResult>("policy",{method:"POST",body:JSON.stringify({...input,revision})}),
  reauthenticate:(password:string)=>accountRequest<{reauthenticated:true}>("reauth",{method:"POST",body:JSON.stringify({password})}),
  messages:(cursor?:string,conversationId?:string)=>accountRequest<{messages:DemoState["messages"];cursor?:string}>(`messages?${new URLSearchParams({...cursor?{cursor}:{},...conversationId?{conversationId}:{}})}`),
  logout: () => accountRequest<{ signedOut: true }>("logout", { method: "POST" }),
  exportData: () => accountRequest<{ schemaVersion: number; exportedAt: string; checksum: string; backupPolicy: { rolling: boolean; retentionDays: number }; account: { id: string; email: string; name: string; createdAt: string }; state: DemoState }>("export"),
  deleteAccount: () => accountRequest<{ deleted: true }>("delete", { method: "DELETE" }),
};
