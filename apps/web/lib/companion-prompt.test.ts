import { describe, expect, it } from "vitest";
import {buildFreeChatMessages} from "./free-chat";
import { buildCompanionSystemPrompt, buildContextualDirectReply, buildDayCheckInReply, buildIdentityReply, buildMemoryRecallReply, canUseSavedMemoryReply, detectCompanionLanguage, detectCompanionRequestLanguage, isGenericCompanionReply, isIdentityRequest, isInvalidCompanionReply, isMemoryRecallRequest, requestsListeningOnly, sanitizeCompanionReply, sanitizeCompanionReplyForDelivery } from "./companion-prompt";

const request = {
  messages: [{ role: "user" as const, content: "nothing just monotonous" }],
  companion: { name: "Mira", backstory: "Warm, playful, and observant.", personality: { playfulness: .8 } },
  user: { name: "Prakhar" },
  relationshipMode: "friend",
  memories: ["Prakhar likes old films."],
  responsePreferences: { responseLength: "balanced" as const, adviceStyle: "ask-first" as const, questionFrequency: "balanced" as const },
  delivery: "voice" as const,
};

describe("edge companion prompting", () => {
  it("preserves internal draft quotes and apostrophes but removes matching outer wrappers",()=>{
    expect(sanitizeCompanionReply('You could say, "Good luck tomorrow."')).toBe('You could say, "Good luck tomorrow."');
    expect(sanitizeCompanionReply('"Good luck tomorrow."')).toBe('Good luck tomorrow.');
    expect(sanitizeCompanionReply("That bag is James'")).toBe("That bag is James'");
  });
  it("clips long Hindi speech at a danda sentence boundary",()=>{
    const first="यह तुम्हारे लिए एक आसान तरीका हो सकता है और इसे अपनी सुविधा के हिसाब से बदल सकते हो। ".repeat(3);
    const reply=sanitizeCompanionReplyForDelivery(first+"एक और बहुत लंबा अधूरा विचार ".repeat(5),"voice");
    expect(reply.length).toBeLessThanOrEqual(290);expect(reply.endsWith("।")).toBe(true);
  });
  it("anchors the current call language after history without dropping facts",()=>{
    const input={...request,messages:[{role:"user" as const,content:"Arjun ko bheed pasand nahi"},{role:"assistant" as const,content:"Haan, shaant jagah choose karenge."},{role:"user" as const,content:"Keep the plan simple, we are not trying to see everything"}]};
    const messages=buildFreeChatMessages(input);
    expect(messages[1]).toEqual(input.messages[0]);expect(messages[2]).toEqual(input.messages[1]);
    expect(messages.at(-1)?.content).toContain("English only (no Hindi words)");
    expect(input.messages.at(-1)?.content).not.toContain("Application reply setting");
    expect(buildFreeChatMessages({...input,messages:[{role:"user",content:"हिंदी में बात करो"}]}).at(-1)?.content).toContain("Hindi in Devanagari");
    expect(buildFreeChatMessages({...input,messages:[{role:"user",content:"ab hinglish mein bolo"}]}).at(-1)?.content).toContain("Hinglish in Roman letters");
    const hindi=buildFreeChatMessages({...input,messages:[{role:"user",content:"इसे आसान उदाहरण से समझाओ"}]});
    expect(hindi.at(-1)?.content).toContain("पूरा जवाब देवनागरी में लिखो");
    expect(hindi[0]?.content).not.toContain("TASK MODE");
    const draft=buildFreeChatMessages({...input,messages:[{role:"user",content:"Write a short message to my brother in Hindi"}]});
    expect(draft[0]?.content).toContain("ready-to-send wording directly to the recipient");
    expect(draft[0]?.content).toContain("a translation preserves its purpose and addressee");
  });
  it("answers simple day check-ins without depending on provider availability",()=>{expect(buildDayCheckInReply("आज तुम्हारा दिन कैसा था?")).toContain("तुम्हारे साथ");expect(buildDayCheckInReply("How was your day?")).toContain("conversation");expect(buildDayCheckInReply("tumhara din kaisa tha")).toContain("tumhare saath");expect(buildDayCheckInReply("My day was rough")).toBeNull();});
  it("forbids the canned listener language seen in the failed call", () => {
    const prompt = buildCompanionSystemPrompt(request);
    expect(prompt).toContain("Ordinary statements deserve ordinary conversation");
    expect(prompt).toContain("Do not announce that you are listening or not fixing");
    expect(prompt).toContain("Speech recognition can be imperfect");
    expect(prompt).toContain("Never announce that you heard the user wrong");
    expect(prompt).toContain("natural conversational English");
    expect(prompt).toContain("Match the language of the latest user turn");
    expect(prompt).toContain("Facts, people, pronouns, preferences, corrections");
  });

  it("detects each input language and validates matching replies", () => {
    expect(detectCompanionLanguage("yar ofis mein boss ne sabke samne daant dia")).toBe("hinglish");
    expect(detectCompanionLanguage("The main road is closed")).toBe("en");
    expect(detectCompanionLanguage("Riya bhi trip pe gayi thi")).toBe("hinglish");
    expect(detectCompanionLanguage("I visited Gaya last week.")).toBe("en");
    expect(detectCompanionLanguage("waise maine kis ke saath chai pi thi?")).toBe("hinglish");
    expect(detectCompanionLanguage("ab pakka select ho jayegi na?")).toBe("hinglish");
    expect(detectCompanionLanguage("woh wapas aa jayega")).toBe("hinglish");
    expect(detectCompanionLanguage("ab chalo ghar chalein")).toBe("hinglish");
    expect(detectCompanionLanguage("sab sahi ho jayega")).toBe("hinglish");
    expect(detectCompanionLanguage("Sahi sent me an English invitation.")).toBe("en");
    expect(detectCompanionLanguage("I visited Gaya with Sahi last week.")).toBe("en");
    expect(detectCompanionLanguage("Who had chai with my mom?")).toBe("en");
    expect(detectCompanionLanguage("Riya Delhi gai thi")).toBe("hinglish");
    expect(detectCompanionLanguage("How are you today?")).toBe("en");
    expect(detectCompanionLanguage("आज तुम कैसी हो?" )).toBe("hi");
    expect(detectCompanionLanguage("yaar aaj kaafi busy tha")).toBe("hinglish");
    expect(detectCompanionLanguage("main uske liye kya kar sakta hoon")).toBe("hinglish");
    expect(detectCompanionLanguage("English में बात करें। Hindi में नहीं, English.")).toBe("en");
    expect(detectCompanionLanguage("मैं बोल रहा हूँ English नहीं, Hinglish में बोलो")).toBe("hinglish");
    expect(detectCompanionLanguage("Please don't speak Hindi, talk in English")).toBe("en");
    expect(detectCompanionLanguage("अब हिंदी में बात करो")).toBe("hi");
    expect(isInvalidCompanionReply("I’m good today.", "How are you today?")).toBe(false);
    expect(isInvalidCompanionReply("Main aaj badhiya hoon.", "How are you today?")).toBe(true);
    expect(isInvalidCompanionReply("Exactly, simple plan hi best rahega, aap dono enjoy karoge, thakaan bhi nahin hogi.","Keep the plan simple, we are not trying to see everything")).toBe(true);
    expect(isInvalidCompanionReply("Chai and aloo paratha could be nice before visiting Jaipur.","What should we eat?")).toBe(false);
    expect(isInvalidCompanionReply("आज मैं अच्छी हूँ।", "आज तुम कैसी हो?" )).toBe(false);
    expect(isInvalidCompanionReply("Main aaj badhiya hoon.", "आज तुम कैसी हो?" )).toBe(true);
    expect(isInvalidCompanionReply("Good luck tomorrow! Just be yourself.", "Okay, what should I text her tonight?")).toBe(false);
    expect(isInvalidCompanionReply("तो फिर बस उसके साथ समय bitta karne ki koshish karo, movie dekhne jao.", "लेकिन उसे सलाह पसंद नहीं है।")).toBe(true);
    expect(isInvalidCompanionReply("मुझे खेद है, तो फिर तुम Kabir ko bas itna kah sakte ho ki all the best.","नहीं, वो मेरा भाई है, दोस्त नहीं।")).toBe(true);
    expect(isInvalidCompanionReply("React में state बदलता है, जबकि props बाहर से आते हैं।", "इसे आसान उदाहरण से समझाओ")).toBe(false);
    expect(isInvalidCompanionReply("Bilkul!", "haan sahi kaha")).toBe(false);
    expect(isInvalidCompanionReply("main اس کے لئے کیا کر سکتا ہوں", "main uske liye kya kar sakta hoon")).toBe(true);
    expect(isInvalidCompanionReply("तो सलाह छोड़ दो। बस प्रिया को बता दो कि तुम उसके साथ हो, बिना लंबा भाषण दिए।", "लेकिन उसे सलाह पसंद नहीं है।")).toBe(false);
    expect(isInvalidCompanionReply("Haan, aaj mood kaafi accha hai.", "yaar tum kaisi ho?")).toBe(false);
  });

  it("does not confuse Mira's grammar with a different person's or a past event",()=>{
    expect(isInvalidCompanionReply("Riya Delhi gayi thi.", "Riya kahan gayi thi? Keep it short in Hinglish.")).toBe(false);
    expect(isInvalidCompanionReply("Aman Mumbai waapas gaya tha.", "Aman kahan gaya tha?")).toBe(false);
    expect(isInvalidCompanionReply("Riya went to Delhi.", "Riya kahan gayi thi? Keep it short in Hinglish.")).toBe(true);
    expect(detectCompanionLanguage("Riya kahan gayi thi? Keep it short in English.")).toBe("en");
    const input="Meri behen Riya kal Delhi gayi thi. Mera bhai Aman abhi Mumbai mein hai.";
    expect(isInvalidCompanionReply("Riya Delhi gayi thi aur Aman Mumbai mein hai. Kya Aman kal aa raha tha?",input)).toBe(false);
    expect(isInvalidCompanionReply("Haan, woh plan accha tha.","Riya bhi trip pe gayi thi")).toBe(false);
    expect(isInvalidCompanionReply("Main khush hoon ki woh aa gaya.","mera bhai ghar aa gaya")).toBe(false);
    expect(isInvalidCompanionReply("मुझे अच्छा लगा था।", "तुम्हें कैसा लगा था?")).toBe(false);
    expect(isInvalidCompanionReply("मैंने सोचा था कि आलू और चावल ठीक रहेंगे।", "मेरे पास सिर्फ आलू, चावल और दही है")).toBe(false);
    expect(isInvalidCompanionReply("Main tumse baat kar raha hoon.","tum kya kar rahi ho")).toBe(true);
    expect(isInvalidCompanionReply("Main baat kar raha hoon.","tum kya kar rahi ho")).toBe(true);
    expect(isInvalidCompanionReply("मैं बात कर रहा हूँ।", "तुम क्या कर रही हो?")).toBe(true);
  });

  it("keeps short acknowledgements in the active language but switches on clear input", () => {
    expect(detectCompanionRequestLanguage({ messages: [
      { role: "user", content: "आज काम बहुत मुश्किल था" },
      { role: "assistant", content: "आज सच में बहुत load था।" },
      { role: "user", content: "okay" },
    ] })).toBe("hi");
    expect(detectCompanionRequestLanguage({ messages: [
      { role: "user", content: "yaar aaj work bahut hectic tha" },
      { role: "assistant", content: "Haan, kaafi load tha." },
      { role: "user", content: "Tell me what you think about it" },
    ] })).toBe("en");
  });

  it.each([["Hindi please", "hi"], ["please in Hindi", "hi"], ["Hinglish", "hinglish"], ["in Hinglish please!", "hinglish"], ["English please", "en"], ["हिंदी", "hi"], ["अंग्रेज़ी", "en"], ["इंग्लिश।", "en"], ["हिंग्लिश प्लीज़", "hinglish"]] as const)("accepts the standalone language choice %s", (content, language) => {
    expect(detectCompanionLanguage(content)).toBe(language);
    expect(detectCompanionRequestLanguage({messages:[{role:"user",content},{role:"user",content:"okay"},{role:"user",content:"hmm"}]})).toBe(language);
  });

  it.each(["thanks", "thank you", "yep", "nope", "sorry"])("keeps brief %s in the language of the conversation", content => {
    expect(detectCompanionRequestLanguage({ messages: [{ role: "user", content: "आज बारिश हो रही है।" }, { role: "user", content }] })).toBe("hi");
    expect(detectCompanionRequestLanguage({ messages: [{ role: "user", content: "aaj baarish ho rahi hai" }, { role: "user", content }] })).toBe("hinglish");
  });

  it.each(["haha ye achha tha", "achhi baat", "achhe lagte hain"])("recognizes colloquial Hinglish spelling: %s", content => {
    expect(detectCompanionLanguage(content)).toBe("hinglish");
  });

  it.each(["I watched a Hindi film", "No Hindi please", "My friend speaks Hindi"])("does not treat a mere mention or negative short choice as a standalone command: %s", content=>{
    expect(detectCompanionLanguage(content)).toBe("en");
  });

  it.each([
    ["आज ऑफिस में बहुत काम था।", "hi"],
    ["yaar aaj office mein bahut kaam tha", "hinglish"],
    ["Please speak English", "en"],
  ] as const)("preserves %s through repeated acknowledgements in every delivery mode", (content, language) => {
    for (const delivery of ["text", "voice", "video"] as const) {
      const messages = [{ role: "user" as const, content }, ...["okay", "hmm", "right!", "go on"].flatMap(content => [
        { role: "assistant" as const, content: "This English reply must not change your language." },
        { role: "user" as const, content },
      ])];
      expect(detectCompanionRequestLanguage({ messages })).toBe(language);
      const prompt = buildFreeChatMessages({ ...request, messages, delivery });
      expect(prompt.at(-1)?.content).toContain(language === "hi" ? "Hindi in Devanagari" : language === "hinglish" ? "Hinglish in Roman letters" : "English only");
      expect(messages.at(-1)?.content).toBe("go on");
    }
  });

  it("uses the most recent meaningful user language, including explicit switches", () => {
    const messages = [{ role: "user" as const, content: "आज का दिन अच्छा था।" }, { role: "user" as const, content: "okay" }];
    for (const content of ["Now let's talk in English", "This was a good day", "Yes, but why did that happen?"]) {
      expect(detectCompanionRequestLanguage({ messages: [...messages, { role: "user", content }, { role: "user", content: "hmm" }] })).toBe("en");
    }
    expect(detectCompanionRequestLanguage({ messages: [...messages, { role: "user", content: "ab hinglish mein bolo" }, { role: "user", content: "sure" }] })).toBe("hinglish");
    expect(detectCompanionRequestLanguage({ messages: [{ role: "assistant", content: "हिंदी में बोलो" }, { role: "user", content: "okay" }, { role: "user", content: "yes" }] })).toBe("en");
    expect(detectCompanionRequestLanguage({ messages: [] })).toBe("en");
  });

  it("resolves a named person through English, Hinglish, Hindi, then English", () => {
    const messages = [
      { role: "user" as const, content: "My sister Priya has an interview tomorrow and she is nervous." },
      { role: "assistant" as const, content: "Big day for Priya." },
      { role: "user" as const, content: "main uske liye kya kar sakta hoon?" },
      { role: "assistant" as const, content: "Uske saath normal raho." },
      { role: "user" as const, content: "लेकिन उसे सलाह पसंद नहीं है।" },
      { role: "assistant" as const, content: "तो advice छोड़ दो।" },
      { role: "user" as const, content: "Okay, what should I text her tonight?" },
    ];
    const reply = buildContextualDirectReply({ ...request, messages, delivery: "text" });
    expect(reply).toContain("Priya");
    expect(reply).toContain("No advice");
  });

  it("enforces listen-only intent and rejects provider identity hallucinations", () => {
    expect(requestsListeningOnly("Please just listen, no advice and no questions.")).toBe(true);
    expect(requestsListeningOnly("yaar bas suno, advice mat dena aur sawal mat poochna")).toBe(true);
    expect(isInvalidCompanionReply("That meeting really drained you. What happened next?", "Please just listen, no advice and no questions.")).toBe(true);
    expect(isInvalidCompanionReply("Haan, samajh raha hoon. Kya hua?", "yaar bas suno advice mat dena")).toBe(true);
    expect(isInvalidCompanionReply("Haan, samajh rahi hoon. Launch wali nervousness ko abhi bas yahin rehne dete hain.", "yaar bas suno advice mat dena")).toBe(false);
    expect(isInvalidCompanionReply("Aaj ka din tough tha. Bas bata do kya hua.", "Please just listen, no advice and no questions.")).toBe(true);
    expect(isInvalidCompanionReply("Meta designed me and Llama is my basis.", "Who made you?")).toBe(true);
    expect(isInvalidCompanionReply("I'm a large language model, so I don't have feelings like humans do, but I'm working properly and ready to chat.", "What about you?")).toBe(true);
  });

  it("answers identity questions in the user's current language", () => {
    expect(isIdentityRequest("What is your name and what do you do?")).toBe(true);
    expect(isIdentityRequest("tum kya karti ho?")).toBe(true);
    expect(buildIdentityReply("Mira")).toBe("Main Mira hoon—tumhari AI companion. Tumse chat aur calls par baat karti hoon, aur sirf tumhari approved baatein yaad rakhti hoon.");
    expect(buildIdentityReply("Mira", "en")).toContain("I’m Mira, your AI companion");
    expect(buildIdentityReply("Mira", "hi")).toContain("मैं Mira हूँ");
  });

  it("detects generic replies so the UI can use its contextual fallback", () => {
    expect(isGenericCompanionReply("Yeah. I’m listening, not fixing.")).toBe(true);
    expect(isGenericCompanionReply("Monotony can feel like background static.")).toBe(true);
    expect(isGenericCompanionReply("Monotony’s a sneaky thief and I was wondering if there was any particular")).toBe(true);
    expect(isGenericCompanionReply("Monotonous as in every day feels copy-pasted, or is work the repetitive part?")).toBe(false);
  });

  it("removes model reasoning and speaker labels", () => {
    expect(sanitizeCompanionReply("<think>hidden</think> Mira: That routine would bore me too.")).toBe("That routine would bore me too.");
  });

  it("removes symbols that should not be spoken during calls", () => {
    expect(sanitizeCompanionReplyForDelivery("You've got this. 😎", "voice")).toBe("You've got this.");
    expect(sanitizeCompanionReplyForDelivery("You've got this. 😎", "video")).toBe("You've got this.");
    expect(sanitizeCompanionReplyForDelivery("You've got this. 😎", "text")).toBe("You've got this. 😎");
  });

  it("keeps generated call replies concise for low-latency speech", () => {
    const longReply = `${"Yaar aaj ka din kaafi long tha, but tumne phir bhi handle kar liya. ".repeat(8)}Bas ab thoda breathe karo.`;
    expect(sanitizeCompanionReplyForDelivery(longReply, "voice").length).toBeLessThanOrEqual(290);
    expect(sanitizeCompanionReplyForDelivery(longReply, "video").length).toBeLessThanOrEqual(290);
    expect(sanitizeCompanionReplyForDelivery(longReply, "text").length).toBeGreaterThan(290);
  });

  it("answers memory requests in the user's current language", () => {
    expect(canUseSavedMemoryReply({...request,messages:[{role:"user",content:"What do you remember about me?"}]})).toBe(true);
    expect(canUseSavedMemoryReply({...request,messages:[{role:"user",content:"My cat is named Sona."},{role:"assistant",content:"Sona is a lovely name."},{role:"user",content:"Do you remember what my cat is called?"}]})).toBe(false);
    expect(isMemoryRecallRequest("maine pehle kya bataya tha?")).toBe(true);
    expect(isMemoryRecallRequest("मैंने पहले क्या बताया था?" )).toBe(true);
    expect(buildMemoryRecallReply({ ...request, messages: [{ role: "user", content: "maine pehle kya bataya tha?" }], memories: ["Prakhar said: “I work from a small studio in Pune”"] })).toContain("I work from a small studio in Pune");
    expect(buildMemoryRecallReply({ ...request, messages: [{ role: "user", content: "What do you remember about me?" }], memories: [] })).toBe("I don’t have any saved memories about you yet.");
    expect(buildMemoryRecallReply({ ...request, messages: [{ role: "user", content: "meri behen ke baare mein kya yaad hai?" }], memories: ["User's behen is named Priya."] })).toBe("Haan, mujhe yaad hai: Tumhari behen is named Priya.");
    expect(buildMemoryRecallReply({ ...request, messages: [{ role: "user", content: "meri behen ke baare mein kya yaad hai?" }], memories: ["Prakhar has a Stripe interview tomorrow.", "Prakhar's sister is named Priya."] })).toBe("Haan, mujhe yaad hai: Tumhari sister is named Priya.");
    expect(buildMemoryRecallReply({ ...request, messages: [{ role: "user", content: "What do you remember about my interview?" }], memories: ["Prakhar has a Stripe interview tomorrow."] })).toBe("Yes, I remember: You have a Stripe interview tomorrow.");
    expect(buildMemoryRecallReply({ ...request, messages: [{ role: "user", content: "मैंने पहले क्या बताया था?" }], memories: [] })).toContain("कोई saved memory नहीं");
  });
});
