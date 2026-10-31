/** Temporary calibration offsets. The production fit remains in handPreview.json. */
export type HandFitAdjustments = { roll: number; pitch: number; yaw: number; seat: number };
export const DEFAULT_HAND_FIT: HandFitAdjustments = { roll: 0, pitch: 0, yaw: 0, seat: 0 };
