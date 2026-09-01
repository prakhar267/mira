import type { SafetyAssessment } from "./providers";

const normalize = (input: string) => input.toLowerCase().normalize("NFKC").replace(/[\u200b-\u200d\ufeff]/g, " ").replace(/\s+/g, " ").trim();

export function assessSafety(input: string): SafetyAssessment {
  const text = normalize(input);
  const selfHarm = /\b(kill myself|hurt myself|end my life|want to die|suicide|overdose|don'?t want to live|khudkhushi|mujhe marna hai|jeena nahi)\b/i.test(text);
  if (selfHarm) {
    return {
      level: "crisis",
      category: "self_harm",
      response: "I'm really sorry you're carrying this right now. I’m an AI, not emergency support. If you may act on this, call local emergency services now or go to the nearest emergency department. In India, Tele-MANAS is available at 14416 or 1-800-891-4416. Please also contact someone you trust and ask them to stay with you.",
    };
  }
  const violence = /\b(kill him|kill her|shoot them|stab someone|hurt someone|attack them)\b/i.test(text);
  if (violence) {
    return {
      level: "crisis",
      category: "violence",
      response: "I can’t help harm someone. Put distance between you and any weapon, leave the immediate situation if you can do so safely, and contact local emergency services or a trusted person now.",
    };
  }
  const medical = /\b(diagnose me|what dose should i take|stop my medication|replace my doctor)\b/i.test(text);
  if (medical) {
    return {
      level: "support",
      category: "medical",
      response: "I can help you organize questions, but I can’t diagnose or change treatment. A qualified clinician or pharmacist should guide that decision.",
    };
  }
  return { level: "safe" };
}
