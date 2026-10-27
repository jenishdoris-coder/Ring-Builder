import { Box3, CanvasTexture, DoubleSide, LinearFilter, LinearMipmapLinearFilter, Matrix3, Matrix4, Raycaster, Vector3, Vector4, type MaterialExtension } from "webgi";
import { ENGRAVING_POSITIONS, normalizeEngravingText, type EngravingPosition, type RingEngravingConfig } from "../config/engraving";
import { isDiamondMesh } from "./meshUtils";
import { fitCameraToPoints, type RingCameraPose } from "./ringCameraViews";

type Surface = { root: any; metals: any[]; bounds: Box3; angle: number; centerY: number; radius: number; minY: number; maxY: number };
type Layout = Surface & { span: number; height: number; tolerance: number; points: Vector3[]; adapted: boolean };
type RootState = { root: any; layout: { value: Vector4 }; surface: { value: Vector4 }; meshToBand: { value: Matrix4 }; normalToBand: { value: Matrix3 } };
const KEY = "ring-inner-engraving-v2";
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
  private geometries = new WeakMap<object, { metals: any[]; bounds: Box3 }>();
  private strips = new WeakMap<object, Map<string, Surface[]>>();
  private probes = new WeakMap<object, Map<string, { point: Vector3; alignment: number } | null>>();

  private createMask(text: string) {
    if (this.config?.text === text && this.texture) return;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d")!;
    const font = '500 360px Georgia, "Times New Roman", serif';
    context.font = font;
    const measure = context.measureText(text);
    canvas.width = Math.max(256, Math.min(4096, 2 ** Math.ceil(Math.log2(measure.width + 128))));
    canvas.height = 512;
    context.font = font;
    context.textAlign = "center";
    context.fillStyle = "white";
    const baseline = (canvas.height + measure.actualBoundingBoxAscent - measure.actualBoundingBoxDescent) / 2;
    context.fillText(text, canvas.width / 2, baseline, canvas.width - 80);
    const texture = new CanvasTexture(canvas);
    texture.minFilter = LinearMipmapLinearFilter;
    texture.magFilter = LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 8;
    this.maskAspect = canvas.width / canvas.height;
    this.mask.value = texture;
    this.texture?.dispose();
    this.texture = texture;
  }

  private probe(surface: Pick<Surface, "root" | "metals">, theta: number, y: number, innerOnly = false) {
    let cache = this.probes.get(surface.root);
    if (!cache) { cache = new Map(); this.probes.set(surface.root, cache); }
    const key = `${theta.toFixed(8)}:${y.toFixed(8)}`;
    if (cache.has(key)) {
      const hit = cache.get(key);
      return hit && (!innerOnly || hit.alignment >= .72) ? hit.point.clone() : undefined;
    }
    if (cache.size > 8000) cache.clear();
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
        if (hit) {
          const inverse = frame.clone().invert();
          const point = hit.point.clone().applyMatrix4(inverse);
          let alignment = 1;
          if (hit.face) {
            const normalToBand = new Matrix3().getNormalMatrix(new Matrix4().multiplyMatrices(inverse, hit.object.matrixWorld));
            const normal = hit.face.normal.clone().applyMatrix3(normalToBand).normalize();
            const inward = new Vector3(-point.x, 0, -point.z).normalize();
            alignment = Math.abs(normal.dot(inward));
          }
          cache.set(key, { point, alignment });
          return !innerOnly || alignment >= .72 ? point.clone() : undefined;
        }
      }
      cache.set(key, null);
    } finally { for (const [material, side] of sides) material.side = side; }
  }

  private geometryFor(root: any) {
    const cached = this.geometries.get(root);
    if (cached) return cached;
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
    const geometry = { metals, bounds };
    this.geometries.set(root, geometry);
    return geometry;
  }

  private surfaceFor(root: any, position: RingEngravingConfig["position"]) {
    let cache = this.surfaces.get(root);
    if (!cache) { cache = new Map(); this.surfaces.set(root, cache); }
    if (cache.has(position)) return cache.get(position) ?? undefined;
    const { metals, bounds } = this.geometryFor(root);
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

  /** Test real metal and the shader's radial envelope, not only the row's centre. */
  private fitsLayout(layout: Layout, strip = false) {
    let minRadius = Infinity, maxRadius = 0;
    const check = (angle: number, y: number) => {
      const hit = this.probe(layout, angle, y, true);
      if (!hit) return false;
      const radius = Math.hypot(hit.x, hit.z);
      minRadius = Math.min(minRadius, radius); maxRadius = Math.max(maxRadius, radius);
      return Math.abs(radius - layout.radius) <= layout.tolerance * .75;
    };
    // A wide, multi-row shank can have valid metal above and below an empty gap.
    const widthSteps = strip ? 4 : 16;
    for (let step = 0; step <= widthSteps; step++) if (!check(layout.angle, layout.centerY + layout.height * .8 * (step / widthSteps - .5))) return false;
    for (let step = 0; step <= 8; step++) for (const side of [-.4, 0, .4]) {
      if (!check(layout.angle + layout.span * (step / 8 - .5), layout.centerY + layout.height * side)) return false;
    }
    return maxRadius - minRadius <= Math.min((layout.maxY - layout.minY) * .35, layout.radius * .06);
  }

  /** Fallback only: find one continuous inside strip on split/twisted shanks. */
  private innerStrips(root: any, position: EngravingPosition) {
    let cache = this.strips.get(root);
    if (!cache) { cache = new Map(); this.strips.set(root, cache); }
    if (cache.has(position)) return cache.get(position)!;
    const { metals, bounds } = this.geometryFor(root);
    const strips: Surface[] = [];
    if (!metals.length || bounds.isEmpty()) { cache.set(position, strips); return strips; }
    const requestedAngle = ENGRAVING_POSITIONS.find(item => item.id === position)!.angle;
    const width = bounds.max.y - bounds.min.y;
    for (const offset of [0, -.16, .16]) {
      const angle = requestedAngle + offset;
      const source = { root, metals };
      let first = -1, last = -1, seedRadius = 0;
      const yAt = (step: number) => bounds.min.y + width * step / 64;
      const onStrip = (y: number) => {
        const point = this.probe(source, angle, y, true);
        return point && Math.abs(Math.hypot(point.x, point.z) - seedRadius) < Math.max(width * .08, seedRadius * .025) ? point : undefined;
      };
      const finish = (outside: number) => {
        if (first < 0) return;
        const edge = (inside: number, outside: number) => {
          for (let step = 0; step < 9; step++) {
            const middle = (inside + outside) / 2;
            if (onStrip(middle)) inside = middle; else outside = middle;
          }
          return inside;
        };
        const minY = edge(yAt(first), yAt(Math.max(0, first - 1)));
        const maxY = edge(yAt(last), yAt(Math.min(64, outside)));
        const centerY = (minY + maxY) / 2;
        const hit = onStrip(centerY);
        if (hit && maxY - minY > .08) strips.push({ root, metals, bounds, angle, centerY, minY, maxY, radius: Math.hypot(hit.x, hit.z) });
        first = last = -1;
      };
      for (let step = 0; step <= 64; step++) {
        const point = this.probe(source, angle, yAt(step), true);
        const radius = point && Math.hypot(point.x, point.z);
        if (!point || (first >= 0 && Math.abs(radius! - seedRadius) >= Math.max(width * .08, seedRadius * .025))) {
          finish(step);
          if (!point) continue;
        }
        if (first < 0) { first = step; seedRadius = radius!; }
        last = step;
      }
      finish(64);
    }
    strips.sort((a, b) => Math.abs(a.angle - requestedAngle) - Math.abs(b.angle - requestedAngle) || (b.maxY - b.minY) - (a.maxY - a.minY) || Math.abs(a.centerY) - Math.abs(b.centerY));
    cache.set(position, strips);
    return strips;
  }

  private createLayout(surface: Surface, narrow = false): Layout | undefined {
    const width = surface.maxY - surface.minY;
    // Some pavé bands have open stone seats along their centre. Fit to an
    // uninterrupted strip of inner metal rather than bridging those openings.
    for (const offset of narrow ? [0, -.15, .15] : [0, -0.22, 0.22, -0.35, 0.35]) {
      const centerY = surface.centerY + width * offset;
      const available = 2 * Math.min(centerY - surface.minY, surface.maxY - centerY);
      let height = Math.min(available * 0.68, surface.radius * 0.9 / this.maskAspect);
      let span = height * this.maskAspect / surface.radius;
      for (let attempt = 0; attempt < (narrow ? 8 : 5) && height >= (narrow ? .04 : .08); attempt++) {
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
          const layout = { ...surface, centerY, radius, span, height, tolerance, points, adapted: narrow || attempt > 0 || offset !== 0 };
          if (this.fitsLayout(layout, narrow)) return layout;
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
    if (!this.layout || (this.layout.height < (this.layout.maxY - this.layout.minY) * .25 && this.layout.span < .4)) {
      const requestedAngle = ENGRAVING_POSITIONS.find(item => item.id === config.position)!.angle;
      let score = this.layout ? this.layout.height * 1.2 : 0;
      for (const strip of this.innerStrips(root, config.position)) {
        const candidate = this.createLayout(strip, true);
        const candidateScore = candidate ? candidate.height * (1 - Math.abs(candidate.angle - requestedAngle) * .3) : 0;
        if (candidate && candidateScore > score) { this.layout = candidate; score = candidateScore; }
      }
    }
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
            state.surface.value.z = Math.min(layout.height * 0.018, (layout.maxY - layout.minY) * 0.012) * scale;
            material.uniformsNeedUpdate = true;
          },
          shaderExtender: shader => {
            if (shader.fragmentShader.includes(`float ringEngravingCoverage${this.channel}()`)) return;
            const names = /\b(?:uRingEngraving\w*|vRingEngraving\w*|ringEngraving\w*|engraving(?:Q0|Q1|R1|R2|Det|Height|Gradient|Slope))\b/g;
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
                // Leave the rest of the shank's normal exactly unchanged.
                // A degenerate screen-space triangle must not normalize zero
                // or turn a distant metal seam into an engraving bevel.
                if (ringEngravingInk > 0.001 && abs(engravingDet) > 1.0e-10) {
                  vec3 engravingSlope=engravingGradient/abs(engravingDet);
                  engravingSlope*=min(1.0,0.35/max(length(engravingSlope),0.00001));
                  normal=normalize(normal-engravingSlope);
                }
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

  cameraPose(camera: any, framing: "viewer" | "photo" = "viewer"): RingCameraPose | undefined {
    const layout = this.layout;
    if (!this.active || !layout || !this.root) return;
    this.root.updateWorldMatrix(true, true);
    const frame = this.root.matrixWorld;
    const target = new Vector3(Math.sin(layout.angle) * layout.radius, layout.centerY, -Math.cos(layout.angle) * layout.radius).applyMatrix4(frame);
    const direction = new Vector3(-Math.sin(layout.angle), layout.adapted ? .2 : .55, Math.cos(layout.angle)).transformDirection(frame);
    const up = new Vector3(0, 1, 0).transformDirection(frame);
    const points: Vector3[] = [];
    const span = layout.adapted ? Math.max(.32, layout.span * 2.4) : Math.max(1.55, layout.span * 1.6);
    const frameHeight = layout.adapted ? Math.min(layout.maxY - layout.minY, layout.height * 2.8) : layout.maxY - layout.minY;
    for (let step = 0; step <= 16; step++) for (const side of [-1, 1]) {
      const angle = layout.angle + span * (step / 16 - .5);
      points.push(new Vector3(Math.sin(angle) * layout.radius, layout.centerY + side * frameHeight * .75, -Math.cos(angle) * layout.radius).applyMatrix4(frame));
    }
    // Photos show a continuous inner-band detail across the tile, rather than
    // fitting a distant arc whose ends look like a severed strip of metal.
    return fitCameraToPoints(points, target, direction, up, camera, { padding: framing === "photo" ? .95 : 1.4 });
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
  cameraPose(camera: any, position?: EngravingPosition, framing: "viewer" | "photo" = "viewer") {
    return this.inscriptions.get(position ?? this.applied[0]?.position)?.cameraPose(camera, framing);
  }
  dispose() { this.inscriptions.forEach(renderer => renderer.dispose()); this.active = false; }
}
