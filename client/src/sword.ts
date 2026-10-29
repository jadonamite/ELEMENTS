import { type Bone, Quaternion, Vector3 } from 'three';
import balance from '../../shared/balance.json';
import type { HeroInstance } from './hero.js';

const tuning = balance.stance;
export type SwordPhase = 'sheathed' | 'drawing' | 'armed' | 'sheathing';

/**
 * Draws and sheathes the sword: the right arm reaches over the shoulder to the
 * hilt, the sword changes sockets when the hand arrives, and the arm returns.
 */
export class SwordStance {
  phase: SwordPhase = 'sheathed';
  private elapsed = 0;
  private length = 0;
  private swapped = false;
  private readonly upper: Bone;
  private readonly lower: Bone;
  private readonly hand: Bone;

  constructor(private readonly hero: HeroInstance) {
    const bone = (name: string): Bone => {
      const found = hero.model.getObjectByName(name) as Bone | undefined;
      if (!found) throw new Error(`Bone ${name} not found in hero rig.`);
      return found;
    };
    this.upper = bone('upperarm_r');
    this.lower = bone('lowerarm_r');
    this.hand = bone('hand_r');
  }

  /** Sword in hand and ready to fight. */
  get armed(): boolean { return this.phase === 'armed'; }
  /** Drawing or drawn: the fighting side of the stance. */
  get engaged(): boolean { return this.phase === 'drawing' || this.phase === 'armed'; }

  /** `fast` is the quick draw used when an attack or guard asks for the sword. */
  draw(fast: boolean): void {
    if (this.phase === 'armed' || this.phase === 'drawing') return;
    this.begin('drawing', fast ? tuning.fastDrawSeconds : tuning.drawSeconds);
  }

  sheathe(): void {
    if (this.phase !== 'armed') return;
    this.begin('sheathing', tuning.sheatheSeconds);
  }

  /** Call after the animation mixer has posed the skeleton for this frame. */
  update(delta: number): void {
    if (this.phase !== 'drawing' && this.phase !== 'sheathing') return;
    this.elapsed += delta;
    const t = Math.min(1, this.elapsed / this.length);
    if (!this.swapped && t >= tuning.swapAt) {
      this.swapped = true;
      this.hero.arm(this.phase === 'drawing');
    }
    // The reach rises to the hilt at the swap and eases back out after it.
    const weight = t < tuning.swapAt ? smooth(t / tuning.swapAt) : smooth((1 - t) / (1 - tuning.swapAt));
    this.hero.model.updateMatrixWorld(true);
    reach(this.upper, this.lower, this.hand, this.hero.backSocket.getWorldPosition(new Vector3()), weight);
    if (t >= 1) this.phase = this.phase === 'drawing' ? 'armed' : 'sheathed';
  }

  private begin(phase: SwordPhase, seconds: number): void {
    this.phase = phase;
    this.elapsed = 0;
    this.length = seconds;
    this.swapped = false;
  }
}

const smooth = (x: number): number => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); };

/** Two-bone reach: bend the elbow in its current plane so the wrist meets `target`, blended by `weight`. */
function reach(upper: Bone, lower: Bone, hand: Bone, target: Vector3, weight: number): void {
  if (weight <= 0) return;
  const shoulder = upper.getWorldPosition(new Vector3());
  const elbow = lower.getWorldPosition(new Vector3());
  const wrist = hand.getWorldPosition(new Vector3());
  const upperLength = shoulder.distanceTo(elbow);
  const lowerLength = elbow.distanceTo(wrist);
  const toTarget = new Vector3().subVectors(target, shoulder);
  const distance = Math.min(Math.max(toTarget.length(), 0.01), upperLength + lowerLength - 0.001);
  const aim = toTarget.normalize();
  // Keep the elbow on the side it already bends toward.
  const bend = new Vector3().subVectors(elbow, shoulder);
  const side = bend.clone().sub(aim.clone().multiplyScalar(bend.dot(aim)));
  if (side.lengthSq() < 1e-6) side.set(0, -1, 0).sub(aim.clone().multiplyScalar(-aim.y));
  side.normalize();
  const cosShoulder = (upperLength ** 2 + distance ** 2 - lowerLength ** 2) / (2 * upperLength * distance);
  const angle = Math.acos(Math.max(-1, Math.min(1, cosShoulder)));
  const newElbow = shoulder.clone()
    .addScaledVector(aim, Math.cos(angle) * upperLength)
    .addScaledVector(side, Math.sin(angle) * upperLength);
  const goal = shoulder.clone().addScaledVector(aim, distance);
  turnBone(upper, elbow.clone().sub(shoulder), newElbow.clone().sub(shoulder), weight);
  upper.updateMatrixWorld(true);
  const movedElbow = lower.getWorldPosition(new Vector3());
  const movedWrist = hand.getWorldPosition(new Vector3());
  turnBone(lower, movedWrist.sub(movedElbow), goal.sub(movedElbow), weight);
  lower.updateMatrixWorld(true);
}

/** Rotate a bone so a world direction `from` turns toward `to`, by `weight`. */
function turnBone(bone: Bone, from: Vector3, to: Vector3, weight: number): void {
  const swing = new Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
  const world = bone.getWorldQuaternion(new Quaternion());
  const parent = bone.parent!.getWorldQuaternion(new Quaternion());
  const turned = parent.invert().multiply(swing.multiply(world));
  bone.quaternion.slerp(turned, weight);
}
