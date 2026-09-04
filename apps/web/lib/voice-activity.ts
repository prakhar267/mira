export interface VoiceActivityMonitor {
  stop(): void;
}

export function microphoneRms(samples: Float32Array) {
  if (!samples.length) return 0;
  let total = 0;
  for (const sample of samples) total += sample * sample;
  return Math.sqrt(total / samples.length);
}

export async function startVoiceActivityMonitor(options: {
  shouldDetect: () => boolean;
  onSpeech: () => void;
}): Promise<VoiceActivityMonitor> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone monitoring is unavailable.");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });
  const AudioContextConstructor = window.AudioContext
    ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("Audio monitoring is unavailable.");
  }

  const context = new AudioContextConstructor();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = .45;
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  let frame = 0;
  let active = true;
  let noiseFloor = .008;
  let voicedFrames = 0;
  let armed = true;

  const sample = () => {
    if (!active) return;
    analyser.getFloatTimeDomainData(samples);
    const level = microphoneRms(samples);
    if (!options.shouldDetect()) {
      noiseFloor = noiseFloor * .97 + Math.min(level, .045) * .03;
      voicedFrames = 0;
      armed = true;
    } else if (armed) {
      const threshold = Math.max(.032, noiseFloor * 3.2);
      voicedFrames = level > threshold ? voicedFrames + 1 : Math.max(0, voicedFrames - 1);
      if (voicedFrames >= 5) {
        armed = false;
        voicedFrames = 0;
        options.onSpeech();
      }
    }
    frame = window.requestAnimationFrame(sample);
  };
  frame = window.requestAnimationFrame(sample);

  return {
    stop() {
      if (!active) return;
      active = false;
      window.cancelAnimationFrame(frame);
      source.disconnect();
      analyser.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      void context.close();
    },
  };
}
