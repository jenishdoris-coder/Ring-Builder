export interface ComponentPrice {
  mode: "weights" | "fixed";
  goldGrams?: number;
  diamondCarats?: number;
  fixedPrice?: number;
  metalPrices?: Record<string, number>;
}
export interface PublicPricing { enabled: boolean; currency: string; sizeSystem: PricingConfig["sizeSystem"]; sizes: string[]; defaultSize: string; }
export interface PricingConfig {
  enabled: boolean;
  currency: string;
  multiplier: number;
  diamondPerCarat?: number;
  accentDiamondPerCarat?: number;
  metalRates: Record<string, { perGram?: number; finishCharge?: number }>;
  centerRates: Record<string, number>;
  heads: Record<string, ComponentPrice>;
  bands: Record<string, ComponentPrice>;
  sizeSystem: "US" | "India" | "UK" | "EU" | "Custom";
  sizes: string[];
  defaultSize: string;
}
export interface PriceSelection { shapeId: string; carat: number; headStyleId: string; bandId: string; headMetalId: string; bandMetalId: string; size: string; }
export interface PriceQuote { total: number | null; subtotal: number; multiplier: number; currency: string; issues: string[]; lines: { label: string; amount: number; detail?: string }[]; goldGrams: number; diamondCarats: number; }
