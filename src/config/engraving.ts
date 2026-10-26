export type EngravingPosition = "bottom" | "right" | "left";
export type RingEngravingConfig = { text: string; position: EngravingPosition };
export type EngravingStatus = "idle" | "applying" | "ready" | "unavailable";
export const ENGRAVING_MAX_CHARACTERS = 24;
export const ENGRAVING_POSITIONS: { id: EngravingPosition; label: string; angle: number }[] = [
  { id: "bottom", label: "Bottom", angle: 0 },
  { id: "right", label: "Right", angle: Math.PI / 2 },
  { id: "left", label: "Left", angle: -Math.PI / 2 },
];
export const normalizeEngravingText = (text: string) => text.normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
export const engravingTextError = (text: string) => {
  const value = normalizeEngravingText(text);
  if (!value) return "Enter the text you would like inside your ring.";
  if (Array.from(value).length > ENGRAVING_MAX_CHARACTERS) return `Use up to ${ENGRAVING_MAX_CHARACTERS} characters.`;
  return "";
};
