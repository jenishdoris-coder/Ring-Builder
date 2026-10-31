import { Box3, CameraController, DoubleSide, Euler, Matrix4, MeshBasicMaterial, PerspectiveCamera, Quaternion, Vector3 } from "webgi";
import type { RingCameraPose } from "./ringCameraViews";
import type { EngravingPosition } from "../config/engraving";
import type { PortraitFit } from "../config/portraitFit";
import type { PortraitEnvironment } from "./portraitEnvironment";

export type RingPreviewImage = { id: string; label: string; url: string; width?: number; height?: number; engravingPosition?: EngravingPosition };
export type RingDetailPreviewRequest = { key: string; viewId: string; resolution: number; engravingPosition?: EngravingPosition; portraitFit?: PortraitFit; environment?: PortraitEnvironment };
export const RING_PREVIEW_RESOLUTION = 1200;
export const RING_PREVIEW_VERSION = "studio-1200-balanced-resting-v17";

/** Render just the enlarged photograph at a resolution suited to 3x zoom. */
export const getRingDetailResolution = () => {
  const mobile = window.innerWidth <= 768;
  const constrained = (navigator.hardwareConcurrency || 4) <= 8;
  const required = Math.ceil(Math.min(window.innerWidth * 0.8, window.innerHeight * 0.8) * Math.min(window.devicePixelRatio || 1, 2) * 3 / 256) * 256;
  return Math.min(constrained ? 1792 : 2048, Math.max(mobile ? 1600 : 1792, required));
};

const imageJobTails = new WeakMap<object, Promise<void>>();
/** Captures and their cleanup must finish serially on the shared renderer. */
export async function runRingImageJob<T>(viewer: object, signal: AbortSignal, job: () => Promise<T>): Promise<T> {
  const previous = imageJobTails.get(viewer) ?? Promise.resolve();
  let release!: () => void;
  const completion = new Promise<void>(resolve => { release = resolve; });
  const tail = previous.then(() => completion);
  imageJobTails.set(viewer, tail);
  await previous;
  try {
    if (signal.aborted) throw new DOMException("Photo cancelled", "AbortError");
    return await job();
  } finally { release(); if (imageJobTails.get(viewer) === tail) imageJobTails.delete(viewer); }
}

export const RING_PREVIEW_VIEWS = [
  { id: "three-quarter", label: "Three-quarter view", direction: [0.8, 0.4, -1], up: [0, 1, 0], lying: false },
  { id: "top", label: "Diamond view", direction: [1, 0.16, 0], up: [0, 1, 0], lying: true },
  { id: "profile", label: "Side profile", direction: [0.08, 0.38, 1], up: [0, 1, 0], lying: true },
] as const;

export const getRingPreviewViews = (engraved: boolean) => engraved
  ? [...RING_PREVIEW_VIEWS.slice(0, 2), { ...RING_PREVIEW_VIEWS[2], id: "engraving", label: "Engraving detail" }]
  : [...RING_PREVIEW_VIEWS];

const saveTransform = (object: any) => ({
  position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone(),
});
const restoreTransform = (object: any, saved: ReturnType<typeof saveTransform>) => {
  object.position.copy(saved.position);
  object.quaternion.copy(saved.quaternion);
  object.scale.copy(saved.scale);
  object.updateMatrix();
  object.updateWorldMatrix(true, true);
};
const ringBounds = (roots: any[]) => {
  const bounds = new Box3();
  roots.forEach(root => { root.updateWorldMatrix(true, true); bounds.union(new Box3().setFromObject(root, true)); });
  return bounds;
};

const contactVertices = (roots: any[]) => {
  const points: number[] = [];
  const point = new Vector3();
  roots.forEach(root => root.traverse((mesh: any) => {
    const vertices = mesh.isMesh && mesh.visible && mesh.geometry?.attributes.position;
    if (!vertices) return;
    for (let index = 0; index < vertices.count; index++) {
      point.fromBufferAttribute(vertices, index).applyMatrix4(mesh.matrixWorld);
      points.push(point.x, point.y);
    }
  }));
  return points;
};

