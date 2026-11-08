import { Frustum, Group, Matrix4, Scene, Sphere, Vector3, type Camera, type Mesh, type Object3D } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AnimationPlayer } from '../anim/index.js';
import {
  SINDR_TOWNSFOLK,
  type RoutineActivity,
  type Townsperson,
  getTownspersonActivity,
} from './townsfolk.js';
import { CrowdOcclusion, hidesHero } from './occlusion.js';
import { WalkMap, type WalkBounds, type WaterQuery } from './walk-map.js';
import { MARKET_SLICE, waterAt } from '../../../shared/src/world/ignis/market-slice.js';
import { IDLE, walkFor, type TownsfolkBody } from './townsfolk-bodies.js';
import type { CombatSpace } from '../attacks/space.js';
import type { Browse, Post } from '../world/builder.js';

/** Beyond this a townsperson is neither drawn nor animated. */
const DRAW_DISTANCE = 60;
/** At most this many people are drawn at once: the nearest in view. */
const DRAWN = 40;
/** The nearest this many drawn people cast shadows. */
const SHADOWED = 6;
/** Beyond this distance a drawn person's animation advances every third frame. */
const SLOW_ANIM_DISTANCE = 25;
/** Eyes and brows are too small to see beyond this, metres; further off they are not drawn. */
const FACE_DISTANCE = 14;
const WALK_SPEED = 1.8;
/** Townsfolk inside this distance of a fight run from it. */
const FEAR_RADIUS = 14;
const RUN_SPEED = 4.2;
/** A short quiet pause keeps the crowd in cover between attacks. */
const QUIET_SECONDS = 3;
const BODY_RADIUS = 0.35;

/** People keep this far apart, and this far from the hero; closer, they step aside. */
const PERSONAL_SPACE = 0.8;
const HERO_SPACE = 1.0;
/** Wanderers pick their next spot this far away, and rest this long between walks, seconds. */
const LEG_MIN = 5, LEG_MAX = 28;
const REST_MIN = 2, REST_MAX = 12;
/** How often a wanderer's next stop is goods to look at rather than open street, and how long they look. */
const BROWSE_CHANCE = 0.5;
const BROWSE_MIN = 5, BROWSE_MAX = 16;
/** A resting wanderer turns to face anyone this close, so standing people look like they talk. */
const TALK_FACE = 3;

const scratchFrom = new Vector3();
const scratchTo = new Vector3();
const sphere = new Sphere(new Vector3(), 1.2);
const frustum = new Frustum();
const viewProjection = new Matrix4();

export interface LiveTownsperson {
  data: Townsperson;
  nearBody: Object3D;
  occlusion: CrowdOcclusion;
  farBody: Object3D | null;
  farAnim: AnimationPlayer | null;
  farLoading: boolean;
  body: TownsfolkBody;
  object: Object3D;
  anim: AnimationPlayer | null;
  idleClip: string;
  walkClip: string;
  meshes: Mesh[];
  /** Eyes and brows, drawn only up close. */
  face: Mesh[];
  position: Vector3;
  /** Where the person is headed, and the corners of the way there still to reach. */
  targetPosition: Vector3;
  path: Vector3[];
  targetFacing: number;
  facing: number;
  currentActivity: RoutineActivity;
  walking: boolean;
  feelingScore: number; // 0..100 (LORE 15)
  /** Seconds left resting before a wanderer walks on. */
  rest: number;
  /** Animation time saved up while the person was drawn far away. */
  animDebt: number;
  /** Metres from the hero, this frame. */
  far: number;
  fleeing: boolean;
  shelter: Vector3 | null;
  returnTo: Vector3 | null;
  alarmAt: Vector3 | null;
  quiet: number;
  fearCheck: number;
  cowering: boolean;
  /** Where a browsing wanderer will look once there (the goods), or null on open street. */
  looking: number | null;
}

/** Where wanderers may stand and walk: street areas, sampled on a grid. */
export interface StreetArea { x0: number; x1: number; z0: number; z1: number; y: number }

