import RAPIER from '@dimforge/rapier3d-compat';
import { BatchedMesh, BoxGeometry, BufferAttribute, BufferGeometry, InstancedMesh, Matrix4, MeshBasicMaterial, Vector3, type Material, type Scene } from 'three';
import { IGNIS, LEGACY_SINDR_ORIGIN as ORIGIN } from '../../../shared/src/world/ignis/coordinates.js';
import { landCell } from '../../../shared/src/world/ignis/ground.js';
import { type Field, sampleField } from './landscape.js';
import { tileGeometry } from './terrain-grid.js';
export { tileGeometry } from './terrain-grid.js';

interface TerrainJob { tier: Tier; ix: number; iz: number; key: string }
interface StreamOptions {
  workerFactory?: () => Worker;
  jobTimeoutMs?: number;
  prepareTimeoutMs?: number;
  retryLimit?: number;
}
export interface TerrainResult { heights: Float32Array; positions: Float32Array; normals: Float32Array; uv: Float32Array; indices: Uint32Array | Uint16Array; cpuMs: number }
interface Cell { key: string; ix: number; iz: number; slot: number; collider: RAPIER.Collider | null }
interface Slot { geometry: number; instance: number; used: boolean }
interface Tier { batch: BatchedMesh; slots: Slot[]; cells: Map<string, Cell>; step: number }
const SIZE = IGNIS.cellSize;
/** Mid cells reach this many cells from the hero's cell: a 5x5 square less the near 3x3, 16 cells. */
const MID_REACH = 2;

function tier(capacity: number, step: number, material: Material): Tier {
  const n = SIZE / step + 1, vertices = n * n + 4 * n, indices = (n - 1) ** 2 * 6 + (n - 1) * 24;
  const batch = new BatchedMesh(capacity, capacity * vertices, capacity * indices, material);
  batch.frustumCulled = false; batch.sortObjects = false; batch.castShadow = false; batch.receiveShadow = true;
  // Pre-allocate all geometry and instance slots so streaming only calls setGeometryAt.
  const placeholder = new BufferGeometry();
  placeholder.setAttribute('position', new BufferAttribute(new Float32Array(vertices * 3), 3));
  placeholder.setAttribute('normal', new BufferAttribute(new Float32Array(vertices * 3), 3));
  placeholder.setAttribute('uv', new BufferAttribute(new Float32Array(vertices * 2), 2));
  placeholder.setAttribute('uv1', placeholder.getAttribute('uv'));
  placeholder.setIndex(new BufferAttribute(new Uint16Array(indices), 1));
  const slots: Slot[] = [];
  for (let i = 0; i < capacity; i++) {
    const id = batch.addGeometry(placeholder), instance = batch.addInstance(id);
    batch.setVisibleAt(instance, false);
    slots.push({ geometry: id, instance, used: false });
  }
  placeholder.dispose();
  return { batch, slots, cells: new Map(), step };
}

/** Owns near collision and the visible mid cells. National coordinates determine every cell ID. */
export class TerrainStream {
  readonly near: Tier;
  readonly mid: Tier;
  readonly checkpoint: InstancedMesh;
  readonly status = { failures: 0, error: null as string | null };
  readonly timing = { initialMs: 0, maxSliceMs: 0, maxCellMs: 0, maxUploadMs: 0 };
  private targetX = NaN;
  private targetZ = NaN;
  private pending: TerrainJob[] = [];
  private worker: Worker | null = null;
  private busy = false;
  private generation = 0;
  private completed: { data: TerrainResult; job: TerrainJob } | null = null;
  private pinned = new Map<string, RAPIER.Collider>();
  private active: TerrainJob | null = null;
  private sentAt = 0;
  private patch: { x0: number; z0: number; nx: number; nz: number; heights: Float32Array } | null = null;
  private frontier = new Map<string, RAPIER.Collider>();
  private frontierDirty = true;
  private frontierX = NaN;
  private frontierZ = NaN;
  private disposed = false;
  private preparing: { x: number; z: number } | null = null;

