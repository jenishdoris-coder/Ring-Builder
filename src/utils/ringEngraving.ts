import { Box3, CanvasTexture, DoubleSide, LinearFilter, Matrix3, Matrix4, Raycaster, Vector3, Vector4, type MaterialExtension } from "webgi";
import { ENGRAVING_POSITIONS, normalizeEngravingText, type EngravingPosition, type RingEngravingConfig } from "../config/engraving";
import { isDiamondMesh } from "./meshUtils";
import { fitCameraToPoints, type RingCameraPose } from "./ringCameraViews";

type Surface = { root: any; metals: any[]; bounds: Box3; angle: number; centerY: number; radius: number; minY: number; maxY: number };
type Layout = Surface & { span: number; height: number; tolerance: number; points: Vector3[] };
type RootState = { root: any; layout: { value: Vector4 }; surface: { value: Vector4 }; meshToBand: { value: Matrix4 }; normalToBand: { value: Matrix3 } };
const KEY = "ring-inner-engraving-v1";
const MAIN = /void\s+main\s*\(\s*\)\s*\{/;

const FRAGMENT = `
uniform sampler2D uRingEngravingMask;
uniform vec4 uRingEngravingLayout;
uniform vec4 uRingEngravingSurface;
varying vec3 vRingEngravingPosition;
varying vec3 vRingEngravingNormal;
float ringEngravingCoverage() {
  if (uRingEngravingSurface.w < 0.5) return 0.0;
  float theta = atan(vRingEngravingPosition.x, -vRingEngravingPosition.z);
  float delta = atan(sin(theta-uRingEngravingLayout.x), cos(theta-uRingEngravingLayout.x));
  vec2 uv = vec2(0.5 + delta/uRingEngravingLayout.y, 0.5 + (vRingEngravingPosition.y-uRingEngravingLayout.w)/uRingEngravingLayout.z);
  if (min(uv.x,uv.y)<0.0 || max(uv.x,uv.y)>1.0) return 0.0;
  vec3 inward = normalize(vec3(-vRingEngravingPosition.x,0.0,-vRingEngravingPosition.z));
  float innerFace = smoothstep(0.35,0.7,abs(dot(normalize(vRingEngravingNormal),inward)));
  float radial = length(vRingEngravingPosition.xz);
  float onSurface = 1.0-smoothstep(uRingEngravingSurface.y*0.8,uRingEngravingSurface.y,abs(radial-uRingEngravingSurface.x));
  return texture2D(uRingEngravingMask,uv).a*innerFace*onSurface;
}
`;

export class RingEngraving {
  constructor(private channel = "") {}
  active = false;
  revision = 0;
  matches(config: RingEngravingConfig | null) { return this.active && config?.text === this.config?.text && config?.position === this.config?.position; }
  private config: RingEngravingConfig | null = null;
  private root: any;
  private layout?: Layout;
  private texture?: CanvasTexture;
  private mask = { value: null as CanvasTexture | null };
  private maskAspect = 1;
  private states = new Set<RootState>();
  private installed = new WeakMap<object, { root: any; extension: MaterialExtension }>();
  private surfaces = new WeakMap<object, Map<string, Surface | null>>();

  private createMask(text: string) {
    if (this.config?.text === text && this.texture) return;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d")!;
    const font = '500 180px Georgia, "Times New Roman", serif';
    context.font = font;
    const measure = context.measureText(text);
    canvas.width = Math.max(128, Math.min(4096, Math.ceil(measure.width + 64)));
    canvas.height = 256;
    context.font = font;
    context.textAlign = "center";
    context.fillStyle = "white";
    const baseline = (canvas.height + measure.actualBoundingBoxAscent - measure.actualBoundingBoxDescent) / 2;
    context.fillText(text, canvas.width / 2, baseline, canvas.width - 40);
    const texture = new CanvasTexture(canvas);
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.generateMipmaps = false;
    this.maskAspect = canvas.width / canvas.height;
    this.mask.value = texture;
    this.texture?.dispose();
    this.texture = texture;
  }

  private probe(surface: Pick<Surface, "root" | "metals">, theta: number, y: number) {
    const frame = surface.root.matrixWorld;
    const raycaster = new Raycaster();
    const sides = new Map<any, number>();
    for (const mesh of surface.metals) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (material && !sides.has(material)) { sides.set(material, material.side); material.side = DoubleSide; }
    }
    try {
      // CAD seams can put the ideal axis exactly between two triangles. A tiny
      // angular offset avoids that numerical crack without moving the inscription.
      for (const offset of [0, 0.00001, -0.00001]) {
        raycaster.set(new Vector3(0, y, 0).applyMatrix4(frame), new Vector3(Math.sin(theta + offset), 0, -Math.cos(theta + offset)).transformDirection(frame));
        const hit = raycaster.intersectObjects(surface.metals, false)[0];
        if (hit) return hit.point.clone().applyMatrix4(frame.clone().invert());
      }
    } finally { for (const [material, side] of sides) material.side = side; }
  }

  private surfaceFor(root: any, position: RingEngravingConfig["position"]) {
    let cache = this.surfaces.get(root);
    if (!cache) { cache = new Map(); this.surfaces.set(root, cache); }
    if (cache.has(position)) return cache.get(position) ?? undefined;
    root.updateWorldMatrix(true, true);
    const inverse = root.matrixWorld.clone().invert();
    const metals: any[] = [];
    const bounds = new Box3();
    const point = new Vector3();
    root.traverse((mesh: any) => {
      if (!mesh.isMesh || isDiamondMesh(mesh) || !mesh.geometry?.attributes.position) return;
      metals.push(mesh);
      const toBand = new Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
      const vertices = mesh.geometry.attributes.position;
      for (let index = 0; index < vertices.count; index++) bounds.expandByPoint(point.fromBufferAttribute(vertices, index).applyMatrix4(toBand));
    });
    if (!metals.length || bounds.isEmpty()) { cache.set(position, null); return; }
    const angle = ENGRAVING_POSITIONS.find(item => item.id === position)!.angle;
    const surface = { root, metals, bounds, angle, centerY: Math.max(bounds.min.y, Math.min(bounds.max.y, 0)), minY: 0, maxY: 0, radius: 0 };
    let hit = this.probe(surface, angle, surface.centerY);
    if (!hit) {
      for (let step = 1; step < 16 && !hit; step++) {
        surface.centerY = bounds.min.y + (bounds.max.y - bounds.min.y) * step / 16;
        hit = this.probe(surface, angle, surface.centerY);
      }
    }
    if (!hit) { cache.set(position, null); return; }
    const edge = (boundary: number) => {
      let inside = surface.centerY, outside = boundary;
      for (let step = 0; step < 11; step++) {
        const middle = (inside + outside) / 2;
        if (this.probe(surface, angle, middle)) inside = middle; else outside = middle;
      }
      return inside;
    };
    surface.minY = edge(bounds.min.y);
    surface.maxY = edge(bounds.max.y);
    hit = this.probe(surface, angle, surface.centerY) ?? hit;
    surface.radius = Math.hypot(hit.x, hit.z);
    if (surface.maxY - surface.minY < 0.1 || surface.radius < 0.1) { cache.set(position, null); return; }
    cache.set(position, surface);
    return surface;
  }

  private createLayout(surface: Surface): Layout | undefined {
    const width = surface.maxY - surface.minY;
    // Some pavé bands have open stone seats along their centre. Fit to an
    // uninterrupted strip of inner metal rather than bridging those openings.
    for (const offset of [0, -0.22, 0.22, -0.35, 0.35]) {
      const centerY = surface.centerY + width * offset;
      const available = 2 * Math.min(centerY - surface.minY, surface.maxY - centerY);
      let height = Math.min(available * 0.68, surface.radius * 0.9 / this.maskAspect);
      let span = height * this.maskAspect / surface.radius;
      for (let attempt = 0; attempt < 5 && height >= 0.08; attempt++) {
        const points: Vector3[] = [];
        let continuous = true;
        for (let step = 0; step <= 8; step++) {
          const angle = surface.angle + span * (step / 8 - 0.5);
          const hit = this.probe(surface, angle, centerY);
          if (!hit || !this.probe(surface, angle, centerY - height * 0.4) || !this.probe(surface, angle, centerY + height * 0.4)) { continuous = false; break; }
          points.push(hit);
        }
        if (continuous && points.length === 9) {
          const radii = points.map(point => Math.hypot(point.x, point.z));
          const radius = radii[4];
          const tolerance = Math.max(surface.radius * 0.018, ...radii.map(value => Math.abs(value - radius) + available * 0.12));
          return { ...surface, centerY, radius, span, height, tolerance, points };
        }
        height *= 0.75; span *= 0.75;
      }
    }
  }

  apply(root: any, config: RingEngravingConfig | null): "idle" | "ready" | "unavailable" {
    if (this.active && root === this.root && config?.text === this.config?.text && config?.position === this.config?.position) {
      let intact = true;
      root.traverse((mesh: any) => {
        if (!mesh.isMesh || isDiamondMesh(mesh)) return;
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if (material?.registerMaterialExtensions && this.installed.get(material)?.root !== root) intact = false;
        }
      });
      if (intact) return "ready";
    }
    for (const state of this.states) state.surface.value.w = 0;
    this.revision++;
    this.active = false;
    this.root = root;
    if (!config || !root) { this.config = null; this.layout = undefined; return "idle"; }
    const text = normalizeEngravingText(config.text);
    this.createMask(text);
    this.config = { ...config, text };
    const surface = this.surfaceFor(root, config.position);
    this.layout = surface && this.createLayout(surface);
    if (!this.layout) return "unavailable";
    const layout = this.layout;
    for (const old of this.states) if (old.root === root || !old.root.parent) this.states.delete(old);
    const state: RootState = {
      root,
      layout: { value: new Vector4(layout.angle, layout.span, layout.height, layout.centerY) },
      surface: { value: new Vector4(layout.radius, layout.tolerance, 0, 1) },
      meshToBand: { value: new Matrix4() }, normalToBand: { value: new Matrix3() },
    };
    // A material can be shared by several pieces within the same band.
    // Refresh its uniforms per draw so the mark follows every staged pose.
    const visited = new Set<object>();
    root.traverse((mesh: any) => {
      if (!mesh.isMesh || isDiamondMesh(mesh)) return;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (!material?.registerMaterialExtensions || visited.has(material)) continue;
        visited.add(material);
        const previous = this.installed.get(material);
        if (previous) material.unregisterMaterialExtensions?.([previous.extension]);
        const extension: MaterialExtension = {
          customCacheKey: KEY + this.channel,
          isCompatible: () => true,
          extraUniforms: Object.fromEntries(Object.entries({
            uRingEngravingMask: this.mask, uRingEngravingLayout: state.layout, uRingEngravingSurface: state.surface,
            uRingEngravingMeshToBand: state.meshToBand, uRingEngravingNormalToBand: state.normalToBand,
          }).map(([name, value]) => [name + this.channel, value])),
          onObjectRender: (object: any) => {
            state.meshToBand.value.copy(root.matrixWorld).invert().multiply(object.matrixWorld);
            state.normalToBand.value.getNormalMatrix(state.meshToBand.value);
            const scale = new Vector3().setFromMatrixScale(root.matrixWorld).x;
            state.surface.value.z = Math.min(layout.height * 0.065, (layout.maxY - layout.minY) * 0.035) * scale;
            material.uniformsNeedUpdate = true;
          },
          shaderExtender: shader => {
            if (shader.fragmentShader.includes(`float ringEngravingCoverage${this.channel}()`)) return;
            const names = /\b(?:uRingEngraving\w*|vRingEngraving\w*|ringEngraving\w*|engraving(?:Q0|Q1|R1|R2|Det|Height|Gradient))\b/g;
            const suffix = (source: string) => source.replace(names, name => name + this.channel);
            // Only rename this extension's additions, leaving the other two
            // inscriptions and the dissolve extension untouched.
            shader.vertexShader = shader.vertexShader.replace(MAIN, suffix(`uniform mat4 uRingEngravingMeshToBand;\nuniform mat3 uRingEngravingNormalToBand;\nvarying vec3 vRingEngravingPosition;\nvarying vec3 vRingEngravingNormal;\n$&\n vRingEngravingPosition=(uRingEngravingMeshToBand*vec4(position,1.0)).xyz;\n vRingEngravingNormal=normalize(uRingEngravingNormalToBand*normal);`));
            shader.fragmentShader = shader.fragmentShader.replace(MAIN, `${suffix(FRAGMENT)}\n$&`)
              .replace("#include <color_fragment>", "#include <color_fragment>" + suffix("\n float ringEngravingInk=ringEngravingCoverage();\n diffuseColor.rgb*=1.0-0.55*ringEngravingInk;"))
              .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>" + suffix("\n roughnessFactor=mix(roughnessFactor,max(roughnessFactor,0.4),ringEngravingInk);"))
              .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>" + suffix(`
                vec3 engravingQ0=dFdx(-vViewPosition), engravingQ1=dFdy(-vViewPosition);
                vec3 engravingR1=cross(engravingQ1,normal), engravingR2=cross(normal,engravingQ0);
                float engravingDet=dot(engravingQ0,engravingR1);
                float engravingHeight=-ringEngravingInk*uRingEngravingSurface.z;
                vec3 engravingGradient=sign(engravingDet)*(dFdx(engravingHeight)*engravingR1+dFdy(engravingHeight)*engravingR2);
                normal=normalize(abs(engravingDet)*normal-engravingGradient);
              `));
          },
        };
        material.registerMaterialExtensions([extension]);
        material.needsUpdate = true;
        this.installed.set(material, { root, extension });
      }
    });
    this.states.add(state);
    // Discard uniform state for bands no longer attached to the viewer.
    for (const old of this.states) if (old.root !== root && !old.root.parent) this.states.delete(old);
    this.active = true;
    return "ready";
  }

  cameraPose(camera: any): RingCameraPose | undefined {
    const layout = this.layout;
    if (!this.active || !layout || !this.root) return;
    this.root.updateWorldMatrix(true, true);
    const frame = this.root.matrixWorld;
    const target = new Vector3(Math.sin(layout.angle) * layout.radius, layout.centerY, -Math.cos(layout.angle) * layout.radius).applyMatrix4(frame);
    const direction = new Vector3(-Math.sin(layout.angle), 0.55, Math.cos(layout.angle)).transformDirection(frame);
    const up = new Vector3(0, 1, 0).transformDirection(frame);
    const points: Vector3[] = [];
    const span = Math.max(1.55, layout.span * 1.6);
    for (let step = 0; step <= 16; step++) for (const side of [-1, 1]) {
      const angle = layout.angle + span * (step / 16 - .5);
      points.push(new Vector3(Math.sin(angle) * layout.radius, layout.centerY + side * (layout.maxY - layout.minY) * .75, -Math.cos(angle) * layout.radius).applyMatrix4(frame));
    }
    return fitCameraToPoints(points, target, direction, up, camera, { padding: 1.4 });
  }

  dispose() {
    for (const state of this.states) state.surface.value.w = 0;
    this.states.clear();
    this.texture?.dispose();
    this.texture = undefined;
    this.mask.value = null;
    this.active = false;
  }
}

/** Independent masks/uniforms let three inscriptions share the same metal. */
export class MultiRingEngraving {
  active = false;
  revision = 0;
  unavailable: EngravingPosition[] = [];
  private inscriptions = new Map(ENGRAVING_POSITIONS.map(position => [position.id, new RingEngraving(position.id)]));
  private applied: RingEngravingConfig[] = [];
  matches(config: RingEngravingConfig[]) {
    return this.active && JSON.stringify(config) === JSON.stringify(this.applied);
  }
  apply(root: any, config: RingEngravingConfig[]) {
    this.unavailable = [];
    let changed = false;
    for (const [position, renderer] of this.inscriptions) {
      const inscription = config.find(item => item.position === position) ?? null;
      const revision = renderer.revision;
      const status = renderer.apply(root, inscription);
      if (inscription && status === "unavailable") this.unavailable.push(position);
      if (revision !== renderer.revision && (inscription || renderer.active)) changed = true;
    }
    if (changed || JSON.stringify(config) !== JSON.stringify(this.applied)) this.revision++;
    this.applied = config.map(item => ({ ...item }));
    this.active = [...this.inscriptions.values()].some(renderer => renderer.active);
    return !config.length ? "idle" as const : this.active ? "ready" as const : "unavailable" as const;
  }
  cameraPose(camera: any, position?: EngravingPosition) {
    return this.inscriptions.get(position ?? this.applied[0]?.position)?.cameraPose(camera);
  }
  dispose() { this.inscriptions.forEach(renderer => renderer.dispose()); this.active = false; }
}
