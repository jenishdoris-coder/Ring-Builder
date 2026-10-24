import { SSRPlugin } from "webgi";
import { CONTACT_SHADOW_GROUND } from "../config/viewerConfig";

// ---------------------------------------------------------------------------
// Diamond environment helpers
// ---------------------------------------------------------------------------

/** WebGI: one global env on DiamondPlugin only — not per-material envMap/envMaps. */
export const refreshDiamondPluginEnvOnly = (
  diamondPlugin: any,
  diamondEnv: any,
) => {
  if (!diamondPlugin || !diamondEnv) return false;

  diamondPlugin.forceSceneEnvMap = false;
  if (diamondPlugin.config) {
    diamondPlugin.config.forceSceneEnvMap = false;
  }
  diamondPlugin.envMap = diamondEnv;
  diamondPlugin.envMap2 = diamondEnv;
  diamondPlugin.envMap3 = diamondEnv;
  diamondPlugin.refreshEnvMaps?.();
  return true;
};

// ---------------------------------------------------------------------------
// SSR plugin management
// ---------------------------------------------------------------------------

const SSR_PLUGIN_TYPE_NAMES = ["SSRPlugin", "SSReflection"] as const;

const forceDisablePluginInstance = (plugin: any) => {
  if (!plugin) return;
  plugin.enabled = false;
  const passCandidates = [
    plugin.pass,
    plugin.ssrPass,
    plugin.ssaoPass,
    plugin.ssgiPass,
    plugin.sscsPass,
    plugin.taoPass,
  ];
  for (const pass of passCandidates) {
    if (pass && "enabled" in pass) pass.enabled = false;
  }
  if (Array.isArray(plugin.passes)) {
    for (const pass of plugin.passes) {
      if (pass && "enabled" in pass) pass.enabled = false;
    }
  }
};

const collectSSRPlugins = (viewer: any) => {
  const found: any[] = [];
  const seen = new Set<any>();
  const tryAdd = (plugin: unknown) => {
    if (!plugin || seen.has(plugin)) return;
    seen.add(plugin);
    found.push(plugin);
  };

  tryAdd(viewer.getPlugin?.(SSRPlugin));
  for (const typeName of SSR_PLUGIN_TYPE_NAMES) {
    tryAdd(viewer.getPluginByType?.(typeName));
  }

  const allPlugins =
    viewer.plugins ?? viewer._plugins ?? viewer.pluginManager?.plugins;
  if (Array.isArray(allPlugins)) {
    for (const plugin of allPlugins) {
      const type = String(
        plugin?.constructor?.PluginType ??
          plugin?.type ??
          plugin?.constructor?.name ??
          "",
      );
      if (SSR_PLUGIN_TYPE_NAMES.some((disabledType) => type === disabledType)) {
        tryAdd(plugin);
      }
    }
  }

  return found;
};

export const ensureSSRDisabled = (viewer: any) => {
  for (const plugin of collectSSRPlugins(viewer)) {
    forceDisablePluginInstance(plugin);
  }
};

export const disableSSRPlugin = async (viewer: any) => {
  for (const plugin of collectSSRPlugins(viewer)) {
    forceDisablePluginInstance(plugin);
    try {
      await viewer.removePlugin?.(plugin);
    } catch (error) {
      console.warn("[RingViewer] SSR plugin could not be removed", error);
    }
  }
  ensureSSRDisabled(viewer);
};

// ---------------------------------------------------------------------------
// Animation helpers
// ---------------------------------------------------------------------------

/** Stop WebGI GLTF animation plugin from playing or auto-starting on load. */
export const disableViewerGltfAnimations = (viewer: any) => {
  const animPlugin =
    viewer?.getPluginByType?.("GLTFAnimation") ??
    viewer?.getPluginByType?.("GLTFAnimationPlugin");
  if (!animPlugin) return;

  const plugin = animPlugin as {
    enabled?: boolean;
    autoplayOnLoad?: boolean;
    autoplayOnLoadForce?: boolean;
    autoIncrementTime?: boolean;
    animateOnDrag?: boolean;
    animateOnScroll?: boolean;
    animateOnPageScroll?: boolean;
    stopAnimation?: (reset?: boolean) => void;
    resetAnimation?: () => void;
    pauseAnimation?: () => void;
  };

  plugin.autoplayOnLoad = false;
  plugin.autoplayOnLoadForce = false;
  plugin.autoIncrementTime = false;
  plugin.animateOnDrag = false;
  plugin.animateOnScroll = false;
  plugin.animateOnPageScroll = false;
  plugin.enabled = false;
  plugin.stopAnimation?.(true);
  plugin.resetAnimation?.();
  plugin.pauseAnimation?.();
};

