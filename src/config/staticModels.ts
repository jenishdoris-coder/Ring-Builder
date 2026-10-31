import source from "./catalog.json";
import deployment from "./deployment.json";
import { assetUrl } from "./assets";
import type { DiamondShape, ShankOption, MetalOption, RingCatalog } from "../types/catalog";
export type { CaratOption, DiamondShape, ShankOption, MetalOption } from "../types/catalog";

export const STATIC_DIAMOND_SHAPES: DiamondShape[] = source.shapes.map(shape => ({ ...shape, carats: shape.carats.map(carat => ({ ...carat, file: assetUrl(carat.file) })) }));
export const STATIC_SHANKS: ShankOption[] = source.shanks.map(shank => ({ ...shank, file: assetUrl(shank.file) }));
export const STATIC_METALS: MetalOption[] = source.metals;
export const DEFAULT_RING_CONFIG = source.defaults;
/** Start new customer designs in yellow gold when the catalog offers it. */
export const getDefaultMetalId = (catalog: RingCatalog) => catalog.metals.find(metal => metal.id === "yellow_gold")?.id ?? catalog.defaults.metalId;
export const BOOTSTRAP_CATALOG: RingCatalog = { schemaVersion: 1, releaseId: deployment.releaseId, assetBaseUrl: deployment.assetBaseUrl, shapes: STATIC_DIAMOND_SHAPES, shanks: STATIC_SHANKS, metals: STATIC_METALS, defaults: DEFAULT_RING_CONFIG };
