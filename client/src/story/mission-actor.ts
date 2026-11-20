import { Group, type Mesh, type Scene, type SkinnedMesh, Vector3 } from 'three';
import type { Loaders } from '../assets/loaders.js';
import { bodyKit, markRest, type OutfitId } from '../body.js';
import { sanitizeCharacterConfig } from '../creator/creator-types.js';
import { AnimationPlayer } from '../anim/player.js';

export function seatedPose(model: Group, floorY: number): void {
  for (const side of ['l', 'r']) {
    const thigh = model.getObjectByName(`thigh_${side}`), calf = model.getObjectByName(`calf_${side}`);
    if (thigh) thigh.rotation.x = 1.35;
    if (calf) calf.rotation.x = -1.6;
  }
  model.position.y = floorY - 0.45;
}

/** Named story people use the same bodies and fitted clips as the town crowd. */
export class MissionActor {
  readonly position: Vector3;
  private model: Group | null = null;
  private anim: AnimationPlayer | null = null;
  private disposed = false;
  private sitting = false;
  private peekBase: number | null = null;
  readonly ready: Promise<void>;
  constructor(private readonly scene: Scene, loaders: Loaders, name: string, at: { x: number; y: number; z: number }, female = false,
    private readonly dress?: OutfitId) {
    this.position = new Vector3(at.x, at.y, at.z);
    this.ready = this.load(loaders, name, female);
  }
  private async load(loaders: Loaders, name: string, female: boolean): Promise<void> {
    const master = name === 'Master Brandr';
    const outfit: OutfitId = this.dress ?? (master ? 'shaper_ignis' : 'rags');
    const config = sanitizeCharacterConfig({ sex: female ? 'female' : 'male', skinToneId: 'bronze', hairStyleId: female ? 'short' : 'beard', hairColorId: master ? 'silver' : 'brown', bodyPreset: master ? 'broad' : 'average' });
    // Seated clips (writing at a desk, hands on the table, talking) for people who work sitting down.
    const sets = await Promise.all(['townsfolk_a', 'townsfolk_b', 'townsfolk_mixamo', 'seated'].map(n => loaders.model(`/assets/characters/${n}.glb`)));
    const kit = bodyKit(loaders, 'close');
    const model = await kit.build(config, 'hero', undefined, outfit);
    const clips = await kit.fitClips(config.sex, sets.flatMap(markRest), 'townsfolk', outfit);
    this.model = model;
    model.name = name;
    this.anim = new AnimationPlayer(model, clips);
    if (this.disposed) { this.release(); return; }
    model.position.copy(this.position);
    model.traverse(node => { const mesh = node as Mesh; if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; } });
    this.scene.add(model);
    this.pose('idle');
  }
  pose(...names: string[]): void {
    this.sitting = names[0] === 'sit';
    if (!this.anim) return;
    const clips = this.anim.getClipNames();
    const name = names.find(n => clips.includes(n));
    if (name) this.anim.play(name, 0.2);
  }
  tick(dt: number, face: Vector3, hiding = false): void {
    if (!this.model) return;
    this.model.position.copy(this.position);
    this.model.rotation.y = Math.atan2(face.x - this.position.x, face.z - this.position.z);
    const spine = this.model.getObjectByName('spine_01');
    if (!hiding && this.peekBase !== null) { if (spine) spine.rotation.z = this.peekBase; this.peekBase = null; }
    this.anim?.update(dt);
    if (this.sitting) seatedPose(this.model, this.position.y);
    // Cowering keeps the body behind low cover; a small lean makes the road visible to Neri.
    if (hiding) {
      if (spine) {
        this.peekBase ??= spine.rotation.z;
        spine.rotation.z = this.peekBase + Math.max(0, Math.sin(performance.now() / 1800)) * 0.3;
      }
      this.model.position.x += Math.max(0, Math.sin(performance.now() / 1800)) * 1.3;
    }
  }
  private release(): void {
    this.anim?.dispose(); this.anim = null;
    this.model?.removeFromParent();
    this.model?.traverse(node => {
      const mesh = node as Mesh;
      if (!mesh.isMesh) return;
      if ((mesh as SkinnedMesh).isSkinnedMesh) (mesh as SkinnedMesh).skeleton.dispose();
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
    });
    this.model = null;
  }
  dispose(): void { this.disposed = true; this.release(); }
}
