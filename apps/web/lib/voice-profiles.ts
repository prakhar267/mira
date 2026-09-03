export type CompanionVoiceEmotion = "natural" | "happy" | "playful" | "tender" | "intimate" | "sad" | "angry";

export interface CompanionVoiceMode {
  id: string;
  name: string;
  detail: string;
  emotion: CompanionVoiceEmotion;
  speaker: "luna";
  rate: number;
  pitch: number;
  volume: number;
}

export const companionVoiceIdentity = {
  name: "Mira Aster",
  detail: "One soft, gentle adult female voice · English, हिन्दी and Hinglish",
} as const;

// These are delivery moods for one voice identity, not separate characters or voices.
export const companionVoiceModes: CompanionVoiceMode[] = [
  { id: "mira-natural-01", name: "Natural", detail: "Soft-spoken, shy and conversational", emotion: "natural", speaker: "luna", rate: .91, pitch: 1.08, volume: .92 },
  { id: "mira-happy-01", name: "Happy", detail: "Light, smiling and bright", emotion: "happy", speaker: "luna", rate: .98, pitch: 1.12, volume: .96 },
  { id: "mira-playful-01", name: "Playful", detail: "Gentle teasing with lively warmth", emotion: "playful", speaker: "luna", rate: .95, pitch: 1.11, volume: .94 },
  { id: "mira-tender-01", name: "Tender", detail: "Delicate, caring and unhurried", emotion: "tender", speaker: "luna", rate: .85, pitch: 1.07, volume: .82 },
  { id: "mira-intimate-01", name: "Intimate", detail: "Close, quiet and warmly restrained", emotion: "intimate", speaker: "luna", rate: .84, pitch: 1.04, volume: .84 },
  { id: "mira-sad-01", name: "Sad", detail: "Quiet, vulnerable and subdued", emotion: "sad", speaker: "luna", rate: .82, pitch: 1.02, volume: .78 },
  { id: "mira-angry-01", name: "Angry", detail: "Firm and emotional without shouting", emotion: "angry", speaker: "luna", rate: .99, pitch: 1.05, volume: .95 },
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
