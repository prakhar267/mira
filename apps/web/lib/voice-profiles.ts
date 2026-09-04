export type CompanionVoiceEmotion = "natural" | "happy" | "playful" | "tender" | "intimate" | "sad" | "angry";

export interface CompanionVoiceMode {
  id: string;
  name: string;
  detail: string;
  emotion: CompanionVoiceEmotion;
  speaker: "ara";
  rate: number;
  pitch: number;
  volume: number;
  temperature: number;
}

export const companionVoiceIdentity = {
  name: "Mira Aster",
  detail: "Ara neural voice · English, हिन्दी and Hinglish",
} as const;

// These are delivery moods for one voice identity, not separate characters or voices.
export const companionVoiceModes: CompanionVoiceMode[] = [
  { id: "mira-natural-01", name: "Natural", detail: "Warm, human and conversational", emotion: "natural", speaker: "ara", rate: 1, pitch: 1, volume: .96, temperature: .45 },
  { id: "mira-happy-01", name: "Happy", detail: "Smiling, bright and affectionate", emotion: "happy", speaker: "ara", rate: 1, pitch: 1, volume: .98, temperature: .72 },
  { id: "mira-playful-01", name: "Playful", detail: "Teasing, lively and warm", emotion: "playful", speaker: "ara", rate: 1, pitch: 1, volume: .97, temperature: .78 },
  { id: "mira-tender-01", name: "Tender", detail: "Soft, caring and unhurried", emotion: "tender", speaker: "ara", rate: 1, pitch: 1, volume: .9, temperature: .34 },
  { id: "mira-intimate-01", name: "Intimate", detail: "Close, breathy and warmly restrained", emotion: "intimate", speaker: "ara", rate: 1, pitch: 1, volume: .9, temperature: .3 },
  { id: "mira-sad-01", name: "Sad", detail: "Quiet, vulnerable and subdued", emotion: "sad", speaker: "ara", rate: 1, pitch: 1, volume: .88, temperature: .28 },
  { id: "mira-angry-01", name: "Angry", detail: "Firm and emotional without shouting", emotion: "angry", speaker: "ara", rate: 1, pitch: 1, volume: .98, temperature: .68 },
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
