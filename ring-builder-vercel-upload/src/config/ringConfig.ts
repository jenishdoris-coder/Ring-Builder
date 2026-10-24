// ─── 3D Ring Position (World Units) ──────────────────────
export const RING_POSITION_X = 0;
export const RING_POSITION_Y = -0.35;
export const RING_POSITION_Z = 0;

// ─── 3D Ring Rotation (DEGREES ONLY: 0° to 360°) ─────────
export const RING_ROTATION_X = 90;   // Pitch / tilt in degrees
export const RING_ROTATION_Y = 180;  // Spin around vertical axis in degrees
export const RING_ROTATION_Z = -70;  // Roll / lean in degrees

// ─── Sizing & Matching Band ──────────────────────────────
export const RING_SCALE_MULTIPLIER = 0.7;
export const MATCHING_BAND_GAP = 0.3;

export interface RingTransform {
  posX: number; posY: number; posZ: number;
  rotX: number; rotY: number; rotZ: number;
  scale: number;
}

/** Fixed production pose. The customer-facing viewer has no transform editor. */
export const FIXED_RING_TRANSFORM: Readonly<RingTransform> = Object.freeze({
  posX: RING_POSITION_X, posY: RING_POSITION_Y, posZ: RING_POSITION_Z,
  rotX: RING_ROTATION_X, rotY: RING_ROTATION_Y, rotZ: RING_ROTATION_Z,
  scale: RING_SCALE_MULTIPLIER,
});
