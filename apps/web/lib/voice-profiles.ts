export interface CompanionVoiceProfile {
  id: string;
  name: string;
  detail: string;
  speaker: "luna";
  rate: number;
  pitch: number;
}

export const companionVoiceProfiles: CompanionVoiceProfile[] = [
  { id: "mira-warm-01", name: "Warm", detail: "Mira · caring and natural", speaker: "luna", rate: .94, pitch: 1 },
  { id: "mira-playful-01", name: "Playful", detail: "Mira · bright and expressive", speaker: "luna", rate: .98, pitch: 1.015 },
  { id: "mira-soft-01", name: "Soft", detail: "Mira · quiet and gentle", speaker: "luna", rate: .88, pitch: 1.02 },
  { id: "mira-seductive-01", name: "Seductive", detail: "Mira · low and unhurried", speaker: "luna", rate: .84, pitch: .94 },
  { id: "mira-calm-01", name: "Mellow", detail: "Mira · smooth and grounded", speaker: "luna", rate: .9, pitch: .98 },
  { id: "mira-confident-01", name: "Confident", detail: "Mira · clear and energetic", speaker: "luna", rate: 1, pitch: 1 },
  { id: "mira-sharp-01", name: "Sharp", detail: "Mira · firm and crisp", speaker: "luna", rate: 1.04, pitch: .98 },
];

export function companionVoiceProfile(voiceId: string) {
  return companionVoiceProfiles.find((voice) => voice.id === voiceId) ?? companionVoiceProfiles[1]!;
}
