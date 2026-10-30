import { Box3, Matrix4, Object3D, Raycaster, Vector3 } from "three";
import { isDiamondMesh } from "./ring-meshes.ts";

type MetalGeometry = { mesh: any; transform: Matrix4 };

const collectMetalGeometry = (root: any, inverseFrame: Matrix4) => {
  const geometry: MetalGeometry[] = [];
  root.traverse((mesh: any) => {
    if (!mesh.isMesh || !mesh.geometry?.attributes?.position || isDiamondMesh(mesh)) return;
    geometry.push({ mesh, transform: new Matrix4().multiplyMatrices(inverseFrame, mesh.matrixWorld) });
  });
  return geometry;
};

const visitVertices = (geometry: MetalGeometry[], visit: (point: Vector3) => void) => {
  const point = new Vector3();
  geometry.forEach(({ mesh, transform }) => {
    const positions = mesh.geometry.attributes.position;
    for (let index = 0; index < positions.count; index++) {
      point.fromBufferAttribute(positions, index).applyMatrix4(transform);
      visit(point);
    }
  });
};

/**
 * GLBs use a common X/Z ring plane, but their basket bases and shank seats have
 * different heights. Seat the metal base using geometry in the shank's frame,
 * so camera angle, ring rotation, scale, and decorative diamonds cannot create
 * a false mounting height. Keep the correction inside the head container: live
 * transforms and model swaps can then update the ring pose without losing it.
 */
export const alignRingHeadToShank = (head: any, shank: any) => {
  if (!head || !shank) return null;
  let mount = head.__headMountGroup;
  if (!mount) {
    mount = new Object3D();
    mount.name = "head-mount";
    [...head.children].forEach((child) => mount.add(child));
    head.add(mount);
    head.__headMountGroup = mount;
  }
  mount.position.z = 0;
  head.updateWorldMatrix(true, true);
  shank.updateWorldMatrix(true, true);
  const inverseFrame = shank.matrixWorld.clone().invert();
  const headGeometry = collectMetalGeometry(head, inverseFrame);
  const shankGeometry = collectMetalGeometry(shank, inverseFrame);
  const headBounds = new Box3();
  const shankBounds = new Box3();
  visitVertices(headGeometry, (point) => headBounds.expandByPoint(point));
  visitVertices(shankGeometry, (point) => shankBounds.expandByPoint(point));
  if (headBounds.isEmpty() || shankBounds.isEmpty()) return null;

  const headHeight = headBounds.max.z - headBounds.min.z;
  const foot = new Box3();
  visitVertices(headGeometry, (point) => {
    if (point.z <= headBounds.min.z + headHeight * 0.02) foot.expandByPoint(point);
  });
  const center = foot.getCenter(new Vector3());
  const shankSize = shankBounds.getSize(new Vector3());
  const footSize = foot.getSize(new Vector3());
  const radiusX = Math.max(shankSize.x * 0.025, footSize.x * 0.15);
  const radiusY = Math.max(shankSize.y * 0.55, footSize.y * 0.15);
  const upperHalf = (shankBounds.min.z + shankBounds.max.z) / 2;
  let seatZ = -Infinity;
  // Intersect the surface itself. A sparse mesh may have no vertices at its
  // center even though a metal mounting face spans that area.
  const raycaster = new Raycaster();
  const down = new Vector3(0, 0, -1).transformDirection(shank.matrixWorld);
  const metalMeshes = shankGeometry.map(({ mesh }) => mesh);
  const probeSeat = (x: number, y: number) => {
    const origin = new Vector3(x, y, shankBounds.max.z + shankSize.z).applyMatrix4(shank.matrixWorld);
    raycaster.set(origin, down);
    for (const hit of raycaster.intersectObjects(metalMeshes, false)) {
      const point = hit.point.clone().applyMatrix4(inverseFrame);
      if (point.z > upperHalf) return point.z;
    }
    return -Infinity;
  };
  seatZ = probeSeat(center.x, center.y);
  if (!Number.isFinite(seatZ)) {
    for (const x of [-0.45, 0, 0.45]) {
      for (const y of [-0.45, 0, 0.45]) {
        seatZ = Math.max(seatZ, probeSeat(center.x + footSize.x * x, center.y + footSize.y * y));
      }
    }
  }
  const raycastSeatZ = seatZ;
  let nearestDistance = Infinity;
  let nearestSeatZ = -Infinity;
  visitVertices(shankGeometry, (point) => {
    if (point.z < upperHalf) return;
    const dx = Math.abs(point.x - center.x);
    const dy = Math.abs(point.y - center.y);
    if (!Number.isFinite(raycastSeatZ) && dx <= radiusX && dy <= radiusY) seatZ = Math.max(seatZ, point.z);
    const distance = dx * dx + dy * dy;
    if (distance < nearestDistance - 0.0001) {
      nearestDistance = distance;
      nearestSeatZ = point.z;
    } else if (Math.abs(distance - nearestDistance) <= 0.0001) {
      nearestSeatZ = Math.max(nearestSeatZ, point.z);
    }
  });
  if (!Number.isFinite(seatZ)) seatZ = nearestSeatZ;
  if (!Number.isFinite(seatZ)) return null;

  const relative = new Matrix4().multiplyMatrices(inverseFrame, head.matrixWorld);
  const localUpScale = relative.elements[10];
  if (Math.abs(localUpScale) < 0.0001) return null;
  // A small metal overlap closes the seam without lifting or stretching a part.
  const overlap = shankSize.x * 0.0025;
  const offsetZ = (seatZ - overlap - headBounds.min.z) / localUpScale;
  mount.position.z = offsetZ;
  head.updateWorldMatrix(true, true);
  return { seatZ, baseZ: headBounds.min.z + offsetZ * localUpScale, overlap, offsetZ };
};
