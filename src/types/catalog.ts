export interface CaratOption { carat: number; label: string; file: string; filename: string; }
export interface DiamondShape { id: string; name: string; folder: string; carats: CaratOption[]; }
export interface ShankOption { id: string; name: string; rawName: string; file: string; category: string; }
export interface MetalOption { id: string; name: string; hexCode: string; previewColor: string; gradient: string; description: string; }
export interface RingDefaults { shapeId: string; carat: number; shankId: string; metalId: string; headScale: number; shankScale: number; }
export interface RingCatalog {
  schemaVersion: number; releaseId: string; assetBaseUrl: string;
  shapes: DiamondShape[]; shanks: ShankOption[]; metals: MetalOption[]; defaults: RingDefaults;
}
