import type { Box3, OrthographicCamera } from 'three';

export type RingRenderViewport = { x: number; y: number; width: number; height: number };

// Keep the same screen-space pixel density while allocating only the pixels
// occupied by the jewelry and its shadow. Bucket sizes avoid reallocating
// graphics buffers for every small tracking correction.
export function ringRenderViewport(bounds: Box3, width: number, height: number, previous?: RingRenderViewport): RingRenderViewport {
  const units = 2 / height;
  const left = width / 2 + bounds.min.x / units;
  const right = width / 2 + bounds.max.x / units;
  const top = height / 2 - bounds.max.y / units;
  const bottom = height / 2 - bounds.min.y / units;
  const dimension = (needed: number, limit: number, old?: number) => {
    const next = Math.min(limit, Math.max(64, Math.ceil((needed + 32) / 64) * 64));
    return old && old >= next && old <= next * 2 && old <= limit ? old : next;
  };
  const w = dimension(right - left, width, previous?.width);
  const h = dimension(bottom - top, height, previous?.height);
  return {
    x: Math.floor(Math.max(0, Math.min(width - w, (left + right - w) / 2))),
    y: Math.floor(Math.max(0, Math.min(height - h, (top + bottom - h) / 2))),
    width: w, height: h,
  };
}

export function cropRingCamera(camera: OrthographicCamera, viewport: RingRenderViewport, width: number, height: number) {
  const units = 2 / height;
  camera.left = (viewport.x - width / 2) * units;
  camera.right = (viewport.x + viewport.width - width / 2) * units;
  camera.top = (height / 2 - viewport.y) * units;
  camera.bottom = (height / 2 - viewport.y - viewport.height) * units;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}
