export type ThumbnailMetal = "silver" | "gold" | "rose";
export interface EnvironmentChoice { id: string; rotation: number; intensity: number; }
export interface ThumbnailChoice { mode: "preset" | "hdr"; preset: string; metal: ThumbnailMetal; environment: EnvironmentChoice; }
export interface BuilderAppearance {
  thumbnails: ThumbnailChoice;
  studio: EnvironmentChoice;
  portraits: EnvironmentChoice;
  thumbnailSet?: { signature: string; images: Record<string, string> };
}
