import { Frustum, Group, Matrix4, Scene, Sphere, Vector3, type Camera, type Mesh, type Object3D } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AnimationPlayer } from '../anim/index.js';
import {
  SINDR_TOWNSFOLK,
  type RoutineActivity,
  type Townsperson,
  getTownspersonPosition,
} from './townsfolk.js';
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
  targetPosition: Vector3;
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
  private frame = 0;
  private readonly order: LiveTownsperson[] = [];

  constructor(private readonly scene: Scene, private readonly space: CombatSpace | null = null,
    private readonly random: () => number = Math.random) {
    this.scene.add(this.group);
  }

  /** Puts every townsperson in the street on a copy of their look's body; wanderers start on open spots. */
  init(bodies: ReadonlyMap<string, TownsfolkBody>, people: readonly Townsperson[] = SINDR_TOWNSFOLK,
    streets: readonly StreetArea[] = SINDR_STREETS): void {
    if (people.some(p => p.wander)) this.findSpots(streets);
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
        ? { ...this.spots[Math.floor(this.random() * this.spots.length)]!, facing: this.random() * Math.PI * 2 }
        : npc.schedule.work;
      object.position.set(start.x, start.y, start.z);
      object.rotation.y = start.facing;
      object.visible = false;
      this.group.add(object);
      const person: LiveTownsperson = {
        data: npc, object, anim, idleClip: idle, walkClip: walkFor(npc, i), meshes, face,
        position: new Vector3(start.x, start.y, start.z),
        targetPosition: new Vector3(start.x, start.y, start.z),
        targetFacing: start.facing, facing: start.facing,
        currentActivity: 'work', walking: false, feelingScore: 50,
        rest: this.random() * REST_MAX, animDebt: 0, far: 0, fleeing: false, cowering: false,
      };
      this.townsfolk.push(person);
    }
  }

  /** Grid points on the streets where a person fits without touching anything solid. */
  private findSpots(streets: readonly StreetArea[]): void {
    for (const a of streets) {
      for (let x = a.x0; x <= a.x1; x += GRID) {
        for (let z = a.z0; z <= a.z1; z += GRID) {
          if (this.spots.some(s => Math.abs(s.x - x) < 0.1 && Math.abs(s.z - z) < 0.1)) continue;
          const at = new Vector3(x, a.y, z);
          if (!this.space || this.space.clear(scratchFrom.set(x, a.y + 1, z), scratchTo.set(x + 0.01, a.y + 1, z), BODY_RADIUS + 0.15)) this.spots.push(at);
        }
      }
    }
  }

  /** A wanderer's next spot: some way off, reached by a straight walk that touches nothing. */
  private nextSpot(person: LiveTownsperson): void {
    for (let tries = 0; tries < 8; tries++) {
      const s = this.spots[Math.floor(this.random() * this.spots.length)]!;
      const d = Math.hypot(s.x - person.position.x, s.z - person.position.z);
      if (d < LEG_MIN || d > LEG_MAX) continue;
      if (this.space && !this.space.clear(scratchFrom.set(person.position.x, s.y + 1, person.position.z), scratchTo.set(s.x, s.y + 1, s.z), BODY_RADIUS)) continue;
      person.targetPosition.copy(s);
      return;
    }
  }

  update(delta: number, minute: number, playerPos: Vector3, threats: readonly Vector3[] = [], camera?: Camera): void {
    this.frame++;
    for (const person of this.townsfolk) {
      let routineY = person.position.y;
      if (person.data.wander) {
        if (!person.walking) {
          person.rest -= delta;
          if (person.rest <= 0) { this.nextSpot(person); person.rest = REST_MIN + this.random() * (REST_MAX - REST_MIN); }
        }
      } else {
        const target = getTownspersonPosition(minute, person.data);
        person.targetPosition.set(target.x, target.y, target.z);
        person.targetFacing = target.facing;
        routineY = target.y;
      }
      // A fight nearby overrides the routine: run straight away from the closest fighter.
      const threat = nearest(threats, person.position);
      const fleeing = threat !== null && threat.distance < FEAR_RADIUS;
      // With no open street (behind a counter, in a doorway) they duck down where they are.
      const cowering = fleeing && !this.fleeTarget(person, threat.at, routineY);
      if (cowering) person.targetPosition.copy(person.position);
      person.fleeing = fleeing;
      person.cowering = cowering;

      const dx = person.targetPosition.x - person.position.x;
      const dz = person.targetPosition.z - person.position.z;
      const distSq = dx * dx + dz * dz;
      if (distSq > 0.08) {
        person.walking = true;
        const step = Math.min(Math.sqrt(distSq), (fleeing ? RUN_SPEED : WALK_SPEED) * delta);
        person.facing = Math.atan2(dx, dz);
        // A wanderer whose way is shut ends the walk where it is and picks another spot after a rest.
        if (!this.move(person, Math.sin(person.facing) * step, Math.cos(person.facing) * step) && person.data.wander) {
          person.targetPosition.copy(person.position);
        }
      } else {
        if (person.walking && person.data.wander) person.targetFacing = person.facing;
        person.walking = false;
        if (!person.data.wander) { person.position.x = person.targetPosition.x; person.position.z = person.targetPosition.z; }
        person.facing = person.targetFacing;
      }
      person.position.y = routineY;
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
   * The one way a person moves: a wanderer's step is taken only if the body fits all the way.
   * People on a schedule walk their schedule's straight lines until they have routes of their own.
   */
  private move(p: LiveTownsperson, dx: number, dz: number): boolean {
    if (!p.data.wander || !this.space) { p.position.x += dx; p.position.z += dz; return true; }
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
      if (run > best) { best = run; person.targetPosition.set(end.x, y, end.z); }
    }
    return best >= MIN_FLEE_RUN;
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
