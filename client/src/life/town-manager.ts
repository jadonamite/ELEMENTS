import { Frustum, Group, Matrix4, Scene, Sphere, Vector3, type Camera, type Mesh, type Object3D } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AnimationPlayer } from '../anim/index.js';
import {
  SINDR_TOWNSFOLK,
  type RoutineActivity,
  type Townsperson,
  getTownspersonActivity,
} from './townsfolk.js';
import { WalkMap, type WalkBounds } from './walk-map.js';
import { IDLE, walkFor, type TownsfolkBody } from './townsfolk-bodies.js';
import type { CombatSpace } from '../attacks/space.js';

/** Beyond this a townsperson is neither drawn nor animated. */
const DRAW_DISTANCE = 60;
/** At most this many people are drawn at once: the nearest in view. */
const DRAWN = 40;
/** The nearest this many drawn people cast shadows. */
const SHADOWED = 10;
/** Beyond this distance a drawn person's animation advances every third frame. */
const SLOW_ANIM_DISTANCE = 25;
/** Eyes and brows are too small to see beyond this, metres; further off they are not drawn. */
const FACE_DISTANCE = 14;
const WALK_SPEED = 1.8;
/** Townsfolk inside this distance of a fight run from it. */
const FEAR_RADIUS = 14;
const RUN_SPEED = 4.2;
/** How far ahead a fleeing person looks for open street, and the turns from straight away they try. */
const FLEE_LOOK = 6;
const FLEE_TURNS = [0, 0.6, -0.6, 1.2, -1.2];
const BODY_RADIUS = 0.35;
/** Less open street than this in every direction and a person cowers instead. */
const MIN_FLEE_RUN = 1;
/** People keep this far apart, and this far from the hero; closer, they step aside. */
const PERSONAL_SPACE = 0.8;
const HERO_SPACE = 1.0;
/** Wanderers pick their next spot this far away, and rest this long between walks, seconds. */
const LEG_MIN = 5, LEG_MAX = 28;
const REST_MIN = 2, REST_MAX = 12;
/** A resting wanderer turns to face anyone this close, so standing people look like they talk. */
const TALK_FACE = 3;

const scratchFrom = new Vector3();
const scratchTo = new Vector3();
const scratchEnd = new Vector3();
const scratchFlee = new Vector3();
const sphere = new Sphere(new Vector3(), 1.2);
const frustum = new Frustum();
const viewProjection = new Matrix4();

export interface LiveTownsperson {
  data: Townsperson;
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
  cowering: boolean;
}

/** Where wanderers may stand and walk: street areas, sampled on a grid. */
export interface StreetArea { x0: number; x1: number; z0: number; z1: number; y: number }

