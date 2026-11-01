import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Euler,
  ExtrudeGeometry,
  Group,
  Matrix4,
  Mesh,
  Path,
  Quaternion,
  Shape,
  Vector3,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LOOKS, worldUv, type Surface } from './materials.js';
import { roof } from './roofs.js';

/** Surfaces that glow instead of taking scanned textures. */
export type Glow = 'window' | 'forge' | 'lava';
export type Bucket = Surface | Glow;

export interface Collider {
  x: number; y: number; z: number; hx: number; hy: number; hz: number; yaw: number;
  /** Full rotation for tilted boxes (stair and lane ramps); overrides yaw. */
  q?: { x: number; y: number; z: number; w: number };
}
/** A light source the nearest-lights pool may pick: braziers, forge mouths, windows. */
export interface Emitter { position: Vector3; color: number; intensity: number; range: number; flicker: number }

export interface HouseSpec {
  x: number; z: number;
  /** Rotation about y; the front faces local +z. */
  yaw: number;
  w: number; d: number;
  floors: 1 | 2 | 3;
  /** Open forge mouth on the ground floor. */
  forge?: boolean;
  /** All stone, no timber upper floor. */
  stone?: boolean;
  chimney?: -1 | 0 | 1;
  /** Roof pitch in radians. */
  pitch?: number;
  door?: number;
}

const GLOWS: Glow[] = ['window', 'forge', 'lava'];

