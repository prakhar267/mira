import { CloudStoreError, cloudStore, storeAction } from "./cloud-store";
import { edgeRateLimited } from "./edge-security";
import { ACCOUNT_POLICY_VERSION, decodeAccountState, memoryCommandSchema, StateValidationError, validateAccountState, type MemoryCommand, type StateEnvelope } from "./account-state-schema";
const sessionCookie = "__Host-companaro_session";
const sessionSeconds = 60 * 60 * 24 * 30;
// Cloudflare Workers WebCrypto currently caps a PBKDF2 call at 100,000 rounds.
const passwordIterations = 100_000;

export interface AccountRecord {
  id: string;
  email: string;
  emailKey: string;
  name: string;
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
  updatedAt: string;
  passwordChangedAt?: string;
  passwordAlgorithm?: "pbkdf2-sha256";
  passwordIterations?: number;
  emailVerifiedAt?: string;
}

interface SessionRecord {
  userId: string;
  createdAt: string;
  reauthenticatedAt?: string;
}

async function store() {
  return cloudStore;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

async function passwordHash(password: string, salt: Uint8Array, iterations=passwordIterations) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", iterations, salt: Uint8Array.from(salt).buffer }, key, 256);
  return bytesToBase64Url(new Uint8Array(bits));
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

function normalizedEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase().slice(0, 254) : "";
}
function validatedAccount(raw:string):AccountRecord {
  const value=JSON.parse(raw) as AccountRecord;
  if(!value||typeof value!=="object"||typeof value.id!=="string"||!/^[a-zA-Z0-9_-]{1,120}$/.test(value.id)||typeof value.email!=="string"||value.email.length>254||typeof value.name!=="string"||value.name.length>80||typeof value.emailKey!=="string"||typeof value.passwordHash!=="string"||!/^[a-zA-Z0-9_-]{43}$/.test(value.passwordHash)||typeof value.passwordSalt!=="string"||!/^[a-zA-Z0-9_-]{22}$/.test(value.passwordSalt)||!Number.isFinite(Date.parse(value.createdAt)))throw new AccountError("Account data could not be read safely. Contact support.",503,"ACCOUNT_DATA_INVALID");
  return value;
}
function validatedSession(raw:string):SessionRecord {
  const value=JSON.parse(raw) as SessionRecord;
  if(!value||typeof value.userId!=="string"||!/^[a-zA-Z0-9_-]{1,120}$/.test(value.userId)||!Number.isFinite(Date.parse(value.createdAt))||Date.parse(value.createdAt)>Date.now()+60_000||Date.parse(value.createdAt)+sessionSeconds*1000<=Date.now())throw new AccountError("Your session expired. Please sign in again.",401,"SESSION_EXPIRED");
  return value;
}

function cookieValue(request: Request, name: string) {
  const cookies = request.headers.get("cookie") ?? "";
  for (const part of cookies.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (origin && origin !== new URL(request.url).origin) throw new AccountError("That request did not come from this site.", 403);
  if (!origin && fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") throw new AccountError("That request did not come from this site.", 403);
}

export class AccountError extends Error {
  constructor(message: string, readonly status = 400, readonly code="ACCOUNT_ERROR", readonly revision?:number) {
    super(message);
  }
}

export function accountErrorResponse(cause: unknown) {
  const error = cause instanceof AccountError ? cause : cause instanceof StateValidationError ? new AccountError(cause.message,400,"INVALID_STATE") : cause instanceof CloudStoreError&&cause.code==="TRANSCRIPT_LIMIT"?new AccountError("This beta account has reached its stored-history limit (2,000 messages or 8 MB). Export your data, then turn stored history off to clear it before continuing.",413,"TRANSCRIPT_LIMIT"):cause instanceof CloudStoreError&&cause.code==="CONVERSATION_REMOVED"?new AccountError("This conversation has been deleted. Reload your account to continue.",409,"STATE_CONFLICT"):new AccountError("Account service unavailable. Please try again.", 503,"ACCOUNT_UNAVAILABLE");
  const requestId=crypto.randomUUID();
  return Response.json({ error: error.message,code:error.code,revision:error.revision,requestId }, { status: error.status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff","x-request-id":requestId } });
}

export async function parseJsonObject(request: Request, maximumBytes = 2_000_000) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maximumBytes) throw new AccountError("That request is too large.", 413);
  const reader=request.body?.getReader();if(!reader)throw new AccountError("The request body is missing.");
  const chunks:Uint8Array[]=[];let bytes=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maximumBytes){await reader.cancel();throw new AccountError("That request is too large.",413,"PAYLOAD_TOO_LARGE");}chunks.push(value);}}finally{reader.releaseLock();}
  const combined=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){combined.set(chunk,offset);offset+=chunk.length;}
  const text = new TextDecoder().decode(combined);
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new AccountError("The request was not valid JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AccountError("The request body is invalid.");
  return value as Record<string, unknown>;
}

