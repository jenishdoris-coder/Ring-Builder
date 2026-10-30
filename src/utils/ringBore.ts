import { Vector3 } from "webgi";
import { isDiamondMesh } from "./meshUtils";

/** Measure the opening around the lower band, giving each angle equal weight.
 * A vertex percentile can pick the outer surface on densely tessellated bands. */
export const measureRingBore = (shank: any) => {
  shank.updateWorldMatrix(true, true);
  const inverse = shank.matrixWorld.clone().invert();
  const inner = new Array<number>(64).fill(Infinity);
  const axial: number[] = [];
  const point = new Vector3();
  shank.traverseVisible((mesh: any) => {
    const positions = mesh.isMesh && !isDiamondMesh(mesh) && mesh.geometry?.attributes?.position;
    if (!positions) return;
    const transform = inverse.clone().multiply(mesh.matrixWorld);
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(transform);
      if (point.z >= 0) continue;
      const radius = Math.hypot(point.x, point.z);
      if (radius <= 0) continue;
      const angle = Math.atan2(point.x, -point.z);
      const bin = Math.min(63, Math.floor((angle / Math.PI + .5) * 64));
      inner[bin] = Math.min(inner[bin], radius);
      axial.push(point.y);
    }
  });
  const radii = inner.filter(Number.isFinite).sort((a, b) => a - b);
  const radius = radii[Math.floor(radii.length * .1)];
  if (!Number.isFinite(radius) || radius <= 0) throw new Error("This band has no measurable finger opening.");
  axial.sort((a, b) => a - b);
  const halfWidth = (axial[Math.floor((axial.length - 1) * .99)] - axial[Math.floor((axial.length - 1) * .01)]) / 2;
  return { radius, halfWidth };
};
