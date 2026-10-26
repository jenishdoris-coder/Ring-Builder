import { Box3, Vector3 } from "webgi";
import { isDiamondMesh } from "./meshUtils";

export type RingCameraView = "front" | "top" | "head" | "shank" | "hand" | "engraving";
export type RingCameraPose = { position: Vector3; target: Vector3; up: Vector3; minDistance: number };

const corners = (box: Box3) => {
  const points: Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) points.push(new Vector3(x, y, z));
  return points;
};

const meshPoints = (mesh: any) => {
  if (!mesh.geometry?.attributes?.position) return [];
  mesh.geometry.computeBoundingBox();
  return corners(mesh.geometry.boundingBox).map(point => point.applyMatrix4(mesh.matrixWorld));
};

const partPoints = (root: any) => {
  const points: Vector3[] = [];
  root?.updateWorldMatrix(true, true);
  root?.traverseVisible((mesh: any) => { if (mesh.isMesh) points.push(...meshPoints(mesh)); });
  return points;
};

export const fitCameraToPoints = (points: Vector3[], target: Vector3, direction: Vector3, up: Vector3, camera: any, options: { aspect?: number; padding?: number } = {}): RingCameraPose => {
  direction.normalize();
  const right = new Vector3().crossVectors(up, direction).normalize();
  const screenUp = new Vector3().crossVectors(direction, right).normalize();
  const object = camera.cameraObject ?? camera;
  const tangent = Math.tan(((object.fov ?? 45) * Math.PI) / 360) / (object.zoom || 1);
  const aspect = Math.max(0.1, options.aspect ?? object.aspect ?? 1);
  const relative = new Vector3();
  let distance = 0.2;
  for (const point of points) {
    relative.copy(point).sub(target);
    const horizontal = Math.abs(relative.dot(right)) / (tangent * aspect);
    const vertical = Math.abs(relative.dot(screenUp)) / tangent;
    distance = Math.max(distance, Math.max(horizontal, vertical) * (options.padding ?? 1.2) + relative.dot(direction));
  }
  return { position: target.clone().addScaledVector(direction, distance), target, up: screenUp, minDistance: Math.max(0.15, distance * 0.35) };
};

/** Frame the actual selected geometry in the ring's own axes, including its mounting correction. */
export const getRingCameraPose = (view: string, head: any, shank: any, camera: any): RingCameraPose | undefined => {
  if (!head || !shank) return undefined;
  const headPoints = partPoints(head), bandPoints = partPoints(shank);
  if (!headPoints.length || !bandPoints.length) return undefined;
  const frame = shank.matrixWorld;
  const inverse = frame.clone().invert();
  const localDirection = (x: number, y: number, z: number) => new Vector3(x, y, z).transformDirection(frame);
  const headBounds = new Box3().setFromPoints(headPoints);
  if (view === "front") {
    const points = [...headPoints, ...bandPoints];
    const bounds = new Box3().setFromPoints(points);
    const target = bounds.getCenter(new Vector3());
    // Fit the complete ring and leave room for its default turn around Y.
    const radius = Math.max(...points.map(point => Math.hypot(point.x - target.x, point.z - target.z)));
    const envelope: Vector3[] = [];
    for (let step = 0; step < 24; step++) for (const y of [bounds.min.y, bounds.max.y]) {
      const angle = step * Math.PI / 12;
      envelope.push(new Vector3(target.x + Math.cos(angle) * radius, y, target.z + Math.sin(angle) * radius));
    }
    const pose = fitCameraToPoints(envelope, target, new Vector3(6.75, 3.33, -6.75), new Vector3(0, 1, 0), camera, { padding: 1.1 });
    // Framing uses screen-up for projection, but orbiting must use world-up.
    // A projected up-vector tilts the orbit axis and makes the ring wobble.
    pose.up.set(0, 1, 0);
    return pose;
  }
  if (view === "top") {
    // The band shoulders run horizontally instead of inheriting the world-camera roll.
    return fitCameraToPoints([...headPoints, ...bandPoints], headBounds.getCenter(new Vector3()), localDirection(0, -0.04, 1), localDirection(0, 1, 0), camera);
  }
  if (view === "head") {
    return fitCameraToPoints(headPoints, headBounds.getCenter(new Vector3()), localDirection(0.65, -1, 0.5), localDirection(0, 0, 1), camera);
  }
  if (view !== "shank") return undefined;

  const localBandBounds = new Box3().setFromPoints(bandPoints.map(point => point.clone().applyMatrix4(inverse)));
  const size = localBandBounds.getSize(new Vector3());
  const center = localBandBounds.getCenter(new Vector3());
  const shoulder = new Vector3(center.x + size.x * 0.34, center.y, center.z + size.z * 0.34);
  const stones: { bounds: Box3; center: Vector3; score: number }[] = [];
  shank.traverseVisible((mesh: any) => {
    if (!mesh.isMesh || !isDiamondMesh(mesh)) return;
    const points = meshPoints(mesh).map(point => point.applyMatrix4(inverse));
    if (!points.length) return;
    const bounds = new Box3().setFromPoints(points);
    const stoneCenter = bounds.getCenter(new Vector3());
    if (stoneCenter.z < center.z || stoneCenter.x < center.x) return;
    stones.push({ bounds, center: stoneCenter, score: stoneCenter.distanceToSquared(shoulder) });
  });
  stones.sort((a, b) => a.score - b.score);
  const focus = new Box3();
  const nearest = stones[0];
  // Separate stone instances give an exact shoulder cluster. A merged stone mesh
  // or a plain metal band uses a small shoulder window instead of the whole ring.
  if (nearest && nearest.bounds.getSize(new Vector3()).length() < size.length() * 0.4) {
    for (const stone of stones.slice(0, 4)) if (stone.center.distanceTo(nearest.center) < size.length() * 0.2) focus.union(stone.bounds);
    focus.expandByScalar(size.x * 0.035);
  } else {
    const half = new Vector3(size.x * 0.14, Math.max(size.y * 0.7, size.x * 0.06), size.z * 0.14);
    focus.set(shoulder.clone().sub(half), shoulder.clone().add(half));
  }
  const points = corners(focus).map(point => point.applyMatrix4(frame));
  const target = focus.getCenter(new Vector3()).applyMatrix4(frame);
  return fitCameraToPoints(points, target, localDirection(1, -0.9, 0.65), localDirection(0, 0, 1), camera);
};
