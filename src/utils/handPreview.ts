import { Color, Matrix4, Object3D, Vector3 } from "webgi";
import calibration from "../config/handPreview.json";
import { assetUrl } from "../config/assets";
import { PART_LOAD_OPTIONS } from "./partLoader";
import { isDiamondMesh } from "./meshUtils";
import { fitCameraToPoints } from "./ringCameraViews";
import { DEFAULT_SKIN_TONE, getSkinToneLinear } from "../config/skinTones";

export class HandPreview {
  readonly root = new Object3D();
  active = false;
  private disposed = false;
  private pending?: Promise<void>;
  private loaded = false;
  private sourceMesh: any;
  private sourceFrame = new Matrix4();
  private skinTone = { value: new Color().setRGB(...getSkinToneLinear(DEFAULT_SKIN_TONE)) };
  private groundState?: { enabled: boolean; visible: boolean; meshVisible: boolean };

  constructor(private viewer: any, private manager: any) {
    this.root.name = "ring-finger-hand-preview";
    this.root.visible = false;
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
          material.userData.renderToDepth = false;
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
    shank.updateWorldMatrix(true, true);
    const inverse = shank.matrixWorld.clone().invert();
    const radii: number[] = [];
    const point = new Vector3();
    shank.traverseVisible((mesh: any) => {
      const positions = mesh.isMesh && !isDiamondMesh(mesh) && mesh.geometry?.attributes?.position;
      if (!positions) return;
      for (let index = 0; index < positions.count; index++) {
        point.fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
        if (point.z < 0) radii.push(Math.hypot(point.x, point.z));
      }
    });
    radii.sort((a, b) => a - b);
    const innerRadius = radii[Math.floor(radii.length * 0.02)];
    if (!Number.isFinite(innerRadius) || innerRadius <= 0) throw new Error("The selected band has no ring opening.");
    const ringScale = new Vector3().setFromMatrixScale(shank.matrixWorld).x;
    const finger = calibration.ringFinger;
    const axis = new Vector3(...finger.axis as [number, number, number]).normalize();
    // The calibrated roll moves the crown toward the centre of this right
    // hand's ring finger while keeping the bore axis and seating point fixed.
    const dorsal = new Vector3(...finger.dorsal as [number, number, number]).normalize().applyAxisAngle(axis, finger.rollDegrees * Math.PI / 180);
    const lateral = new Vector3().crossVectors(axis, dorsal).normalize();
    const handBasis = new Matrix4().makeBasis(lateral, axis, dorsal);
    const ringRotation = new Matrix4().extractRotation(shank.matrixWorld);
    const scale = innerRadius * ringScale / finger.radius * finger.clearance;
    const rawWorld = new Matrix4().multiplyMatrices(ringRotation, handBasis.invert()).scale(new Vector3(scale, scale, scale));
    const anchor = new Vector3(...finger.anchor as [number, number, number]).applyMatrix4(rawWorld);
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

  show(shank: any) {
    if (!this.loaded || this.disposed) return;
    if (!this.root.parent) this.viewer.scene.add(this.root);
    this.fit(shank);
    this.active = true;
    this.root.visible = true;
    this.setGroundHidden(true);
    this.viewer.setDirty?.();
  }

  hide() {
    this.active = false;
    this.root.visible = false;
    this.root.removeFromParent();
    if (this.groundState) this.setGroundHidden(false);
    this.viewer.setDirty?.();
  }

  suspend() {
    this.root.visible = false;
    this.root.removeFromParent();
    if (this.groundState) this.setGroundHidden(false);
  }

  resume(shank: any) { if (this.active && shank?.visible) this.show(shank); }

  setSkinTone(value: number) {
    this.skinTone.value.setRGB(...getSkinToneLinear(value));
    this.viewer.setDirty?.();
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
    const direction = new Vector3(0.2, 1, 0.3).transformDirection(meshWorld);
    const up = new Vector3(0, 0, 1).transformDirection(meshWorld);
    // Keep the hand between the two control rails while the canvas itself
    // stays full-width in every mode (no internal crop or resize flash).
    const stage = this.viewer.canvas.closest(".product-viewer-stage");
    const rail = stage ? parseFloat(getComputedStyle(stage).getPropertyValue("--viewer-right-rail")) || 64 : 0;
    const canvas = this.viewer.canvas;
    const safeAspect = Math.max(1, canvas.clientWidth - rail * 2) / Math.max(1, canvas.clientHeight);
    return fitCameraToPoints(points, target, direction, up, camera, { aspect: safeAspect });
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

  dispose() { this.hide(); this.disposed = true; this.releaseResources(); }
}