/** Balance the front of the assembly against the back of the band. Wide
 * bypass shoulders can support the front before the stone touches the floor. */
const findRestingTilt = (head: number[], band: number[]) => {
  if (!head.length || !band.length) return 0;
  let minX = Infinity, maxX = -Infinity;
  for (let index = 0; index < band.length; index += 2) {
    minX = Math.min(minX, band[index]);
    maxX = Math.max(maxX, band[index]);
  }
  const middleX = (minX + maxX) / 2;
  const front = [...head], back: number[] = [];
  for (let index = 0; index < band.length; index += 2) {
    (band[index] > middleX ? front : back).push(band[index], band[index + 1]);
  }
  if (!back.length) return 0;
  const lowest = (points: number[], angle: number) => {
    const sine = Math.sin(angle), cosine = Math.cos(angle);
    let floor = Infinity;
    for (let index = 0; index < points.length; index += 2) floor = Math.min(floor, points[index] * sine + points[index + 1] * cosine);
    return floor;
  };
  const gap = (angle: number) => lowest(front, angle) - lowest(back, angle);
  let lower = -Math.PI / 4, upper = Math.PI / 4;
  if (gap(lower) >= 0 || gap(upper) <= 0) return 0;
  for (let iteration = 0; iteration < 28; iteration++) {
    const middle = (lower + upper) / 2;
    if (gap(middle) < 0) lower = middle;
    else upper = middle;
  }
  return (lower + upper) / 2;
};

