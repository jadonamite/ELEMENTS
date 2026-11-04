import {
  AdditiveBlending,
  Color,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Camera,
  type Texture,
} from 'three';
import { carry, type CombatSpace } from '../attacks/space.js';

export type PieceKind = 'spark' | 'rock';

interface Piece {
  active: boolean;
  position: Vector3;
  velocity: Vector3;
  gravity: number;
  drag: number;
  elapsed: number;
  duration: number;
  startSize: number;
  endSize: number;
  /** Rocks: tumble axis and speed; each rock keeps its own squashed shape. */
  axis: Vector3;
  spin: number;
  turn: Quaternion;
  shape: Vector3;
  colorCore: Color;
  colorMid: Color;
  opacity: number;
}

export interface PieceSpec {
  position: Vector3;
  velocity: Vector3;
  duration: number;
  startSize: number;
  endSize: number;
  gravity: number;
  drag: number;
  core: Color;
  mid?: Color;
  opacity: number;
}

const GROUND = 0.03;
const matrix = new Matrix4();
const camInv = new Quaternion();
const roll = new Quaternion();
const step = new Quaternion();
const scale = new Vector3();
const local = new Vector3();
const color = new Color();
const zAxis = new Vector3(0, 0, 1);

/** A lumpy stone: an icosahedron pushed in and out so no two faces catch the light alike. */
function rockGeometry(): IcosahedronGeometry {
  const geo = new IcosahedronGeometry(0.5, 1);
  const p = geo.attributes.position!;
  for (let i = 0; i < p.count; i++) {
    local.fromBufferAttribute(p, i);
    const k = 0.78 + 0.44 * Math.abs(Math.sin(local.x * 13.1 + local.y * 7.7) * Math.cos(local.z * 11.3 - local.x * 3.1));
    p.setXYZ(i, local.x * k, local.y * k * 0.8, local.z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Sparks and thrown rock for every bending effect, two draw calls in all: sparks are additive streaks
 * stretched along their screen-space motion, rocks are lit stones that tumble, bounce and settle.
 * Both move through the world with `carry`, so nothing flies through a wall.
 */
export class Debris {
  space?: Pick<CombatSpace, 'obstruction'> | undefined;
  private readonly sparks: InstancedMesh;
  private readonly rocks: InstancedMesh;
  private readonly pools: Record<PieceKind, Piece[]> = { spark: [], rock: [] };

  constructor(parent: Object3D, sparkTexture: Texture | null, sparkCount: number, rockCount: number) {
    this.sparks = new InstancedMesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({
      map: sparkTexture, transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false,
    }), sparkCount);
    this.rocks = new InstancedMesh(rockGeometry(), new MeshStandardMaterial({ roughness: 0.95, metalness: 0, flatShading: true }), rockCount);
    for (const [mesh, kind, count] of [[this.sparks, 'spark', sparkCount], [this.rocks, 'rock', rockCount]] as const) {
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(count * 3), 3).setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.renderOrder = 3;
      parent.add(mesh);
      for (let i = 0; i < count; i++) {
        this.pools[kind].push({
          active: false, position: new Vector3(), velocity: new Vector3(), gravity: 0, drag: 1, elapsed: 0, duration: 1,
          startSize: 0.1, endSize: 0.1, axis: new Vector3(0, 1, 0), spin: 0, turn: new Quaternion(), shape: new Vector3(1, 1, 1),
          colorCore: new Color(), colorMid: new Color(), opacity: 1,
        });
      }
    }
  }

  spawn(kind: PieceKind, s: PieceSpec): void {
    const p = this.pools[kind].find(q => !q.active);
    if (!p) return;
    p.active = true;
    p.position.copy(s.position);
    p.velocity.copy(s.velocity);
    p.elapsed = 0;
    p.duration = s.duration;
    p.startSize = s.startSize;
    p.endSize = s.endSize;
    p.gravity = s.gravity;
    p.drag = s.drag;
    p.colorCore.copy(s.core);
    p.colorMid.copy(s.mid ?? s.core);
    p.opacity = s.opacity;
    if (kind === 'rock') {
      p.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      p.spin = 6 + Math.random() * 10;
      p.turn.setFromAxisAngle(p.axis, Math.random() * Math.PI * 2);
      p.shape.set(0.75 + Math.random() * 0.5, 0.6 + Math.random() * 0.5, 0.75 + Math.random() * 0.5);
    }
  }

  update(delta: number, camera?: Camera): void {
    this.updateSparks(delta, camera);
    this.updateRocks(delta);
  }

  private move(p: Piece, delta: number, size: number): void {
    p.velocity.y += p.gravity * delta;
    const damp = Math.pow(p.drag, delta * 60);
    p.velocity.x *= damp;
    p.velocity.z *= damp;
    carry(this.space, p.position, p.velocity, delta, size);
  }

  private updateSparks(delta: number, camera?: Camera): void {
    const camQuat = camera?.quaternion;
    if (camQuat) camInv.copy(camQuat).invert();
    let n = 0;
    for (const p of this.pools.spark) {
      if (!p.active) continue;
      p.elapsed += delta;
      const t = p.elapsed / p.duration;
      if (t >= 1) { p.active = false; continue; }
      this.move(p, delta, 0.02);
      const size = p.startSize + t * (p.endSize - p.startSize);
      // Facing the camera, streaked along the screen-space direction of travel.
      let stretch = 1;
      if (camQuat) {
        local.copy(p.velocity).applyQuaternion(camInv);
        stretch = 1 + Math.min(3, Math.hypot(local.x, local.y) * 0.5);
        step.copy(camQuat).multiply(roll.setFromAxisAngle(zAxis, Math.atan2(local.y, local.x)));
      } else step.identity();
      matrix.compose(p.position, step, scale.set(size * stretch, size, 1));
      this.sparks.setMatrixAt(n, matrix);
      // Additive: fading the colour fades the light.
      color.copy(p.colorCore).lerp(p.colorMid, Math.min(1, t * 1.5)).multiplyScalar(p.opacity * (1 - t * t));
      this.sparks.setColorAt(n, color);
      n++;
    }
    this.sparks.count = n;
    this.sparks.instanceMatrix.needsUpdate = true;
    if (this.sparks.instanceColor) this.sparks.instanceColor.needsUpdate = true;
  }

  private updateRocks(delta: number): void {
    let n = 0;
    for (const p of this.pools.rock) {
      if (!p.active) continue;
      p.elapsed += delta;
      const t = p.elapsed / p.duration;
      if (t >= 1) { p.active = false; continue; }
      const size = p.startSize + t * (p.endSize - p.startSize);
      this.move(p, delta, size * 0.5);
      if (p.position.y < GROUND + size * 0.3) {
        // Bounce, lose most of the energy, and roll slower each time.
        p.position.y = GROUND + size * 0.3;
        p.velocity.set(p.velocity.x * 0.45, Math.abs(p.velocity.y) * 0.25, p.velocity.z * 0.45);
        p.spin *= 0.5;
      }
      p.turn.multiply(step.setFromAxisAngle(p.axis, p.spin * delta));
      // Stones do not fade: they sink into the ground at the end of their life.
      const sink = t > 0.85 ? (1 - t) / 0.15 : 1;
      matrix.compose(p.position, p.turn, scale.copy(p.shape).multiplyScalar(size * sink));
      this.rocks.setMatrixAt(n, matrix);
      this.rocks.setColorAt(n, p.colorCore);
      n++;
    }
    this.rocks.count = n;
    this.rocks.instanceMatrix.needsUpdate = true;
    if (this.rocks.instanceColor) this.rocks.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    for (const m of [this.sparks, this.rocks]) {
      m.geometry.dispose();
      (m.material as MeshBasicMaterial).dispose();
      m.removeFromParent();
    }
  }
}
