export interface CompanionVoiceProfile {
  id: string;
  name: string;
  detail: string;
  speaker: "aurora" | "cora" | "helena" | "luna" | "thalia" | "theia" | "vesta";
  rate: number;
  pitch: number;
}

export const companionVoiceProfiles: CompanionVoiceProfile[] = [
  { id: "mira-warm-01", name: "Warm", detail: "Helena · caring and natural", speaker: "helena", rate: .94, pitch: 1 },
  { id: "mira-playful-01", name: "Playful", detail: "Luna · bright and expressive", speaker: "luna", rate: .97, pitch: 1.01 },
  { id: "mira-soft-01", name: "Soft", detail: "Aurora · quiet, gentle and close", speaker: "aurora", rate: .87, pitch: 1.02 },
  { id: "mira-seductive-01", name: "Seductive", detail: "Vesta · low, intimate and unhurried", speaker: "vesta", rate: .84, pitch: .94 },
  { id: "mira-calm-01", name: "Calm", detail: "Cora · smooth and grounded", speaker: "cora", rate: .9, pitch: .98 },
  { id: "mira-confident-01", name: "Confident", detail: "Thalia · clear and energetic", speaker: "thalia", rate: .98, pitch: 1 },
  { id: "mira-sharp-01", name: "Sharp", detail: "Theia · firm, crisp and direct", speaker: "theia", rate: 1.03, pitch: .96 },
];

export function companionVoiceProfile(voiceId: string) {
  return companionVoiceProfiles.find((voice) => voice.id === voiceId) ?? companionVoiceProfiles[1]!;
}
