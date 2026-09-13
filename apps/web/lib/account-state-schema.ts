import { z } from "zod";
import { initialState, type DemoState } from "./state";

export const ACCOUNT_STATE_VERSION = 1;
export const ACCOUNT_POLICY_VERSION = "2026-09-13";
export const MAX_ACCOUNT_MESSAGES = 2_000;
export const STATE_MESSAGE_WINDOW = 200;
const text = (maximum = 2_000) => z.string().max(maximum);
const id = z.string().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/);
const date = z.string().max(40).refine(value => Number.isFinite(Date.parse(value)), "Invalid date");
const unit = z.number().finite().min(0).max(1);
const score = z.number().finite().min(0).max(100);
const count = z.number().int().min(0).max(1_000_000);
const pronouns = z.enum(["she/her", "he/him", "they/them"]);
const mood = z.enum(["calm", "cheerful", "curious", "excited", "thoughtful", "sleepy"]);
// Account mode has no private-media storage service. Only bundled artwork is
// accepted; data/blob URLs and remote tracking URLs must not enter snapshots.
const asset = z.string().max(300).regex(/^\/assets\/[a-zA-Z0-9_./-]+$/).refine(value => !value.includes(".."));
const memoryType = z.enum(["semantic", "episodic", "preference", "relationship", "goal", "emotional", "shared"]);
export const accountMessageSchema = z.object({ id, conversationId: id, role: z.enum(["user", "assistant", "system"]), content: text(8_000), createdAt: date,
  status: z.enum(["sending", "sent", "failed"]).optional(), replyToId: id.optional(), feedback: z.enum(["up", "down"]).optional(), explanation: z.array(text(500)).max(8).optional(),
  attachments: z.array(z.object({id, type:z.enum(["image", "generated-image", "audio"]), url:asset, name:text(120).optional(), transcript:text(8_000).optional(), durationMs:z.number().int().min(0).max(120_000).optional()})).max(4).optional(),
});
const memory = z.object({id,userId:id,companionId:id,type:memoryType,content:text(),normalizedContent:text(),importance:unit,confidence:unit,sourceMessageIds:z.array(id).max(20),createdAt:date,updatedAt:date,lastRetrievedAt:date.optional(),retrievalCount:count,status:z.enum(["active","superseded","deleted"]),pinned:z.boolean()});
const schema = z.object({
  onboardingComplete:z.boolean(),firstMeetingComplete:z.boolean(),
  user:z.object({id,name:text(80),birthday:text(10),pronouns,interests:z.array(text(80)).max(30),timezone:text(80),adultConfirmed:z.boolean()}),
  companion:z.object({id,name:text(40),pronouns,presentation:text(300),voiceId:text(80),relationshipMode:z.enum(["friend","mentor","sibling","romantic","organic"]),mood,createdAt:date,personality:z.object({warmth:unit,humor:unit,curiosity:unit,assertiveness:unit,optimism:unit,energy:unit,verbosity:unit,playfulness:unit,empathy:unit})}),
  relationship:z.object({stage:z.enum(["New","Getting to know you","Close","Very close","Special","Partner"]),level:count,progress:score,nickname:text(80),friendliness:score,affection:score,flirtiness:score,playfulness:score,romance:score,sensuality:score,humor:score,initiative:score,romanticOptIn:z.boolean(),sensualOptIn:z.boolean()}),
  activeConversationId:id,messages:z.array(accountMessageSchema).max(MAX_ACCOUNT_MESSAGES),memories:z.array(memory).max(300),
  moments:z.array(z.object({id,title:text(120),description:text(),date,imageUrl:asset,kind:z.enum(["milestone","call","date","memory"]),detail:text(300).optional()})).max(100),
  photos:z.array(z.object({id,imageUrl:asset,caption:text(500),createdAt:date,kind:z.enum(["selfie","moment","shared"])})).max(100),
  calls:z.array(z.object({id,type:z.enum(["voice","video"]),startedAt:date,durationSeconds:z.number().int().min(0).max(86_400),summary:text()})).max(200),
  companionBackstory:text(8_000),companionReflections:z.array(z.object({id,title:text(120),thought:text(),createdAt:date,memoryIds:z.array(id).max(30)})).max(100),
  feedbackSignals:z.array(z.object({id,messageId:id,rating:z.enum(["up","down"]),reason:z.enum(["too-scripted","too-many-questions","missed-what-i-said","wrong-tone"]).optional(),createdAt:date})).max(400),
  activities:z.array(z.object({id,title:text(120),category:z.enum(["Fun","Reflection","Relationships","Growth","Relaxation","Creativity","Games"]),description:text(500),durationMinutes:count,xp:count,coinReward:count})).max(50),completedActivityIds:z.array(id).max(100),
  wallet:z.object({xp:count,level:count,coins:count,gems:count}),
  walletTransactions:z.array(z.object({id,userId:id,type:z.enum(["earn","purchase","refund","admin_adjustment"]),currency:z.enum(["coins","gems","xp"]),amount:z.number().int().min(-1_000_000).max(1_000_000),balanceAfter:count,referenceId:id,idempotencyKey:id,createdAt:date})).max(200),
  storeItems:z.array(z.object({id,name:text(120),description:text(500),category:z.enum(["Clothing","Accessories","Appearance","Room","Special Items"]),assetUrl:asset,currency:z.enum(["free","coins","gems"]),price:count,tierRequired:z.enum(["free","plus","ultra","platinum"]),metadata:z.record(z.string().max(40),text(120)).refine(value=>Object.keys(value).length<=10),active:z.boolean()})).max(100),
  ownedItems:z.array(z.object({itemId:id,purchasedAt:date,equipped:z.boolean()})).max(100),
  subscription:z.object({planId:z.enum(["free","plus","ultra","platinum"]),status:z.enum(["active","trialing","canceled"]),testMode:z.boolean(),renewsAt:date.optional()}),
  journalEntries:z.array(z.object({id,userId:id,title:text(120),content:text(12_000),mood,tags:z.array(text(40)).max(12),reflected:z.boolean(),createdAt:date,updatedAt:date})).max(100),
  futureEvents:z.array(z.object({id,userId:id,companionId:id,description:text(500),eventDate:date,relatedMemoryId:id.optional(),status:z.enum(["candidate","confirmed","completed","dismissed"]),createdAt:date})).max(100),
  nudges:z.array(z.object({id,userId:id,eventId:id.optional(),content:text(500),scheduledFor:date,status:z.enum(["planned","sent","canceled"])})).max(100),
  responsePreferences:z.object({listeningFirst:z.boolean(),responseLength:z.enum(["short","balanced","deep"]),adviceStyle:z.enum(["gentle","direct","ask-first"]),questionFrequency:z.enum(["rare","balanced"])}),
  mediaLibrary:z.array(z.object({id,type:z.enum(["image","generated-image"]),name:text(120),url:asset,createdAt:date})).max(100),
  notifications:z.object({frequency:z.enum(["off","low","normal","high"]),quietStart:text(5),quietEnd:text(5),timezone:text(80),enabledTopics:z.array(text(40)).max(10)}),
  memoryEnabled:z.boolean(),aiProcessingConsent:z.boolean(),conversationStorageEnabled:z.boolean(),theme:z.enum(["light","dark"]),activeEnvironment:z.enum(["window-nook","rainy-cafe","rooftop"]),ambienceEnabled:z.boolean(),proactiveCalls:z.enum(["never","rarely","sometimes","often"]),currentView:z.enum(["home","chat","moments","companion","profile","memory","activities"]),
});

