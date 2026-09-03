export type CompanionVoiceEmotion = "natural" | "happy" | "playful" | "tender" | "intimate" | "sad" | "angry";

export interface CompanionVoiceMode {
  id: string;
  name: string;
  detail: string;
  emotion: CompanionVoiceEmotion;
  speaker: "juno";
  rate: number;
  pitch: number;
  volume: number;
  temperature: number;
}

export const companionVoiceIdentity = {
  name: "Mira Aster",
  detail: "One soft, breathy adult female voice · English, हिन्दी and Hinglish",
} as const;

// These are delivery moods for one voice identity, not separate characters or voices.
export const companionVoiceModes: CompanionVoiceMode[] = [
  { id: "mira-natural-01", name: "Natural", detail: "Soft-spoken, gentle and conversational", emotion: "natural", speaker: "juno", rate: .94, pitch: 1.01, volume: .94, temperature: .45 },
  { id: "mira-happy-01", name: "Happy", detail: "Light, smiling and bright", emotion: "happy", speaker: "juno", rate: .99, pitch: 1.04, volume: .97, temperature: .72 },
  { id: "mira-playful-01", name: "Playful", detail: "Gentle teasing with lively warmth", emotion: "playful", speaker: "juno", rate: .97, pitch: 1.035, volume: .95, temperature: .78 },
  { id: "mira-tender-01", name: "Tender", detail: "Delicate, caring and unhurried", emotion: "tender", speaker: "juno", rate: .88, pitch: 1, volume: .84, temperature: .34 },
  { id: "mira-intimate-01", name: "Intimate", detail: "Close, quiet and warmly restrained", emotion: "intimate", speaker: "juno", rate: .86, pitch: .99, volume: .86, temperature: .3 },
  { id: "mira-sad-01", name: "Sad", detail: "Quiet, vulnerable and subdued", emotion: "sad", speaker: "juno", rate: .84, pitch: .98, volume: .8, temperature: .28 },
  { id: "mira-angry-01", name: "Angry", detail: "Firm and emotional without shouting", emotion: "angry", speaker: "juno", rate: 1, pitch: .995, volume: .96, temperature: .68 },
];

const legacyModeAliases: Record<string, string> = {
  "mira-warm-01": "mira-natural-01",
  "mira-soft-01": "mira-tender-01",
  "mira-seductive-01": "mira-intimate-01",
  "mira-calm-01": "mira-natural-01",
  "mira-confident-01": "mira-happy-01",
  "mira-sharp-01": "mira-angry-01",
};

export function companionVoiceMode(modeId: string) {
  const resolvedId = legacyModeAliases[modeId] ?? modeId;
  return companionVoiceModes.find((mode) => mode.id === resolvedId) ?? companionVoiceModes[0]!;
}