export async function throttle(request: Request, scope: "login" | "signup", identity: string, maximum: number) {
  if (await edgeRateLimited(request, `account:${scope}`, maximum, 900) || await storeAction<{limited:boolean}>({action:"rate",key:`identity:${scope}:${await sha256(identity)}`,max:maximum,seconds:900}).then(r=>r.limited)) throw new AccountError("Too many attempts. Please wait fifteen minutes and try again.", 429);
}

async function prepareAccount(input: Record<string, unknown>) {
  const kv = await store();
  const email = normalizedEmail(input.email);
  const password = typeof input.password === "string" ? input.password : "";
  const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ").slice(0, 80) : "";
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new AccountError("Enter a valid email address.");
  if (password.length < 12 || password.length > 200) throw new AccountError("Use a password between 12 and 200 characters.");
  if (!name) throw new AccountError("Enter your name.");
  const emailKey = await sha256(email);
  if (await kv.get(`email:${emailKey}`)) throw new AccountError("An account with that email already exists.", 409,"ACCOUNT_EXISTS");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const now = new Date().toISOString();
  const account: AccountRecord = {
    id: crypto.randomUUID(),
    email,
    emailKey,
    name,
    passwordHash: await passwordHash(password, salt),
    passwordSalt: bytesToBase64Url(salt),
    createdAt: now,
    updatedAt: now,
    passwordAlgorithm:"pbkdf2-sha256",
    passwordIterations,
  };
  return account;
}

export async function bootstrapAccount(input:Record<string,unknown>){
  const state=validateAccountState(input.state);
  if(!state.user.adultConfirmed)throw new AccountError("Mira is for adults 18+ only. Confirm your age before creating an account.",403,"ADULT_DECLARATION_REQUIRED");
  const policy=input.policy as Record<string,unknown>|undefined;
  if(policy?.termsVersion!==ACCOUNT_POLICY_VERSION||policy?.adultConfirmed!==true||policy?.aiProcessingConsent!==state.aiProcessingConsent)throw new AccountError("Confirm the current AI processing and adult policy before creating an account.",403,"POLICY_CONFIRMATION_REQUIRED");
  const account=await prepareAccount(input);const prepared=await prepareSession(account);
  const result=await storeAction<{created:boolean;capacity?:boolean}&StateEnvelope>({action:"bootstrap",key:`email:${account.emailKey}`,account,state:{...state,user:{...state.user,id:account.id,name:account.name}},sessionKey:`session:${prepared.tokenHash}`,sessionValue:JSON.stringify(prepared.session),ttl:sessionSeconds});
  if(result.capacity)throw new AccountError("Mira's limited beta is currently full. Existing accounts can still sign in; new registration will reopen when capacity is available.",503,"BETA_CAPACITY");
  if(!result.created)throw new AccountError("An account with that email already exists.",409,"ACCOUNT_EXISTS");
  return {account,state:result.state,revision:result.revision,cookie:prepared.cookie};
}