export class StateValidationError extends Error {}
export function validateAccountState(value: unknown,maximumBytes=1_500_000): DemoState {
  const result = schema.safeParse(value);
  if (!result.success) throw new StateValidationError(`Invalid account state (${result.error.issues[0]?.path.join(".") || "profile"}). Inline uploads are not supported in accounts.`);
  if(new TextEncoder().encode(JSON.stringify({...result.data,messages:[]})).byteLength>850_000)throw new StateValidationError("Profile and journal data exceed this beta's 850 KB limit. Export before removing old entries.");
  if (new TextEncoder().encode(JSON.stringify(result.data)).byteLength > maximumBytes) throw new StateValidationError("Account data exceeds this beta's storage limit. Export data before removing old entries.");
  const seen = new Set<string>();
  for (const message of result.data.messages) { if (seen.has(message.id)) throw new StateValidationError("Duplicate message identifier."); seen.add(message.id); }
  return result.data as DemoState;
}

export interface StateEnvelope { schemaVersion: 1; revision: number; state: DemoState }
export function decodeAccountState(raw: string,maximumBytes=1_500_000): StateEnvelope {
  const parsed = JSON.parse(raw);
  if (parsed?.schemaVersion !== undefined) {
    if (parsed.schemaVersion !== ACCOUNT_STATE_VERSION || !Number.isSafeInteger(parsed.revision) || parsed.revision < 1) throw new StateValidationError("Unsupported account state version.");
    return {schemaVersion:1,revision:parsed.revision,state:validateAccountState(parsed.state,maximumBytes)};
  }
  // Older optional fields are defaulted; malformed persisted data is not trusted
  // or silently replaced with another user's demonstration conversation.
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)||!parsed.user||!parsed.companion||!Array.isArray(parsed.messages))throw new StateValidationError("Invalid legacy account profile.");
  const state=validateAccountState({...structuredClone(initialState),...parsed});
  state.memories=state.memories.filter(item=>item.status!=="deleted");
  state.wallet={xp:0,level:1,coins:0,gems:0};state.walletTransactions=[];state.ownedItems=[];state.subscription={planId:"free",status:"active",testMode:true};
  return {schemaVersion:1,revision:0,state};
}

