/** Supersample the jewelry crop rather than the full camera image. WebGI's
 * isAntialiased flag does not supply coverage AA for its HDR/depth passes. */
export function arRenderScale(width: number, height: number, dpr: number, maxTextureSize = 4096) {
  const w = Math.max(1, width), h = Math.max(1, height);
  const desired = Math.min(4, Math.max(2.5, (Number.isFinite(dpr) ? dpr : 1) * 1.5));
  const limit = Math.min(desired, Math.sqrt(1_000_000 / (w * h)), maxTextureSize / Math.max(w, h));
  // Fixed quarter steps avoid reallocating buffers for minor crop changes.
  return Math.max(.25, Math.floor(limit * 4) / 4);
}