export async function authenticate(emailValue: unknown, passwordValue: unknown) {
  const kv = await store();
  const email = normalizedEmail(emailValue);
  const password = typeof passwordValue === "string" ? passwordValue : "";
  const emailKey = await sha256(email);
  const userId = await kv.get(`email:${emailKey}`);
  const raw = await kv.get(`account:${userId??"missing-login-record"}`);
  const account = raw?validatedAccount(raw):null;
  // Run the same expensive KDF for a missing account. Legacy records without
  // metadata use exactly the original 100k work factor (no password reset).
  const iterations=account?.passwordIterations??passwordIterations;
  const supported=(!account?.passwordAlgorithm||account.passwordAlgorithm==="pbkdf2-sha256")&&Number.isInteger(iterations)&&iterations>0&&iterations<=passwordIterations;
  const candidate = await passwordHash(password.slice(0,200),account?base64UrlToBytes(account.passwordSalt):new Uint8Array(16),supported?iterations:passwordIterations);
  if (!account||!supported||password.length>200||!constantTimeEqual(candidate, account.passwordHash)) throw new AccountError("Email or password is incorrect.", 401,"INVALID_CREDENTIALS");
  return account;
}

async function prepareSession(account:AccountRecord){
  const token = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256(token);
  const now=new Date().toISOString();
  const session: SessionRecord = { userId: account.id, createdAt:now,reauthenticatedAt:now };
  return {tokenHash,session,cookie:`${sessionCookie}=${token}; Max-Age=${sessionSeconds}; Path=/; HttpOnly; Secure; SameSite=Strict`};
}
export async function createSession(account: AccountRecord) {
  const kv = await store();const {tokenHash,session,cookie}=await prepareSession(account);
  await kv.put(`session:${tokenHash}`, JSON.stringify(session), { expirationTtl: sessionSeconds });
  return cookie;
}

