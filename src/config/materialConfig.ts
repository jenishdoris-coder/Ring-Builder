import type { Object3D } from "webgi";

// =============================================================================
// ENVIRONMENT MAP
// =============================================================================
export const ENV_MAP_ROTATION = 15 * Math.PI / 180;

// =============================================================================
// DIAMOND MESH IDENTIFICATION — DiamondPlugin keywords / exact names
// =============================================================================
export const DIAMOND_MESH_KEYWORDS = ["stone"] as const;

export const DIAMOND_MESH_EXACT_NAMES = [
  "gem 01",
  "gem 02",
  "gem 03",
  "heart",
  "center stone",
  "main stone",
  "side stone",
  "shank stone",
  "shank_round",
  "diamond_round_1",
  "diamond_round_2",
  "diamond_round_3",
  "diamond_round_4",
  "diamond_round_5",
] as const;

// =============================================================================
// DIAMOND — plugin + per-stone bake (edit values below)
// =============================================================================
export const DIAMOND_GEM = {
  normalMapRes: 512,
  dispersion: 0.001,
  ior: 2.4,
  rayBounces: 4,
  envMapIntensity: 1.6,
  reflectivity: 0.46,
  transmission: 0,
  renderOrder: 10,
  gammaFactor: 1.1,
  boostFactors: [1.6, 1.6, 1.6] as [number, number, number],
};

export function applyDiamondShaderProps(mat: any) {
  const matCfg = buildDiamondPluginAddOptions().materialConfig;
  mat.rayBounces = DIAMOND_GEM.rayBounces;
  if ("refractiveIndex" in mat) mat.refractiveIndex = matCfg.refractiveIndex;
  if ("ior" in mat) mat.ior = DIAMOND_GEM.ior;
  if ("dispersion" in mat) mat.dispersion = matCfg.dispersion;
  if ("envMapIntensity" in mat) mat.envMapIntensity = matCfg.envMapIntensity;
  if ("envMapRotationOffset" in mat) mat.envMapRotationOffset = ENV_MAP_ROTATION;
  if ("reflectivity" in mat) mat.reflectivity = matCfg.reflectivity;
  if ("gammaFactor" in mat) mat.gammaFactor = DIAMOND_GEM.gammaFactor;
  if ("boostFactors" in mat) {
    mat.boostFactors = [...DIAMOND_GEM.boostFactors];
  }
  if ("roughness" in mat) mat.roughness = 0;
  mat.userData = {
    ...mat.userData,
    ssreflDisabled: true,
    // Transparent stones must not cast the opaque screen-space occlusion of
    // a solid metal object onto the setting beside the centre diamond.
    ssaoCastDisabled: true,
    ssaoDisabled: true,
    sscsDisabled: true,
    Bloom: { enable: false },
  };
  mat.setDirty?.();
  mat.needsUpdate = true;
}

export const getDiamondRefractionMaxBounces = () => DIAMOND_GEM.rayBounces;

export function buildDiamondPluginAddOptions() {
  return {
    prepareConfig: { normalMapRes: DIAMOND_GEM.normalMapRes },
    materialConfig: {
      envMapIntensity: DIAMOND_GEM.envMapIntensity,
      dispersion: DIAMOND_GEM.dispersion,
      transmission: DIAMOND_GEM.transmission,
      refractiveIndex: DIAMOND_GEM.ior,
      rayBounces: DIAMOND_GEM.rayBounces,
      squashFactor: 1,
      geometryFactor: 1,
      gammaFactor: DIAMOND_GEM.gammaFactor,
      absorptionFactor: 1,
      reflectivity: DIAMOND_GEM.reflectivity,
      boostFactors: DIAMOND_GEM.boostFactors,
      envMapRotation: ENV_MAP_ROTATION,
      envMapRotationOffset: ENV_MAP_ROTATION,
      diamondOrientedEnvMap: 0,
      color: "#ffffff",
    },
    mobileTuning: {
      enabled: true,
      maxNormalMapRes: 300,
      rayBounces: DIAMOND_GEM.rayBounces,
      dispersion: 0,
      minEnvMapIntensity: 2.2,
      fallbackEnvMapIntensity: 2.5,
      transmission: DIAMOND_GEM.transmission,
    },
    pluginConfig: { forceSceneEnvMap: false, envMapRotation: ENV_MAP_ROTATION },
  };
}

