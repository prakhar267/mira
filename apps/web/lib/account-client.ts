import type { DemoState } from "@/lib/state";

async function decode<T>(response: Response) {
  const body = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status}).`);
  return body;
}

async function accountRequest<T>(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  return decode<T>(await fetch(`/api/account/${path}`, { ...init, headers, credentials: "same-origin", cache: "no-store" }));
}

export const accountClient = {
  login: (email: string, password: string) => accountRequest<{ account: { id: string; email: string; name: string } }>("login", { method: "POST", body: JSON.stringify({ email, password }) }),
  signup: (input: { email: string; password: string; name: string; state: DemoState }) => accountRequest<{ account: { id: string; email: string; name: string }; state: DemoState }>("signup", { method: "POST", body: JSON.stringify(input) }),
  load: () => accountRequest<{ account: { id: string; email: string; name: string }; state: DemoState }>("state"),
  save: (state: DemoState) => accountRequest<{ saved: true }>("state", { method: "PUT", body: JSON.stringify({ state }) }),
  logout: () => accountRequest<{ signedOut: true }>("logout", { method: "POST" }),
  exportData: () => accountRequest<{ exportedAt: string; account: { id: string; email: string; name: string; createdAt: string }; state: DemoState }>("export"),
  deleteAccount: () => accountRequest<{ deleted: true }>("delete", { method: "DELETE" }),
};
