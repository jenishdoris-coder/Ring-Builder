/** Timing and the size of the disappearing sections in the GLTF part swap. */
export const RING_DISSOLVE = {
  dissolveDuration: 0.62,
  pauseDuration: 0.06,
  revealDuration: 0.82,
  // A stationary dissolve still communicates the swap on reduced-motion devices.
  reducedMotion: { dissolveDuration: 0.28, pauseDuration: 0.03, revealDuration: 0.36 },
  maxFrameDuration: 0.064,
  noiseScale: 3.8,
} as const;