/** Sindr's open ground: Cinder Row from gate to gate, the market street in among its stalls, the upper walk over the canal. */
export const SINDR_STREETS: readonly StreetArea[] = [
  { x0: 56, x1: 220, z0: -5, z1: 5, y: 0 },
  { x0: MARKET_SLICE.street.x0, x1: MARKET_SLICE.street.x1, z0: MARKET_SLICE.canal.z1, z1: MARKET_SLICE.street.stalls.z1, y: MARKET_SLICE.street.y },
  { ...MARKET_SLICE.upperWalk, y: MARKET_SLICE.terrace.y },
];
const GRID = 2.5;
/** Sindr's walk map starts on the market square and Cinder Row and spreads over the whole town. */
export const SINDR_WALK: { seeds: readonly Vector3[]; bounds: WalkBounds; water: WaterQuery } = {
  seeds: [new Vector3(125, 0, 3), new Vector3(80, 0, 0)], bounds: { x0: -10, x1: 240, z0: -200, z1: 60 },
  water: (x, z) => waterAt(x, z)?.surface ?? null,
};

function nearest(points: readonly Vector3[], from: Vector3): { at: Vector3; distance: number } | null {
  let best: { at: Vector3; distance: number } | null = null;
  for (const at of points) {
    const distance = Math.hypot(at.x - from.x, at.z - from.z);
    if (!best || distance < best.distance) best = { at, distance };
  }
  return best;
}

export class TownManager {
  readonly group = new Group();
  readonly townsfolk: LiveTownsperson[] = [];
  /** Open spots wanderers walk between; every one is clear of the world's solids. */
  readonly spots: Vector3[] = [];
  /** Where people can walk, read from the world. */
  map: WalkMap | null = null;
  /** Goods to stop and look at (stalls, tables, counters) that the walk map reaches, and the way to face them. */
  readonly sights: Array<{ at: Vector3; facing: number }> = [];
  readonly refuges: Vector3[] = [];
  private frame = 0;
  private refugeBudget = 0;
  private disposed = false;
  /** Where the hero stood this frame. */
  private readonly hero = new Vector3(Infinity, 0, Infinity);
  private readonly order: LiveTownsperson[] = [];

  constructor(private readonly scene: Scene, private readonly space: CombatSpace | null = null,
    private readonly random: () => number = Math.random, private readonly low = false) {
    this.scene.add(this.group);
  }

  /**
   * Puts every townsperson in the street on a copy of their look's body. With the world to ask, a walk map is
   * read from it first: everyone walks routes along it, and wanderers start on its open street cells.
   */
  async init(bodies: ReadonlyMap<string, TownsfolkBody>, people: readonly Townsperson[] = SINDR_TOWNSFOLK,
    streets: readonly StreetArea[] = SINDR_STREETS, walk: { seeds: readonly Vector3[]; bounds: WalkBounds; water?: WaterQuery } = SINDR_WALK,
    browse: readonly Browse[] = [], posts: readonly Post[] = []): Promise<void> {
    if (this.space) {
      this.map = await WalkMap.over(this.space, walk.seeds, walk.bounds, walk.water ?? null);
      for (const s of browse) {
        const at = new Vector3(s.x, s.y, s.z), i = this.map.nearest(at, 1.2);
        if (i !== null && Math.abs(this.map.y[i]! - s.y) < 0.5) this.sights.push({ at, facing: s.facing });
      }
      for (let i = 0; i < this.map.size; i++) {
        const x = this.map.x[i]!, z = this.map.z[i]!;
        if (streets.some(a => x >= a.x0 && x <= a.x1 && z >= a.z0 && z <= a.z1)) this.spots.push(new Vector3(x, this.map.y[i]!, z));
      }
    } else {
      for (const a of streets) for (let x = a.x0; x <= a.x1; x += GRID) for (let z = a.z0; z <= a.z1; z += GRID) this.spots.push(new Vector3(x, a.y, z));
    }
    for (const p of [...posts.filter(p => p.kind === 'household' || p.kind === 'keeper' || p.kind === 'smith'), ...browse]) {
      const at = this.place(p);
      if (Math.abs(at.y - p.y) < 0.6 && !this.refuges.some(r => r.distanceToSquared(at) < 0.5)) this.refuges.push(at);
    }
    for (const [i, npc] of people.entries()) {
      const body = bodies.get(npc.look ?? npc.id);
      if (!body) continue;
      const nearBody = cloneSkinned(body.model);
      const object = new Group();
      object.add(nearBody);
      const occlusion = new CrowdOcclusion();
      occlusion.attach(nearBody);
      const meshes: Mesh[] = [];
      object.traverse((n) => { if ((n as Mesh).isMesh) meshes.push(n as Mesh); });
      const face = meshes.filter(m => /^eye/i.test(m.name));
      const anim = body.clips.length ? new AnimationPlayer(object, body.clips, { defaultFadeDuration: 0.25 }) : null;
      const idle = IDLE[npc.role];
      anim?.play(idle);
      // Each person starts at their own point in the clip, so a crowd never moves in step.
      anim?.mixer.update(this.random() * 2);
      const start = npc.wander && this.spots.length
        ? this.spots[Math.floor(this.random() * this.spots.length)]!.clone()
        : this.place(npc.schedule.work, !!npc.post);
      const facing = npc.wander ? this.random() * Math.PI * 2 : npc.schedule.work.facing;
      object.position.copy(start);
      object.rotation.y = facing;
      object.visible = false;
      this.group.add(object);
      this.townsfolk.push({
        data: npc, object, nearBody, occlusion, farBody: null, farAnim: null, farLoading: false, body, anim, idleClip: idle, walkClip: walkFor(npc, i), meshes, face,
        position: start.clone(), targetPosition: start.clone(), path: [],
        targetFacing: facing, facing,
        currentActivity: getTownspersonActivity(0, npc), walking: false, feelingScore: 50,
        rest: this.random() * REST_MAX, animDebt: 0, far: 0, fleeing: false, cowering: false, looking: null, shelter: null, returnTo: null, alarmAt: null, quiet: 0, fearCheck: 0,
      });
    }
  }

