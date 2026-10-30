import {
  BufferAttribute,
  BufferGeometry,
  Color,
  LinearSRGBColorSpace,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

const BASE = '/assets/env/ignis/materials';

export type Surface =
  | 'basalt_cobblestone' | 'basalt_rock_face' | 'ash_cinder_ground' | 'cooled_lava_crust'
  | 'ashlar_stone_blocks' | 'charred_timber_beams' | 'blackened_rusted_iron' | 'packed_dirt_road'
  | 'roof_slates' | 'sooted_plaster';

export interface SurfaceLook {
  /** Metres covered by one repeat of the texture. */
  tile: number;
  tint?: number;
  roughness?: number;
  normalScale?: number;
}

/** Repeat size and grade per scanned surface, pushed toward black basalt and soot. */
export const LOOKS: Record<Surface, SurfaceLook> = {
  basalt_cobblestone: { tile: 2.6, tint: 0x8a8580, normalScale: 1.2 },
  basalt_rock_face: { tile: 6, tint: 0x6e6862, normalScale: 1.4 },
  ash_cinder_ground: { tile: 4, tint: 0x9a918a },
  cooled_lava_crust: { tile: 3, tint: 0x7a7470 },
  ashlar_stone_blocks: { tile: 3.2, tint: 0x9a938b, normalScale: 1.2 },
  charred_timber_beams: { tile: 2.4, tint: 0x6a5e54 },
  blackened_rusted_iron: { tile: 1.5, tint: 0x3e3632, roughness: 0.75 },
  packed_dirt_road: { tile: 4, tint: 0xb8a898 },
  roof_slates: { tile: 2.4, tint: 0xa8a2a0, normalScale: 1.3 },
  sooted_plaster: { tile: 3, tint: 0x8c8379 },
};

export class SurfaceLibrary {
  private readonly loader: KTX2Loader;
  private readonly cache = new Map<Surface, MeshStandardMaterial>();
  private readonly pending: Promise<unknown>[] = [];

  constructor(renderer: WebGLRenderer, private readonly size: '2k' | '1k',
    private readonly onMaterial: (m: MeshStandardMaterial) => void = () => {}) {
    this.loader = new KTX2Loader().setTranscoderPath('/assets/env/ignis/basis/').detectSupport(renderer);
  }

  /** A material per surface; its textures stream in after it is first used. */
  get(surface: Surface): MeshStandardMaterial {
    const known = this.cache.get(surface);
    if (known) return known;
    const look = LOOKS[surface];
    const material = new MeshStandardMaterial({ color: new Color(look.tint ?? 0xffffff), roughness: look.roughness ?? 1, metalness: 0 });
    material.normalScale = new Vector2(look.normalScale ?? 1, look.normalScale ?? 1);
    // Normals stay at 1K on every level: the 2K ones cost four times the download for detail the town camera never sees.
    const load = (map: string, srgb: boolean, apply: (t: Texture) => void): void => {
      const size = map === 'nor_uastc' ? '1k' : this.size;
      this.pending.push(this.loader.loadAsync(`${BASE}/${surface}_${map}_${size}.ktx2`).then((t) => {
        t.wrapS = t.wrapT = RepeatWrapping;
        t.colorSpace = srgb ? SRGBColorSpace : LinearSRGBColorSpace;
        t.anisotropy = 8;
        apply(t);
        material.needsUpdate = true;
      }).catch((error: unknown) => console.warn(`Texture ${surface} ${map} failed:`, error)));
    };
    load('diff', true, (t) => { material.map = t; });
    load('nor_uastc', false, (t) => { material.normalMap = t; });
    // Only iron reads the packed metal channel; stone, wood and dirt stay dielectric.
    load('arm', false, (t) => { material.aoMap = t; material.roughnessMap = t; if (surface === 'blackened_rusted_iron') { material.metalnessMap = t; material.metalness = 1; } });
    this.onMaterial(material);
    this.cache.set(surface, material);
    return material;
  }

  ready(): Promise<unknown> { return Promise.all(this.pending); }

  dispose(): void {
    for (const m of this.cache.values()) {
      m.map?.dispose(); m.normalMap?.dispose(); m.aoMap?.dispose();
      m.dispose();
    }
    this.loader.dispose();
  }
}

const n = new Vector3();
const p = new Vector3();

/**
 * Box-projected UVs from world positions, so every wall, floor and roof shows the
 * texture at its real size. Writes uv and uv1 (the AO map reads uv1).
 */
export function worldUv(geometry: BufferGeometry, tile: number): BufferGeometry {
  const pos = geometry.getAttribute('position');
  const nor = geometry.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    let u: number, v: number;
    if (ay >= ax && ay >= az) { u = p.x; v = p.z; }
    else if (ax >= az) { u = p.z * Math.sign(n.x || 1); v = p.y; }
    else { u = -p.x * Math.sign(n.z || 1); v = p.y; }
    uv[i * 2] = u / tile;
    uv[i * 2 + 1] = v / tile;
  }
  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
  geometry.setAttribute('uv1', geometry.getAttribute('uv'));
  return geometry;
}
