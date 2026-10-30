import { Matrix4, Vector3 } from 'three';
import type { RingPlacement } from './ring-tracking';

/** Neighboring fingers and palm must cover the skin seen in the camera.
 * Reconcile their depth with the fitted ring frame without moving their
 * observed image silhouette to the ring's smoothed XY/rotation. */
export function handMaskPose(raw: RingPlacement, filtered: RingPlacement, width: number, height: number) {
  if (!(raw.width > 0) || !(filtered.width > 0) || !(height > 0)) return new Matrix4();
  const units = 2 / height;
  const origin = new Vector3((raw.x - width / 2) * units, (height / 2 - raw.y) * units, 0);
  const rotation = filtered.orientation.clone().multiply(raw.orientation.clone().invert());
  const ratio = filtered.width / raw.width;
  const elements = new Matrix4().makeRotationFromQuaternion(rotation).elements;
  const zx = elements[2] * ratio, zy = elements[6] * ratio, zz = elements[10] * ratio;
  return new Matrix4().set(1, 0, 0, 0, 0, 1, 0, 0,
    zx, zy, zz, -zx * origin.x - zy * origin.y, 0, 0, 0, 1);
}
