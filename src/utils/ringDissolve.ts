import { Box3, Matrix4, Vector3, type MaterialExtension } from "webgi";
import { RING_DISSOLVE } from "../config/animationConfig";

type DissolveState = {
  progress: { value: number };
  worldToPattern: { value: Matrix4 };
  normalization: Matrix4;
  root: any;
};

export type RingDissolveTransition = {
  finished: Promise<boolean>;
  cancel: () => void;
};

const states = new WeakMap<object, DissolveState>();
const meshStates = new WeakMap<object, DissolveState>();
const materialExtensions = new WeakMap<object, MaterialExtension>();
const depthExtensions = new WeakSet<object>();
const EXTENSION_KEY = "ring-part-dissolve-v1";
const MAIN = /void\s+main\s*\(\s*\)\s*\{/;

// Coarse, continuous 3D noise removes curved sections of the actual geometry.
// It stays attached to the ring when the camera moves and keeps metal and gems
// fully shaded; there is no transparent crossfade or screen-space pixel noise.
const FRAGMENT_PARS = `
uniform float uRingDissolveProgress;
varying vec3 vRingDissolvePosition;
float ringDissolveHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.13, 0.27, 0.43));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float ringDissolveNoise(vec3 p) {
  vec3 cell = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(ringDissolveHash(cell), ringDissolveHash(cell + vec3(1,0,0)), f.x),
        mix(ringDissolveHash(cell + vec3(0,1,0)), ringDissolveHash(cell + vec3(1,1,0)), f.x), f.y),
    mix(mix(ringDissolveHash(cell + vec3(0,0,1)), ringDissolveHash(cell + vec3(1,0,1)), f.x),
        mix(ringDissolveHash(cell + vec3(0,1,1)), ringDissolveHash(cell + vec3(1,1,1)), f.x), f.y), f.z);
}
`;

const FRAGMENT_MAIN = `
  if (uRingDissolveProgress > 0.0) {
    vec3 p = vRingDissolvePosition * ${RING_DISSOLVE.noiseScale.toFixed(1)} + vec3(2.7, 5.1, 1.3);
    float pattern = 0.85 * ringDissolveNoise(p) + 0.15 * ringDissolveNoise(p * 2.1);
    pattern = smoothstep(0.15, 0.85, pattern);
    if (uRingDissolveProgress >= 1.0 || pattern < uRingDissolveProgress) discard;
  }
`;

const makeExtension = (state: Pick<DissolveState, "progress" | "worldToPattern">): MaterialExtension => ({
  customCacheKey: EXTENSION_KEY,
  isCompatible: () => true,
  extraUniforms: {
    uRingDissolveProgress: state.progress,
    uRingDissolveWorldToPattern: state.worldToPattern,
  },
  shaderExtender: (shader) => {
    // WebGI can pass an already extended shader during a rebuild or hot reload.
    if (!shader.vertexShader.includes("varying vec3 vRingDissolvePosition;")) {
      shader.vertexShader = shader.vertexShader.replace(
        MAIN,
        `uniform mat4 uRingDissolveWorldToPattern;
       varying vec3 vRingDissolvePosition;
       $&
       vRingDissolvePosition = (uRingDissolveWorldToPattern * modelMatrix * vec4(position, 1.0)).xyz;`,
      );
    }
    if (!shader.fragmentShader.includes("uniform float uRingDissolveProgress;")) {
      shader.fragmentShader = shader.fragmentShader.replace(
        MAIN,
        `${FRAGMENT_PARS}\n$&\n${FRAGMENT_MAIN}`,
      );
    }
  },
});

const installExtension = (material: any, extension: MaterialExtension) => {
  // Material extensions can survive a clone or a development hot reload.
  if (material.materialExtensions) {
    material.materialExtensions = material.materialExtensions.filter(
      (candidate: MaterialExtension) => candidate.customCacheKey !== EXTENSION_KEY,
    );
  }
  material.registerMaterialExtensions([extension]);
  material.needsUpdate = true;
};

const updatePatternTransform = (state: DissolveState) => {
  state.worldToPattern.value.copy(state.root.matrixWorld).invert();
  state.worldToPattern.value.premultiply(state.normalization);
};

/** Install once per display material, after WebGI has baked the diamonds. */
export const prepareRingDissolve = (root: any): DissolveState => {
  let state = states.get(root);
  if (!state) {
    root.updateWorldMatrix(true, true);
    const inverse = root.matrixWorld.clone().invert();
    const bounds = new Box3();
    root.traverse((mesh: any) => {
      if (!mesh.isMesh || !mesh.geometry) return;
      mesh.geometry.computeBoundingBox();
      const localMatrix = new Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
      bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(localMatrix));
    });
    if (bounds.isEmpty()) bounds.set(new Vector3(), new Vector3(1, 1, 1));
    const size = bounds.getSize(new Vector3());
    // Uniform scale keeps the holes round on thin prongs and wide shanks alike.
    const extent = Math.max(size.x, size.y, size.z, 0.0001);
    const normalization = new Matrix4().makeScale(1 / extent, 1 / extent, 1 / extent);
    normalization.multiply(new Matrix4().makeTranslation(-bounds.min.x, -bounds.min.y, -bounds.min.z));
    state = {
      progress: { value: 0 },
      worldToPattern: { value: new Matrix4() },
      normalization,
      root,
    };
    states.set(root, state);
  }
  updatePatternTransform(state);
  const partState = state;

  root.traverse((mesh: any) => {
    if (!mesh.isMesh) return;
    meshStates.set(mesh, partState);
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material: any) => {
      if (!material?.registerMaterialExtensions || materialExtensions.has(material)) return;
      const extension = makeExtension(partState);
      // Also covers diamonds, whose material uses a custom refraction shader.
      extension.onObjectRender = () => updatePatternTransform(partState);
      installExtension(material, extension);
      materialExtensions.set(material, extension);
    });
  });
  return state;
};