/** Seeded random numbers, so the town is the same on every load. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const up = new Vector3(0, 1, 0);

export class WorldBuilder {
  private readonly buckets = new Map<Bucket, BufferGeometry[]>();
  readonly colliders: Collider[] = [];
  readonly emitters: Emitter[] = [];
  readonly fires: Array<{ position: Vector3; scale: number }> = [];
  readonly chimneys: Vector3[] = [];
  readonly embers: Vector3[] = [];
  readonly props: Array<{ id: string; x: number; y: number; z: number; yaw: number; scale: number }> = [];
  /** Where pieces go; houses set it to their own frame. */
  private frame = new Matrix4();

  /** Adds a piece in the current frame. Local UVs keep a box face's own 0..1 range scaled by size/tile. */
  add(bucket: Bucket, geometry: BufferGeometry, local: Matrix4, localUv?: { u: number; v: number }): void {
    let g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (localUv) {
      const uv = g.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * localUv.u, uv.getY(i) * localUv.v);
      g.setAttribute('uv1', uv);
    }
    g.applyMatrix4(new Matrix4().multiplyMatrices(this.frame, local));
    if (!localUv && !GLOWS.includes(bucket as Glow)) g = worldUv(g, LOOKS[bucket as Surface].tile);
    if (!g.getAttribute('uv1')) g.setAttribute('uv1', g.getAttribute('uv'));
    const list = this.buckets.get(bucket) ?? [];
    list.push(g);
    this.buckets.set(bucket, list);
  }

  /** A box centred at (x, y, z) in the current frame. */
  box(bucket: Bucket, x: number, y: number, z: number, sx: number, sy: number, sz: number,
    rot?: { x?: number; y?: number; z?: number }, localUv?: { u: number; v: number }): void {
    const m = new Matrix4().compose(new Vector3(x, y, z),
      new Quaternion().setFromEuler(new Euler(rot?.x ?? 0, rot?.y ?? 0, rot?.z ?? 0)),
      new Vector3(1, 1, 1));
    this.add(bucket, new BoxGeometry(sx, sy, sz), m, localUv);
  }

  cylinder(bucket: Bucket, x: number, y: number, z: number, rTop: number, rBottom: number, h: number, sides = 12, open = false): void {
    this.add(bucket, new CylinderGeometry(rTop, rBottom, h, sides, 1, open), new Matrix4().makeTranslation(x, y, z));
  }

  /** Moves the frame to a placement; pieces and colliders after this are relative to it. */
  at(x: number, z: number, yaw: number, y = 0): this {
    this.frame = new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromAxisAngle(up, yaw), new Vector3(1, 1, 1));
    return this;
  }

  world(x: number, y: number, z: number): Vector3 { return new Vector3(x, y, z).applyMatrix4(this.frame); }

  /** A solid block the hero and camera stop at, in the current frame. */
  solid(x: number, y: number, z: number, sx: number, sy: number, sz: number): void {
    const c = this.world(x, y, z);
    const yaw = Math.atan2(this.frame.elements[8]!, this.frame.elements[10]!);
    this.colliders.push({ x: c.x, y: c.y, z: c.z, hx: sx / 2, hy: sy / 2, hz: sz / 2, yaw });
  }

  /** A solid block tilted about the frame's x axis (a ramp rising along +z for a negative pitch). */
  solidTilted(x: number, y: number, z: number, sx: number, sy: number, sz: number, pitch: number): void {
    const c = this.world(x, y, z);
    const frameQ = new Quaternion();
    this.frame.decompose(new Vector3(), frameQ, new Vector3());
    const q = frameQ.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch));
    this.colliders.push({ x: c.x, y: c.y, z: c.z, hx: sx / 2, hy: sy / 2, hz: sz / 2, yaw: 0, q: { x: q.x, y: q.y, z: q.z, w: q.w } });
  }

  light(x: number, y: number, z: number, color: number, intensity: number, range: number, flicker = 0.25): void {
    this.emitters.push({ position: this.world(x, y, z), color, intensity, range, flicker });
  }

  fire(x: number, y: number, z: number, scale: number): void {
    this.fires.push({ position: this.world(x, y, z), scale });
    this.embers.push(this.world(x, y + scale * 0.6, z));
  }

  prop(id: string, x: number, z: number, yaw: number, scale = 1, y = 0): void {
    const p = this.world(x, y, z);
    const frameYaw = Math.atan2(this.frame.elements[8]!, this.frame.elements[10]!);
    this.props.push({ id, x: p.x, y: p.y, z: p.z, yaw: yaw + frameYaw, scale });
  }

  /** A window: glowing pane set back inside a deep timber casing and sill, on the face at z = face; dir -1 faces -z. */
  window(x: number, y: number, face: number, w = 0.8, h = 1.1, dir = 1): void {
    this.box('window', x, y, face + 0.02 * dir, w, h, 0.04, undefined, { u: 1, v: 1 });
    const t = 0.14, deep = 0.3;
    this.box('charred_timber_beams', x, y + h / 2 + t / 2, face + deep / 2 * dir, w + t * 2, t, deep);
    this.box('charred_timber_beams', x, y - h / 2 - t / 2, face + (deep / 2 + 0.05) * dir, w + t * 2.8, t, deep + 0.1);
    this.box('charred_timber_beams', x - w / 2 - t / 2, y, face + deep / 2 * dir, t, h, deep);
    this.box('charred_timber_beams', x + w / 2 + t / 2, y, face + deep / 2 * dir, t, h, deep);
  }

  /** A noble lacquered round column on a moulded stone base with a capital block. */
  column(x: number, z: number, height: number, radius = 0.22, opts?: { mat?: Surface; baseMat?: Surface; solid?: boolean }): void {
    const mat: Surface = opts?.mat ?? 'red_lacquer';
    const baseMat: Surface = opts?.baseMat ?? 'pale_stone';
    const baseH = 0.35;
    const baseR = radius * 1.6;
    const capH = 0.22;
    this.cylinder(baseMat, x, baseH / 2, z, baseR * 0.9, baseR, baseH, 16);
    this.cylinder(mat, x, baseH + (height - baseH - capH) / 2, z, radius * 0.95, radius, height - baseH - capH, 16);
    this.box(mat, x, height - capH / 2, z, radius * 2.5, capH, radius * 2.5);
    if (opts?.solid !== false) {
      this.solid(x, height / 2, z, radius * 2, height, radius * 2);
    }
  }

  /** A decorative lattice screen panel with optional window glow behind. */
  lattice(x: number, y: number, face: number, w = 1.2, h = 1.8, dir = 1, glow = true): void {
    if (glow) {
      this.box('window', x, y, face + 0.02 * dir, w - 0.1, h - 0.1, 0.04, undefined, { u: 1, v: 1 });
    }
    const t = 0.12, deep = 0.15;
    this.box('red_lacquer', x, y + h / 2 - t / 2, face + deep / 2 * dir, w, t, deep);
    this.box('red_lacquer', x, y - h / 2 + t / 2, face + deep / 2 * dir, w, t, deep);
    this.box('red_lacquer', x - w / 2 + t / 2, y, face + deep / 2 * dir, t, h, deep);
    this.box('red_lacquer', x + w / 2 - t / 2, y, face + deep / 2 * dir, t, h, deep);
    const barsX = 3, barsY = 4;
    for (let i = 1; i < barsX; i++) {
      const bx = x - w / 2 + (i * w) / barsX;
      this.box('red_lacquer', bx, y, face + 0.04 * dir, 0.04, h - t * 2, 0.06);
    }
    for (let j = 1; j < barsY; j++) {
      const by = y - h / 2 + (j * h) / barsY;
      this.box('red_lacquer', x, by, face + 0.04 * dir, w - t * 2, 0.04, 0.06);
    }
  }

  /** A stone platform with a moulded edge, pale stone floor on top, and optional front stair. */
  podium(x: number, z: number, w: number, d: number, h: number, stairW = 0): void {
    this.box('ashlar_stone_blocks', x, h / 2, z, w, h, d);
    this.box('pale_stone', x, h + 0.05, z, w + 0.3, 0.1, d + 0.3);
    this.solid(x, h / 2, z, w, h, d);
    if (stairW > 0) {
      const steps = Math.max(3, Math.round(h / 0.2));
      const stepH = h / steps;
      const stepD = 0.45;
      for (let s = 1; s <= steps; s++) {
        const sy = s * stepH - stepH / 2;
        const sz = d / 2 + (steps - s + 0.5) * stepD;
        this.box('pale_stone', x, sy, z + sz, stairW, stepH, stepD);
        this.solid(x, sy, z + sz, stairW, stepH, stepD);
      }
    }
  }

  /** A town house: basalt plinth, ashlar ground floor, jettied timber-framed plaster floors, slate gable roof. */
  house(spec: HouseSpec, rand: () => number): void {
    const { w, d, floors } = spec;
    this.at(spec.x, spec.z, spec.yaw);
    const plinth = 0.45;
    const groundH = 3.3;
    const upperH = 2.7;
    const jetty = spec.stone ? 0 : 0.4;
    this.box('basalt_rock_face', 0, plinth / 2, 0, w + 0.3, plinth, d + 0.3);
    const front = d / 2;
    if (spec.forge) {
      // Forge mouth: an arched opening in the front wall over a glowing hearth.
      const depth = 2.2;
      this.box('ashlar_stone_blocks', 0, plinth + groundH / 2, -depth / 2, w, groundH, d - depth);
      this.box('ashlar_stone_blocks', -w / 2 + 0.3, plinth + groundH / 2, front - depth / 2, 0.6, groundH, depth);
      this.box('ashlar_stone_blocks', w / 2 - 0.3, plinth + groundH / 2, front - depth / 2, 0.6, groundH, depth);
      this.box('ashlar_stone_blocks', 0, plinth + groundH + 0.0, front - depth / 2, w, 0.01, depth);
      const archW = Math.min(w - 1.6, 4.2);
      const shape = new Shape();
      shape.moveTo(-w / 2, 0); shape.lineTo(w / 2, 0); shape.lineTo(w / 2, groundH); shape.lineTo(-w / 2, groundH); shape.lineTo(-w / 2, 0);
      const hole = new Path();
      const springAt = groundH - archW / 2 - 0.35;
      hole.moveTo(-archW / 2, 0.01); hole.lineTo(archW / 2, 0.01); hole.lineTo(archW / 2, springAt);
      hole.absarc(0, springAt, archW / 2, 0, Math.PI, false);
      hole.lineTo(-archW / 2, 0.01);
      shape.holes.push(hole);
      const wall = new ExtrudeGeometry(shape, { depth: 0.6, bevelEnabled: false, curveSegments: 10 });
      this.add('ashlar_stone_blocks', wall, new Matrix4().makeTranslation(0, plinth, front - 0.6));
      // Hearth glow at the back of the mouth and the floor inside.
      this.box('forge', 0, plinth + groundH * 0.4, front - depth + 0.05, w - 1.2, groundH * 0.8, 0.05, undefined, { u: 1, v: 1 });
      this.box('basalt_cobblestone', 0, plinth + 0.01, front - depth / 2, w - 1.2, 0.02, depth);
      this.box('ashlar_stone_blocks', 0, plinth + 0.45, front - depth + 0.7, 1.8, 0.9, 0.9);
      this.fire(0, plinth + 0.95, front - depth + 0.7, 0.9);
      this.light(0, plinth + 1.6, front + 0.6, 0xff6a20, 35, 13, 0.35);
      this.prop('anvil', 1.6 * (rand() > 0.5 ? 1 : -1), front + 1.3, rand() * 0.8 - 0.4, 1.1);
    } else {
      this.box('ashlar_stone_blocks', 0, plinth + groundH / 2, 0, w, groundH, d);
      const door = spec.door ?? (rand() - 0.5) * (w - 2.4);
      this.box('charred_timber_beams', door, plinth + 1.1, front + 0.03, 1.2, 2.2, 0.1, undefined, { u: 0.5, v: 1 });
      this.box('ashlar_stone_blocks', door, plinth + 2.35, front + 0.08, 1.7, 0.32, 0.2);
      this.box('basalt_rock_face', door, 0.12, front + 0.45, 1.6, 0.24, 0.6);
      const side = door > 0 ? -1 : 1;
      if (w > 5) this.window(side * Math.min(w / 2 - 1.2, Math.abs(door) + 2.1), plinth + 1.7, front);
      if (rand() > 0.6) this.window(0, plinth + 1.7, -front, 0.7, 0.9, -1);
    }
    let top = plinth + groundH;
    for (let f = 1; f < floors; f++) {
      const wf = w;
      const df = d + jetty * 2;
      if (spec.stone) {
        this.box('ashlar_stone_blocks', 0, top + upperH / 2, 0, wf, upperH, df);
        this.box('ashlar_stone_blocks', 0, top + 0.12, 0, wf + 0.16, 0.24, df + 0.16);
      } else {
        this.box('sooted_plaster', 0, top + upperH / 2, 0, wf - 0.04, upperH, df - 0.04);
        this.frameWalls(wf, df, top, upperH, rand);
        for (let k = 0; k < 4; k++) {
          // Joist ends showing under the jetty.
          const x = -wf / 2 + 0.4 + k * (wf - 0.8) / 3;
          this.box('charred_timber_beams', x, top - 0.1, df / 2 - 0.15, 0.2, 0.2, 0.5);
        }
      }
      const count = Math.max(1, Math.floor(wf / 3));
      for (let k = 0; k < count; k++) {
        const x = (k - (count - 1) / 2) * (wf / count);
        if (rand() > 0.25) this.window(x, top + upperH * 0.55, df / 2, 0.7, 1.0);
      }
      top += upperH;
    }
    // Hip-and-gable roof, ridge along width
    const totalD = d + jetty * 2;
    const pitch = spec.pitch ?? 0.62;
    const rise = Math.tan(pitch) * (totalD / 2);
    roof(this, {
      w: w + 0.4,
      d: totalD,
      base: top,
      pitch,
      overhang: 0.85,
      curve: 0.18,
      cornerLift: 0.12,
      gableRatio: 0.44,
      tile: 'roof_tile_charcoal',
      trim: false,
    });
    const chimney = spec.chimney ?? (rand() > 0.5 ? 1 : -1);
    if (chimney !== 0 || spec.forge) {
      const cx = (chimney || 1) * (w / 2 - 0.8);
      const ch = rise + 1.8;
      this.box('ashlar_stone_blocks', cx, top + ch / 2, -0.3, 1.0, ch, 1.0);
      this.box('basalt_rock_face', cx, top + ch + 0.1, -0.3, 1.2, 0.2, 1.2);
      this.chimneys.push(this.world(cx, top + ch + 0.3, -0.3));
    }
    this.solid(0, (top + rise) / 2, 0, w + 0.2, top + rise, d + jetty * 2);
  }

  /** Charred half-timbering over a plaster floor: sill, head, posts and braces on all four faces. */
  private frameWalls(w: number, d: number, base: number, h: number, rand: () => number): void {
    const t = 0.2;
    const faces = [
      { len: w, along: 'x', at: d / 2 + 0.05 }, { len: w, along: 'x', at: -d / 2 - 0.05 },
      { len: d, along: 'z', at: w / 2 + 0.05 }, { len: d, along: 'z', at: -w / 2 - 0.05 },
    ] as const;
    for (const face of faces) {
      const piece = (u: number, y: number, length: number, height: number, roll = 0): void => {
        if (face.along === 'x') this.box('charred_timber_beams', u, y, face.at, length, height, 0.16, roll ? { z: roll } : undefined);
        else this.box('charred_timber_beams', face.at, y, u, 0.16, height, length, roll ? { x: -roll } : undefined);
      };
      piece(0, base + t / 2, face.len + 0.1, t);
      piece(0, base + h - t / 2, face.len + 0.1, t);
      const bays = Math.max(2, Math.round(face.len / 1.5));
      const bay = face.len / bays;
      for (let b = 0; b <= bays; b++) piece(-face.len / 2 + b * bay, base + h / 2, t, h - t * 2);
      for (let b = 0; b < bays; b++) {
        if (rand() > 0.55) continue;
        const angle = Math.atan2(h - t * 2, bay) * (b % 2 ? 1 : -1);
        piece(-face.len / 2 + (b + 0.5) * bay, base + h / 2, Math.hypot(bay, h - t * 2) - 0.1, 0.15, angle);
      }
    }
  }

  /** Merges every bucket into one mesh per material. */
  build(material: (bucket: Bucket) => Material): Group {
    const group = new Group();
    for (const [bucket, list] of this.buckets) {
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      for (const g of list) g.dispose();
      merged.computeBoundingSphere();
      const mesh = new Mesh(merged, material(bucket));
      mesh.name = bucket;
      mesh.castShadow = !GLOWS.includes(bucket as Glow);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    this.buckets.clear();
    return group;
  }
}
