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
  | 'roof_slates' | 'sooted_plaster'
  | 'lime_plaster' | 'red_lacquer' | 'pale_stone' | 'roof_tile_charcoal' | 'roof_tile_red' | 'gold_trim'
  | 'moss' | 'terracotta'
  | 'worn_flagstones' | 'ash_plaster' | 'dirt_verge' | 'indigo_cloth' | 'raw_timber' | 'river_cobbles';

export interface SurfaceLook {
  /** Metres covered by one repeat of the texture. */
  tile: number;
  /** Hue the scan is pushed toward; only its colour counts, not its brightness. */
  tint?: number;
  /** Linear brightness of the scan's colour map, measured from the 1K KTX2. */
  scan: number;
  /** Linear albedo the surface should end up with (dark basalt about 0.1, dry dirt about 0.16). */
  albedo: number;
  roughness?: number;
  normalScale?: number;
  /** Reuse another scan set (a surface's, or a scan no surface uses directly) under a different grade. */
  source?: Surface | 'clean_plaster';
  /** Plain metal with no scans (gold trim). */
  metal?: number;
  /** Pan-and-cover tile courses drawn over the scan: cover rows across u, courses up v, per texture repeat. */
  courses?: { rows: number; courses: number };
  /** Laid over other ground with a ragged edge: vertex alpha fades it, so it never writes depth. */
  overlay?: boolean;
}

/** Repeat size and grade per scanned surface, pushed toward black basalt and soot. */
export const LOOKS: Record<Surface, SurfaceLook> = {
  basalt_cobblestone: { tile: 2.6, tint: 0x8a8580, scan: 0.224, albedo: 0.1, normalScale: 1.2 },
  basalt_rock_face: { tile: 6, tint: 0x6e6862, scan: 0.14, albedo: 0.09, normalScale: 1.4 },
  ash_cinder_ground: { tile: 4, tint: 0x9a918a, scan: 0.094, albedo: 0.11 },
  cooled_lava_crust: { tile: 3, tint: 0x7a7470, scan: 0.095, albedo: 0.07 },
  ashlar_stone_blocks: { tile: 3.2, tint: 0x8e8c8c, scan: 0.036, albedo: 0.085, normalScale: 1.2 },
  charred_timber_beams: { tile: 2.4, tint: 0x6a5e54, scan: 0.202, albedo: 0.07 },
  blackened_rusted_iron: { tile: 1.5, tint: 0x3e3632, scan: 0.221, albedo: 0.05, roughness: 0.75 },
  packed_dirt_road: { tile: 4, tint: 0xb8a898, scan: 0.046, albedo: 0.16 },
  roof_slates: { tile: 2.4, tint: 0xa8a2a0, scan: 0.243, albedo: 0.09, normalScale: 1.3 },
  sooted_plaster: { tile: 3, tint: 0x8a8580, scan: 0.234, albedo: 0.11 },
  // The palace and temple family: lime plaster, lacquered timber, pale floor stone, curved tile roofs, gold trim.
  lime_plaster: { tile: 3.5, tint: 0xf2ebe0, scan: 0.246, albedo: 0.42, normalScale: 0.8, source: 'clean_plaster' },
  red_lacquer: { tile: 2.4, tint: 0xa3170e, scan: 0.202, albedo: 0.1, roughness: 0.55, normalScale: 0.5, source: 'charred_timber_beams' },
  pale_stone: { tile: 3.2, tint: 0xd9d2c6, scan: 0.036, albedo: 0.32, source: 'ashlar_stone_blocks' },
  roof_tile_charcoal: { tile: 2.4, tint: 0x6a6866, scan: 0.243, albedo: 0.07, normalScale: 0.6, source: 'roof_slates', courses: { rows: 8, courses: 7 } },
  roof_tile_red: { tile: 2.4, tint: 0x8c2a1e, scan: 0.243, albedo: 0.08, normalScale: 0.6, source: 'roof_slates', courses: { rows: 8, courses: 7 } },
  // Lived-on surfaces: moss and growth in damp corners, fired clay pots and planters.
  moss: { tile: 3, tint: 0x56603a, scan: 0.094, albedo: 0.055, normalScale: 1.4, source: 'ash_cinder_ground' },
  terracotta: { tile: 1.5, tint: 0x8a5e4a, scan: 0.234, albedo: 0.13, source: 'sooted_plaster' },
  // The street: big worn flagstones down the middle, rounded cobbles in bands, packed earth at the edges.
  worn_flagstones: { tile: 7, tint: 0x8c8a88, scan: 0.276, albedo: 0.13, normalScale: 1.3 },
  river_cobbles: { tile: 2.2, tint: 0x9a948c, scan: 0.224, albedo: 0.15, normalScale: 1.5, source: 'basalt_cobblestone' },
  dirt_verge: { tile: 3.5, tint: 0x8a7a6a, scan: 0.046, albedo: 0.1, source: 'packed_dirt_road', overlay: true },
  // Sindr's plaster: lime washed over and greyed by the forges' ash, never the clean white of a lowland town.
  ash_plaster: { tile: 3.5, tint: 0xd8d2c8, scan: 0.246, albedo: 0.3, normalScale: 0.8, source: 'clean_plaster' },
  indigo_cloth: { tile: 1.6, tint: 0x2c3e66, scan: 0.246, albedo: 0.06, normalScale: 0.4, source: 'clean_plaster' },
  raw_timber: { tile: 2.0, tint: 0x9a7656, scan: 0.202, albedo: 0.17, source: 'charred_timber_beams' },
  gold_trim: { tile: 1.5, tint: 0xd8a84a, scan: 1, albedo: 0.55, roughness: 0.32, metal: 1 },
};