export function clearSessionCookie() {
  return `${sessionCookie}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

export async function requireAccount(request: Request) {
  const kv = await store();
  const token = cookieValue(request, sessionCookie);
  if (!token) throw new AccountError("Please sign in to continue.", 401);
  const tokenHash = await sha256(token);
  const sessionRaw = await kv.get(`session:${tokenHash}`);
  if (!sessionRaw) throw new AccountError("Your session expired. Please sign in again.", 401);
  const session = validatedSession(sessionRaw);
  const accountRaw = await kv.get(`account:${session.userId}`);
  if (!accountRaw) throw new AccountError("Your account could not be found.", 401);
  const account = validatedAccount(accountRaw);
  if (account.passwordChangedAt && session.createdAt <= account.passwordChangedAt) throw new AccountError("Please sign in again after changing your password.", 401);
  return { account, tokenHash,session };
}

export async function requireRecentAccount(request:Request){
  const result=await requireAccount(request);const authenticated=Date.parse(result.session.reauthenticatedAt??result.session.createdAt);
  if(!Number.isFinite(authenticated)||authenticated>Date.now()+60_000||Date.now()-authenticated>10*60_000)throw new AccountError("Confirm your password before exporting or deleting your account.",403,"REAUTH_REQUIRED");
  return result;
}
export async function reauthenticate(request:Request,password:unknown){
  const {account,tokenHash,session}=await requireAccount(request);
  await throttle(request,"login",account.email,10);await authenticate(account.email,password);
  const remaining=Math.floor((Date.parse(session.createdAt)+sessionSeconds*1000-Date.now())/1000);
  if(remaining<=0)throw new AccountError("Sign in again.",401);
  await cloudStore.put(`session:${tokenHash}`,JSON.stringify({...session,reauthenticatedAt:new Date().toISOString()}),{expirationTtl:remaining});
}

export async function readState(userId: string) {
  return (await readStateEnvelope(userId)).state;
}
export async function readStateEnvelope(userId:string,exportAll=false){
  const {envelope}=await storeAction<{envelope:StateEnvelope|null}>({action:exportAll?"stateExport":"stateRead",userId});
  if(!envelope)throw new AccountError("Your companion profile could not be found.",404,"STATE_NOT_FOUND");
  return decodeAccountState(JSON.stringify(envelope),exportAll?24_000_000:1_500_000);
}
function requireRevision(value:unknown):number{
  if(!Number.isSafeInteger(value)||Number(value)<1)throw new AccountError("Reload your account before saving changes.",428,"REVISION_REQUIRED");return Number(value);
}
function savedResult(result:StateEnvelope&{conflict?:boolean;missing?:boolean;notFound?:boolean;consentRequired?:boolean;limit?:boolean}){
  if(result.conflict)throw new AccountError("This account changed in another tab. Reload before saving.",409,"STATE_CONFLICT",result.revision);
  if(result.missing||result.notFound)throw new AccountError("That account or memory no longer exists.",404,"NOT_FOUND");
  if(result.consentRequired)throw new AccountError("Enable memory before saving a new memory.",403,"MEMORY_DISABLED");
  if(result.limit)throw new AccountError("The account memory limit has been reached.",413,"MEMORY_LIMIT");
  return result;
}
export async function writeState(userId: string, state: unknown,revision:unknown) {
  const normalized=validateAccountState(state);
  return savedResult(await storeAction({action:"stateSave",userId,state:normalized,revision:requireRevision(revision)}));
}
export async function mutateMemory(userId:string,command:MemoryCommand,revision:unknown){
  const parsed=memoryCommandSchema.safeParse(command);if(!parsed.success)throw new AccountError("That memory update is invalid.",400,"INVALID_MEMORY");
  return savedResult(await storeAction({action:"memoryCommand",userId,command:parsed.data,revision:requireRevision(revision)}));
}
export async function mutateConversation(userId:string,input:unknown,revision:unknown){
  const command=input as {action?:string;id?:unknown}|null;
  if(!command||!["create","delete"].includes(command.action??"")||(command.action==="delete"&&(typeof command.id!=="string"||!/^[a-zA-Z0-9_-]{1,120}$/.test(command.id))))throw new AccountError("That conversation update is invalid.",400,"INVALID_CONVERSATION");
  return savedResult(await storeAction({action:"conversationCommand",userId,command,revision:requireRevision(revision)}));
}
export async function acceptAccountPolicy(userId:string,input:Record<string,unknown>){
  if(input.termsVersion!==ACCOUNT_POLICY_VERSION||input.adultConfirmed!==true||[input.aiProcessingConsent,input.memoryEnabled,input.conversationStorageEnabled].some(value=>typeof value!=="boolean"))throw new AccountError("Confirm Mira's current adult and processing disclosures.",400,"INVALID_POLICY");
  return savedResult(await storeAction({action:"acceptPolicy",userId,policy:{aiProcessingConsent:input.aiProcessingConsent,memoryEnabled:input.memoryEnabled,conversationStorageEnabled:input.conversationStorageEnabled},revision:requireRevision(input.revision)}));
}

export async function revokeSession(tokenHash: string) {
  await (await store()).delete(`session:${tokenHash}`);
}

export async function deleteAccount(account: AccountRecord, tokenHash: string) {
  await storeAction({action:"eraseAccount",userId:account.id,emailKey:account.emailKey,keys:[`session:${tokenHash}`]});
}

export function publicAccount(account: AccountRecord) {
  return { id: account.id, email: account.email, name: account.name, createdAt: account.createdAt };
}

export async function resetPasswordWithToken(token: string, password: string) {
  if (!/^[a-f0-9]{64}$/.test(token) || password.length < 12 || password.length > 200) throw new AccountError("Use the link from your email and a password of at least 12 characters.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const result = await storeAction<{reset:boolean}>({action:"resetPassword", key:`recovery:${await sha256(token)}`,hash:await passwordHash(password,salt),salt:bytesToBase64Url(salt)});
  if (!result.reset) throw new AccountError("This reset link expired or has already been used.");
}
