export const METAL_COLORS_SRGB = {
  yellow_gold: "#E3BB5E",
  white_gold: "#C2C2C3",
  rose_gold: "#D9A483",
} as const;

const normalizeMetalHex = (hex: string) => {
  const trimmed = hex.trim();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return withHash.toLowerCase();
};

const METAL_SRGB_HEX_ALIASES: Record<string, string> = {
  "#e3bb5e": METAL_COLORS_SRGB.yellow_gold,
  "#e3c588": METAL_COLORS_SRGB.yellow_gold,
  "#d9a483": METAL_COLORS_SRGB.rose_gold,
  "#e5b095": METAL_COLORS_SRGB.rose_gold,
  "#c2c2c3": METAL_COLORS_SRGB.white_gold,
  "#dadada": METAL_COLORS_SRGB.white_gold,
  "#ffffff": METAL_COLORS_SRGB.white_gold,
  "#eeeeee": METAL_COLORS_SRGB.white_gold,
};

export const resolveMetalColorHexSrgb = (hex: string) => {
  const normalized = normalizeMetalHex(hex);
  if (METAL_SRGB_HEX_ALIASES[normalized]) {
    return METAL_SRGB_HEX_ALIASES[normalized];
  }
  const body = normalized.slice(1);
  return `#${body.toUpperCase()}`;
};

export const isWhiteGoldSrgb = (hex: string) =>
  resolveMetalColorHexSrgb(hex).toLowerCase() ===
  METAL_COLORS_SRGB.white_gold.toLowerCase();

export const isYellowGoldSrgb = (hex: string) =>
  resolveMetalColorHexSrgb(hex).toLowerCase() ===
  METAL_COLORS_SRGB.yellow_gold.toLowerCase();

export const isRoseGoldSrgb = (hex: string) =>
  resolveMetalColorHexSrgb(hex).toLowerCase() ===
  METAL_COLORS_SRGB.rose_gold.toLowerCase();

/** WebGI 0.7.6+ / Three r152+: ColorManagement already maps sRGB hex → linear storage. */
export const hexSrgbToMetalColor = (ColorCtor: any, hex: string) => {
  const srgbHex = resolveMetalColorHexSrgb(hex);
  return new ColorCtor(srgbHex);
};

export const getMetalRoughness = (hex: string) => {
  if (isWhiteGoldSrgb(hex)) return 0.05;
  if (isYellowGoldSrgb(hex)) return 0.12;
  if (isRoseGoldSrgb(hex)) return 0.1;
  return 0.1;
};
