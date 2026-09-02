export interface CompanionVoiceProfile {
  id: string;
  name: string;
  detail: string;
  speaker: "luna";
  rate: number;
  pitch: number;
}

export const companionVoiceProfiles: CompanionVoiceProfile[] = [
  { id: "mira-warm-01", name: "Warm", detail: "Mira Velvet · caring and natural", speaker: "luna", rate: .96, pitch: .99 },
  { id: "mira-playful-01", name: "Playful", detail: "Mira Velvet · bright and expressive", speaker: "luna", rate: .99, pitch: 1.015 },
  { id: "mira-soft-01", name: "Soft", detail: "Mira Velvet · quiet and gentle", speaker: "luna", rate: .92, pitch: 1 },
  { id: "mira-seductive-01", name: "Seductive", detail: "Mira Velvet · low and intimate", speaker: "luna", rate: .89, pitch: .96 },
  { id: "mira-calm-01", name: "Mellow", detail: "Mira Velvet · smooth and grounded", speaker: "luna", rate: .94, pitch: .985 },
  { id: "mira-confident-01", name: "Confident", detail: "Mira Velvet · clear and energetic", speaker: "luna", rate: 1, pitch: .995 },
  { id: "mira-sharp-01", name: "Sharp", detail: "Mira Velvet · firm and crisp", speaker: "luna", rate: 1.03, pitch: 1 },
];

export function companionVoiceProfile(voiceId: string) {
  return companionVoiceProfiles.find((voice) => voice.id === voiceId) ?? companionVoiceProfiles[1]!;
}
