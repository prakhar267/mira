export const featureFlags = {
  voice: true,
  camera: true,
  imageGeneration: true,
  romanticMode: true,
  proactiveMessaging: true,
  advancedMemory: true,
  store: true,
  journal: true,
  experimentalModels: false,
} as const;

export type FeatureFlag = keyof typeof featureFlags;

export const plans = {
  free: {
    name: "Free",
    features: ["textChat", "basicAvatar", "basicMemory", "activities", "limitedVoiceNotes"],
  },
  plus: {
    name: "Plus",
    features: ["relationshipModes", "romanticMode", "voiceNotes", "voiceConversations", "imageGeneration", "aiSelfies", "premiumVoices", "premiumOutfits"],
  },
  ultra: {
    name: "Ultra",
    features: ["voiceCalls", "realtimeVoiceCalls", "videoCalls", "cameraConversation", "advancedMemory", "deepReflections", "manualMemory", "personalityControls", "premiumEnvironments", "proactiveInteractions"],
  },
  platinum: {
    name: "Platinum",
    features: ["advancedTraining", "responseExplanation", "priorityRealtime", "earlyAccess"],
  },
} as const;

export type PlanId = keyof typeof plans;
export type Entitlement = (typeof plans)[PlanId]["features"][number];