/** Strip GLTF animation clips/mixers from a loaded model root. */
export const disableModelGltfAnimations = (root: any) => {
  if (!root) return;

  const stopNodeAnimations = (node: any) => {
    if (node?.animationMixer?.stopAllAction) {
      node.animationMixer.stopAllAction();
    }
    if (Array.isArray(node?.animations)) node.animations = [];
  };

  stopNodeAnimations(root);
  root.traverse?.((child: any) => {
    stopNodeAnimations(child);
    if (child.userData?.mixer?.stopAllAction) {
      child.userData.mixer.stopAllAction();
      delete child.userData.mixer;
    }
  });
};

// ---------------------------------------------------------------------------
// Shadow helpers
// ---------------------------------------------------------------------------

export const setSubtreeCastShadow = (root: any, cast: boolean) => {
  root?.traverse?.((child: any) => {
    if (child.isMesh) child.castShadow = cast;
  });
};

export const configureContactShadowGround = (groundPlugin: any) => {
  if (!groundPlugin) return;
  groundPlugin.enabled = true;
  groundPlugin.visible = true;
  groundPlugin.contactShadows = CONTACT_SHADOW_GROUND.contactShadows;
  groundPlugin.blurAmount = CONTACT_SHADOW_GROUND.blurAmount;
  groundPlugin.shadowScale = CONTACT_SHADOW_GROUND.shadowScale;
  groundPlugin.shadowHeight = CONTACT_SHADOW_GROUND.shadowHeight;
  groundPlugin.size = CONTACT_SHADOW_GROUND.size;
  groundPlugin.yOffset = CONTACT_SHADOW_GROUND.yOffset;
  groundPlugin.renderToDepth = CONTACT_SHADOW_GROUND.renderToDepth;
  groundPlugin.tonemapGround = CONTACT_SHADOW_GROUND.tonemapGround;
  groundPlugin.autoAdjustTransform = CONTACT_SHADOW_GROUND.autoAdjustTransform;
  if ("groundReflection" in groundPlugin) {
    groundPlugin.groundReflection = false;
  }
};

export const refreshContactShadowGround = (groundPlugin: any, viewer?: any) => {
  if (!groundPlugin) return;
  groundPlugin.refreshOptions?.();
  groundPlugin.refreshTransform?.();
  viewer?.setDirty?.();
};

/** Fade the separately rendered shadow with the ring, including cancellation. */
export const createContactShadowFade = (groundPlugin: any) => {
  const mesh = groundPlugin?.mesh?.modelObject;
  const material = groundPlugin?.material?.materialObject ?? groundPlugin?.material ?? mesh?.material;
  const originalOpacity = material?.opacity ?? 1;
  const originalVisible = mesh?.visible ?? true;
  return (visibility: number) => {
    const amount = Math.max(0, Math.min(1, visibility));
    // Fade out a little faster as most of the ring's surface disappears.
    if (material) material.opacity = originalOpacity * amount * amount;
    if (mesh) mesh.visible = originalVisible && amount > 0;
  };
};

/**
 * Freeze the ground plugin transform so scene-update events and intermediate
 * refreshTransform calls cannot reposition the ground plane.
 * Call this before parts are detached / hidden during a ring swap.
 */
export const freezeContactShadowGroundTransform = (groundPlugin: any) => {
  if (!groundPlugin) return;
  groundPlugin.enableRefreshTransform = false;
};

/**
 * Unfreeze and immediately re-trigger the ground transform.
 * Call this after the new parts are visible so the ground fits them correctly.
 */
export const unfreezeContactShadowGroundTransform = (
  groundPlugin: any,
  viewer?: any,
) => {
  if (!groundPlugin) return;
  groundPlugin.enableRefreshTransform = true;
  groundPlugin.refreshTransform?.();
  viewer?.setDirty?.();
};