  /**
   * Where a schedule point is actually stood on: the nearest walkable cell, so nobody waits inside a wall.
   * A post is built for a person to stand at (behind a counter, at a door), so it is stood on exactly.
   */
  private place(w: { x: number; y: number; z: number }, exact = false): Vector3 {
    const at = new Vector3(w.x, w.y, w.z);
    if (exact) return at;
    const i = this.map?.nearest(at);
    return i == null ? at : at.set(this.map!.x[i]!, this.map!.y[i]!, this.map!.z[i]!);
  }

  /** Sets where a person is going and the way there: along the walk map, or straight with no map. */
  private goTo(person: LiveTownsperson, goal: Vector3): void {
    person.targetPosition.copy(goal);
    person.path = this.map ? this.map.route(person.position, goal) : [goal.clone()];
    // A post is stepped onto from the walk map's last cell, the one step the map does not cover.
    const last = person.path[person.path.length - 1];
    if (person.data.post && this.map && (!last || last.distanceTo(goal) > 0.05)) person.path.push(goal.clone());
  }

  /** A wanderer's next stop: goods to look at, half the time, else some way off on the open street. */
  private nextSpot(person: LiveTownsperson): void {
    person.looking = null;
    if (this.sights.length && this.random() < BROWSE_CHANCE) {
      for (let tries = 0; tries < 8; tries++) {
        const s = this.sights[Math.floor(this.random() * this.sights.length)]!;
        const d = Math.hypot(s.at.x - person.position.x, s.at.z - person.position.z);
        if (d < 2 || d > LEG_MAX) continue;
        this.goTo(person, s.at);
        if (!person.path.length) continue;
        // The walk map ends on its cell; the last step up to the goods is taken when the body fits.
        const last = person.path[person.path.length - 1]!;
        if (last.distanceTo(s.at) > 0.05 && this.space?.clear(scratchFrom.copy(last).setY(last.y + 1), scratchTo.copy(s.at).setY(s.at.y + 1), BODY_RADIUS)) person.path.push(s.at.clone());
        person.looking = s.facing;
        return;
      }
    }
    for (let tries = 0; tries < 8; tries++) {
      const s = this.spots[Math.floor(this.random() * this.spots.length)]!;
      const d = Math.hypot(s.x - person.position.x, s.z - person.position.z);
      if (d < LEG_MIN || d > LEG_MAX) continue;
      this.goTo(person, s);
      if (person.path.length) return;
    }
  }

