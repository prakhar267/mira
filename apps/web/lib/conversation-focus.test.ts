import {describe,expect,it} from "vitest";
import {conversationFocus} from "./conversation-focus";
import {buildFreeChatMessages} from "./free-chat";

describe("turn-local speaker and intent focus",()=>{
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
});
