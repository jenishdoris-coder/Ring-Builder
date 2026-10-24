export type PartLoadType = "head" | "shank" | "band";

export type PartMeshCaches = {
  head: Map<string, any[]>;
  shank: Map<string, any[]>;
  band: Map<string, any[]>;
};

export type RingPartData = {
  file: string | null;
  scale?: number;
  posZ?: number;
  name?: string;
};

export type RingRotation = {
  x: number;
  y: number;
  z: number;
};