export const DIAMOND_PLUGIN_RUNTIME = {
  normalMapRes: DIAMOND_GEM.normalMapRes,
  rayBounces: DIAMOND_GEM.rayBounces,
  dispersion: DIAMOND_GEM.dispersion,
};

export function syncDiamondPluginFromConfig(diamondPlugin: any) {
  if (!diamondPlugin) return;
  const opts = buildDiamondPluginAddOptions();

  diamondPlugin.autoRefresh = false;
  diamondPlugin.keywords = [...DIAMOND_MESH_KEYWORDS];
  diamondPlugin.exactNames = [...DIAMOND_MESH_EXACT_NAMES];
  diamondPlugin.forceSceneEnvMap = false;
  if (!diamondPlugin.config) diamondPlugin.config = {};
  diamondPlugin.config.normalMapRes = DIAMOND_PLUGIN_RUNTIME.normalMapRes;
  diamondPlugin.config.rayBounces = DIAMOND_PLUGIN_RUNTIME.rayBounces;
  diamondPlugin.config.dispersion = DIAMOND_PLUGIN_RUNTIME.dispersion;

  diamondPlugin.materialConfig = {
    ...diamondPlugin.materialConfig,
    ...opts.materialConfig,
  };
  diamondPlugin.prepareConfig = opts.prepareConfig;
  diamondPlugin.mobileTuning = opts.mobileTuning;
  if (diamondPlugin.config?.forceSceneEnvMap != null) {
    diamondPlugin.config.forceSceneEnvMap = false;
    diamondPlugin.config.envMapRotation = opts.pluginConfig.envMapRotation;
  }

  if (diamondPlugin.pass && "rayBounces" in diamondPlugin.pass) {
    diamondPlugin.pass.rayBounces = DIAMOND_GEM.rayBounces;
  }
  if (diamondPlugin.materialPass?.parameters) {
    const params = diamondPlugin.materialPass.parameters;
    if ("rayBounces" in params) params.rayBounces = DIAMOND_GEM.rayBounces;
    if ("gammaFactor" in params) params.gammaFactor = DIAMOND_GEM.gammaFactor;
    if ("boostFactors" in params)
      params.boostFactors = DIAMOND_GEM.boostFactors;
  }

  diamondPlugin.refreshEnvMaps?.();
  diamondPlugin.setDirty?.();
}

export function applyDiamondMaterialRuntimeSettings(root: Object3D) {
  root.traverse((child: any) => {
    if (!child.isMesh || !child.material) return;
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];

    materials.forEach((mat: any) => {
      if (!mat?.userData?.__isDiamond) return;
      applyDiamondShaderProps(mat);
    });
  });
}

export function syncRefractionPassRayBounces(viewer: {
  renderer?: {
    pipeline?: { refractionPlugin?: { pass?: { maxBounces?: number } } };
  };
}) {
  const maxBounces = getDiamondRefractionMaxBounces();
  const pass = viewer.renderer?.pipeline?.refractionPlugin?.pass;
  if (pass) pass.maxBounces = maxBounces;
}

export function getDiamondBakeConfig(cacheKey: string) {
  return {
    cacheKey,
    normalMapRes: DIAMOND_GEM.normalMapRes,
    dispersion: DIAMOND_GEM.dispersion,
    ior: DIAMOND_GEM.ior,
    rayBounces: DIAMOND_GEM.rayBounces,
    refractiveIndex: DIAMOND_GEM.ior,
    gammaFactor: DIAMOND_GEM.gammaFactor,
    boostFactors: DIAMOND_GEM.boostFactors,
  };
}
