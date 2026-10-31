import { Color, Matrix4, Object3D, Vector3 } from "webgi";
import calibration from "../config/handPreview.json";
import { assetUrl } from "../config/assets";
import { PART_LOAD_OPTIONS } from "./partLoader";
import { measureRingBore } from "./ringBore";
import { fitCameraToPoints } from "./ringCameraViews";
import { DEFAULT_SKIN_TONE, getSkinToneLinear } from "../config/skinTones";
import { DEFAULT_HAND_FIT, type HandFitAdjustments } from "../config/handFit";

export class HandPreview {
  readonly root = new Object3D();
  active = false;
  private disposed = false;
  private pending?: Promise<void>;
  private loaded = false;
  private sourceMesh: any;
  private sourceFrame = new Matrix4();
  private sourcePositions?: Float32Array;
  private surfaceFitKey = "";
  private depthState?: { camera: any; near: number; far: number; auto: any; min: any; max: any };
  private skinTone = { value: new Color().setRGB(...getSkinToneLinear(DEFAULT_SKIN_TONE)) };
  private groundState?: { enabled: boolean; visible: boolean; meshVisible: boolean };
  private fitAdjustments = { ...DEFAULT_HAND_FIT };

  constructor(private viewer: any, private manager: any) {
    this.root.name = "ring-finger-hand-preview";
    this.root.visible = false;
    this.viewer.addEventListener?.("preRender", this.updateDepthRange);
  }