/** Stage complete assemblies on a horizontal studio floor without changing the live pose. */
export const createRingPhotoStage = (roots: any[], ground?: any) => {
  roots.forEach(root => root.updateWorldMatrix(true, true));
  const savedRoots = roots.map(root => ({ root, transform: saveTransform(root), world: root.matrixWorld.clone() }));
  const origin = roots[0].getWorldPosition(new Vector3());
  const originalRotation = roots[0].getWorldQuaternion(new Quaternion());
  const groundMesh = ground?.mesh?.modelObject;
  const groundMaterial = ground?.material?.materialObject ?? ground?.material ?? groundMesh?.material;
  const savedGround = groundMesh && {
    transform: saveTransform(groundMesh), visible: groundMesh.visible,
    blur: ground.blurAmount, refresh: ground.enableRefreshTransform,
    camera: ground.shadowCamera?.clone(), material: groundMesh.material,
  };
  // Bake the depth shadow onto a white studio floor. An opaque receiver also
  // retains the shadow when WebGI exports its off-screen RGBM render target.
  const photoShadow = groundMaterial?.alphaMap && new MeshBasicMaterial({
    color: 0xffffff, map: groundMaterial.alphaMap, side: DoubleSide,
  });
  if (photoShadow) {
    photoShadow.userData = { ...groundMaterial.userData };
    photoShadow.userData.renderToDepth = true;
    photoShadow.userData.postTonemap = false;
    photoShadow.userData.ssaoDisabled = true;
    photoShadow.userData.sscsDisabled = true;
    photoShadow.toneMapped = false;
    photoShadow.onBeforeCompile = (shader: any) => {
      // Match the scene's clipped studio white while retaining soft depth detail.
      shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", "#include <map_fragment>\n diffuseColor.rgb = vec3(4.0) - diffuseColor.rgb * 3.8;");
    };
    photoShadow.customProgramCacheKey = () => "ring-photo-shadow-white-v2";
    groundMesh.material = photoShadow;
  }
  const materialDepth = new Map<any, any>();
  roots.forEach(root => root.traverse((mesh: any) => {
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!material || materialDepth.has(material)) continue;
      materialDepth.set(material, material.userData.renderToDepth);
      material.userData.renderToDepth = true;
    }
  }));
  if (ground) ground.enableRefreshTransform = false;
  const applyWorld = (object: any, world: Matrix4) => {
    object.parent?.updateWorldMatrix(true, false);
    const local = object.parent ? new Matrix4().copy(object.parent.matrixWorld).invert().multiply(world) : world;
    local.decompose(object.position, object.quaternion, object.scale);
    object.updateMatrix();
    object.updateWorldMatrix(false, true);
  };
  return {
    pose(lying: boolean) {
      const rotation = new Quaternion().setFromEuler(lying ? new Euler(0, Math.PI / 2, 0) : new Euler(-Math.PI / 2, 0, 0));
      rotation.multiply(originalRotation.clone().invert());
      const stage = new Matrix4().makeRotationFromQuaternion(rotation).multiply(new Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z));
      savedRoots.forEach(({ root, world }) => applyWorld(root, new Matrix4().multiplyMatrices(stage, world)));
      if (lying && roots.length > 1) {
        const tilt = findRestingTilt(contactVertices([roots[0]]), contactVertices(roots.slice(1)));
        stage.premultiply(new Matrix4().makeRotationZ(tilt));
        savedRoots.forEach(({ root, world }) => applyWorld(root, new Matrix4().multiplyMatrices(stage, world)));
      }
      const initial = ringBounds(roots);
      const lift = new Matrix4().makeTranslation(0, -initial.min.y, 0);
      savedRoots.forEach(({ root, world }) => applyWorld(root, new Matrix4().multiplyMatrices(lift, new Matrix4().multiplyMatrices(stage, world))));
      const bounds = ringBounds(roots);
      if (groundMesh && ground.shadowCamera) {
        const center = bounds.getCenter(new Vector3());
        const size = bounds.getSize(new Vector3());
        const extent = Math.max(size.x, size.z) * 1.55;
        // Fit the floor and depth camera to this pose before the shadow pass runs.
        const floor = new Matrix4().compose(new Vector3(center.x, -0.002, center.z), new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0)), new Vector3(extent, -extent, extent));
        applyWorld(groundMesh, floor);
        groundMesh.visible = true;
        ground.blurAmount = 1.6;
        const camera = ground.shadowCamera;
        camera.position.set(center.x, -0.002, center.z);
        camera.rotation.set(Math.PI / 2, 0, 0);
        camera.left = camera.bottom = -extent / 2;
        camera.right = camera.top = extent / 2;
        camera.near = 0.001;
        camera.far = Math.max(1, size.y * 1.8);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld(true);
      }
      return bounds;
    },
    restore() {
      savedRoots.forEach(({ root, transform }) => restoreTransform(root, transform));
      for (const [material, depth] of materialDepth) {
        if (depth === undefined) delete material.userData.renderToDepth;
        else material.userData.renderToDepth = depth;
      }
      if (savedGround) {
        groundMesh.material = savedGround.material;
        photoShadow?.dispose();
        restoreTransform(groundMesh, savedGround.transform);
        groundMesh.visible = savedGround.visible;
        ground.blurAmount = savedGround.blur;
        if (savedGround.camera) ground.shadowCamera.copy(savedGround.camera);
        ground.enableRefreshTransform = savedGround.refresh;
        ground.refreshTransform?.();
      }
    },
  };
};