  update(delta: number, minute: number, playerPos: Vector3, threats: readonly Vector3[] = [], camera?: Camera): void {
    this.frame++;
    this.refugeBudget = 2;
    this.hero.copy(playerPos);
    for (const person of this.townsfolk) {
      const fleeing = this.respondToFight(person, delta, minute, threats);
      if (!fleeing) {
        if (person.data.wander) {
          if (!person.path.length) {
            person.rest -= delta;
            if (person.rest <= 0) {
              this.nextSpot(person);
              person.rest = person.looking !== null ? BROWSE_MIN + this.random() * (BROWSE_MAX - BROWSE_MIN) : REST_MIN + this.random() * (REST_MAX - REST_MIN);
            }
          }
        } else {
          const activity = getTownspersonActivity(minute, person.data);
          if (activity !== person.currentActivity) {
            person.currentActivity = activity;
            const target = person.data.schedule[activity];
            person.targetFacing = target.facing;
            this.goTo(person, this.place(target, !!person.data.post));
          }
        }
      }
      const next = person.path[0];
      if (!next) {
        if (person.fleeing && person.alarmAt) person.targetFacing = Math.atan2(person.alarmAt.x - person.position.x, person.alarmAt.z - person.position.z);
        else if (person.walking && person.data.wander) person.targetFacing = person.looking ?? person.facing;
        person.walking = false;
        person.facing = person.targetFacing;
        continue;
      }
      const dx = next.x - person.position.x, dz = next.z - person.position.z;
      const dist = Math.hypot(dx, dz);
      const step = Math.min(dist, (fleeing ? RUN_SPEED : WALK_SPEED) * delta);
      person.walking = true;
      if (dist > 1e-3) person.facing = Math.atan2(dx, dz);
      const k = dist > 1e-3 ? step / dist : 1;
      const ontoPost = !fleeing && !!person.data.post && person.path.length === 1 && dist < 3;
      if (ontoPost || this.move(person, dx * k, dz * k)) {
        if (ontoPost) { person.position.x += dx * k; person.position.z += dz * k; }
        person.position.y += (next.y - person.position.y) * k;
        if (dist - step < 0.05) person.path.shift();
      } else if (person.data.wander || fleeing) {
        // The way is shut (someone shoved them off the line): stop here and choose again.
        person.path = [];
        if (fleeing) person.shelter = null;
      } else if ((person.rest -= delta) <= 0) {
        // Shoved off their route: find the way again from here, at most once a second.
        person.rest = 1;
        this.goTo(person, person.targetPosition);
      }
    }
    this.makeRoom(playerPos, delta);
    this.draw(delta, playerPos, camera);
  }

  /**
   * People near the hero keep their personal space: two too close each step half the overlap apart,
   * and anyone the hero walks into steps out of the way. A step that would meet a wall is not taken.
   */
  private makeRoom(hero: Vector3, delta: number): void {
    const near = this.townsfolk.filter(p => Math.abs(p.position.x - hero.x) < 30 && Math.abs(p.position.z - hero.z) < 30);
    const ease = Math.min(1, delta * 8);
    for (let i = 0; i < near.length; i++) {
      const a = near[i]!;
      let px = 0, pz = 0;
      const hx = a.position.x - hero.x, hz = a.position.z - hero.z;
      const hd = Math.hypot(hx, hz);
      if (hd < HERO_SPACE && hd > 1e-4) { px += hx / hd * (HERO_SPACE - hd); pz += hz / hd * (HERO_SPACE - hd); }
      for (let j = 0; j < near.length; j++) {
        if (i === j) continue;
        const b = near[j]!;
        const x = a.position.x - b.position.x, z = a.position.z - b.position.z;
        const d = Math.hypot(x, z);
        if (d < PERSONAL_SPACE && d > 1e-4) { px += x / d * (PERSONAL_SPACE - d) * 0.5; pz += z / d * (PERSONAL_SPACE - d) * 0.5; }
      }
      if (px === 0 && pz === 0) continue;
      this.move(a, px * ease, pz * ease);
    }
  }

  /**
   * The one way a person moves: the step is taken only if the body fits all the way, and never deeper into the
   * hero's space (a person walking at the hero stops as at a wall, and chooses again).
   */
  private move(p: LiveTownsperson, dx: number, dz: number): boolean {
    const now = Math.hypot(p.position.x - this.hero.x, p.position.z - this.hero.z);
    const next = Math.hypot(p.position.x + dx - this.hero.x, p.position.z + dz - this.hero.z);
    if (next < HERO_SPACE && next < now) return false;
    if (!this.space) { p.position.x += dx; p.position.z += dz; return true; }
    const y = p.position.y + 1;
    if (this.space && !this.space.clear(scratchFrom.set(p.position.x, y, p.position.z), scratchTo.set(p.position.x + dx, y, p.position.z + dz), BODY_RADIUS)) return false;
    p.position.x += dx; p.position.z += dz;
    return true;
  }

