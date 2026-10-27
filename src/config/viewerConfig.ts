import { assetUrl } from "./assets";

export const PROGRESSIVE_PLUGIN_SAMPLES = 60;
export const DISPLAY_CANVAS_SCALING = 1.5;
export const TONEMAP_CONTRAST = 1.1;
export const TONEMAP_SATURATION = 1.05;
export const TEMPORAL_AA_ENABLED = true;
export const TEMPORAL_AA_USE_TOTAL_FRAME_COUNT = true;
export const CAMERA_FOV_MOBILE = 65;
export const CAMERA_MIN_DISTANCE_DESKTOP = 6.5;
export const CAMERA_MAX_DISTANCE_DESKTOP = 25;
export const CAMERA_MIN_DISTANCE_MOBILE = 5.5;
export const CAMERA_MAX_DISTANCE_MOBILE = 20;
export const CAMERA_AUTO_ROTATE_SPEED = 1.5;
export const ENABLE_MSAA = false;
export const BACKGROUND_COLOR = "#fafafa";
export const RING_OCCLUSION = { intensity: 0.08, radius: 0.2 };

export const CONTACT_SHADOW_GROUND = {
  contactShadows: true,
  blurAmount: 0,
  shadowScale: 1,
  shadowHeight: 2,
  size: 8,
  yOffset: 0.03,
  autoAdjustTransform: true,
  renderToDepth: true,
  tonemapGround: false,
};

// Studio source: metal_custom_env_75.exr, published under the stable asset name.
export const CUSTOM_METAL_ENV_URL = assetUrl("/metal_env.exr");
export const CUSTOM_DIAMOND_ENV_URL = assetUrl("/diamond_env.exr");
export const METAL_ENV_ROTATION = 0;

export const DIAMOND_BAKE_CONCURRENCY = 8;
export const FIRST_LOAD_DIAMOND_BAKE_CONCURRENCY = 12;

export const DIAMOND_COLOR_HEX = "#ffffff";
export const DIAMOND_COLOR_SRGB = 0xffffff;