export const fitPreviewCamera = (camera: any, bounds: Box3, direction: Vector3, up: Vector3, aspect: number, roots?: any[], centerOutline = false) => {
  camera.clearViewOffset();
  const center = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3());
  const distance = size.length() * 1.8;
  camera.up.copy(up);
  camera.position.copy(center).addScaledVector(direction.clone().normalize(), distance);
  camera.lookAt(center);
  camera.aspect = aspect;
  camera.near = 0.01;
  camera.far = Math.max(100, distance * 10);
  camera.updateMatrixWorld(true);
  const inverse = camera.matrixWorldInverse;
  const halfFov = Math.tan((camera.fov * Math.PI) / 360);
  let requiredDistance = 0;
  const point = new Vector3();
  const fitPoint = () => {
    point.applyMatrix4(inverse);
    requiredDistance = Math.max(requiredDistance, Math.abs(point.y) / halfFov + point.z + distance, Math.abs(point.x) / (halfFov * aspect) + point.z + distance);
  };
  if (roots) {
    // A small CPU geometry pass avoids the empty corners of the assembly's
    // bounding box: more ring detail fits into the same 1200px render budget.
    roots.forEach(root => root.traverseVisible((mesh: any) => {
      const vertices = mesh.isMesh && mesh.geometry?.attributes.position;
      if (!vertices) return;
      for (let index = 0; index < vertices.count; index++) {
        point.fromBufferAttribute(vertices, index).applyMatrix4(mesh.matrixWorld);
        fitPoint();
      }
    }));
  } else {
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      point.set(x, y, z);
      fitPoint();
    }
  }
  camera.position.copy(center).addScaledVector(direction.clone().normalize(), requiredDistance * (roots ? 1.24 : 1.12));
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  if (centerOutline && roots?.length) {
    // A world-space box centre is not the centre of a perspective silhouette.
    // Shift the image plane using the rendered geometry's projected outline,
    // preserving the existing viewing angle, scale and floor contact.
    const clipFromWorld = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    roots.forEach(root => root.traverseVisible((mesh: any) => {
      const vertices = mesh.isMesh && mesh.geometry?.attributes.position;
      if (!vertices) return;
      const clipFromMesh = new Matrix4().multiplyMatrices(clipFromWorld, mesh.matrixWorld);
      for (let index = 0; index < vertices.count; index++) {
        point.fromBufferAttribute(vertices, index).applyMatrix4(clipFromMesh);
        minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
      }
    }));
    if (Number.isFinite(minX) && Number.isFinite(minY)) {
      const height = 1000, width = height * aspect;
      camera.setViewOffset(width, height, (minX + maxX) * width / 4, -(minY + maxY) * height / 4, width, height);
    }
  }
};

const orientImage = async (source: string | Blob) => {
  const image = new Image();
  const url = typeof source === "string" ? source : URL.createObjectURL(source);
  image.src = url;
  try {
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.translate(0, canvas.height); context.scale(1, -1); context.drawImage(image, 0, 0);
    // Async encoding leaves wheel/pinch input free instead of synchronously
    // encoding multi-megapixel PNG and WebP strings on every enlargement.
    if (!canvas.toBlob) return canvas.toDataURL("image/webp", 1);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Photo encoding failed")), "image/webp", 1));
    return await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
  } finally { if (typeof source !== "string") URL.revokeObjectURL(url); }
};

/** Tight clipping improves mobile depth precision around overlapping metal. */
const fitPhotoClipping = (camera: any, roots: any[]) => {
  const object = camera.cameraObject ?? camera;
  object.updateMatrixWorld(true);
  let near = Infinity, far = 0;
  const point = new Vector3();
  for (const root of roots) {
    const box = new Box3().setFromObject(root, true);
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const depth = -point.set(x, y, z).applyMatrix4(object.matrixWorldInverse).z;
      if (depth > 0) { near = Math.min(near, depth); far = Math.max(far, depth); }
    }
  }
  if (Number.isFinite(near) && far > 0) {
    camera.near = Math.max(.01, near * .25);
    camera.far = Math.max(camera.near + 1, far * 1.25);
    object.near = camera.near;
    object.far = camera.far;
    object.updateProjectionMatrix();
  }
};

