import { type Bone, Line3, Quaternion, Vector3 } from 'three';
import balance from '../../shared/balance.json';
import type { HeroInstance } from './hero.js';
import { StaffAirTrail } from './weapon.js';

const tuning = balance.stance;
export type SwordPhase = 'sheathed' | 'drawing' | 'armed' | 'sheathing';

/**
 * Draws and sheathes the weapon: the right arm reaches over the shoulder to the
 * hilt/socket, the weapon changes sockets when the hand arrives, and the arm returns.
 * For two-handed weapons like the staff, also aligns the secondary hand in the grip
 * and manages the weapon's air ripple trail during elemental swings.
 */
export class SwordStance {
  phase: SwordPhase = 'sheathed';
  private elapsed = 0;
  private length = 0;
  private swapped = false;
  private readonly upper: Bone;
  private readonly lower: Bone;
  private readonly hand: Bone;
  private readonly upperL: Bone;
  private readonly lowerL: Bone;
  private readonly handL: Bone;
  private readonly staffTrail: StaffAirTrail;
  private readonly tipPrev = new Vector3();

  constructor(private readonly hero: HeroInstance) {
    const bone = (name: string): Bone => {
      const found = hero.model.getObjectByName(name) as Bone | undefined;
      if (!found) throw new Error(`Bone ${name} not found in hero rig.`);
      return found;
    };
    this.upper = bone('upperarm_r');
    this.lower = bone('lowerarm_r');
    this.hand = bone('hand_r');
    this.upperL = bone('upperarm_l');
    this.lowerL = bone('lowerarm_l');
    this.handL = bone('hand_l');
    this.staffTrail = new StaffAirTrail(hero.model);
  }

  /** Weapon in hand and ready to fight. */
  get armed(): boolean { return this.phase === 'armed'; }
  /** Drawing or drawn: the fighting side of the stance. */
  get engaged(): boolean { return this.phase === 'drawing' || this.phase === 'armed'; }

  /** `fast` is the quick draw used when an attack or guard asks for the weapon. */
  draw(fast: boolean): void {
    if (this.phase === 'armed' || this.phase === 'drawing') return;
    this.begin('drawing', fast ? tuning.fastDrawSeconds : tuning.drawSeconds);
  }

  sheathe(): void {
    if (this.phase !== 'armed') return;
    this.begin('sheathing', tuning.sheatheSeconds);
  }

  /** Immediately places the weapon into the hand socket with no draw interpolation. */
  forceArm(): void {
    this.phase = 'armed';
    this.elapsed = 0;
    this.length = 0;
    this.swapped = true;
    this.hero.arm(true);
  }

  /** Immediately places the weapon into the sheathed back socket with no draw interpolation. */
  forceSheathe(): void {
    this.phase = 'sheathed';
    this.elapsed = 0;
    this.length = 0;
    this.swapped = true;
    this.hero.arm(false);
  }

  /** Call after the animation mixer has posed the skeleton for this frame. */
  update(delta: number): void {
    if (this.phase === 'drawing' || this.phase === 'sheathing') {
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

    // Two-handed grip when armed with staff
    if (this.phase === 'armed' && this.hero.weaponSlot.type === 'staff') {
      this.hero.model.updateMatrixWorld(true);
      // Secondary hand grips along the middle third of the staff closest to left shoulder
      const shoulderL = this.upperL.getWorldPosition(new Vector3());
      const p1 = this.hero.sword.localToWorld(new Vector3(0, -0.28, 0));
      const p2 = this.hero.sword.localToWorld(new Vector3(0, 0.28, 0));
      const gripLine = new Line3(p1, p2);
      const targetL = new Vector3();
      gripLine.closestPointToPoint(shoulderL, true, targetL);
      reach(this.upperL, this.lowerL, this.handL, targetL, 1.0);
      this.hero.model.updateMatrixWorld(true);

      // Thin pale-white air ripple ribbon trailing the staff tip on swing when AURA bends with staff
      const tip = this.hero.sword.localToWorld(this.hero.bladeTip.clone());
      const base = this.hero.sword.localToWorld(new Vector3(0, 0.55, 0));
      const moved = this.tipPrev.distanceTo(tip);
      const speed = delta > 0 ? moved / delta : 0;
      this.tipPrev.copy(tip);
      const alpha = this.hero.elemental ? Math.min(1, Math.max(0, (speed - 1.8) / 4.0)) : 0;
      this.staffTrail.record(base, tip, alpha);
    }

    this.staffTrail.update(delta);
  }

  dispose(): void {
    this.staffTrail.dispose();
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
  if (upperLength < 1e-4 || lowerLength < 1e-4) return;
  const toTarget = new Vector3().subVectors(target, shoulder);
  const distance = Math.min(Math.max(toTarget.length(), 0.01), upperLength + lowerLength - 0.001);
  const aim = toTarget.normalize();
  // Keep the elbow on the side it already bends toward.
  const bend = new Vector3().subVectors(elbow, shoulder);
  const side = bend.clone().sub(aim.clone().multiplyScalar(bend.dot(aim)));
  if (side.lengthSq() < 1e-6) side.set(0, -1, 0).sub(aim.clone().multiplyScalar(-aim.y));
  side.normalize();
  const cosShoulder = (upperLength ** 2 + distance ** 2 - lowerLength ** 2) / (2 * upperLength * distance);
  if (Number.isNaN(cosShoulder)) return;
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
  if (from.lengthSq() < 1e-6 || to.lengthSq() < 1e-6) return;
  const swing = new Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
  if (Number.isNaN(swing.x) || Number.isNaN(swing.y) || Number.isNaN(swing.z) || Number.isNaN(swing.w)) return;
  const world = bone.getWorldQuaternion(new Quaternion());
  const parent = bone.parent ? bone.parent.getWorldQuaternion(new Quaternion()) : new Quaternion();
  const turned = parent.invert().multiply(swing.multiply(world));
  bone.quaternion.slerp(turned, weight);
}
