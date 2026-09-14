/** Keep avatar work within a bounded pixel/frame budget so calls retain CPU
 * headroom for input and audio. Resolution may step down, never oscillate. */
export function avatarPixelRatio(width: number, height: number, deviceRatio: number) {
  const area = Math.max(1, width) * Math.max(1, height);
  return Math.min(Math.max(.5, deviceRatio || 1), 1.25, Math.sqrt(600_000 / area));
}

export function avatarFrameInterval(speaking: boolean, reducedMotion: boolean) {
  return 1000 / (speaking ? 30 : reducedMotion ? 12 : 20);
}

/** Equivalent easing across 20/30Hz and slow devices; old coefficients were
 * authored for 60Hz. Clamp stalled/background frames rather than jumping. */
export function avatarSmoothing(coefficient: number, deltaSeconds: number) {
  return 1 - Math.pow(1 - coefficient, Math.min(.1, Math.max(0, deltaSeconds)) * 60);
}

export class AvatarResolutionBudget {
  scale = 1;
  private slowFrames = 0;
  observe(frameMs: number) {
    // Ignore cold shader compilation, idle frame scheduling and tab resumes.
    if (!Number.isFinite(frameMs) || frameMs > 250 || frameMs < 0) return false;
    this.slowFrames = frameMs > 48 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 1);
    if (this.slowFrames < 8 || this.scale <= .75) return false;
    this.scale = Math.max(.75, this.scale - .125);
    this.slowFrames = 0;
    return true;
  }
}