const preserveLiveFrame = async (viewer: any) => {
  try {
  const canvas: HTMLCanvasElement = viewer.canvas;
  if (!canvas.parentElement) return () => {};
  const overlay = document.createElement("img");
  const blob = canvas.toBlob ? await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", .94)) : null;
  const url = blob ? URL.createObjectURL(blob) : canvas.toDataURL("image/png");
  overlay.src = url;
  overlay.alt = "";
  overlay.setAttribute("aria-hidden", "true");
  Object.assign(overlay.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none", zIndex: "4" });
  try { await overlay.decode(); } catch { /* A connected live frame is still a useful fallback. */ }
  if (!canvas.isConnected) { if (blob) URL.revokeObjectURL(url); return () => {}; }
  canvas.parentElement?.appendChild(overlay);
  return () => {
    const remove = () => { viewer.removeEventListener?.("postRender", presented); viewer.removeEventListener?.("dispose", remove); overlay.remove(); if (blob) URL.revokeObjectURL(url); };
    const presented = () => {
      if (viewer.renderer.defaultRenderToScreen === false || viewer.scene.renderCamera !== viewer.scene.activeCamera) return;
      viewer.removeEventListener?.("postRender", presented);
      requestAnimationFrame(remove);
    };
    // Two arbitrary animation frames can expire before a busy laptop draws its
    // live camera. Keep the guard until an actual live frame is presented.
    viewer.addEventListener?.("postRender", presented);
    viewer.addEventListener?.("dispose", remove);
    viewer.setDirty?.();
  };
  } catch { return () => {}; }
};

/** Render product photos off-screen through the same metal/diamond pipeline. */
export const captureRingPreviews = async (viewer: any, roots: any[], signal: AbortSignal, options: { viewId?: string; resolution?: number; engraving?: { cameraPose: (camera: any) => RingCameraPose | undefined; position?: EngravingPosition }; customView?: { id: string; label: string; cameraPose: (camera: any, roots: any[]) => RingCameraPose; configureCamera?: (camera: any, roots: any[]) => void; beforeRender: (camera: any) => void; capture: (renderer: any, target: any) => string | Blob | Promise<Blob> } } = {}): Promise<RingPreviewImage[]> => {
  const scene = viewer.scene;
  const renderer = viewer.renderer;
  const progressive = viewer.getPluginByType?.("Progressive");
  const temporalAA = viewer.getPluginByType?.("TAA");
  const ground = viewer.getPluginByType?.("ContactShadowGroundPlugin");
  const originalGroundVisible = ground?.visible;
  const originalCamera = scene.renderCamera;
  const originalRenderToScreen = renderer.defaultRenderToScreen;
  const originalRenderEnabled = viewer.renderEnabled;
  const originalProgressive = progressive?.enabled;
  const originalJitter = progressive?.jitter;
  const originalSize = { width: renderer.renderSize.x, height: renderer.renderSize.y };
  const scale = renderer.displayCanvasScaling || 1;
  const requestedResolution = options.resolution ?? RING_PREVIEW_RESOLUTION;
  const resolution = Math.min(requestedResolution, renderer.rendererObject?.capabilities.maxTextureSize ?? requestedResolution);
  const smoothDetail = resolution > RING_PREVIEW_RESOLUTION && Boolean(progressive);
  const smoothPreview = Boolean(progressive && (temporalAA?.enabled || options.customView));
  const sampleCount = smoothDetail || smoothPreview ? 4 : 2;
  const accumulate = smoothDetail || smoothPreview;
  const aspect = 1;
  const camera = new CameraController(new PerspectiveCamera(25, aspect, 0.01, 100), { controlsMode: "", controlsEnabled: false, aspect, fov: 25 }, viewer.canvas);
  if (!roots.length || ringBounds(roots).isEmpty()) { camera.dispose(); return []; }
  const stage = createRingPhotoStage(roots, ground);
  const releaseLiveFrame = await preserveLiveFrame(viewer);
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    stage.restore();
    if (ground) ground.visible = originalGroundVisible;
    scene.renderCamera = originalCamera;
    renderer.setSize(viewer.canvas.clientWidth || originalSize.width, viewer.canvas.clientHeight || originalSize.height, true);
    renderer.defaultRenderToScreen = originalRenderToScreen;
    viewer.renderEnabled = originalRenderEnabled;
    if (progressive) {
      // WebGI keeps accumulation targets by camera UUID. Photo cameras are
      // temporary, so release their history rather than retaining GPU memory.
      const history = progressive.getLastFrame?.(camera);
      if (history) { renderer.disposeTarget?.(history); progressive._lastFrames?.delete(camera.cameraObject.uuid); }
      progressive.enabled = originalProgressive;
      progressive.jitter = originalJitter;
    }
    renderer.reset();
    viewer.setDirty();
    camera.dispose();
    releaseLiveFrame();
  };
  signal.addEventListener("abort", restore, { once: true });
  try {
    if (signal.aborted) throw new DOMException("Preview cancelled", "AbortError");
    renderer.defaultRenderToScreen = false;
    viewer.renderEnabled = false;
    if (progressive) {
      progressive.enabled = accumulate;
      // Its built-in jitter targets the live camera; jitter our photo camera
      // explicitly and preserve the outline-centering projection offset.
      progressive.jitter = false;
    }
    scene.renderCamera = camera;
    // Resize every render target through WebGI, including the shared depth buffer.
    renderer.setSize(resolution / scale, resolution / scale, true);
    const images: RingPreviewImage[] = [];
    const views = options.customView ? [{ ...RING_PREVIEW_VIEWS[0], id: options.customView.id, label: options.customView.label }] : getRingPreviewViews(Boolean(options.engraving)).filter(view => !options.viewId || view.id === options.viewId);
    for (const view of views) {
      if (signal.aborted) throw new DOMException("Preview cancelled", "AbortError");
      // A user may expand the live canvas while the previous image decodes.
      renderer.setSize(resolution / scale, resolution / scale);
      if (ground) ground.visible = view.id !== "engraving" && !options.customView;
      const bounds = stage.pose(view.lying);
      if ((view.id === "engraving" || options.customView) && ground?.mesh?.modelObject) ground.mesh.modelObject.visible = false;
      const direction = new Vector3(...view.direction);
      const up = new Vector3(...view.up);
      const engravingPose = options.customView?.cameraPose(camera.cameraObject, roots) ?? (view.id === "engraving" ? options.engraving?.cameraPose(camera.cameraObject) : undefined);
      if (engravingPose) {
        camera.cameraObject.clearViewOffset();
        camera.cameraObject.up.copy(engravingPose.up);
        camera.cameraObject.position.copy(engravingPose.position);
        camera.cameraObject.lookAt(engravingPose.target);
        camera.cameraObject.updateProjectionMatrix();
        camera.cameraObject.updateMatrixWorld(true);
      } else fitPreviewCamera(camera.cameraObject, bounds, direction, up, aspect, roots, view.lying);
      camera.position.copy(camera.cameraObject.position);
      camera.target.copy(engravingPose?.target ?? bounds.getCenter(new Vector3()));
      options.customView?.configureCamera?.(camera.cameraObject, roots);
      const floor = ground?.mesh?.modelObject;
      // WebGI's depth uniforms read the controller's near/far, so update the
      // controller as well as its underlying projection matrix.
      fitPhotoClipping(camera, [...roots, ...(floor?.visible ? [floor] : [])]);
      renderer.reset();
      const projection = camera.cameraObject.view?.enabled ? { ...camera.cameraObject.view } : { fullWidth: resolution, fullHeight: resolution, offsetX: 0, offsetY: 0, width: resolution, height: resolution };
      const samples = [[-.375, -.125], [.125, -.375], [.375, .125], [-.125, .375], [-.375, .375], [.375, -.375], [-.125, -.125], [.125, .125]];
      for (let frame = 0; frame < sampleCount; frame++) {
        if (signal.aborted) throw new DOMException("Preview cancelled", "AbortError");
        if (accumulate) {
          const [x, y] = samples[frame];
          camera.cameraObject.setViewOffset(projection.fullWidth, projection.fullHeight, projection.offsetX + x * projection.width / resolution, projection.offsetY + y * projection.height / resolution, projection.width, projection.height);
        }
        options.customView?.beforeRender(camera.cameraObject);
        viewer.dispatchEvent({ type: "preRender", target: viewer });
        scene.renderCamera = camera;
        renderer.render(false);
        viewer.dispatchEvent({ type: "postRender", target: viewer });
        if (accumulate && frame < sampleCount - 1) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }
      if (signal.aborted) throw new DOMException("Preview cancelled", "AbortError");
      const target = renderer.composer.readBuffer;
      const source = options.customView ? await options.customView.capture(renderer, target) : renderer.renderTargetToDataUrl(target, "image/png");
      const url = await orientImage(source);
      if (signal.aborted) throw new DOMException("Preview cancelled", "AbortError");
      images.push({ id: view.id, label: view.label, url, width: resolution, height: resolution, ...(view.id === "engraving" ? { engravingPosition: options.engraving?.position } : {}) });
    }
    return images;
  } finally {
    signal.removeEventListener("abort", restore);
    restore();
  }
};