  /** Only the nearest people in view are drawn and animated; far ones animate less often, the nearest cast shadows. */
  private draw(delta: number, hero: Vector3, camera?: Camera): void {
    if (camera) frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const order = this.order;
    order.length = 0;
    for (const p of this.townsfolk) {
      p.object.position.copy(p.position);
      p.object.rotation.y = p.facing;
      p.occlusion.update(!!camera && hidesHero(camera.position, hero, p.position, p.data.role === 'child' ? 1.3 : 1.9), delta);
      p.far = Math.hypot(p.position.x - hero.x, p.position.z - hero.z);
      let shown = p.far < (this.low ? 42 : DRAW_DISTANCE);
      if (shown && camera) shown = frustum.intersectsSphere(sphere.set(sphere.center.set(p.position.x, p.position.y + 0.9, p.position.z), 1.2));
      if (shown) order.push(p);
      else { p.object.visible = false; p.animDebt += delta; }
    }
    order.sort((a, b) => a.far - b.far);
    for (const [rank, p] of order.entries()) {
      const shown = rank < (this.low ? 24 : DRAWN);
      p.object.visible = shown;
      if (!shown) { p.animDebt += delta; continue; }
      const useFar = p.far > (this.low ? 10 : 16) || rank >= (this.low ? 4 : 8);
      if (useFar && !p.farBody && !p.farLoading && p.body.loadFar) {
        p.farLoading = true;
        void p.body.loadFar().then(body => {
          if (this.disposed) return;
          const model = cloneSkinned(body.model);
          p.farBody = model;
          p.occlusion.attach(model);
          model.visible = false;
          p.object.add(model);
          p.farAnim = body.clips.length ? new AnimationPlayer(model, body.clips) : null;
        }).catch(error => { console.error('Townsperson detail failed to load:', error); });
      }
      p.nearBody.visible = !useFar || !p.farBody;
      if (p.farBody) p.farBody.visible = useFar;
      const anim = useFar && p.farBody ? p.farAnim : p.anim;
      const close = p.far < FACE_DISTANCE;
      if (p.face[0] && p.face[0].visible !== close) for (const m of p.face) m.visible = close;
      const shadow = !this.low && rank < SHADOWED && !useFar;
      if (p.meshes[0]?.castShadow !== shadow) for (const m of p.meshes) m.castShadow = shadow;
      if (p.data.wander && !p.fleeing && !p.walking && p.looking === null) this.faceCompany(p);
      anim?.play(p.cowering ? 'cower' : p.walking ? p.walkClip : p.idleClip);
      if (anim) anim.mixer.timeScale = p.fleeing && p.walking ? RUN_SPEED / WALK_SPEED : 1;
      p.animDebt += delta;
      if (p.far > SLOW_ANIM_DISTANCE && (this.frame + rank) % 3 !== 0) continue;
      // Time missed while hidden is capped, so a returning person does not jump through a clip.
      anim?.update(Math.min(p.animDebt, 0.25));
      p.animDebt = 0;
    }
  }

  /** A resting wanderer turns toward the nearest person standing close, as if talking to them. */
  private faceCompany(p: LiveTownsperson): void {
    let best: LiveTownsperson | null = null, bestD = TALK_FACE;
    for (const o of this.order) {
      if (o === p) continue;
      const d = Math.hypot(o.position.x - p.position.x, o.position.z - p.position.z);
      if (d < bestD) { bestD = d; best = o; }
    }
    if (best) p.facing = Math.atan2(best.position.x - p.position.x, best.position.z - p.position.z);
    p.object.rotation.y = p.facing;
  }

