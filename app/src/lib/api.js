import { assessSafety } from "../../cloudflare/safety.ts";

const API_ROOT = "/api";
const SESSION_TOKEN_KEY = "saathkind-session-token";
const BOOTSTRAP_PENDING_KEY = "saathkind-bootstrap-pending-at";

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function classifySafetyText(input) {
  const assessment = assessSafety(String(input || ""));
  return assessment.level === "crisis" ? assessment.category : null;
}

function legacyClassifySafetyText(input) {
  const normalized = String(input || "").normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "").slice(0, 8_000);
  const deobfuscated = normalized
    .toLowerCase()
    .replace(/[0]/g, "o")
    .replace(/[1!|]/g, "i")
    .replace(/[3]/g, "e")
    .replace(/[4@]/g, "a")
    .replace(/[5$]/g, "s")
    .replace(/[7]/g, "t");
  const compacted = deobfuscated.replace(/[^a-z\u0900-\u097f]+/gu, "");
  const selfHarm = /\b(?:i\s+(?:(?:am|'m)\s+)?(?:going\s+to|gonna|want\s+to|will|might|may|could|plan(?:ning)?\s+to)\s+)?(?:kill|hurt|harm)\s+myself\b|\bi\s+(?:will|want\s+to|might|may|could|plan(?:ning)?\s+to)\s+(?:kill|hurt|harm)\s+me\b|\b(suicid(?:e|al)|overdose|end my life|end it all|take my own life|decided to die(?: tonight)?|going to hang myself|hang myself|shoot myself|jump(?:ing)? off (?:the )?(?:roof|bridge|building|balcony|cliff)|don'?t want to (?:live|be alive)(?: anymore)?|want to die|apni jaan|khudkhushi|mujhe marna hai|jeena nahi)\b|\bi\s+(?:am|'m)\s+(?:cutting|burning|injuring)\s+myself(?:\s+right\s+now)?\b|\bi\s+(?:(?:am|'m)\s+(?:about\s+to|going\s+to)|will|want\s+to)?\s*(?:cut|slit)\s+(?:my\s+)?wrists?\b|\bi\s+(?:(?:am|'m)\s+going\s+to|will|want\s+to)?\s*jump\s+in\s+front\s+of\s+(?:a\s+)?train\b|\bi\s+(?:swallowed|took|have\s+taken)\s+(?:a\s+)?(?:bottle|handful)?\s*(?:of\s+)?(?:pills|tablets)\b|\bi\s+(?:have|have got|'?ve got|am holding)\s+(?:a\s+)?(?:gun|firearm)\b.{0,80}\b(?:shoot|kill|hurt|harm)\s+myself\b|\b(?:bandook|pistol)\s+se\s+(?:khud\s+ko|apne\s+aap\s+ko)\s+goli\b|\b(?:chhat|pul|building)\s+se\s+(?:kud|kood)(?:ne|na)?\b|\bmain\s+(?:aaj\s+raat\s+)?mar\s+ja(?:unga|ungi|aunga|aungi)\b|\bmain\s+(?:faansi|fansi)\s+lagane\s+ja\s+rah[ai]\s+(?:hun|hoon)\b|\bmain\s+(?:zeher|zahar)\s+kha\s+(?:lunga|lungi)\b|\bmain\s+(?:apni\s+)?(?:nas|kalai)\s+kaat\s+(?:lunga|lungi)\b|\b(?:train|gaadi)\s+ke\s+saamne\s+(?:kud|kood)\s+ja(?:unga|ungi)\b|\bmaine\s+(?:zeher|zahar)\s+kha\s+liya\s+hai\b|\bmain\s+(?:khud\s+ko\s+maar|apni\s+(?:nas|kalai)\s+kaatne)\s+(?:ja\s+rah[ai]\s+(?:hun|hoon)|lunga|lungi)\b/i.test(deobfuscated)
    || /(?:आत्म\s*हत्या|ख़?ुदकुशी|(?:मैं|मुझे)?\s*(?:अब\s*)?जीना\s*नहीं\s*(?:चाहता|चाहती)?|ख़?ुद\s*को\s*मार|मुझे\s*मरना\s*है|अपनी\s*जान\s*(?:लेना|देना|ले\s*(?:लूँ|लूंगा|लूँगा|लूंगी|लूँगी)|दे\s*दूँ)|मरना\s*(?:चाहता|चाहती)|(?:फांसी|फाँसी)\s*(?:लगाने|लगा)\s*(?:जा\s*रहा|जा\s*रही|लूँगा|लूंगी|लूँगी)?|(?:बंदूक|पिस्तौल)\s*से\s*(?:ख़?ुद\s*को|अपने\s*आप\s*को)\s*गोली|(?:छत|पुल|इमारत)\s*से\s*कूद|(?:मैं\s*)?(?:आज\s*रात\s*)?मर\s*जाऊँगा|(?:ज़हर|जहर)\s*खा\s*लूँगा|(?:अपनी\s*)?नस\s*काट\s*लूँगा|ट्रेन\s*के\s*सामने\s*कूद|मैंने\s*(?:ज़हर|जहर)\s*खा\s*लिया\s*है|मैं\s*अपनी\s*(?:नस|कलाई)\s*काटने\s*जा\s*रहा)/u.test(normalized)
    || /(killmyself|hurtmyself|harmmyself|cuttingmyself|burningmyself|injuringmyself|(?:cut|slit)(?:my)?wrist|shootmyself|jump(?:ing)?infrontof(?:a)?train|jumpoff(?:the)?(?:roof|bridge|building|balcony|cliff)|swallowed(?:a)?(?:bottle|handful)?(?:of)?(?:pills|tablets)|tookan?overdose|suicid|endmylife|enditall|takemyownlife|decidedtodie|goingtohangmyself|hangmyself|wanttodie|dontwantto(?:live|bealive)(?:anymore)?|khudkhushi|mujhemarnahai|jeenanahi|main(?:aajraat)?marja(?:unga|ungi|aunga|aungi)|main(?:faansi|fansi)laganejara(?:ha|hi)(?:hun|hoon)|main(?:zeher|zahar)kha(?:lunga|lungi)|maine(?:zeher|zahar)khaliyahai|mainkhudkomaar(?:lunga|lungi)|mainapni(?:nas|kalai)kaatnejarah[ai](?:hun|hoon)|main(?:apni)?(?:nas|kalai)kaat(?:lunga|lungi)|(?:train|gaadi)kesaamne(?:kud|kood)ja(?:unga|ungi)|(?:bandook|pistol)se(?:khudko|apneaapko)goli|(?:chhat|pul|building)se(?:kud|kood))/i.test(compacted)
    || /(?:आत्महत्या|ख़?ुदकुशी|जीना(?:नहीं|नही)(?:चाहता|चाहती)?|मुझेमरनाहै|अपनीजानले(?:लूँ|लूंगा|लूँगा|लूंगी|लूँगी)|मरना(?:चाहता|चाहती)|ख़?ुदकोमार|फांसी(?:लगाने|लगा)|फाँसी(?:लगाने|लगा)|मैंने(?:ज़हर|जहर)खालियाहै|मैंअपनी(?:नस|कलाई)काटनेजारहा|(?:बंदूक|पिस्तौल)से(?:ख़?ुदको|अपनेआपको)गोली|(?:छत|पुल|इमारत)सेकूद)/u.test(compacted);
  const directSelfHarm = /\bself[- ]?harm\b|\bmar\s+jaana\b|\bi\s+(?:(?:am|'m)\s+(?:going\s+to|about\s+to)|will|want\s+to|might|may|could|plan(?:ning)?\s+to)\s+(?:stab|burn|poison|drown|cut|suffocate|electrocute|choke|shoot|hang)\s+myself\b|\bi\s+(?:have|have got|'?ve got|am holding)\s+(?:a\s+)?(?:knife|blade)\b.{0,80}\b(?:stab|cut|kill|hurt|harm)\s+myself\b|\bi\s+(?:put|have|held)\s+(?:a\s+)?(?:gun|firearm)\s+(?:to|against|at)\s+(?:my\s+)?head\b|\bi\s+(?:(?:am|'m)\s+(?:going\s+to|about\s+to)|will|want\s+to|plan(?:ning)?\s+to)\s+(?:take|swallow)\s+all\s+(?:of\s+)?(?:these|my|the)?\s*(?:pills|tablets)\b|\bi\s+(?:have|'?ve)\s+tied\s+(?:a\s+)?(?:rope|cord|noose)\s+around\s+(?:my\s+)?neck\b|\bi\s+(?:(?:am|'m)\s+going\s+to|will|plan(?:ning)?\s+to)\s+crash\s+(?:my\s+)?(?:car|vehicle)\s+(?:to|so\s+i)\s+die\b|\bmain\s+marna\s+chaht[ai]\s+(?:hun|hoon)\b|\bmain\s+(?:pankhe|fan)\s+se\s+latak\s+ja(?:unga|ungi)\b|\bmain\s+(?:khud\s+ko\s+)?(?:chaaku|chaku)\s+maar(?:ne)?\s+ja\s+rah[ai]\s+(?:hun|hoon)\b/i.test(deobfuscated)
    || /मैं\s*(?:खुद|ख़ुद)\s*को\s*(?:चाकू|छुरी)\s*मारने\s*जा\s*रह[ाी]|मैं\s*पंखे\s*से\s*लटकने\s*जा\s*रह[ाी]/u.test(normalized)
    || /(?:(?:stab|burn|poison|drown|cut|suffocate|electrocute|choke|shoot|hang)myself|(?:put|have|held)(?:a)?(?:gun|firearm)(?:to|against|at)(?:my)?head|(?:take|swallow)all(?:of)?(?:these|my|the)?(?:pills|tablets)|(?:have|ve)tied(?:a)?(?:rope|cord|noose)around(?:my)?neck|crash(?:my)?(?:car|vehicle)(?:to|soi)die|mainmarnachaht[ai](?:hun|hoon)|main(?:pankhe|fan)selatakja(?:unga|ungi)|main(?:khudko)?(?:chaaku|chaku)maar(?:ne)?jarah[ai](?:hun|hoon)|मैं(?:खुद|ख़ुद)को(?:चाकू|छुरी)मारनेजारह[ाी]|मैंपंखेसेलटकनेजारह[ाी])/iu.test(compacted);
  if (selfHarm || directSelfHarm) return "self_harm";
  const violence = /\b(?:kill|hurt|harm|shoot|stab|attack)\s+(?:him|her|them|someone|me)\b|\b(?:usko|use|unko)\s+(?:maar dunga|maar dungi|khatam kar)\b|\b(?:my\s+)?(?:husband|wife|partner|boyfriend|girlfriend|someone|he|she|they)\s+(?:is|was|keeps?)\s+(?:beating|hitting|raping|abusing|attacking)\s+me\b|\b(?:my\s+)?(?:husband|wife|partner|boyfriend|girlfriend|someone|he|she|they)\s+(?:beats?|hits?|rapes?|abuses?|attacks?)\s+me(?:\s+every\s+day)?\b|\bi\s+(?:am|'m|was)\s+(?:being\s+)?(?:beaten|hit|raped|abused|attacked|sexually assaulted)\b|\b(?:someone|he|she|they)\s+(?:is|are|was|were)\s+forcing\s+me\s+to\s+(?:have\s+)?sex\b|\bi\s+(?:am|'m|was)\s+(?:being\s+)?forced\s+to\s+(?:have\s+)?sex\b|\b(?:my\s+)?(?:husband|wife|partner|boyfriend|girlfriend)\s+forced\s+me\s+to\s+(?:have\s+)?sex\b|\b(?:mera|meri)\s+(?:pati|patni|partner|boyfriend|girlfriend)\s+mujhe\s+(?:peet|maar|hit)\s+rah[ai]\s+hai\b|\bkoi\s+mujhe\s+(?:sex|sambhog)\s+ke\s+liye\s+majboor\s+kar\s+rah[ai]\s+hai\b|\bmera\s+(?:pati|partner|boyfriend)\s+mujhe\s+roz\s+(?:maarta|peetta|hit\s+karta)\s+hai\b|\busne\s+mere\s+saath\s+(?:zabardasti|jabardasti)\s+(?:sex|sambhog)\s+kiya\b/i.test(deobfuscated)
    || /(?:उसे|उसको|किसी\s*को)\s*(?:मार\s*(?:दूँगा|दूंगा|दूँगी|दूंगी)|ख़त्म\s*कर)|(?:(?:पति|पत्नी|साथी|कोई|वह)\s*)?(?:मुझे|मेरे\s*साथ)\s*(?:मार|पीट|बलात्कार|ज़बरदस्ती|जबरदस्ती|यौन\s*हमला)|(?:सेक्स|संभोग)\s*(?:के\s*लिए)?\s*(?:मजबूर|बाध्य)/u.test(normalized)
    || /(?:kill|hurt|harm|shoot|stab|attack)(?:him|her|them|someone|me)|(?:usko|use|unko)(?:maardunga|maardungi|khatamkar)|(?:(?:my)?(?:husband|wife|partner|boyfriend|girlfriend|someone|he|she|they)(?:is|was|keeps?)(?:beating|hitting|raping|abusing|attacking)me)|(?:my)?(?:husband|wife|partner|boyfriend|girlfriend|someone|he|she|they)(?:beats?|hits?|rapes?|abuses?|attacks?)me(?:everyday)?|i(?:am|m|was)(?:being)?(?:beaten|hit|raped|abused|attacked|sexuallyassaulted)|(?:someone|he|she|they)(?:is|are|was|were)forcingmeto(?:have)?sex|i(?:am|m|was)(?:being)?forcedto(?:have)?sex|(?:mera|meri)(?:pati|patni|partner|boyfriend|girlfriend)mujhe(?:peet|maar|hit)rah[ai]hai|koimujhe(?:sex|sambhog)keliyemajboorkarrah[ai]hai|mera(?:pati|partner|boyfriend)mujheroz(?:maarta|peetta|hitkarta)hai|usnemeresaath(?:zabardasti|jabardasti)(?:sex|sambhog)kiya/i.test(compacted)
    || /(?:उसे|उसको|किसीको)(?:मार(?:दूँगा|दूंगा|दूँगी|दूंगी)|ख़त्मकर)|(?:(?:पति|पत्नी|साथी|कोई|वह)?(?:मुझे|मेरेसाथ)(?:मार|पीट|बलात्कार|ज़बरदस्ती|जबरदस्ती|यौनहमला))|(?:सेक्स|संभोग)(?:केलिए)?(?:मजबूर|बाध्य)|मुझसे(?:जबरदस्ती|ज़बरदस्ती)(?:सेक्स|संभोग)करायाजारहा|उसनेमेराबलात्कारकिया/u.test(compacted);
  const directVictimization = /\b(?:my\s+)?(?:father|mother|parent|uncle|aunt|neighbor|neighbour|a\s+man|a\s+woman)\s+(?:is|was|keeps?)\s+(?:beating|hitting|raping|abusing|sexually\s+abusing|attacking)\s+me\b|\b(?:my\s+)?(?:father|mother|parent|uncle|aunt|neighbor|neighbour|a\s+man|a\s+woman)\s+(?:beats?|hits?|rapes?|abuses?|sexually\s+abuses?|attacks?|attacked)\s+me(?:\s+every\s+day)?\b|\b(?:someone|a\s+man|a\s+woman|he|she|they)\s+(?:is|was)\s+holding\s+(?:a\s+)?(?:knife|gun|weapon)\s+(?:to|at|against)\s+me\b/i.test(deobfuscated)
    || /मेरे\s*(?:पिता|पापा|माता|माँ|चाचा|मामा|पड़ोसी)\s*मुझे\s*(?:रोज\s*)?(?:पीटते|मारते|धमकाते)\s*(?:हैं|है)/u.test(normalized)
    || /(?:(?:my)?(?:father|mother|parent|uncle|aunt|neighbor|neighbour|aman|awoman)(?:is|was|keeps?)(?:beating|hitting|raping|abusing|sexuallyabusing|attacking)me|(?:my)?(?:father|mother|parent|uncle|aunt|neighbor|neighbour|aman|awoman)(?:beats?|hits?|rapes?|abuses?|sexuallyabuses?|attacks?|attacked)me(?:everyday)?|(?:someone|aman|awoman|he|she|they)(?:is|was)holding(?:a)?(?:knife|gun|weapon)(?:to|at|against)me|मेरे(?:पिता|पापा|माता|माँ|चाचा|मामा|पड़ोसी)मुझे(?:रोज)?(?:पीटते|मारते|धमकाते)(?:हैं|है))/iu.test(compacted);
  return violence || directVictimization ? "violence" : null;
}

function readSessionToken() {
  try {
    return window.sessionStorage.getItem(SESSION_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function hasApiSession() {
  return Boolean(readSessionToken());
}

export function clearApiSession() {
  try {
    window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
    window.sessionStorage.removeItem(BOOTSTRAP_PENDING_KEY);
  } catch {
    // Cookie-based sessions are still revoked by the API when it is reachable.
  }
}

export async function apiRequest(path, options = {}) {
  const { timeoutMs = 20_000, skipAuthorization = false, ...requestOptions } = options;
  const controller = new AbortController();
  // The Worker gives Gemini up to 15 seconds. Keep the browser deadline longer
  // so the Worker can return its disclosed provider fallback instead of the
  // browser aborting a request that is still being handled safely.
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const token = readSessionToken();
  const headers = new Headers(requestOptions.headers || {});

  if (requestOptions.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token && !skipAuthorization && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);

  try {
    const response = await fetch(`${API_ROOT}${path}`, {
      ...requestOptions,
      credentials: "same-origin",
      headers,
      signal: controller.signal,
    });

    if (response.status === 204) {
      if (!response.ok) throw new Error(`API unavailable (${response.status})`);
      return null;
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error(`API returned an unexpected response (${response.status})`);
    }

    const payload = await response.json();
    if (!response.ok || payload?.ok === false) {
      const error = new Error(payload?.error?.message || `API unavailable (${response.status})`);
      error.code = payload?.error?.code || "api_error";
      error.status = response.status;
      error.details = payload?.error?.details;
      throw error;
    }
    return payload?.data ?? payload;
  } finally {
    window.clearTimeout(timer);
  }
}

async function fetchAllItems(path) {
  const items = [];
  let cursor = null;
  for (let page = 0; page < 100; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const query = `${separator}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const result = await apiRequest(`${path}${query}`);
    items.push(...(Array.isArray(result?.items) ? result.items : []));
    cursor = result?.nextCursor || null;
    if (!cursor) return items;
  }
  throw new Error("Cloud history is too large to load safely. Please export your data or try again later.");
}

function zonedDateAndTime(value, timeZone) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

export function zonedWallTimeToIso(dateValue, timeValue, timeZone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateValue || "")) || !/^\d{2}:\d{2}$/.test(String(timeValue || ""))) return null;
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
  const wallTimeUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const zone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
  const offsetAt = (instant) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(instant));
    const part = (type) => Number(parts.find((item) => item.type === type)?.value || 0);
    return Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second")) - instant;
  };
  try {
    let instant = wallTimeUtc - offsetAt(wallTimeUtc);
    instant = wallTimeUtc - offsetAt(instant);
    const roundTrip = zonedDateAndTime(instant, zone);
    if (roundTrip.date !== dateValue || roundTrip.time !== timeValue) return null;
    return new Date(instant).toISOString();
  } catch {
    return null;
  }
}

export async function bootstrapSession(profile) {
  let provisionalAccessToken = readSessionToken();
  let data;
  let recoveredBootstrap = false;
  let pendingBootstrap = false;
  try {
    pendingBootstrap = Number(window.sessionStorage.getItem(BOOTSTRAP_PENDING_KEY) || 0) > 0;
  } catch {
    pendingBootstrap = false;
  }

  // A previous bootstrap response may have been lost after the server committed
  // the account. Probe the existing high-entropy token before creating another.
  if (/^[a-f0-9]{64,128}$/i.test(provisionalAccessToken)) {
    try {
      data = await apiRequest("/session", { timeoutMs: 3_000 });
      recoveredBootstrap = true;
    } catch (error) {
      if ((error?.status === 401 || error?.status === 410) && !pendingBootstrap) {
        clearApiSession();
      } else if (!(error?.status === 401 || error?.status === 410)) {
        const uncertain = new Error("Cloud setup is still unconfirmed. Wait a moment, then choose Enter Saathkind again to reconnect with the same temporary session token.");
        uncertain.code = "bootstrap_unconfirmed";
        throw uncertain;
      }
    }
  }

  if (!data) {
    if (!/^[a-f0-9]{64,128}$/i.test(provisionalAccessToken)) {
      provisionalAccessToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
    }
    try {
      window.sessionStorage.setItem(SESSION_TOKEN_KEY, provisionalAccessToken);
      window.sessionStorage.setItem(BOOTSTRAP_PENDING_KEY, String(Date.now()));
    } catch {
      // The HttpOnly cookie still works when the response reaches the browser,
      // but a lost response cannot be recovered without sessionStorage.
    }
    try {
      data = await apiRequest("/session/bootstrap", {
        method: "POST",
        body: JSON.stringify({
          clientAccessToken: provisionalAccessToken,
          displayName: profile.name,
          language: { English: "en", Hindi: "hi", Hinglish: "hinglish" }[profile.language] || "hinglish",
          pronouns: profile.pronouns,
          timezone: profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata",
          ageConfirmed: true,
          consents: {
            chatStorage: Boolean(profile.consents?.chat),
            aiProcessing: Boolean(profile.consents?.ai),
            memory: Boolean(profile.consents?.memory),
            proactiveFollowups: Boolean(profile.consents?.notifications),
            moodInference: Boolean(profile.consents?.mood),
          },
        }),
      });
    } catch (bootstrapError) {
      if (bootstrapError?.status >= 400 && bootstrapError?.status < 500 && bootstrapError?.code !== "bootstrap_in_progress") {
        clearApiSession();
        throw bootstrapError;
      }
      // Bootstrap is fast but cross-store. Give an in-flight commit a moment,
      // then use the provisional token to recover a response that was lost.
      let lastProbeError;
      for (const delay of [350, 650, 1_000, 1_500]) {
        await wait(delay);
        try {
          data = await apiRequest("/session", { timeoutMs: 3_000 });
          recoveredBootstrap = true;
          break;
        } catch (probeError) {
          lastProbeError = probeError;
        }
      }
      if (!data) {
        const uncertain = new Error("Cloud setup could not be confirmed. It may already have created a temporary account that will expire after 30 days. Choose Enter Saathkind again to reconnect with this same setup, or continue on this device only; do not start a second cloud setup.");
        uncertain.code = "bootstrap_unconfirmed";
        uncertain.cause = lastProbeError;
        throw uncertain;
      }
    }
  }

  if (data?.accessToken) {
    try {
      window.sessionStorage.setItem(SESSION_TOKEN_KEY, data.accessToken);
    } catch {
      // The HttpOnly cookie remains the preferred same-origin session path.
    }
  }
  try {
    window.sessionStorage.removeItem(BOOTSTRAP_PENDING_KEY);
  } catch {
    // Session recovery no longer needs the bootstrap marker after success.
  }

  let warning = recoveredBootstrap ? {
    code: "bootstrap_response_recovered",
    message: "The original setup response was interrupted, but this device safely reconnected to the same temporary beta account.",
    recoverable: false,
  } : null;
  if (profile.consents?.notifications) {
    try {
      await apiRequest("/quiet-hours", {
        method: "PATCH",
        body: JSON.stringify({
          start: profile.quietStart,
          end: profile.quietEnd,
          enabled: true,
        }),
      });
    } catch {
      // Account creation already succeeded. Preserve that connected session and
      // let the UI surface a recoverable preference-sync warning.
      warning = {
        code: "quiet_hours_sync_failed",
        message: "Your account is connected, but quiet hours could not be saved. Retry from Settings.",
        recoverable: true,
      };
    }
  }

  // The bearer token is retained only in sessionStorage (and the server also
  // sets an HttpOnly cookie). Never expose it to React state or persistence.
  const { accessToken: _accessToken, ...session } = data || {};
  return { ...session, warning };
}

export async function logoutSession() {
  try {
    const result = await apiRequest("/auth/logout", { method: "POST", body: "{}" });
    clearApiSession();
    return result;
  } catch (error) {
    if (error?.status === 401 || error?.status === 410) {
      try {
        const result = await apiRequest("/auth/logout", { method: "POST", body: "{}", skipAuthorization: true });
        clearApiSession();
        return { ...result, recovered: true };
      } catch (cookieError) {
        if (cookieError?.status === 401 || cookieError?.status === 410) {
          clearApiSession();
          return { signedOut: true, recovered: true };
        }
        throw cookieError;
      }
    }
    throw error;
  }
}

function localSafetyResponse(category, input) {
  const devanagari = /[\u0900-\u097f]/u.test(input);
  return {
    reply: category === "violence"
      ? devanagari
        ? "यह तुरंत सुरक्षा का जोखिम हो सकता है। हथियार या शामिल व्यक्ति से दूरी बनाएँ, संभव हो तो सुरक्षित जगह जाएँ, और किसी भरोसेमंद व्यक्ति को अभी बताएँ। अगर किसी को तुरंत खतरा है, भारत में 112 पर कॉल करें।"
        : "This may be an immediate safety risk. Create physical distance from weapons or the person involved, move somewhere safer if you can, and contact someone you trust. If anyone is in immediate danger in India, call 112 now."
      : devanagari
        ? "मुझे अफ़सोस है कि आप इतना कुछ झेल रहे हैं। मैं ऑफ़लाइन AI डेमो हूँ, आपातकालीन सेवा नहीं। कृपया ऐसी चीज़ों से दूर जाएँ जिनसे आप खुद को नुकसान पहुँचा सकते हैं, किसी भरोसेमंद व्यक्ति को अभी अपने पास बुलाएँ, और Tele-MANAS को 14416 या 1800-89-14416 पर कॉल करें। अगर तुरंत खतरा है तो 112 पर कॉल करें या नज़दीकी इमरजेंसी विभाग जाएँ।"
        : "I’m sorry you’re carrying this. I’m an offline AI demo, not an emergency service. Move away from anything you could use to hurt yourself, contact someone you trust who can stay with you, and call Tele-MANAS at 14416 or 1800-89-14416. If you may act now, call 112 or go to the nearest emergency department.",
    mode: "local-safety",
    // High-risk text is intentionally intercepted before any cloud request.
    // Keep the disclosure and guidance together on this device across reloads
    // without implying that either was stored in the cloud account.
    syncStatus: "local-safety",
  };
}

function localConversationReply(input) {
  const lower = input.toLowerCase();
  if (/\b(hello|hey|hi|namaste|hello ji)\b/.test(lower)) return "Hey — this is the on-device demo fallback. I’m here and listening. What’s on your mind?";
  if (/\b(interview|exam|meeting|presentation|deadline)\b/.test(lower)) return "That sounds important. Would it help to name what feels heaviest, or make one small preparation step?";
  if (/\b(sad|upset|lonely|akela|bura|tired|thak)\b/.test(lower)) return "That sounds like a lot to carry. What part feels hardest right now?";
  return "The cloud is not connected, so this is a limited on-device demo reply. Would being heard, thinking it through, or choosing one small next step help most?";
}

export async function sendChatMessage(messages, conversationId, { localOnly = false } = {}) {
  const latestMessage = [...messages].reverse().find((message) => message.role === "user");
  const latest = latestMessage?.content || "";
  const clientMessageId = String(latestMessage?.clientMessageId || latestMessage?.id || crypto.randomUUID());
  const safetyCategory = classifySafetyText(latest);
  if (safetyCategory) return localSafetyResponse(safetyCategory, latest);
  if (localOnly) return { reply: localConversationReply(latest), mode: "local-demo", conversationId };
  try {
    const data = await apiRequest("/chat", {
      method: "POST",
      headers: { "Idempotency-Key": `chat-${clientMessageId}` },
      body: JSON.stringify({
        content: latest,
        clientMessageId,
        ...(conversationId ? { conversationId } : {}),
      }),
    });
    const reply = data?.assistantMessage?.content || data?.reply || data?.message || data?.output;
    if (!reply || typeof reply !== "string") throw new Error("Invalid chat response");
    return {
      reply,
      mode: data?.fallback === false && data?.assistantMessage?.provider === "gemini" ? "live" : "api-demo",
      safety: data?.safety,
      conversationId: data?.conversation?.id || conversationId,
      userMessageId: data?.userMessage?.id || null,
      assistantMessageId: data?.assistantMessage?.id || null,
      usage: data?.usage,
    };
  } catch (error) {
    await wait(300);
    const rejected = error?.status >= 400 && error?.status < 500 && error?.status !== 429;
    return {
      reply: error?.status === 429
        ? "The demo message limit was reached. Please pause and try again later."
        : rejected
          ? ["ai_processing_consent_required", "consent_required"].includes(error?.code)
            ? "AI-processing consent is off, so this turn was not sent or saved to the cloud. Re-enable it in Settings before sending another cloud reply."
            : "The cloud rejected this turn before confirming a save. It remains visible on this device; copy it before reloading if you need to keep it."
          : "The cloud result could not be confirmed. This device keeps the turn visible, and it may already exist in the beta account. Copy it before reloading, and wait before retrying to avoid a duplicate.",
      mode: rejected ? "rejected" : "error",
      syncStatus: rejected ? "rejected" : "unconfirmed",
      ...(error?.code === "message_allowance_reached" ? {
        usage: {
          period: error.details?.period || null,
          counters: { messages: error.details?.messages || error.details?.limit || 0 },
          limits: { messages: error.details?.limit || 300 },
          remaining: { messages: 0 },
        },
      } : {}),
    };
  }
}

export function mergeCloudMessages(cloudMessages = [], deviceMessages = []) {
  const cloudIds = new Set(cloudMessages.map((message) => String(message.id)));
  const committedClientIds = new Set(cloudMessages.map((message) => message.clientMessageId).filter(Boolean).map(String));
  const unresolved = deviceMessages.filter((message) =>
    ["pending", "unconfirmed", "rejected", "local-safety"].includes(message.syncStatus)
    && !cloudIds.has(String(message.id))
    && !committedClientIds.has(String(message.clientMessageId || "")),
  ).map((message) => message.syncStatus === "pending" ? { ...message, syncStatus: "unconfirmed" } : message);
  return [...cloudMessages, ...unresolved];
}

export async function loadUsage() {
  const usage = await apiRequest("/usage");
  return {
    period: usage?.period || null,
    plan: usage?.plan || "free",
    counters: { ...(usage?.counters || {}) },
    limits: { ...(usage?.limits || {}) },
    remaining: { ...(usage?.remaining || {}) },
  };
}

export function incrementMessageUsage(current) {
  const messagesUsed = Number(current?.counters?.messages || 0) + 1;
  const messageLimit = Number(current?.limits?.messages || 300);
  return {
    ...current,
    counters: { ...(current?.counters || {}), messages: messagesUsed },
    remaining: { ...(current?.remaining || {}), messages: Math.max(messageLimit - messagesUsed, 0) },
  };
}

export async function loadCloudState() {
  const conversations = await apiRequest("/conversations?limit=1");
  const latestConversation = conversations?.items?.[0] || null;
  const [messages, memories, followups, goals, quietHours, cloudAccount, consentRecords, usage] = await Promise.all([
    latestConversation ? fetchAllItems(`/conversations/${latestConversation.id}/messages`) : Promise.resolve([]),
    fetchAllItems("/memories"),
    fetchAllItems("/followups"),
    fetchAllItems("/goals"),
    apiRequest("/quiet-hours"),
    apiRequest("/session"),
    apiRequest("/consents"),
    loadUsage(),
  ]);
  const cloudProfile = cloudAccount?.profile || {};

  const consentGranted = (name) => consentRecords?.[name]?.granted === true;
  const normalizedConsentRecords = Object.fromEntries(
    ["chatStorage", "aiProcessing", "memory", "proactiveFollowups", "moodInference"].map((name) => [
      name,
      {
        granted: consentGranted(name),
        updatedAt: consentRecords?.[name]?.updatedAt || null,
      },
    ]),
  );

  return {
    conversationId: latestConversation?.id || null,
    messages: messages.map((message) => ({
      id: message.id,
      clientMessageId: message.clientMessageId || null,
      role: message.role,
      content: message.content,
      time: new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    })),
    memories: memories.map((memory) => ({
      id: memory.id,
      title: memory.category || "Saved memory",
      text: memory.content,
      source: memory.sourceMessageId ? "Approved conversation memory" : "Added by you",
      confidence: `${Math.round((memory.confidence || 1) * 100)}%`,
      pinned: Boolean(memory.pinned),
      category: memory.category || "Fact",
      sourceMessageId: memory.sourceMessageId || null,
    })),
    followups: followups.map((item) => {
      const scheduled = zonedDateAndTime(item.scheduledFor, cloudProfile?.timezone);
      return { id: item.id, title: item.topic, date: scheduled.date, time: scheduled.time, enabled: item.status === "scheduled" };
    }),
    goals: goals.map((goal) => {
      const total = Number.isFinite(Number(goal.total)) && Number(goal.total) > 0 ? Number(goal.total) : 1;
      const progress = Number.isFinite(Number(goal.progress))
        ? Math.min(Math.max(Number(goal.progress), 0), total)
        : goal.status === "completed" ? total : 0;
      return { id: goal.id, title: goal.title, note: goal.description || "", status: goal.status, progress, total };
    }),
    quietHours,
    profile: {
      displayName: cloudAccount?.user?.displayName || null,
      timezone: cloudProfile?.timezone || null,
      language: cloudProfile?.language || "hinglish",
      pronouns: cloudProfile?.pronouns || null,
      memoryPaused: Boolean(cloudProfile?.memoryPaused),
      followupsEnabled: Boolean(cloudProfile?.followupsEnabled),
    },
    consents: {
      chat: consentGranted("chatStorage"),
      ai: consentGranted("aiProcessing"),
      memory: consentGranted("memory"),
      notifications: consentGranted("proactiveFollowups"),
      mood: consentGranted("moodInference"),
    },
    consentRecords: normalizedConsentRecords,
    usage,
  };
}

export async function requestCloudExport({ timeoutMs = 10_000, pollIntervalMs = 500 } = {}) {
  const created = await apiRequest("/data/export", { method: "POST", body: "{}" });
  if (created?.status === "ready" && created.export !== undefined) return created.export;
  if (!created?.id) throw new Error("Cloud export did not return a request ID.");

  const deadline = Date.now() + Math.max(0, timeoutMs);
  const path = `/data/export/${encodeURIComponent(created.id)}`;
  while (true) {
    const result = await apiRequest(path);
    if (result?.status === "ready") {
      if (result.export === undefined) throw new Error("Cloud export completed without export data.");
      return result.export;
    }
    if (["failed", "cancelled"].includes(result?.status)) {
      throw new Error("Cloud export could not be prepared.");
    }
    if (Date.now() >= deadline) {
      const error = new Error("Cloud export is still being prepared. Please try again shortly.");
      error.code = "export_timeout";
      throw error;
    }
    await wait(Math.max(0, Math.min(pollIntervalMs, deadline - Date.now())));
  }
}

export async function saveDemoResource(path, payload, method = "POST", { localOnly = false } = {}) {
  if (localOnly) return { mode: "local" };
  try {
    const data = await apiRequest(path, {
      method,
      ...(method === "DELETE" ? {} : { body: JSON.stringify(payload ?? {}) }),
    });
    return { mode: "live", data };
  } catch (error) {
    await wait(150);
    const status = Number(error?.status || 0);
    return { mode: status >= 400 && status < 500 ? "rejected" : "uncertain", error };
  }
}

export function consentValueAfterWrite({ result, requested, previous, apiName }) {
  if (result?.mode === "live") {
    const record = result.data?.[apiName];
    return typeof record?.granted === "boolean" ? record.granted : Boolean(requested);
  }
  if (result?.mode === "local") return Boolean(requested);
  if (result?.mode === "rejected") return Boolean(previous);
  // A network or 5xx result is ambiguous: the withdrawal may already have
  // committed. Keep dependent processing off until an authoritative refresh.
  if (result?.mode === "uncertain") return requested ? Boolean(previous) : false;
  return Boolean(previous);
}