/** Match the depth pass to the visible holes, avoiding solid depth silhouettes. */
const prepareDepthDissolve = (material: any) => {
  if (!material?.registerMaterialExtensions || depthExtensions.has(material)) return;
  const uniforms = {
    progress: { value: 0 },
    worldToPattern: { value: new Matrix4() },
  };
  const extension = makeExtension(uniforms);
  extension.onObjectRender = (object) => {
    const state = meshStates.get(object);
    uniforms.progress.value = state?.progress.value ?? 0;
    if (state) {
      updatePatternTransform(state);
      uniforms.worldToPattern.value.copy(state.worldToPattern.value);
    }
    material.uniformsNeedUpdate = true;
  };
  installExtension(material, extension);
  depthExtensions.add(material);
};

const smoothstep = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

/** Dissolve old GLTF surfaces, swap in the gap, then reveal the new surfaces. */
export const animateRingDissolve = (options: {
  outgoing: any[];
  incoming: any[];
  depthMaterial?: any;
  onSwap: () => void;
  onUpdate: () => void;
  onVisibilityChange?: (visibility: number) => void;
  onPhaseChange?: (phase: "dissolving" | "revealing") => void;
  reducedMotion?: boolean;
}): RingDissolveTransition => {
  if (options.reducedMotion) {
    options.onSwap();
    options.onVisibilityChange?.(1);
    options.onUpdate();
    return { finished: Promise.resolve(true), cancel: () => {} };
  }

  const outgoing = options.outgoing.filter(Boolean).map(prepareRingDissolve);
  const incoming = options.incoming.filter(Boolean).map(prepareRingDissolve);
  prepareDepthDissolve(options.depthMaterial);
  outgoing.forEach((state) => { state.progress.value = 0; });
  // Unchanged parts participate in both halves of the whole-ring transition.
  // Keep them visible until the outgoing dissolve reaches the swap point.
  const outgoingStates = new Set(outgoing);
  incoming.forEach((state) => {
    if (!outgoingStates.has(state)) state.progress.value = 1;
  });

  let resolveFinished: (completed: boolean) => void;
  let rejectFinished: (error: unknown) => void;
  const finished = new Promise<boolean>((resolve, reject) => {
    resolveFinished = resolve;
    rejectFinished = reject;
  });
  let frame = 0;
  let start: number | undefined;
  let swapped = false;
  let settled = false;
  const finish = (completed: boolean, error?: unknown) => {
    if (settled) return;
    settled = true;
    cancelAnimationFrame(frame);
    [...outgoing, ...incoming].forEach((state) => { state.progress.value = 0; });
    options.onVisibilityChange?.(1);
    options.onUpdate();
    if (error !== undefined) rejectFinished(error);
    else resolveFinished(completed);
  };
  const tick = (now: number) => {
    if (settled) return;
    start ??= now;
    const elapsed = (now - start) / 1000;
    const revealStart = RING_DISSOLVE.dissolveDuration + RING_DISSOLVE.pauseDuration;
    try {
      if (!swapped) {
        const progress = smoothstep(elapsed / RING_DISSOLVE.dissolveDuration);
        outgoing.forEach((state) => {
          state.progress.value = progress;
        });
        options.onVisibilityChange?.(1 - progress);
        if (elapsed >= revealStart) {
          swapped = true;
          options.onSwap();
          options.onPhaseChange?.("revealing");
        }
      }
      if (swapped) {
        const visibility = smoothstep((elapsed - revealStart) / RING_DISSOLVE.revealDuration);
        incoming.forEach((state) => {
          state.progress.value = 1 - visibility;
        });
        options.onVisibilityChange?.(visibility);
      }
      options.onUpdate();
      if (elapsed >= revealStart + RING_DISSOLVE.revealDuration) finish(true);
      else frame = requestAnimationFrame(tick);
    } catch (error) {
      finish(false, error);
    }
  };
  options.onVisibilityChange?.(1);
  options.onPhaseChange?.("dissolving");
  frame = requestAnimationFrame(tick);
  return { finished, cancel: () => finish(false) };
};
