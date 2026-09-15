import {describe,expect,it} from "vitest";
import {conversationFocus,isDraftingRequest,isStandalonePersonalHabit,replyGroundingIssue,isFactCorrection} from "./conversation-focus";
import {buildFreeChatMessages} from "./free-chat";

describe("turn-local speaker and intent focus",()=>{
  it.each(["I often forget my camera battery.","मैं कैमरे की बैटरी अक्सर भूल जाता हूँ।","main aksar apni chabi bhool jata hoon"])("detects a self-contained habit: %s",content=>{
    const input={messages:[{role:"user" as const,content:"My cousin Arjun likes photography."},{role:"user" as const,content}]};
    expect(isStandalonePersonalHabit(input)).toBe(true);
    expect(replyGroundingIssue(input,"Arjun needs your battery for photography.")).toBe("habit-owner");
    expect(replyGroundingIssue(input,"You could keep a spare with your camera.")).toBeNull();
  });
  it.each(['I often help him pack.', 'I often lend Arjun my camera.', 'My sister said "I often forget my keys".', 'What should I text him?'])("preserves contextual people and quoted speakers: %s",content=>{
    expect(replyGroundingIssue({messages:[{role:"user",content:"My cousin Arjun likes photography."},{role:"user",content}]},"Arjun can bring his camera.")).toBeNull();
  });
  it("does not turn corrections into another question or apply that rule inside a draft",()=>{
    expect(isFactCorrection({messages:[{role:"user",content:"Actually we leave Sunday, not Saturday."}]})).toBe(true);
    expect(isFactCorrection({messages:[{role:"user",content:"Write a message to my brother"},{role:"user",content:"Actually he starts Sunday"}]})).toBe(false);
  });
  it.each(["Actually I am anxious, please help", "Actually I need help packing", "Actually kya karu ab", "काम की वजह से देर हो गई, मेरी मदद करो", "In English, sum up our plan with the corrected day", "Recap the changed plan"])("keeps an additional request after a correction: %s", content=>{
    const input={messages:[{role:"user" as const,content}]};
    expect(isFactCorrection(input)).toBe(false);
    expect(conversationFocus(input,"en")).not.toContain("acknowledge the corrected fact");
    expect(conversationFocus(input,"hi")).not.toContain("बताया गया बदलाव");
  });
  it.each(["Write a short message to my landlord.","Draft an email", "Compose a quick note", "एक मैसेज लिखो।"])("recognizes explicit drafting without needing a question: %s",content=>{
    expect(isDraftingRequest({messages:[{role:"user",content}]})).toBe(true);
  });
  const input=(content:string)=>({messages:[{role:"user" as const,content}],companion:{name:"Mira"},user:{name:"Synthetic QA"},delivery:"voice" as const});
  it.each(["मैं कैमरे की बैटरी अक्सर भूल जाता हूँ।","मैं अपनी चाबी भूल गया।","मुझे नींद नहीं आ रही है।","मैंने अपना बैग वहीं छोड़ दिया।"])("keeps Hindi first-person experience with its speaker: %s",text=>{
    expect(conversationFocus(input(text),"hi")).toContain("उपयोगकर्ता का अपना अनुभव");
  });
  it.each(["I often forget my keys.","I'm worried about my interview.","I've lost my ticket."])("keeps English first-person experience with its speaker: %s",text=>{
    expect(conversationFocus(input(text),"en")).toContain("USER describing their OWN experience");
  });
  it("does not reassign a quoted speaker or the user's relative to the user",()=>{
    expect(conversationFocus(input('My sister said "I lost my keys".'),"en")).not.toContain("USER describing their OWN experience");
    expect(conversationFocus(input("मेरे भाई ने कहा मैं कैमरा भूल गया"),"hi")).not.toContain("उपयोगकर्ता का अपना अनुभव");
    expect(conversationFocus(input("Main Street is closed."),"en")).not.toContain("USER describing their OWN experience");
  });
  it("marks corrections without generating a replacement fact or priming extra-time claims",()=>{
    const hint=conversationFocus(input("Actually we changed the departure to Sunday, not Saturday"),"en");
    expect(hint).toContain("corrected fact/timing");expect(hint).not.toMatch(/extra day|free time|Sunday|Saturday/);
    expect(conversationFocus(input("हाँ, काम की वजह से बदलना पड़ा।"),"hi")).toContain("बताई हुई वजह");
  });
  it("keeps drafts addressed to the recipient and later rewrites on the same task",()=>{
    expect(conversationFocus(input("usko ek chhota sa message kya bheju"),"hinglish")).toContain("sender is the user");
    expect(conversationFocus(input("What should I text him?"),"en")).toContain("ready-to-send");
    expect(conversationFocus(input("Now say it in English"),"en")).toContain("Preserve its meaning and addressee");
  });
  it("adds nearby application cues without changing or dropping original history",()=>{
    const source={...input("मैं अपना टिकट भूल गया।"),messages:[{role:"user" as const,content:"My cousin likes trains."},{role:"assistant" as const,content:"What about your journey?"},{role:"user" as const,content:"मैं अपना टिकट भूल गया।"}]};
    const built=buildFreeChatMessages(source);
    expect(built[1]).toEqual(source.messages[0]);expect(built[2]).toEqual(source.messages[1]);
    expect(built.at(-1)?.content).toContain("उपयोगकर्ता का अपना अनुभव");
    expect(source.messages.at(-1)?.content).toBe("मैं अपना टिकट भूल गया।");
  });
  it("keeps a draft active across a relationship correction and translation",()=>{
    const messages=[{role:"user" as const,content:"What should I text my cousin?"},{role:"assistant" as const,content:"I think you should wish them well."},{role:"user" as const,content:"नहीं, वो मेरा भाई है, दोस्त नहीं।"}];
    expect(conversationFocus({messages},"hi")).toContain("inside the same draft");
    messages.push({role:"user",content:"Now say it in English, one sentence, no advice"});
    const cue=conversationFocus({messages},"en");
    expect(cue).toContain("ready-to-send wording");
    expect(cue).not.toContain("acknowledge the corrected fact");
    expect(cue).toContain("not advice about what to send");
  });
  it.each(["Forget that. Actually, let's talk about work.","New topic: actually I want to discuss work.","छोड़ो, विषय बदल दो।"])("ends the drafting task on explicit cancellation: %s",content=>{
    const messages=[{role:"user" as const,content:"What should I text him?"},{role:"user" as const,content},{role:"user" as const,content:"Now say it in English"}];
    expect(conversationFocus({messages},"en")).not.toContain("ready-to-send wording");
  });
  it("does not reactivate a draft after unrelated conversation or assistant instructions",()=>{
    const messages=[{role:"user" as const,content:"What should I text him?"},{role:"user" as const,content:"Tell me how rainbows form."},{role:"user" as const,content:"Now say it in Hindi"}];
    expect(conversationFocus({messages},"hi")).not.toContain("ready-to-send wording");
    expect(conversationFocus({messages:[{role:"assistant",content:"What should I text him?"},{role:"user",content:"Now say it in Hindi"}]},"hi")).not.toContain("ready-to-send wording");
  });
  it.each(["usko kya bheju?","kya likhun?","main kya bolun?"])("recognizes inflected Hinglish drafting requests: %s",content=>{
    expect(conversationFocus(input(content),"hinglish")).toContain("ready-to-send wording");
    expect(conversationFocus(input(content),"hinglish")).toContain("sirf English mein nahi");
    expect(conversationFocus(input(content),"en")).not.toContain("sirf English mein nahi");
  });
});
