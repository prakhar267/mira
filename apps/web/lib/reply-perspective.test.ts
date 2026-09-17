import {describe,expect,it} from "vitest";
import {groundReplyPerspective} from "./reply-perspective";
const input=(latest:string)=>({messages:[{role:"user" as const,content:"I am travelling with my cousin Arjun to Jaipur on Sunday."},{role:"user" as const,content:latest}]});
describe("user-owned offline summaries",()=>{
  it("keeps the model acknowledgement without a new question after thanks",()=>{
    expect(groundReplyPerspective(input("thanks"),"You're welcome! What's on your mind?")).toBe("You're welcome!");
    expect(groundReplyPerspective(input("shukriya"),"Koi baat nahi. Aaj kya plan hai?")).toBe("Koi baat nahi.");
    expect(groundReplyPerspective(input("धन्यवाद।"),"कोई बात नहीं। आज क्या कर रहे हो?")).toBe("कोई बात नहीं।");
    expect(groundReplyPerspective(input("thanks"),'"You are welcome. Happy to help."')).toBe('"You are welcome. Happy to help."');
    expect(groundReplyPerspective(input("thanks"),"What for? You're welcome.")).toBe("What for? You're welcome.");
    expect(groundReplyPerspective(input("thanks, what should I pack?"),"Bring water. Do you have a raincoat?")).toBe("Bring water. Do you have a raincoat?");
    expect(groundReplyPerspective(input("yes"),"Let's practice. Tell me about yourself.")).toBe("Let's practice. Tell me about yourself.");
  });
  it("finishes a plain fact correction before unsolicited consequences or questions",()=>{
    expect(groundReplyPerspective(input("Actually we leave Sunday, not Saturday"),"Sunday morning departure, got it. That gives you a free day!")).toBe("Sunday morning departure, got it.");
    expect(groundReplyPerspective(input("हाँ, काम की वजह से बदलना पड़ा।"),"काम की वजह से अब रविवार सुबह निकलोगे। अब कम समय मिलेगा।")).toBe("काम की वजह से अब रविवार सुबह निकलोगे।");
    const answer="Pack some snacks and water. You can also take a charger.";
    expect(groundReplyPerspective(input("Actually we leave Sunday. What should we pack?"),answer)).toBe(answer);
    expect(groundReplyPerspective(input("Actually we leave Sunday"),"Got it. Sunday morning it is.")).toBe("Got it. Sunday morning it is.");
  });
  it("keeps people and dates, but does not turn Mira into a traveller",()=>{
    expect(groundReplyPerspective(input("In English, sum up our relaxed plan"),"We are leaving for Jaipur on Sunday morning with Arjun. Our trip is relaxed.")).toBe("You are leaving for Jaipur on Sunday morning with Arjun. Your trip is relaxed.");
  });
  it("keeps coordinated travel subjects in the user's perspective",()=>{
    expect(groundReplyPerspective(input("Sum up our relaxed plan"),"Arjun and I are heading to Jaipur on Sunday.")).toBe("Arjun and you are heading to Jaipur on Sunday.");
    expect(groundReplyPerspective(input("Recap the plan"),'They said "Arjun and I are heading to Jaipur."')).toBe('They said "Arjun and I are heading to Jaipur."');
    expect(groundReplyPerspective(input("Write a message about our trip"),"Arjun and I are heading to Jaipur.")).toBe("Arjun and I are heading to Jaipur.");
  });
  it("preserves quotation ownership and incomplete streamed quotes",()=>{
    const reply='Your cousin said, "We are leaving on Sunday."';
    expect(groundReplyPerspective(input("Sum up the trip"),reply)).toBe(reply);
    const partial='Your cousin said, “We are leaving';
    expect(groundReplyPerspective(input("Sum up the trip"),partial)).toBe(partial);
    expect(groundReplyPerspective(input("Recap the trip verbatim"),"We are leaving on Sunday.")).toBe("We are leaving on Sunday.");
  });
  it.each(["Write a short message about our trip","Summarize it in first person","Say it in my voice"])("preserves explicitly authored first person: %s",latest=>{
    expect(groundReplyPerspective(input(latest),"We are leaving for Jaipur.")).toBe("We are leaving for Jaipur.");
  });
  it("does not rewrite ordinary conversation, AI preferences or unrelated summaries",()=>{
    expect(groundReplyPerspective(input("How are you?"),"I'm happy to chat.")).toBe("I'm happy to chat.");
    expect(groundReplyPerspective(input("Summarize it"),"I think you have a relaxed plan.")).toBe("I think you have a relaxed plan.");
    expect(groundReplyPerspective({messages:[{role:"user",content:"Summarize the play we're writing"}]},"We are going to try a different ending.")).toBe("We are going to try a different ending.");
  });
});
