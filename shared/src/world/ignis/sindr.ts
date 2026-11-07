import data from './sindr.json' with { type: 'json' };

export interface SindrAnchor {
  id: string; kind: string; name: string;
  x: number; y: number; z: number; yaw: number; reach: number;
  merchant?: string | null;
  institution?: string;
  door?: { x: number; z: number };
  path?: Array<{ x: number; y: number; z: number }>;
}

export const SINDR_MANIFEST = data;
export const SINDR_ANCHORS: SindrAnchor[] = data.anchors;
