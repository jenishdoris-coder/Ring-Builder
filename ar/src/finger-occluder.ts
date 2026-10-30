import type { Mesh, Quaternion } from 'three';

/** Skin-width coverage closes the rear shoulder gaps. The shallower oval
 * depth keeps the front of the shank outside the proxy instead of erasing it.
 * Every axis uses the ring's same measured pose and scale. */
export function placeFingerOccluder(mesh: Mesh, x: number, y: number, orientation: Quaternion, width: number) {
  mesh.visible = true;
  mesh.position.set(x, y, 0);
  mesh.quaternion.copy(orientation);
  mesh.scale.set(width * .5, width * 1.35, width * .47);
}