/** Sindr's open ground: Cinder Row from gate to gate and the market square. */
export const SINDR_STREETS: readonly StreetArea[] = [
  { x0: 56, x1: 220, z0: -5, z1: 5, y: 0 },
  { x0: 104, x1: 146, z0: -15, z1: 15, y: 0 },
];
const GRID = 2.5;
/** Sindr's walk map starts on the market square and Cinder Row and spreads over the whole town. */
export const SINDR_WALK = { seeds: [new Vector3(125, 0, 3), new Vector3(80, 0, 0)], bounds: { x0: -10, x1: 240, z0: -200, z1: 60 } };

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
  private frame = 0;
  private readonly order: LiveTownsperson[] = [];

  constructor(private readonly scene: Scene, private readonly space: CombatSpace | null = null,
    private readonly random: () => number = Math.random) {
    this.scene.add(this.group);
  }

  /**
   * Puts every townsperson in the street on a copy of their look's body. With the world to ask, a walk map is
   * read from it first: everyone walks routes along it, and wanderers start on its open street cells.
   */
  async init(bodies: ReadonlyMap<string, TownsfolkBody>, people: readonly Townsperson[] = SINDR_TOWNSFOLK,
    streets: readonly StreetArea[] = SINDR_STREETS, walk: { seeds: readonly Vector3[]; bounds: WalkBounds } = SINDR_WALK): Promise<void> {
    if (this.space) {
      this.map = await WalkMap.over(this.space, walk.seeds, walk.bounds);
      for (let i = 0; i < this.map.size; i++) {
        const x = this.map.x[i]!, z = this.map.z[i]!;
        if (streets.some(a => x >= a.x0 && x <= a.x1 && z >= a.z0 && z <= a.z1)) this.spots.push(new Vector3(x, this.map.y[i]!, z));
      }
    } else {
      for (const a of streets) for (let x = a.x0; x <= a.x1; x += GRID) for (let z = a.z0; z <= a.z1; z += GRID) this.spots.push(new Vector3(x, a.y, z));
    }
    for (const [i, npc] of people.entries()) {
      const body = bodies.get(npc.look ?? npc.id);
      if (!body) continue;
      const object = cloneSkinned(body.model);
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
        : this.place(npc.schedule.work);
      const facing = npc.wander ? this.random() * Math.PI * 2 : npc.schedule.work.facing;
      object.position.copy(start);
      object.rotation.y = facing;
      object.visible = false;
      this.group.add(object);
      this.townsfolk.push({
        data: npc, object, anim, idleClip: idle, walkClip: walkFor(npc, i), meshes, face,
        position: start.clone(), targetPosition: start.clone(), path: [],
        targetFacing: facing, facing,
        currentActivity: getTownspersonActivity(0, npc), walking: false, feelingScore: 50,
        rest: this.random() * REST_MAX, animDebt: 0, far: 0, fleeing: false, cowering: false,
      });
    }
  }

  /** Where a schedule point is actually stood on: the nearest walkable cell, so nobody waits inside a wall. */
  private place(w: { x: number; y: number; z: number }): Vector3 {
    const at = new Vector3(w.x, w.y, w.z);
    const i = this.map?.nearest(at);
    return i == null ? at : at.set(this.map!.x[i]!, this.map!.y[i]!, this.map!.z[i]!);
  }

  /** Sets where a person is going and the way there: along the walk map, or straight with no map. */
  private goTo(person: LiveTownsperson, goal: Vector3): void {
    person.targetPosition.copy(goal);
    person.path = this.map ? this.map.route(person.position, goal) : [goal.clone()];
  }

  /** A wanderer's next spot: some way off on the open street. */
  private nextSpot(person: LiveTownsperson): void {
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
    for (const person of this.townsfolk) {
      if (person.data.wander) {
        if (!person.path.length) {
          person.rest -= delta;
          if (person.rest <= 0) { this.nextSpot(person); person.rest = REST_MIN + this.random() * (REST_MAX - REST_MIN); }
        }
      } else {
        const activity = getTownspersonActivity(minute, person.data);
        if (activity !== person.currentActivity) {
          person.currentActivity = activity;
          const target = person.data.schedule[activity];
          person.targetFacing = target.facing;
          this.goTo(person, this.place(target));
        }
      }
      // A fight nearby overrides the routine: run straight away from the closest fighter.
      const threat = nearest(threats, person.position);
      const fleeing = threat !== null && threat.distance < FEAR_RADIUS;
      // With no open street (behind a counter, in a doorway) they duck down where they are.
      const cowering = fleeing && !this.fleeTarget(person, threat.at, person.position.y);
      if (cowering) person.path = [];
      // Once the fight is over, people on a schedule head back to where they belong.
      if (person.fleeing && !fleeing && !person.data.wander) this.goTo(person, this.place(person.data.schedule[person.currentActivity]));
      person.fleeing = fleeing;
      person.cowering = cowering;

      const next = person.path[0];
      if (!next) {
        if (person.walking && person.data.wander) person.targetFacing = person.facing;
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
      if (this.move(person, dx * k, dz * k)) {
        person.position.y += (next.y - person.position.y) * k;
        if (dist - step < 0.05) person.path.shift();
      } else if (person.data.wander || fleeing) {
        // The way is shut (someone shoved them off the line): stop here and choose again.
        person.path = [];
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
   * The one way a person moves: the step is taken only if the body fits all the way.
   */
  private move(p: LiveTownsperson, dx: number, dz: number): boolean {
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
      p.far = Math.hypot(p.position.x - hero.x, p.position.z - hero.z);
      let shown = p.far < DRAW_DISTANCE;
      if (shown && camera) shown = frustum.intersectsSphere(sphere.set(sphere.center.set(p.position.x, p.position.y + 0.9, p.position.z), 1.2));
      if (shown) order.push(p);
      else { p.object.visible = false; p.animDebt += delta; }
    }
    order.sort((a, b) => a.far - b.far);
    for (const [rank, p] of order.entries()) {
      const shown = rank < DRAWN;
      p.object.visible = shown;
      if (!shown) { p.animDebt += delta; continue; }
      const close = p.far < FACE_DISTANCE;
      if (p.face[0] && p.face[0].visible !== close) for (const m of p.face) m.visible = close;
      const shadow = rank < SHADOWED;
      if (p.meshes[0]?.castShadow !== shadow) for (const m of p.meshes) m.castShadow = shadow;
      if (p.data.wander && !p.walking) this.faceCompany(p);
      p.anim?.play(p.cowering ? 'cower' : p.walking ? p.walkClip : p.idleClip);
      if (p.anim) p.anim.mixer.timeScale = p.fleeing ? RUN_SPEED / WALK_SPEED : 1;
      p.animDebt += delta;
      if (p.far > SLOW_ANIM_DISTANCE && (this.frame + rank) % 3 !== 0) continue;
      // Time missed while hidden is capped, so a returning person does not jump through a clip.
      p.anim?.update(Math.min(p.animDebt, 0.25));
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

  /**
   * The direction away from the fight with the most open street, as far as the world allows.
   * False when every direction is shut.
   */
  private fleeTarget(person: LiveTownsperson, threat: Vector3, y: number): boolean {
    const away = Math.atan2(person.position.x - threat.x, person.position.z - threat.z);
    const from = scratchFrom.set(person.position.x, person.position.y + 1, person.position.z);
    let best = -1;
    for (const turn of FLEE_TURNS) {
      const a = away + turn;
      scratchTo.set(from.x + Math.sin(a) * FLEE_LOOK, from.y, from.z + Math.cos(a) * FLEE_LOOK);
      const end = this.space ? this.space.reachable(from, scratchTo, BODY_RADIUS, scratchEnd) : scratchEnd.copy(scratchTo);
      const run = Math.hypot(end.x - from.x, end.z - from.z);
      if (run > best) { best = run; scratchFlee.set(end.x, y, end.z); }
    }
    if (best < MIN_FLEE_RUN) return false;
    const last = person.path[person.path.length - 1];
    if (!person.fleeing || !last || last.distanceToSquared(scratchFlee) > 4) person.path = [scratchFlee.clone()];
    return true;
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
    for (const person of this.townsfolk) person.anim?.mixer.stopAllAction();
    this.townsfolk.length = 0;
    this.group.clear();
    this.scene.remove(this.group);
  }
}