  /** Hold one refuge through the fight, then resume the current routine after a quiet interval. */
  private respondToFight(p: LiveTownsperson, delta: number, minute: number, threats: readonly Vector3[]): boolean {
    const threat = nearest(threats, p.position);
    if (!p.fleeing && threat && threat.distance < FEAR_RADIUS) {
      p.fleeing = true;
      p.returnTo = p.position.clone();
      p.alarmAt = threat.at.clone();
      p.looking = null;
      p.path = [];
      p.fearCheck = 0;
    }
    if (!p.fleeing) return false;
    const ongoing = p.alarmAt && threats.some(t => t.distanceToSquared(p.alarmAt!) < (FEAR_RADIUS * 2) ** 2);
    p.quiet = ongoing ? QUIET_SECONDS : p.quiet - delta;
    if (p.quiet <= 0) {
      p.fleeing = false; p.cowering = false; p.shelter = null; p.alarmAt = null;
      p.currentActivity = getTownspersonActivity(minute, p.data);
      const goal = p.data.wander ? p.returnTo! : this.place(p.data.schedule[p.currentActivity], !!p.data.post);
      this.goTo(p, goal);
      if (!p.data.wander) p.targetFacing = p.data.schedule[p.currentActivity].facing;
      p.returnTo = null;
      p.rest = REST_MAX;
      return false;
    }
    p.fearCheck -= delta;
    if (p.fearCheck <= 0 && threats.length) {
      if (p.shelter && !p.path.length && p.position.distanceTo(p.shelter) > 1.5) p.shelter = null;
      if (!p.shelter || !this.sheltered(p.shelter, threats)) {
        if (this.refugeBudget <= 0) return true;
        this.refugeBudget--;
        p.shelter = this.findRefuge(p, threats);
        p.cowering = !p.shelter;
        if (!p.shelter) p.path = [];
      }
      p.fearCheck = 1;
    }
    return true;
  }

  private sheltered(at: Vector3, threats: readonly Vector3[]): boolean {
    return threats.every(t => {
      const d = at.distanceTo(t);
      if (d < 3.5) return false;
      if (d > FEAR_RADIUS + 1) return true;
      return !!this.space && !this.space.clear(scratchFrom.copy(t).setY(t.y + 1), scratchTo.copy(at).setY(at.y + 1), BODY_RADIUS);
    });
  }

  /** Prefer nearby doorways and the backs of stalls; open street beyond the fight is the fallback. */
  private findRefuge(p: LiveTownsperson, threats: readonly Vector3[]): Vector3 | null {
    const score = (at: Vector3): number => at.distanceTo(p.position)
      + this.townsfolk.filter(o => o !== p && o.shelter && o.shelter.distanceToSquared(at) < 2).length * 3;
    const candidates = [...this.refuges, ...this.spots.filter(s => nearest(threats, s)!.distance > FEAR_RADIUS + 1)]
      .filter(at => at.distanceTo(p.position) < 32 && this.sheltered(at, threats))
      .map(at => ({ at, score: score(at) })).sort((a, b) => a.score - b.score);
    for (const { at } of candidates.slice(0, 24)) {
      const path = this.map ? this.map.route(p.position, at, threats, 1.2) : [at.clone()];
      if (!path.length && p.position.distanceTo(at) > 1.2) continue;
      p.targetPosition.copy(at);
      p.path = path;
      return at.clone();
    }
    return null;
  }

  /**
   * Who the player means to talk to: people within reach in front of the camera, nearest and most
   * centred first. Anyone closer than `besideRadius` counts even when off to the side.
   */
  getTalkTarget(heroPos: Vector3, facingX: number, facingZ: number, maxRadius: number, minDot: number,
    besideRadius: number): LiveTownsperson | null {
    let best: LiveTownsperson | null = null;
    let bestScore = Infinity;
    const len = Math.hypot(facingX, facingZ) || 1;
    const fx = facingX / len, fz = facingZ / len;
    for (const person of this.townsfolk) {
      const dx = person.position.x - heroPos.x, dz = person.position.z - heroPos.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= maxRadius) continue;
      const dot = dist > 1e-3 ? (dx * fx + dz * fz) / dist : 1;
      if (dot < minDot && dist >= besideRadius) continue;
      const score = dist / (0.5 + Math.max(0, dot));
      if (score < bestScore) { bestScore = score; best = person; }
    }
    return best;
  }

  getNearestTownsperson(heroPos: Vector3, maxRadius = 3.5): LiveTownsperson | null {
    let nearest: LiveTownsperson | null = null;
    let minDist = maxRadius;
    for (const person of this.townsfolk) {
      const dist = Math.hypot(heroPos.x - person.position.x, heroPos.z - person.position.z);
      if (dist < minDist) {
        minDist = dist;
        nearest = person;
      }
    }
    return nearest;
  }

  dispose(): void {
    this.disposed = true;
    for (const person of this.townsfolk) { person.anim?.dispose(); person.farAnim?.dispose(); person.occlusion.dispose(); }
    this.townsfolk.length = 0;
    this.group.clear();
    this.scene.remove(this.group);
  }
}