  constructor(private readonly world: RAPIER.World, private readonly height: (x: number, z: number) => number,
    scene: Scene, material: Material, low: boolean, private readonly options: StreamOptions = {}) {
    this.near = tier(9, 2, material); this.mid = tier((MID_REACH * 2 + 1) ** 2 - 9, low ? 16 : 8, material);
    this.near.batch.name = 'national-near'; this.mid.batch.name = 'national-mid';
    scene.add(this.near.batch, this.mid.batch);
    this.checkpoint = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: 0xb67c3f }), 512);
    this.checkpoint.count = 0; this.checkpoint.frustumCulled = false;
    this.checkpoint.name = 'stream-checkpoint'; this.checkpoint.visible = false; scene.add(this.checkpoint);
  }
  private create(field: Field, into: Tier, ix: number, iz: number, key: string, generated?: BufferGeometry): void {
    const geometry = generated ?? tileGeometry(field, 16, this.height), matrix = new Matrix4().makeTranslation(field.cx, 0, field.cz);
    let slot = into.slots.findIndex(s => !s.used);
    if (slot < 0) return; // All slots full; eviction should have freed one.
    into.batch.setGeometryAt(into.slots[slot]!.geometry, geometry);
    geometry.dispose();
    const pooled = into.slots[slot]!; pooled.used = true;
    into.batch.setMatrixAt(pooled.instance, matrix); into.batch.setVisibleAt(pooled.instance, true);
    let collider: RAPIER.Collider | null = null;
    if (into === this.near) {
      const start = performance.now();
      collider = this.pinned.get(key) ?? this.world.createCollider(RAPIER.ColliderDesc.heightfield(field.nz, field.nx, field.heights, { x: SIZE, y: 1, z: SIZE }).setTranslation(field.cx, 0, field.cz));
      this.timing.maxUploadMs = Math.max(this.timing.maxUploadMs, performance.now() - start);
    }
    into.cells.set(key, { ix, iz, key, slot, collider });
    this.frontierDirty = true;
  }
  private evict(into: Tier, wanted: Set<string>): void {
    for (const [key, cell] of into.cells) if (!wanted.has(key)) {
      if (cell.collider && !this.pinned.has(key)) this.world.removeCollider(cell.collider, false);
      const slot = into.slots[cell.slot]!; slot.used = false; into.batch.setVisibleAt(slot.instance, false);
      into.cells.delete(key);
    }
  }
  /** Initial collision is completed before the loader can enable Enter. */
  initialize(x: number, z: number): void {
    const start = performance.now();
    this.request(x, z);
    const initial = this.pending.filter(p => p.tier === this.near);
    this.pending = this.pending.filter(p => p.tier !== this.near);
    for (const p of initial) {
      const cx = (p.ix + 0.5) * SIZE - ORIGIN.x, cz = (p.iz + 0.5) * SIZE - ORIGIN.z;
      this.create(sampleField(cx, cz, SIZE, SIZE, p.tier.step, this.height), p.tier, p.ix, p.iz, p.key);
    }
    // Town simulation stays alive while the hero travels. Its ground has the same lifetime.
    for (const [key, cell] of this.near.cells) if (cell.collider) this.pinned.set(key, cell.collider);
    this.timing.initialMs = performance.now() - start;
  }
  request(x: number, z: number): void {
    const ix = Math.floor((x + ORIGIN.x) / SIZE), iz = Math.floor((z + ORIGIN.z) / SIZE);
    if (ix === this.targetX && iz === this.targetZ) return;
    this.targetX = ix; this.targetZ = iz;
    this.generation++; this.completed = null; this.pending.length = 0;
    // Near is the 3x3 square around the hero, mid the square ring around it. The resident outline is a square with no
    // notches: seen from inside it, every edge skirt faces away and the far tiles only ever begin beyond it.
    const near = new Set<string>(), mid = new Set<string>();
    for (let dx = -MID_REACH; dx <= MID_REACH; dx++) for (let dz = -MID_REACH; dz <= MID_REACH; dz++) {
      const cx = ix + dx, cz = iz + dz;
      if (!landCell(cx, cz)) continue;
      (Math.abs(dx) <= 1 && Math.abs(dz) <= 1 ? near : mid).add(`${cx}:${cz}`);
    }
    this.evict(this.near, near); this.evict(this.mid, mid);
    this.frontierDirty = true;
    for (const [into, wanted] of [[this.near, near], [this.mid, mid]] as const) for (const key of wanted) if (!into.cells.has(key)) {
      const [cx, cz] = key.split(':').map(Number);
      this.pending.push({ tier: into, ix: cx!, iz: cz!, key });
    }
    this.pending.sort((a, b) => (a.tier === this.near ? 0 : 1) - (b.tier === this.near ? 0 : 1)
      || ((a.ix + 0.5) * SIZE - ORIGIN.x - x) ** 2 + ((a.iz + 0.5) * SIZE - ORIGIN.z - z) ** 2
       - ((b.ix + 0.5) * SIZE - ORIGIN.x - x) ** 2 - ((b.iz + 0.5) * SIZE - ORIGIN.z - z) ** 2);
  }
  tick(x: number, z: number): void {
    if (this.disposed) return;
    this.request(x, z); const start = performance.now();
    if (this.busy && start - this.sentAt > (this.options.jobTimeoutMs ?? 2000)) this.workerFailed('Terrain worker timed out');
    if (this.completed) {
      const { data, job } = this.completed; this.completed = null;
      const n = SIZE / job.tier.step;
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(data.positions, 3));
      geometry.setAttribute('normal', new BufferAttribute(data.normals, 3));
      geometry.setAttribute('uv', new BufferAttribute(data.uv, 2)); geometry.setAttribute('uv1', geometry.getAttribute('uv'));
      geometry.setIndex(new BufferAttribute(data.indices, 1));
      this.create({ width: SIZE, depth: SIZE, cx: (job.ix + 0.5) * SIZE - ORIGIN.x, cz: (job.iz + 0.5) * SIZE - ORIGIN.z,
        nx: n, nz: n, heights: data.heights }, job.tier, job.ix, job.iz, job.key, geometry);
    }
    if (!this.busy && this.worker) {
      const job = this.pending.shift();
      if (job) {
        this.busy = true; this.active = job; this.sentAt = performance.now(); const generation = this.generation;
        this.worker.onmessage = (event: MessageEvent<TerrainResult>) => {
          this.busy = false; this.active = null; this.status.failures = 0; this.status.error = null;
          this.timing.maxCellMs = Math.max(this.timing.maxCellMs, event.data.cpuMs);
          if (generation === this.generation) this.completed = { job, data: event.data };
        };
        try { this.worker.postMessage({ ix: job.ix, iz: job.iz, step: job.tier.step }); } catch (error) { this.workerFailed(String(error)); }
      }
    }
    this.timing.maxSliceMs = Math.max(this.timing.maxSliceMs, performance.now() - start);
  }
  /** A small exact sample patch preserves authored floors inside the worker, on the same global 2 m grid. */
  startWorker(bounds: { x0: number; x1: number; z0: number; z1: number }): void {
    const x0 = Math.floor((bounds.x0 - 8 + ORIGIN.x) / 2) * 2 - ORIGIN.x;
    const z0 = Math.floor((bounds.z0 - 8 + ORIGIN.z) / 2) * 2 - ORIGIN.z;
    const nx = Math.ceil((bounds.x1 + 8 - x0) / 2), nz = Math.ceil((bounds.z1 + 8 - z0) / 2);
    const heights = new Float32Array((nx + 1) * (nz + 1));
    for (let x = 0; x <= nx; x++) for (let z = 0; z <= nz; z++) heights[x * (nz + 1) + z] = this.height(x0 + x * 2, z0 + z * 2);
    this.patch = { x0, z0, nx, nz, heights };
    this.openWorker();
  }
  private openWorker(): void {
    if (this.disposed || !this.patch) return;
    try {
      this.worker = this.options.workerFactory?.() ?? new Worker(new URL('./terrain-worker.ts', import.meta.url), { type: 'module' });
      this.worker.onerror = event => { event.preventDefault(); this.workerFailed(event.message || 'Terrain worker failed'); };
      this.worker.onmessageerror = () => this.workerFailed('Terrain worker returned unreadable data');
      // Keep the source patch for retries; each worker receives its own clone.
      this.worker.postMessage({ patch: this.patch });
    } catch (error) { this.workerFailed(String(error)); }
  }
  private workerFailed(message: string): void {
    this.worker?.terminate(); this.worker = null; this.busy = false;
    this.status.failures++; this.status.error = message;
    if (this.active) {
      const job = this.active; this.active = null;
      const dx = Math.abs(job.ix - this.targetX), dz = Math.abs(job.iz - this.targetZ);
      if (dx <= 1 && dz <= 1 && !job.tier.cells.has(job.key)) this.pending.unshift(job);
    }
    if (this.status.failures <= (this.options.retryLimit ?? 2)) this.openWorker();
  }

  /** True when every wanted cell is resident: nothing queued, in flight or waiting to upload. */
  get idle(): boolean { return !this.pending.length && !this.busy && !this.completed; }
  has(x: number, z: number): boolean {
    return this.near.cells.has(`${Math.floor((x + ORIGIN.x) / SIZE)}:${Math.floor((z + ORIGIN.z) / SIZE)}`);
  }
  private lookaheadReady(x: number, z: number): boolean {
    for (const dx of [-192, 0, 192]) for (const dz of [-192, 0, 192]) {
      const ix = Math.floor((x + dx + ORIGIN.x) / SIZE), iz = Math.floor((z + dz + ORIGIN.z) / SIZE);
      if (landCell(ix, iz) && !this.near.cells.has(`${ix}:${iz}`)) return false;
    }
    return true;
  }
  /** Debug travel waits for collision, with a bounded failure and cancellation path. */
  async prepare(x: number, z: number): Promise<void> {
    if (this.disposed) throw new Error('Terrain stream is disposed');
    if (this.preparing) throw new Error('Terrain preparation is already in progress');
    const start = performance.now();
    this.preparing = { x, z };
    try {
      this.request(x, z);
      while (!this.lookaheadReady(x, z)) {
        if (this.disposed) throw new Error('Terrain stream was disposed during preparation');
        if (performance.now() - start > (this.options.prepareTimeoutMs ?? 5000)) {
          throw new Error(this.status.error ?? 'Terrain preparation timed out');
        }
        this.tick(x, z); await new Promise(resolve => setTimeout(resolve, 0));
      }
      this.world.step();
    } finally { this.preparing = null; }
  }
  /** Physical loading barriers cover only nearby exposed edges of resident collision. */
  private updateFrontier(x: number, z: number): void {
    const fx = Math.floor(x / 32), fz = Math.floor(z / 32);
    if (!this.frontierDirty && fx === this.frontierX && fz === this.frontierZ) return;
    this.frontierDirty = false; this.frontierX = fx; this.frontierZ = fz;
    const wanted = new Set<string>(), matrix = new Matrix4();
    let count = 0;
    for (const cell of this.near.cells.values()) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ix = cell.ix + dx!, iz = cell.iz + dz!;
      if (this.near.cells.has(`${ix}:${iz}`)) continue;
      const edgeX = (cell.ix + 0.5 + dx! * 0.5) * SIZE - ORIGIN.x;
      const edgeZ = (cell.iz + 0.5 + dz! * 0.5) * SIZE - ORIGIN.z;
      for (let k = -120; k <= 120; k += 16) {
        const bx = edgeX + (dz ? k : 0), bz = edgeZ + (dx ? k : 0);
        if (Math.hypot(bx - x, bz - z) > 224) continue;
        const key = `${bx}:${bz}`, y = this.height(bx, bz), hx = dz ? 8 : 0.25, hz = dx ? 8 : 0.25;
        wanted.add(key);
        if (!this.frontier.has(key)) this.frontier.set(key, this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, 3, hz).setTranslation(bx, y + 2, bz)));
        matrix.makeScale(hx * 2, 6, hz * 2); matrix.setPosition(bx, y + 2, bz);
        this.checkpoint.setMatrixAt(count++, matrix);
      }
    }
    for (const [key, collider] of this.frontier) if (!wanted.has(key)) { this.world.removeCollider(collider, false); this.frontier.delete(key); }
    this.checkpoint.count = count; this.checkpoint.visible = count > 0; this.checkpoint.instanceMatrix.needsUpdate = true;
  }
  guard(controller: { position: Vector3 }): boolean {
    const p = controller.position;
    this.tick(this.preparing?.x ?? p.x, this.preparing?.z ?? p.z);
    if (!this.preparing) this.updateFrontier(p.x, p.z);
    // Water is a landform, and collision handles loading barriers. Never reset or freeze movement.
    return true;
  }
  dispose(): void {
    this.disposed = true; this.worker?.terminate(); this.completed = null; this.pending.length = 0;
    for (const into of [this.near, this.mid]) { this.evict(into, new Set()); into.batch.removeFromParent(); into.batch.dispose(); }
    for (const collider of this.pinned.values()) this.world.removeCollider(collider, false);
    this.pinned.clear();
    for (const collider of this.frontier.values()) this.world.removeCollider(collider, false);
    this.frontier.clear();
    this.checkpoint.removeFromParent(); this.checkpoint.geometry.dispose(); (this.checkpoint.material as Material).dispose();
  }
}
