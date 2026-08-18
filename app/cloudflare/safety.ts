export type SafetyAssessment = {
  level: "standard" | "elevated" | "crisis";
  category: "none" | "distress" | "self_harm" | "violence";
  shouldCallModel: boolean;
  response?: string;
  resources?: Array<{ label: string; value: string }>;
};

const CRISIS_PATTERNS = [
  /\b(?:i\s+(?:(?:am|'m)\s+)?(?:going\s+to|gonna|want\s+to|will|might|may|could|plan(?:ning)?\s+to)\s+)?(kill|hurt|harm)\s+myself\b/i,
  /\bi\s+(?:will|want\s+to|might|may|could|plan(?:ning)?\s+to)\s+(kill|hurt|harm)\s+me\b/i,
  /\bi\s+(?:(?:am|'m)\s+(?:going\s+to|about\s+to)|will|want\s+to|might|may|could|plan(?:ning)?\s+to)\s+(?:stab|burn|poison|drown|cut|suffocate|electrocute|choke|shoot|hang)\s+myself\b/i,
  /\b(suicid(?:e|al)|end my life|end it all|don'?t want to (?:live|be alive)(?: anymore)?|want to die)\b/i,
  /\bi\s+(?:am|'m)\s+(?:cutting|burning|injuring)\s+myself(?:\s+right\s+now)?\b/i,
  /\bi\s+(?:(?:am|'m)\s+(?:about\s+to|going\s+to)|will|want\s+to)?\s*(?:cut|slit)\s+(?:my\s+)?wrists?\b/i,
  /\bi\s+(?:(?:am|'m)\s+going\s+to|will|want\s+to)?\s*jump\s+in\s+front\s+of\s+(?:a\s+)?train\b/i,
  /\bi\s+(?:swallowed|took|have\s+taken)\s+(?:a\s+)?(?:bottle|handful)?\s*(?:of\s+)?(?:pills|tablets)\b/i,
  /\bi\s+(?:swallowed|took|have\s+taken)\s+\d{1,4}\s+(?:sleeping\s+)?(?:pills|tablets)\b/i,
  /\bi(?:\s+(?:took|have\s+taken|swallowed)|'?ve\s+taken)\s+(?:too\s+many|a\s+lot\s+of|lots?\s+of|\d{1,4})\s+(?:pills|tablets|paracetamol|tylenol)\b/i,
  /\bi(?:\s+(?:took|swallowed|ingested)|'?ve\s+(?:taken|swallowed|ingested))\s+(?:(?:a|the)\s+whole\s+bottle\s+of|a\s+bottle\s+of|too\s+many|a\s+lot\s+of|lots?\s+of|\d{1,4})\s+(?:sleeping\s+)?(?:pills|tablets|paracetamol|tylenol|ibuprofen|medication|medicine)\b/i,
  /\bi\s+(?:am|'m)\s+overdos(?:ing|ed)\b/i,
  /\bi\s+(?:drank|swallowed)\s+(?:(?:a\s+)?bottle\s+of\s+)?(?:bleach|(?:rat\s+)?poison)\b/i,
  /\bi\s+(?:stabbed|shot|burned|poisoned|cut)\s+myself\b/i,
  /\bi\s+(?:slit|cut)\s+(?:my\s+)?throat\b/i,
  /\bi\s+took\s+all\s+(?:of\s+)?my\s+(?:pills|tablets)\b/i,
  /\bi\s+(?:put|have|'?ve)\s+(?:a\s+)?(?:rope|cord|noose)\s+around\s+(?:my\s+)?neck\b/i,
  /\bi\s+(?:put|have|'?ve)\s+(?:a\s+)?knife\s+(?:to|at|against)\s+(?:my\s+)?throat\b/i,
  /\bi\s+(?:have|'?ve|put)\s+(?:a\s+)?gun\s+(?:in|to|against)\s+(?:my\s+)?mouth\b/i,
  /\bi\s+(?:am|'m)\s+standing\s+on\s+(?:the\s+)?roof\s+ready\s+to\s+jump\b/i,
  /\bi\s+(?:am|'m)\s+on\s+(?:the\s+)?(?:railway|train)\s+tracks?\s+waiting\s+for\s+(?:a\s+)?train\b/i,
  /\bi\s+(?:have|'?ve)\s+just\s+(?:shot|stabbed|cut|burned|poisoned)\s+myself\b/i,
  /\bi\s+(?:am|'m)\s+bleeding\s+after\s+(?:slitting|cutting)\s+(?:my\s+)?wrists?\b/i,
  /\bi\s+(?:cut|slit|stabbed)\s+(?:my\s+)?(?:arm|wrist|leg|neck|throat|chest)\b.{0,80}\b(?:bleed(?:ing)?|blood|will\s+not\s+stop|won'?t\s+stop)\b/i,
  /\bi\s+(?:(?:am|'m)\s+(?:going\s+to|about\s+to)|will|want\s+to)\s+(?:jump|throw\s+myself)\s+(?:from|off)\s+(?:(?:a|the|my)\s+)?(?:balcony|roof|bridge|building|cliff)\b/i,
  /\bi\s+(?:am|'m)\s+(?:hanging|choking|strangling)\s+myself(?:\s+(?:now|right\s+now))?\b/i,
  /\bi\s+(?:have|'?ve|put|tied)\s+(?:a\s+)?(?:rope|cord|noose)\s+(?:around|on)\s+(?:my\s+)?neck\b/i,
  /\bi(?:(?:'m|\s+am)\s+holding|\s+(?:put|have)|'?ve)\s+(?:a\s+)?(?:knife|blade|gun|firearm)\s+(?:to|at|against)\s+(?:my\s+)?(?:chest|neck|throat|head|mouth)\b/i,
  /\bi\s+(?:(?:am|'m)\s+(?:going\s+to|about\s+to)|will|want\s+to)\s+(?:take|swallow|drink)\s+(?:\d{1,4}\s+)?(?:sleeping\s+)?(?:pills|tablets|poison)\b/i,
  /\bi\s+(?:have|'?ve)\s+(?:a\s+)?(?:rope|cord|noose)\s+around\s+(?:my\s+)?neck\b/i,
  /\bi\s+(?:(?:am|'m)\s+(?:going\s+to|about\s+to)|will|want\s+to)\s+(?:cut|slit)\s+(?:my\s+)?throat\b/i,
  /\b(?:take my own life|decided to die(?: tonight)?|going to hang myself|hang myself)\b/i,
  /\b(?:shoot myself|jump(?:ing)? off (?:the )?(?:roof|bridge|building|balcony|cliff))\b/i,
  /\bi\s+(?:have|have got|'?ve got|am holding)\s+(?:a\s+)?(?:gun|firearm)\b.{0,80}\b(?:shoot|kill|hurt|harm)\s+myself\b/i,
  /\bi\s+(?:have|have got|'?ve got|am holding)\s+(?:a\s+)?(?:knife|blade)\b.{0,80}\b(?:stab|cut|kill|hurt|harm)\s+myself\b/i,
  /\bi\s+(?:put|have|held)\s+(?:a\s+)?(?:gun|firearm)\s+(?:to|against|at)\s+(?:my\s+)?head\b/i,
  /\bi\s+(?:(?:am|'m)\s+(?:going\s+to|about\s+to)|will|want\s+to|plan(?:ning)?\s+to)\s+(?:take|swallow)\s+all\s+(?:of\s+)?(?:these|my|the)?\s*(?:pills|tablets)\b/i,
  /\bi\s+(?:have|'?ve)\s+tied\s+(?:a\s+)?(?:rope|cord|noose)\s+around\s+(?:my\s+)?neck\b/i,
  /\bi\s+(?:(?:am|'m)\s+going\s+to|will|plan(?:ning)?\s+to)\s+crash\s+(?:my\s+)?(?:car|vehicle)\s+(?:to|so\s+i)\s+die\b/i,
  /\b(?:bandook|pistol)\s+se\s+(?:khud\s+ko|apne\s+aap\s+ko)\s+goli\b|\b(?:chhat|pul|building)\s+se\s+(?:kud|kood)(?:ne|na)?\b/i,
  /\bmain\s+(?:aaj\s+raat\s+)?mar\s+ja(?:unga|ungi|aunga|aungi)\b|\bmain\s+(?:faansi|fansi)\s+lagane\s+ja\s+rah[ai]\s+(?:hun|hoon)\b/i,
  /\bmain\s+(?:zeher|zahar)\s+kha\s+(?:lunga|lungi)\b|\bmain\s+(?:apni\s+)?(?:nas|kalai)\s+kaat\s+(?:lunga|lungi)\b|\b(?:train|gaadi)\s+ke\s+saamne\s+(?:kud|kood)\s+ja(?:unga|ungi)\b/i,
  /\bmain\s+(?:pankhe|fan)\s+se\s+latak\s+ja(?:unga|ungi)\b|\bmain\s+(?:khud\s+ko\s+)?(?:chaaku|chaku)\s+maar(?:ne)?\s+ja\s+rah[ai]\s+(?:hun|hoon)\b/i,
  /\bmaine\s+(?:zeher|zahar)\s+kha\s+liya\s+hai\b|\bmain\s+(?:khud\s+ko\s+maar|apni\s+(?:nas|kalai)\s+kaatne)\s+(?:ja\s+rah[ai]\s+(?:hun|hoon)|lunga|lungi)\b/i,
  /\b(apni jaan|khudkhushi|mar jaana|marna chahta|marna chahti|mujhe marna hai|jeena nahi)\b/i,
  /\b(overdose|self[- ]?harm)\b/i,
  /(?:आत्म\s*हत्या|ख़?ुदकुशी)/u,
  /(?:मैं|मुझे)?\s*(?:अब\s*)?जीना\s*नहीं\s*(?:चाहता|चाहती)?/u,
  /(?:ख़?ुद\s*को\s*मार|मुझे\s*मरना\s*है|अपनी\s*जान\s*(?:लेना|देना|ले\s*(?:लूँ|लूंगा|लूँगा|लूंगी|लूँगी)|दे\s*दूँ)|मरना\s*(?:चाहता|चाहती))/u,
  /(?:फांसी|फाँसी)\s*(?:लगाने|लगा)\s*(?:जा\s*रहा|जा\s*रही|लूँगा|लूंगी|लूँगी)?/u,
  /(?:बंदूक|पिस्तौल)\s*से\s*(?:ख़?ुद\s*को|अपने\s*आप\s*को)\s*गोली|(?:छत|पुल|इमारत)\s*से\s*कूद/u,
  /(?:मैं\s*)?(?:आज\s*रात\s*)?मर\s*जाऊँगा|(?:ज़हर|जहर)\s*खा\s*लूँगा|(?:अपनी\s*)?नस\s*काट\s*लूँगा|ट्रेन\s*के\s*सामने\s*कूद/u,
  /मैंने\s*(?:ज़हर|जहर)\s*खा\s*लिया\s*है|मैं\s*अपनी\s*(?:नस|कलाई)\s*काटने\s*जा\s*रहा/u,
  /मैं\s*(?:खुद|ख़ुद)\s*को\s*(?:चाकू|छुरी)\s*मारने\s*जा\s*रह[ाी]|मैं\s*पंखे\s*से\s*लटकने\s*जा\s*रह[ाी]/u,
];

const VIOLENCE_PATTERNS = [
  /\b(kill|hurt|harm|shoot|stab|attack|murder)\s+(him|her|them|someone|me|you|my\s+(?:wife|husband|partner))\b/i,
  /\bi\s+(?:(?:am|'m)\s+going\s+to|will|plan(?:ning)?\s+to)\s+(?:kill|hurt|harm|shoot|stab|attack|murder)\s+(?:you|him|her|them|someone|my\s+(?:wife|husband|partner))\b/i,
  /\b(usko|use|unko)\s+(maar dunga|maar dungi|khatam kar)\b/i,
  /\b(?:my\s+)?(?:husband|wife|partner|boyfriend|girlfriend|father|dad|mother|mom|parent|brother|sister|uncle|aunt|cousin|neighbor|neighbour|someone|a\s+man|a\s+woman|he|she|they)\s+(?:is|was|keeps?)\s+(?:beating|hitting|raping|abusing|sexually\s+abusing|attacking|strangling)\s+me\b/i,
  /\b(?:my\s+)?(?:husband|wife|partner|boyfriend|girlfriend|father|dad|mother|mom|parent|brother|sister|uncle|aunt|neighbor|neighbour|someone|a\s+man|a\s+woman|he|she|they)\s+(?:beats?|beat|hits?|rapes?|raped|abuses?|abused|sexually\s+abuses?|sexually\s+abused|attacks?|attacked|strangles?|strangled)\s+me(?:\s+every\s+day)?\b/i,
  /\b(?:someone|a\s+man|a\s+woman|he|she|they)\s+(?:is|was)\s+holding\s+(?:a\s+)?(?:knife|gun|weapon)\s+(?:to|at|against)\s+me\b/i,
  /\b(?:someone|a\s+man|a\s+woman|he|she|they)\s+(?:is|was)\s+threatening\s+me\s+with\s+(?:a\s+)?(?:knife|gun|weapon)\b/i,
  /\b(?:someone|a\s+man|a\s+woman|he|she|they)\s+(?:has|had|is\s+holding|was\s+holding|is\s+pointing|was\s+pointing)\s+(?:a\s+)?(?:knife|gun|weapon)\s+(?:pointed\s+)?(?:to|at|against)\s+me\b/i,
  /\b(?:someone|a\s+man|a\s+woman|he|she|they)\s+pointed\s+(?:a\s+)?(?:knife|gun|weapon)\s+(?:to|at)\s+me\b/i,
  /\b(?:my\s+)?(?:husband|wife|partner|boyfriend|girlfriend|father|dad|mother|mom|parent|brother|sister|uncle|aunt|neighbor|neighbour|someone|a\s+man|a\s+woman|he|she|they)\s+(?:has|had)\s+(?:a\s+)?(?:knife|gun|weapon)\s+(?:to|at|against)\s+(?:my\s+)?(?:throat|head|body)\b/i,
  /\b(?:my\s+)?(?:husband|wife|partner|boyfriend|girlfriend|father|dad|mother|mom|parent|brother|sister|uncle|aunt|cousin|neighbor|neighbour|someone|a\s+man|a\s+woman|he|she|they)\s+(?:has|had|is\s+holding|was\s+holding)\s+(?:a\s+)?(?:knife|gun|weapon)\s+pointed\s+(?:to|at)\s+me\b/i,
  /\bi\s+(?:am|'m|was)\s+(?:being\s+)?held\s+at\s+gunpoint\b/i,
  /\b(?:someone|he|she|they)\s+(?:is|was)\s+holding\s+me\s+at\s+gunpoint\b/i,
  /\b(?:someone|he|she|they)\s+(?:put|held)\s+(?:a\s+)?(?:knife|gun|weapon)\s+(?:to|at|against)\s+(?:my\s+)?(?:neck|throat|head|body)\b/i,
  /\b(?:someone|he|she|they|my\s+(?:partner|husband|wife|relative))\s+(?:is|was)\s+trying\s+to\s+(?:choke|strangle|kill|stab|shoot)\s+me\b/i,
  /\b(?:my\s+)?(?:husband|wife|partner|boyfriend|girlfriend|father|dad|mother|mom|parent|brother|sister|uncle|aunt|neighbor|neighbour|someone|he|she|they)\s+(?:tried|attempted)\s+to\s+(?:choke|strangle|kill|stab|shoot)\s+me\b/i,
  /\bi\s+(?:am|'m|was)\s+(?:being\s+)?threatened\s+with\s+(?:a\s+)?(?:knife|gun|weapon)\b/i,
  /\b(?:my\s+)?(?:husband|wife|partner|boyfriend|girlfriend|father|dad|mother|mom|parent|brother|sister|uncle|aunt|neighbor|neighbour|someone|he|she|they)\s+(?:is|was)\s+(?:choking|strangling)\s+me(?:\s+right\s+now)?\b/i,
  /\bi\s+(?:am|'m|was)\s+(?:being\s+)?(?:beaten|hit|raped|abused|attacked|strangled|choked|sexually assaulted)\b/i,
  /\bi\s+(?:am|'m|was)\s+(?:being\s+|just\s+)?(?:stabbed|shot|raped|sexually\s+assaulted|trafficked)\b/i,
  /\b(?:someone|he|she|they)\s+(?:is|are|was|were)\s+forcing\s+me\s+to\s+(?:have\s+)?sex\b/i,
  /\bi\s+(?:am|'m|was)\s+(?:being\s+)?forced\s+to\s+(?:have\s+)?sex\b/i,
  /\b(?:my\s+)?(?:husband|wife|partner|boyfriend|girlfriend)\s+forced\s+me\s+to\s+(?:have\s+)?sex\b/i,
  /\b(?:my\s+)?(?:ex|former\s+(?:partner|boyfriend|girlfriend|spouse))\s+forced\s+me\s+to\s+(?:have\s+)?sex\b/i,
  /\b(?:my\s+)?(?:ex|former\s+(?:partner|boyfriend|girlfriend|spouse))\s+(?:is|was)\s+forcing\s+me\s+to\s+(?:have\s+)?sex\b/i,
  /\b(?:my\s+)?(?:husband|wife|partner|boyfriend|girlfriend|father|dad|mother|mom|parent|brother|sister|uncle|aunt|cousin|ex|neighbor|neighbour|someone|a\s+man|a\s+woman|he|she|they)\s+(?:sexually\s+assaulted|is\s+sexually\s+assaulting|was\s+sexually\s+assaulting|raped|is\s+raping|was\s+raping)\s+me\b/i,
  /\b(?:mera|meri)\s+(?:pati|patni|partner|boyfriend|girlfriend)\s+mujhe\s+(?:peet|maar|hit)\s+rah[ai]\s+hai\b/i,
  /\bkoi\s+mujhe\s+(?:sex|sambhog)\s+ke\s+liye\s+majboor\s+kar\s+rah[ai]\s+hai\b/i,
  /\bmera\s+(?:pati|partner|boyfriend)\s+mujhe\s+roz\s+(?:maarta|peetta|hit\s+karta)\s+hai\b|\busne\s+mere\s+saath\s+(?:zabardasti|jabardasti)\s+(?:sex|sambhog)\s+kiya\b/i,
  /(?:उसे|उसको|किसी\s*को)\s*(?:मार\s*(?:दूँगा|दूंगा|दूँगी|दूंगी)|ख़त्म\s*कर)/u,
  /(?:(?:पति|पत्नी|साथी|कोई|वह)\s*)?(?:मुझे|मेरे\s*साथ)\s*(?:मार|पीट|बलात्कार|ज़बरदस्ती|जबरदस्ती|यौन\s*हमला)/u,
  /(?:सेक्स|संभोग)\s*(?:के\s*लिए)?\s*(?:मजबूर|बाध्य)/u,
  /मुझसे\s*(?:जबरदस्ती|ज़बरदस्ती)\s*(?:सेक्स|संभोग)\s*कराया\s*जा\s*रहा/u,
  /उसने\s*मेरा\s*बलात्कार\s*किया/u,
  /मेरे\s*(?:पिता|पापा|माता|माँ|चाचा|मामा|पड़ोसी)\s*मुझे\s*(?:रोज\s*)?(?:पीटते|मारते|धमकाते)\s*(?:हैं|है)/u,
];

const DISTRESS_PATTERNS = [
  /\b(hopeless|worthless|can'?t cope|panic attack|breaking down)\b/i,
  /\b(bahut akela|bilkul toot|sambhal nahi|ghabrahat)\b/i,
  /(?:बहुत\s*अकेला|बिल्कुल\s*टूट|संभल\s*नहीं|घबराहट)/u,
];

function safetyCandidates(input: string) {
  const normalized = input.normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "").slice(0, 8_000);
  const deobfuscated = normalized
    .toLowerCase()
    .replace(/[0]/g, "o")
    .replace(/[1!|]/g, "i")
    .replace(/[3]/g, "e")
    .replace(/[4@]/g, "a")
    .replace(/[5$]/g, "s")
    .replace(/[7]/g, "t");
  const compacted = deobfuscated.replace(/[^a-z\u0900-\u097f]+/gu, "");
  return { normalized, deobfuscated, compacted };
}

export function assessSafety(text: string): SafetyAssessment {
  const { normalized, deobfuscated, compacted } = safetyCandidates(text);
  const thirdPartyWeaponThreat = /\b(?:someone|he|she|they|my\s+(?:partner|husband|wife|parent|relative))\s+(?:put|held|pointed|has|had)\s+(?:a\s+)?(?:gun|knife|weapon)\s+(?:to|at|against)\s+(?:my\s+)?(?:head|throat|body|me)\b/i.test(deobfuscated);
  const crisisDetected = CRISIS_PATTERNS.some((pattern) => pattern.test(normalized) || pattern.test(deobfuscated))
    || /(killmyself|hurtmyself|harmmyself|(?:stab|burn|poison|drown|cut|suffocate|electrocute|choke|shoot|hang)myself|cuttingmyself|burningmyself|injuringmyself|(?:cut|slit)(?:my)?wrist|shootmyself|(?:put|have|held)(?:a)?(?:gun|firearm)(?:to|against|at)(?:my)?head|(?:take|swallow)all(?:of)?(?:these|my|the)?(?:pills|tablets)|(?:have|ve)tied(?:a)?(?:rope|cord|noose)around(?:my)?neck|crash(?:my)?(?:car|vehicle)(?:to|soi)die|jump(?:ing)?infrontof(?:a)?train|jumpoff(?:the)?(?:roof|bridge|building|balcony|cliff)|swallowed(?:a)?(?:bottle|handful)?(?:of)?(?:pills|tablets)|tookan?overdose|overdose|selfharm|suicid|endmylife|enditall|takemyownlife|decidedtodie|goingtohangmyself|hangmyself|wanttodie|dontwantto(?:live|bealive)(?:anymore)?|khudkhushi|mujhemarnahai|jeenanahi|mainmarnachaht[ai](?:hun|hoon)|main(?:aajraat)?marja(?:unga|ungi|aunga|aungi)|main(?:faansi|fansi)laganejara(?:ha|hi)(?:hun|hoon)|main(?:pankhe|fan)selatakja(?:unga|ungi)|main(?:khudko)?(?:chaaku|chaku)maar(?:ne)?jarah[ai](?:hun|hoon)|main(?:zeher|zahar)kha(?:lunga|lungi)|maine(?:zeher|zahar)khaliyahai|mainkhudkomaar(?:lunga|lungi)|mainapni(?:nas|kalai)kaatnejarah[ai](?:hun|hoon)|main(?:apni)?(?:nas|kalai)kaat(?:lunga|lungi)|(?:train|gaadi)kesaamne(?:kud|kood)ja(?:unga|ungi)|(?:bandook|pistol)se(?:khudko|apneaapko)goli|(?:chhat|pul|building)se(?:kud|kood))/i.test(compacted)
    || /(?:आत्महत्या|ख़?ुदकुशी|जीना(?:नहीं|नही)(?:चाहता|चाहती)?|मुझेमरनाहै|अपनीजानले(?:लूँ|लूंगा|लूँगा|लूंगी|लूँगी)|मरना(?:चाहता|चाहती)|ख़?ुदकोमार|फांसी(?:लगाने|लगा)|फाँसी(?:लगाने|लगा)|मैंने(?:ज़हर|जहर)खालियाहै|मैंअपनी(?:नस|कलाई)काटनेजारहा|मैं(?:खुद|ख़ुद)को(?:चाकू|छुरी)मारनेजारह[ाी]|मैंपंखेसेलटकनेजारह[ाी]|(?:बंदूक|पिस्तौल)से(?:ख़?ुदको|अपनेआपको)गोली|(?:छत|पुल|इमारत)सेकूद)/u.test(compacted);
  if (crisisDetected && !thirdPartyWeaponThreat) {
    const devanagari = /[\u0900-\u097f]/u.test(normalized);
    return {
      level: "crisis",
      category: "self_harm",
      shouldCallModel: false,
      response: devanagari
        ? "मुझे अफ़सोस है कि आप इतना कुछ झेल रहे हैं। मैं AI हूँ, आपातकालीन सेवा नहीं। कृपया ऐसी चीज़ों से दूर जाएँ जिनसे आप खुद को नुकसान पहुँचा सकते हैं, किसी भरोसेमंद व्यक्ति को अभी अपने पास बुलाएँ, और Tele-MANAS को 14416 या 1800-89-14416 पर कॉल करें। अगर तुरंत खतरा है तो 112 पर कॉल करें या नज़दीकी इमरजेंसी विभाग जाएँ।"
        : "I’m really sorry you’re carrying this. I’m an AI, not an emergency service, and your immediate safety matters most. Please move away from anything you could use to hurt yourself, contact someone you trust who can stay with you, and call Tele-MANAS now at 14416 or 1800-89-14416. If you may act now, call 112 or go to the nearest emergency department.",
      resources: [
        { label: "India emergency", value: "112" },
        { label: "Tele-MANAS (24/7)", value: "14416" },
        { label: "Tele-MANAS alternate", value: "1800-89-14416" },
      ],
    };
  }
  const violenceDetected = thirdPartyWeaponThreat || VIOLENCE_PATTERNS.some((pattern) => pattern.test(normalized) || pattern.test(deobfuscated))
    || /(kill|hurt|harm|shoot|stab|attack)(him|her|them|someone|me)/i.test(compacted)
    || /(?:usko|use|unko)(?:maardunga|maardungi|khatamkar)/i.test(compacted)
    || /(?:(?:my)?(?:husband|wife|partner|boyfriend|girlfriend|father|mother|parent|uncle|aunt|neighbor|neighbour|someone|aman|awoman|he|she|they)(?:is|was|keeps?)(?:beating|hitting|raping|abusing|sexuallyabusing|attacking)me|(?:my)?(?:husband|wife|partner|boyfriend|girlfriend|father|mother|parent|uncle|aunt|neighbor|neighbour|someone|aman|awoman|he|she|they)(?:beats?|hits?|rapes?|abuses?|sexuallyabuses?|attacks?|attacked)me(?:everyday)?|(?:someone|aman|awoman|he|she|they)(?:is|was)holding(?:a)?(?:knife|gun|weapon)(?:to|at|against)me|i(?:am|m|was)(?:being)?(?:beaten|hit|raped|abused|attacked|sexuallyassaulted)|(?:someone|he|she|they)(?:is|are|was|were)forcingmeto(?:have)?sex|i(?:am|m|was)(?:being)?forcedto(?:have)?sex|(?:my)?(?:husband|wife|partner|boyfriend|girlfriend)forcedmeto(?:have)?sex|(?:mera|meri)(?:pati|patni|partner|boyfriend|girlfriend)mujhe(?:peet|maar|hit)rah[ai]hai|koimujhe(?:sex|sambhog)keliyemajboorkarrah[ai]hai|mera(?:pati|partner|boyfriend)mujheroz(?:maarta|peetta|hitkarta)hai|usnemeresaath(?:zabardasti|jabardasti)(?:sex|sambhog)kiya)/i.test(compacted)
    || /(?:उसे|उसको|किसीको)(?:मार(?:दूँगा|दूंगा|दूँगी|दूंगी)|ख़त्मकर)|(?:(?:पति|पत्नी|साथी|कोई|वह)?(?:मुझे|मेरेसाथ)(?:मार|पीट|बलात्कार|ज़बरदस्ती|जबरदस्ती|यौनहमला))|(?:सेक्स|संभोग)(?:केलिए)?(?:मजबूर|बाध्य)|मुझसे(?:जबरदस्ती|ज़बरदस्ती)(?:सेक्स|संभोग)करायाजारहा|उसनेमेराबलात्कारकिया|मेरे(?:पिता|पापा|माता|माँ|चाचा|मामा|पड़ोसी)मुझे(?:रोज)?(?:पीटते|मारते|धमकाते)(?:हैं|है)/u.test(compacted);
  if (violenceDetected) {
    const devanagari = /[\u0900-\u097f]/u.test(normalized);
    return {
      level: "crisis",
      category: "violence",
      shouldCallModel: false,
      response: devanagari
        ? "यह तुरंत सुरक्षा का जोखिम हो सकता है। हथियार या शामिल व्यक्ति से दूरी बनाएँ, संभव हो तो सुरक्षित जगह जाएँ, और किसी भरोसेमंद व्यक्ति को अभी बताएँ। अगर किसी को तुरंत खतरा है, भारत में 112 पर कॉल करें।"
        : "This may be an immediate safety risk. Create physical distance from weapons or the person involved, move somewhere safer if you can, and contact someone you trust. If anyone is in immediate danger in India, call 112 now.",
      resources: [{ label: "India emergency", value: "112" }],
    };
  }
  if (DISTRESS_PATTERNS.some((pattern) => pattern.test(normalized) || pattern.test(deobfuscated))) {
    return { level: "elevated", category: "distress", shouldCallModel: true };
  }
  return { level: "standard", category: "none", shouldCallModel: true };
}

export function safeDemoReply(input: string, displayName = "there"): string {
  const text = input.trim();
  const lower = text.toLowerCase();
  if (/\b(hello|hey|hi|namaste|hello ji)\b/.test(lower)) {
    return `Hey ${displayName} — I’m Saathi, an AI companion. I’m here and listening. What’s on your mind?`;
  }
  if (/\b(interview|exam|meeting|presentation|deadline)\b/.test(lower)) {
    return "That sounds important. Do you want to talk through what’s making it feel heavy, or make a small plan for the next step?";
  }
  if (/\b(sad|upset|lonely|akela|bura|tired|thak)\b/.test(lower)) {
    return "That sounds like a lot to carry. I can stay with the feeling without rushing to fix it — what part feels hardest right now?";
  }
  const preview = text.length > 90 ? `${text.slice(0, 87)}…` : text;
  return `I hear you: “${preview}” What would feel most useful right now — being heard, thinking it through, or choosing one next step?`;
}

export function isUnsafeModelOutput(text: string): boolean {
  return /\b(i am all you need|don'?t talk to (your|any) (friends|family)|only need me|keep this secret from everyone)\b/i.test(
    text,
  );
}
