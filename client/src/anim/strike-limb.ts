import { AnimationMixer, Vector3, type AnimationClip, type Object3D } from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';

export type StrikeLimb = 'hand_r' | 'hand_l' | 'foot_r' | 'foot_l';

/** Bones that can land a blow; a knee strike is judged on its leg, so knees count for their foot. */
const bones: Array<[string, StrikeLimb]> = [
  ['hand_r', 'hand_r'], ['hand_l', 'hand_l'], ['foot_r', 'foot_r'], ['foot_l', 'foot_l'],
  ['calf_r', 'foot_r'], ['calf_l', 'foot_l'],
];
const SAMPLES = 16;

/**
 * Reads from the animation itself which hand or foot a strike clip hits with: the clip is played
 * on a silent copy of the rig, and the limb that reaches furthest forward of the pelvis during the
 * strike window is the one that lands. Answers are kept per clip.
 */
export class StrikeLimbs {
  private readonly copy: Object3D;
  private readonly mixer: AnimationMixer;
  private readonly found = new Map<string, StrikeLimb>();
  private readonly forward: Vector3;
  private readonly p = new Vector3();
  private readonly pelvis = new Vector3();

  /** `modelForwardYaw` is the turn the game adds to the model so it faces its heading. */
  constructor(model: Object3D, private readonly clips: readonly AnimationClip[],
    private readonly window: readonly [number, number], modelForwardYaw = 0) {
    this.copy = clone(model);
    this.copy.position.set(0, 0, 0);
    this.copy.rotation.set(0, 0, 0);
    this.copy.scale.copy(model.scale);
    this.mixer = new AnimationMixer(this.copy);
    this.forward = new Vector3(-Math.sin(modelForwardYaw), 0, Math.cos(modelForwardYaw));
  }

  /** The limb this clip strikes with, or null when the clip is unknown or the rig lacks the bones. */
  of(clipName: string): StrikeLimb | null {
    const known = this.found.get(clipName);
    if (known) return known;
    const clip = this.clips.find(c => c.name === clipName);
    const pelvis = this.copy.getObjectByName('pelvis');
    if (!clip || !pelvis) return null;
    const limbs = bones.map(([bone, limb]) => [this.copy.getObjectByName(bone), limb] as const)
      .filter((b): b is readonly [Object3D, StrikeLimb] => !!b[0]);
    if (!limbs.length) return null;

    const action = this.mixer.clipAction(clip);
    action.reset().play();
    let best: StrikeLimb | null = null;
    let bestReach = -Infinity;
    const [from, to] = this.window;
    for (let i = 0; i <= SAMPLES; i++) {
      this.mixer.setTime(clip.duration * (from + (to - from) * (i / SAMPLES)));
      this.copy.updateMatrixWorld(true);
      pelvis.getWorldPosition(this.pelvis);
      for (const [bone, limb] of limbs) {
        const reach = bone.getWorldPosition(this.p).sub(this.pelvis).dot(this.forward);
        if (reach > bestReach) { bestReach = reach; best = limb; }
      }
    }
    action.stop();
    this.mixer.uncacheAction(clip);
    if (best) this.found.set(clipName, best);
    return best;
  }
}
