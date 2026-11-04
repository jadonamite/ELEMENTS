import { Group, Scene, Vector3, type Mesh, type Object3D } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AnimationPlayer } from '../anim/index.js';
import {
  SINDR_TOWNSFOLK,
  type RoutineActivity,
  type Townsperson,
  getTownspersonPosition,
} from './townsfolk.js';
import type { TownsfolkBody } from './townsfolk-bodies.js';
import type { CombatSpace } from '../attacks/space.js';

/** Beyond this a townsperson is neither drawn nor animated. */
const DRAW_DISTANCE = 55;
/** Beyond this a townsperson casts no shadow. */
const SHADOW_DISTANCE = 22;
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
const scratchFrom = new Vector3();
const scratchTo = new Vector3();
const scratchEnd = new Vector3();

export interface LiveTownsperson {
  data: Townsperson;
  object: Object3D;
  anim: AnimationPlayer | null;
  idleClip: string;
  walkClip: string;
  meshes: Mesh[];
  position: Vector3;
  targetPosition: Vector3;
  targetFacing: number;
  facing: number;
  currentActivity: RoutineActivity;
  walking: boolean;
  feelingScore: number; // 0..100 (LORE 15)
}

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

  constructor(private readonly scene: Scene, private readonly space: CombatSpace | null = null) {
    this.scene.add(this.group);
  }

  /** Puts every townsperson in the street on their own body, at their work place. */
  init(bodies: ReadonlyMap<string, TownsfolkBody>, people: readonly Townsperson[] = SINDR_TOWNSFOLK): void {
    for (const npc of people) {
      const body = bodies.get(npc.id);
      if (!body) continue;
      const object = cloneSkinned(body.model);
      const meshes: Mesh[] = [];
      object.traverse((n) => { if ((n as Mesh).isMesh) meshes.push(n as Mesh); });
      const anim = body.clips.length ? new AnimationPlayer(object, body.clips, { defaultFadeDuration: 0.25 }) : null;
      anim?.play(body.idle);
      // Each person starts at their own point in the clip, so a crowd never moves in step.
      anim?.mixer.update(Math.random() * 2);
      const start = npc.schedule.work;
      object.position.set(start.x, start.y, start.z);
      object.rotation.y = start.facing;
      this.group.add(object);
      this.townsfolk.push({
        data: npc,
        object,
        anim,
        idleClip: body.idle,
        walkClip: body.walk,
        meshes,
        position: new Vector3(start.x, start.y, start.z),
        targetPosition: new Vector3(start.x, start.y, start.z),
        targetFacing: start.facing,
        facing: start.facing,
        currentActivity: 'work',
        walking: false,
        feelingScore: 50,
      });
    }
  }

  update(delta: number, minute: number, playerPos: Vector3, threats: readonly Vector3[] = []): void {
    for (const person of this.townsfolk) {
      const target = getTownspersonPosition(minute, person.data);
      person.targetPosition.set(target.x, target.y, target.z);
      person.targetFacing = target.facing;
      // A fight nearby overrides the routine: run straight away from the closest fighter.
      const threat = nearest(threats, person.position);
      const fleeing = threat !== null && threat.distance < FEAR_RADIUS;
      // With no open street (behind a counter, in a doorway) they duck down where they are.
      const cowering = fleeing && !this.fleeTarget(person, threat.at, target.y);
      if (cowering) person.targetPosition.copy(person.position);

      const dx = person.targetPosition.x - person.position.x;
      const dz = person.targetPosition.z - person.position.z;
      const distSq = dx * dx + dz * dz;
      if (distSq > 0.08) {
        person.walking = true;
        const step = Math.min(Math.sqrt(distSq), (fleeing ? RUN_SPEED : WALK_SPEED) * delta);
        person.facing = Math.atan2(dx, dz);
        person.position.x += Math.sin(person.facing) * step;
        person.position.z += Math.cos(person.facing) * step;
      } else {
        person.walking = false;
        person.facing = person.targetFacing;
        person.position.x = target.x;
        person.position.z = target.z;
      }
      person.position.y = target.y;
      person.object.position.copy(person.position);
      person.object.rotation.y = person.facing;

      const far = Math.hypot(person.position.x - playerPos.x, person.position.z - playerPos.z);
      const shown = far < DRAW_DISTANCE;
      person.object.visible = shown;
      if (!shown) continue;
      const shadow = far < SHADOW_DISTANCE;
      if (person.meshes[0]?.castShadow !== shadow) for (const m of person.meshes) m.castShadow = shadow;
      person.anim?.play(cowering ? 'cower' : person.walking ? person.walkClip : person.idleClip);
      if (person.anim) person.anim.mixer.timeScale = fleeing ? RUN_SPEED / WALK_SPEED : 1;
      person.anim?.update(delta);
    }
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
