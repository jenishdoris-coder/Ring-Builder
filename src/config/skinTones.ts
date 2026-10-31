export const SKIN_TONE_STOPS = [
  { value: 0, hex: "#F2D6C7" }, { value: 20, hex: "#DFB59C" },
  { value: 40, hex: "#C89373" }, { value: 60, hex: "#A96F4F" },
  { value: 80, hex: "#7D4B34" }, { value: 100, hex: "#4A2A20" },
] as const;
// A slightly deeper warm tone under the bright jewellery studio lighting.
export const DEFAULT_SKIN_TONE = 45;
export const SKIN_TONE_GRADIENT = `linear-gradient(to bottom in srgb, ${SKIN_TONE_STOPS.map(stop => `${stop.hex} ${stop.value}%`).join(", ")})`;

export const getSkinToneHex = (value: number) => {
  const amount = Math.max(0, Math.min(100, value));
  const upper = SKIN_TONE_STOPS.findIndex(stop => stop.value >= amount);
  if (upper <= 0) return SKIN_TONE_STOPS[0].hex;
  const a = SKIN_TONE_STOPS[upper - 1], b = SKIN_TONE_STOPS[upper];
  const fraction = (amount - a.value) / (b.value - a.value);
  const channels = [1, 3, 5].map(index => Math.round(parseInt(a.hex.slice(index, index + 2), 16) * (1 - fraction) + parseInt(b.hex.slice(index, index + 2), 16) * fraction));
  return `#${channels.map(channel => channel.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
};

export const getSkinToneLinear = (value: number) => {
  const hex = getSkinToneHex(value);
  return [1, 3, 5].map(index => {
    const channel = parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
};