  async load() {
    if (this.loaded) return;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      const url = import.meta.env.DEV ? calibration.file : assetUrl(calibration.file);
      const imported = await this.manager.importer.importPath(url, { ...PART_LOAD_OPTIONS });
      for (const entry of Array.isArray(imported) ? imported : [imported]) {
        const object = entry?.modelObject ?? entry?.scene ?? entry;
        if (object?.isObject3D) this.root.add(object);
      }
      if (!this.root.children.length) throw new Error("The hand model has no visible geometry.");
      this.root.updateWorldMatrix(true, true);
      this.root.traverse((mesh: any) => {
        if (!mesh.isMesh) return;
        if (!this.sourceMesh) {
          this.sourceMesh = mesh;
          this.sourceFrame.copy(this.root.matrixWorld).invert().multiply(mesh.matrixWorld);
          mesh.geometry = mesh.geometry.clone();
          const positions = mesh.geometry.attributes.position;
          // Imported GLBs may interleave position, normal, UV and tangent data.
          this.sourcePositions = new Float32Array(positions.count * 3);
          for (let i = 0; i < positions.count; i++) {
            this.sourcePositions.set([positions.getX(i), positions.getY(i), positions.getZ(i)], i * 3);
          }
        }
        mesh.castShadow = false;
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          material.metalness = 0;
          material.roughness = 0.78;
          material.envMapIntensity = 0.25;
          material.color?.setRGB(1, 1, 1);
          const originalCompile = material.onBeforeCompile?.bind(material);
          material.onBeforeCompile = (shader: any, ...args: any[]) => {
            originalCompile?.(shader, ...args);
            shader.uniforms.handSkinTone = this.skinTone;
            shader.vertexShader = `varying vec3 vHandSkinPosition;\n${shader.vertexShader}`.replace("#include <begin_vertex>", "#include <begin_vertex>\n vHandSkinPosition = position;");
            shader.fragmentShader = `uniform vec3 handSkinTone;\nvarying vec3 vHandSkinPosition;\n${shader.fragmentShader}`.replace("#include <map_fragment>", `#include <map_fragment>
              vec3 originalSkin = diffuseColor.rgb;
              vec3 skinDetail = clamp(originalSkin / vec3(0.77198668, 0.42869050, 0.24620133), vec3(0.3), vec3(1.6));
              vec3 hp = vHandSkinPosition;
              float nailArea = max(max(step(22.0, hp.z) * step(-0.8, hp.x) * step(hp.x, 1.5), step(20.7, hp.z) * step(1.6, hp.x) * step(hp.x, 4.5)),
                max(max(step(20.5, hp.z) * step(-2.8, hp.x) * step(hp.x, -0.7), step(18.8, hp.z) * step(-5.3, hp.x) * step(hp.x, -3.0)), step(15.8, hp.z) * step(4.7, hp.x)));
              float warmth = max(originalSkin.r, originalSkin.g) - min(originalSkin.r, originalSkin.b);
              float nailMask = nailArea * (1.0 - smoothstep(0.08, 0.22, warmth)) * smoothstep(0.45, 0.75, dot(originalSkin, vec3(0.2126, 0.7152, 0.0722)));
              diffuseColor.rgb = mix(handSkinTone * skinDetail, originalSkin, nailMask);
            `).replace("#include <lights_fragment_end>", `#include <lights_fragment_end>
              // The studio is exposed for reflective jewellery. Balance the
              // hand's diffuse light separately so fair skin retains its tone.
              reflectedLight.directDiffuse *= 0.65;
              reflectedLight.indirectDiffuse *= 0.65;
              reflectedLight.directSpecular *= 0.5;
              reflectedLight.indirectSpecular *= 0.5;
            `);
          };
          material.customProgramCacheKey = () => "hand-skin-palette-linear-v2";
          // The hand must participate in the same depth pass as the metal and
          // diamonds; excluding it gives the later passes a different surface.
          material.userData.renderToDepth = true;
          material.depthWrite = true;
          material.depthTest = true;
          material.needsUpdate = true;
        }
      });
      this.loaded = true;
      if (this.disposed) { this.releaseResources(); return; }
    })();
    try { await this.pending; } finally { this.pending = undefined; }
  }

  private setGroundHidden(hidden: boolean) {
    const ground = this.viewer.getPluginByType?.("ContactShadowGroundPlugin");
    if (!ground) return;
    const mesh = ground.mesh?.modelObject;
    this.groundState ??= { enabled: ground.enabled, visible: ground.visible, meshVisible: mesh?.visible ?? true };
    ground.enabled = hidden ? false : this.groundState.enabled;
    ground.visible = hidden ? false : this.groundState.visible;
    if (mesh) mesh.visible = hidden ? false : this.groundState.meshVisible;
    if (!hidden) { ground.refreshOptions?.(); ground.refreshTransform?.(); }
  }

  /** Move the hand around the unchanged ring; the ring keeps its assembled pose. */
  private fit(shank: any) {
    const { radius: innerRadius, halfWidth } = measureRingBore(shank);
    const ringScale = new Vector3().setFromMatrixScale(shank.matrixWorld).x;
    const finger = calibration.ringFinger;
    const axis = new Vector3(...finger.axis as [number, number, number]).normalize();
    // Align the crown with the dorsal centre of this right-hand finger.
    const dorsal = new Vector3(...finger.dorsal as [number, number, number]).normalize().applyAxisAngle(axis, (finger.rollDegrees + this.fitAdjustments.roll) * Math.PI / 180);
    const lateral = new Vector3().crossVectors(axis, dorsal).normalize();
    const handBasis = new Matrix4().makeBasis(lateral, axis, dorsal);
    handBasis.multiply(new Matrix4().makeRotationX(this.fitAdjustments.pitch * Math.PI / 180));
    handBasis.multiply(new Matrix4().makeRotationZ(this.fitAdjustments.yaw * Math.PI / 180));
    const ringRotation = new Matrix4().extractRotation(shank.matrixWorld);
    const scale = innerRadius * ringScale / finger.radius * finger.clearance;
    const rawWorld = new Matrix4().multiplyMatrices(ringRotation, handBasis.invert()).scale(new Vector3(scale, scale, scale));
    // Keep the palm-side edge of wide/multi-row bands clear of the finger web.
    const halfWidthOnHand = halfWidth * ringScale / scale;
    const seatOffset = Math.min(.65, Math.max(.08, halfWidthOnHand - .12));
    const seat = new Vector3(...finger.anchor as [number, number, number]).addScaledVector(axis, seatOffset + finger.seatOffset + this.fitAdjustments.seat);
    this.fitFingerSurface(seat, axis, halfWidthOnHand);
    const anchor = seat.applyMatrix4(rawWorld);
    const center = new Vector3().setFromMatrixPosition(shank.matrixWorld);
    rawWorld.setPosition(center.sub(anchor));
    // Calibration is in mesh coordinates. Cancel the GLB's Sketchfab axis
    // conversion before applying the measured finger anchor and cross-section.
    const world = rawWorld.multiply(this.sourceFrame.clone().invert());
    this.root.parent?.updateWorldMatrix(true, false);
    const local = this.root.parent ? this.root.parent.matrixWorld.clone().invert().multiply(world) : world;
    local.decompose(this.root.position, this.root.quaternion, this.root.scale);
    this.root.updateWorldMatrix(false, true);
  }

  /** Skin is compliant: only the small patch under the band follows its bore.
   * Keep the original hand everywhere else and never deform the jewellery. */
  private fitFingerSurface(seat: Vector3, axis: Vector3, halfWidth: number) {
    const positions = this.sourceMesh.geometry.attributes.position;
    if (!this.sourcePositions) return;
    const key = `${seat.toArray()}:${halfWidth.toFixed(5)}`;
    if (key === this.surfaceFitKey) return;
    this.surfaceFitKey = key;
    const radius = calibration.ringFinger.radius;
    const point = new Vector3(), radial = new Vector3();
    for (let i = 0; i < positions.count; i++) {
      point.fromArray(this.sourcePositions, i * 3);
      radial.copy(point).sub(seat);
      const axial = radial.dot(axis);
      radial.addScaledVector(axis, -axial);
      const length = radial.length();
      if (length > radius * .5 && length < radius * 1.12 && Math.abs(axial) < halfWidth + .32) {
        const t = Math.max(0, Math.min(1, (Math.abs(axial) - halfWidth - .02) / .3));
        const weight = 1 - t * t * (3 - 2 * t);
        point.addScaledVector(radial, (radius * .998 / length - 1) * weight);
      }
      positions.setXYZ(i, point.x, point.y, point.z);
    }
    positions.needsUpdate = true;
    this.sourceMesh.geometry.computeVertexNormals();
    this.sourceMesh.geometry.computeBoundingBox();
    this.sourceMesh.geometry.computeBoundingSphere();
  }

  /** RootScene's whole-hand bounding sphere wastes depth precision around a
   * very thin band. Fit near/far to actual eye-space skin and ring extents. */
  private updateDepthRange = () => {
    if (!this.active || !this.root.visible || !this.sourceMesh) return;
    const camera = this.viewer.scene.activeCamera;
    const object = camera.cameraObject ?? camera;
    object.updateMatrixWorld(true);
    this.depthState ??= { camera, near: camera.near, far: camera.far, auto: object.userData.autoNearFar, min: object.userData.minNearPlane, max: object.userData.maxFarPlane };
    const transform = new Matrix4().multiplyMatrices(object.matrixWorldInverse, this.sourceMesh.matrixWorld);
    const e = transform.elements, positions = this.sourceMesh.geometry.attributes.position;
    let nearest = Infinity, farthest = 0;
    for (let i = 0; i < positions.count; i++) {
      const depth = -(e[2] * positions.getX(i) + e[6] * positions.getY(i) + e[10] * positions.getZ(i) + e[14]);
      if (depth > 0) { nearest = Math.min(nearest, depth); farthest = Math.max(farthest, depth); }
    }
    if (!Number.isFinite(nearest)) return;
    // Include the crown protruding above the dorsal skin without widening the
    // depth interval to a scene-wide ground plane or bounding sphere.
    const margin = calibration.ringFinger.radius * new Vector3().setFromMatrixScale(this.sourceMesh.matrixWorld).x * 1.8;
    const near = Math.max(.01, nearest - margin), far = Math.max(near + .1, farthest + margin);
    object.userData.autoNearFar = false;
    object.userData.minNearPlane = camera.near = near;
    object.userData.maxFarPlane = camera.far = far;
    object.near = near; object.far = far; object.updateProjectionMatrix();
  };

  private restoreDepthRange() {
    if (!this.depthState) return;
    const { camera, near, far, auto, min, max } = this.depthState;
    const object = camera.cameraObject ?? camera;
    for (const [key, value] of [["autoNearFar", auto], ["minNearPlane", min], ["maxFarPlane", max]] as const) {
      if (value === undefined) delete object.userData[key]; else object.userData[key] = value;
    }
    camera.near = object.near = near; camera.far = object.far = far;
    object.updateProjectionMatrix(); this.depthState = undefined;
  }

  show(shank: any) {
    if (!this.loaded || this.disposed) return;
    if (!this.root.parent) this.viewer.scene.add(this.root);
    this.fit(shank);
    this.active = true;
    this.root.visible = true;
    this.setGroundHidden(true);
    this.updateDepthRange();
    this.viewer.setDirty?.();
  }

  hide() {
    this.restoreDepthRange();
    this.active = false;
    this.root.visible = false;
    this.root.removeFromParent();
    if (this.groundState) this.setGroundHidden(false);
    this.viewer.setDirty?.();
  }

  suspend() {
    this.restoreDepthRange();
    this.root.visible = false;
    this.root.removeFromParent();
    if (this.groundState) this.setGroundHidden(false);
  }

  resume(shank: any) { if (this.active && shank?.visible) this.show(shank); }

  setSkinTone(value: number) {
    this.skinTone.value.setRGB(...getSkinToneLinear(value));
    this.viewer.setDirty?.();
  }

  setFitAdjustments(value: HandFitAdjustments | undefined, shank: any) {
    this.fitAdjustments = { ...DEFAULT_HAND_FIT, ...value };
    if (this.active && shank) { this.fit(shank); this.updateDepthRange(); this.viewer.setDirty?.(); }
  }

  cameraPose(camera: any) {
    this.root.updateWorldMatrix(true, true);
    const points: Vector3[] = [];
    const point = new Vector3();
    this.root.traverseVisible((mesh: any) => {
      const positions = mesh.isMesh && mesh.geometry?.attributes?.position;
      if (!positions) return;
      for (let index = 0; index < positions.count; index++) {
        point.fromBufferAttribute(positions, index);
        // Frame fingers and palm; the forearm can continue beyond the lower edge.
        if (point.z >= 10.5) points.push(point.clone().applyMatrix4(mesh.matrixWorld));
      }
    });
    const meshWorld = this.sourceMesh.matrixWorld;
    const target = new Vector3(-0.2, -1.5, 17.8).applyMatrix4(meshWorld);
    const direction = new Vector3(...calibration.ringFinger.dorsal as [number, number, number]).transformDirection(meshWorld);
    const up = new Vector3(0, 0, 1).transformDirection(meshWorld);
    // Keep the hand between the two control rails while the canvas itself
    // stays full-width in every mode (no internal crop or resize flash).
    const stage = this.viewer.canvas.closest(".product-viewer-stage");
    const rail = stage ? parseFloat(getComputedStyle(stage).getPropertyValue("--viewer-right-rail")) || 64 : 0;
    const canvas = this.viewer.canvas;
    const safeAspect = Math.max(1, canvas.clientWidth - rail * 2) / Math.max(1, canvas.clientHeight);
    const pose = fitCameraToPoints(points, target, direction, up, camera, { aspect: safeAspect, padding: 1.08 });
    pose.position.sub(pose.target).multiplyScalar(.82).add(pose.target);
    return pose;
  }

  private releaseResources() {
    const resources = new Set<any>();
    this.root.traverse((mesh: any) => {
      if (!mesh.isMesh) return;
      resources.add(mesh.geometry);
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        resources.add(material);
        for (const value of Object.values(material)) if ((value as any)?.isTexture) resources.add(value);
      }
    });
    resources.forEach(resource => resource.dispose?.());
    this.root.removeFromParent();
    this.root.clear();
  }

  dispose() { this.hide(); this.viewer.removeEventListener?.("preRender", this.updateDepthRange); this.disposed = true; this.releaseResources(); }
}
