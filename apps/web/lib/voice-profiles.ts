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
  name: "Mira Velvet",
  detail: "One warm adult female voice · English, हिन्दी and Hinglish",
} as const;

// These are delivery moods for one voice identity, not separate characters or voices.
export const companionVoiceModes: CompanionVoiceMode[] = [
  { id: "mira-natural-01", name: "Natural", detail: "Warm, relaxed and conversational", emotion: "natural", speaker: "luna", rate: .96, pitch: .985, volume: 1 },
  { id: "mira-happy-01", name: "Happy", detail: "Bright, smiling and energetic", emotion: "happy", speaker: "luna", rate: 1.03, pitch: 1.025, volume: 1 },
  { id: "mira-playful-01", name: "Playful", detail: "Teasing, lively and expressive", emotion: "playful", speaker: "luna", rate: 1, pitch: 1.015, volume: 1 },
  { id: "mira-tender-01", name: "Tender", detail: "Soft, caring and gentle", emotion: "tender", speaker: "luna", rate: .9, pitch: .995, volume: .9 },
  { id: "mira-intimate-01", name: "Intimate", detail: "Low, close and unhurried", emotion: "intimate", speaker: "luna", rate: .87, pitch: .955, volume: .92 },
  { id: "mira-sad-01", name: "Sad", detail: "Quiet, vulnerable and subdued", emotion: "sad", speaker: "luna", rate: .85, pitch: .94, volume: .84 },
  { id: "mira-angry-01", name: "Angry", detail: "Firm, intense and direct", emotion: "angry", speaker: "luna", rate: 1.07, pitch: .965, volume: 1 },
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
