import type { PricingConfig, PublicPricing } from "./pricing";
export interface CaratOption { carat: number; label: string; file: string; filename: string; thumbnail?: string; enabled?: boolean; styleId?: string; }
export interface HeadStyle { id: string; name: string; enabled?: boolean; }
export interface DiamondShape { id: string; name: string; folder: string; carats: CaratOption[]; image?: string; enabled?: boolean; }
export interface ShankOption { id: string; name: string; rawName: string; file: string; category: string; thumbnail?: string; enabled?: boolean; }
export interface MetalOption { id: string; name: string; hexCode: string; previewColor: string; gradient: string; description: string; enabled?: boolean; }
export interface RingDefaults { shapeId: string; carat: number; shankId: string; metalId: string; headScale: number; shankScale: number; headStyleId?: string; }
export interface RingCatalog {
  schemaVersion: number; releaseId: string; assetBaseUrl: string;
  shapes: DiamondShape[]; shanks: ShankOption[]; metals: MetalOption[]; defaults: RingDefaults;
  headStyles?: HeadStyle[];
  pricing?: PricingConfig;
  pricingPublic?: PublicPricing;
  previewSource?: "draft" | "published";
}