export function ownAccountState(input: DemoState, userId: string, current?: DemoState): DemoState {
  const state=structuredClone(input);
  state.user.id=userId;
  state.companion.id=current?.companion.id??crypto.randomUUID();
  state.activeConversationId=current?.activeConversationId??crypto.randomUUID();
  state.user.adultConfirmed=current?.user.adultConfirmed??state.user.adultConfirmed;
  state.companion.createdAt=current?.companion.createdAt??new Date().toISOString();
  state.companion.voiceId="Priya";
  state.activities=structuredClone(initialState.activities);state.storeItems=structuredClone(initialState.storeItems);
  state.wallet=current?.wallet??{xp:0,level:1,coins:0,gems:0};state.walletTransactions=current?.walletTransactions??[];state.ownedItems=current?.ownedItems??[];
  state.relationship.level=current?.relationship.level??1;state.relationship.progress=current?.relationship.progress??0;
  state.subscription=current?.subscription??{planId:"free",status:"active",testMode:true};
  state.memories=current?.memories??[];
  // Derived reflections are not accepted from a whole-document client write.
  state.companionReflections=current?.companionReflections??[];
  if(!current)state.messages=state.messages.map(message=>({...message,conversationId:state.activeConversationId}));
  state.journalEntries=state.journalEntries.map(entry=>({...entry,userId}));
  state.futureEvents=state.futureEvents.map(event=>({...event,userId,companionId:state.companion.id}));
  state.nudges=state.nudges.map(nudge=>({...nudge,userId}));
  if(!state.conversationStorageEnabled){state.messages=[];state.calls=[];state.feedbackSignals=[];state.companionReflections=[];}
  return state;
}

export const memoryCommandSchema=z.discriminatedUnion("action",[
  z.object({action:z.literal("create"),content:z.string().trim().min(1).max(2_000),type:memoryType.optional(),pinned:z.boolean().optional()}),
  z.object({action:z.literal("edit"),id,content:z.string().trim().min(1).max(2_000).optional(),pinned:z.boolean().optional()}),
  z.object({action:z.literal("forget"),id}),
]);
export type MemoryCommand=z.infer<typeof memoryCommandSchema>;