/** Rounded cover tiles and overlapping courses, as shading and a derivative bump over the scanned base. */
function addCourses(material: MeshStandardMaterial, rows: number, courses: number): void {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        float tileShape(vec2 uv) {
          float s = fract(uv.x * ${rows.toFixed(1)}), t = fract(uv.y * ${courses.toFixed(1)});
          return sqrt(max(sin(3.14159 * s), 0.0)) * 0.7 + smoothstep(0.0, 0.9, t) * 0.3;
        }
        vec3 tileBump(vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir) {
          vec3 sx = dFdx(surfPos), sy = dFdy(surfPos);
          vec3 r1 = cross(sy, surfNorm), r2 = cross(surfNorm, sx);
          float det = dot(sx, r1) * faceDir;
          vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
          return normalize(abs(det) * surfNorm - grad);
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float tileFade = 1.0 - smoothstep(0.25, 0.6, fwidth(vMapUv.x * ${rows.toFixed(1)}));
        float tileH = tileShape(vMapUv);
        diffuseColor.rgb *= mix(1.0, 0.45 + 0.55 * tileH, tileFade);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec2 tileD = vec2(dFdx(tileH), dFdy(tileH)) * 0.06 * tileFade;
        normal = tileBump(-vViewPosition, normal, tileD, faceDirection);`);
  };
  material.customProgramCacheKey = () => `courses-${rows}-${courses}`;
}

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
    const files = look.source ?? surface;
    // Colour = the tint's hue scaled so the textured surface lands on its target albedo.
    const color = new Color(look.tint ?? 0xffffff);
    color.multiplyScalar(look.albedo / look.scan / (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b));
    const material = new MeshStandardMaterial({ color, roughness: look.roughness ?? 1, metalness: 0 });
    if (look.metal) {
      material.color.setHex(look.tint ?? 0xffffff);
      material.metalness = look.metal;
      this.cache.set(surface, material);
      return material;
    }
    if (look.courses) addCourses(material, look.courses.rows, look.courses.courses);
    if (look.overlay) {
      material.transparent = true;
      material.vertexColors = true;
      material.depthWrite = false;
      material.polygonOffset = true;
      material.polygonOffsetFactor = -1;
      material.polygonOffsetUnits = -2;
    }
    material.normalScale = new Vector2(look.normalScale ?? 1, look.normalScale ?? 1);
    // Normals stay at 1K on every level: the 2K ones cost four times the download for detail the town camera never sees.
    const load = (map: string, srgb: boolean, apply: (t: Texture) => void): void => {
      const size = map === 'nor_uastc' ? '1k' : this.size;
      this.pending.push(this.loader.loadAsync(`${BASE}/${files}_${map}_${size}.ktx2`).then((t) => {
        t.wrapS = t.wrapT = RepeatWrapping;
        t.colorSpace = srgb ? SRGBColorSpace : LinearSRGBColorSpace;
        t.anisotropy = 8;
        apply(t);
        material.needsUpdate = true;
      }).catch((error: unknown) => console.warn(`Texture ${files} ${map} failed:`, error)));
    };
    load('diff', true, (t) => { material.map = t; });
    load('nor_uastc', false, (t) => { material.normalMap = t; });
    // Only iron reads the packed metal channel, and only partly: forge scale is oxide, not bare steel.
    load('arm', false, (t) => { material.aoMap = t; material.roughnessMap = t; if (surface === 'blackened_rusted_iron') { material.metalnessMap = t; material.metalness = 0.4; material.envMapIntensity = 0.5; } });
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
