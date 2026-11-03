import RAPIER from '@dimforge/rapier3d-compat';
import { Group, type MeshStandardMaterial, type Mesh, type Object3D, type Scene, Vector3, type AnimationClip } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import balance from '../../../shared/balance.json';
import { RemoteTrack, type EnemyView, type PlayerView, type TrackDelay } from '../../../shared/src/net/index.js';
import { AnimationPlayer } from '../anim/index.js';
import type { HeroInstance } from '../hero.js';

const { clipSpeeds, idleSpeedThreshold, runSpeedThreshold } = balance.controller;

/** Another player, drawn where the server last heard they were, carried forward to now. */
export class RemotePlayer {
  readonly track: RemoteTrack;
  hero: HeroInstance | null = null;
  view: PlayerView | null = null;
  private clip = '';

  constructor(readonly id: string, scene: Scene, load: () => Promise<HeroInstance>, delay: TrackDelay = 'auto') {
    this.track = new RemoteTrack(delay);
    load().then((hero) => {
      if (this.disposed) { hero.anim.dispose(); return; }
      this.hero = hero;
      scene.add(hero.model);
    }).catch((error: unknown) => console.error('A remote player could not load:', error));
  }

  private disposed = false;

  push(v: PlayerView, now: number): void {
    this.view = v;
    this.track.push({ at: v.sampledAt, x: v.x, y: v.y, z: v.z, vx: v.vx, vz: v.vz, facing: v.facing }, now);
  }

  update(serverNow: number, dt: number): void {
    if (!this.track.ready) return;
    const shown = this.track.update(serverNow, dt);
    const hero = this.hero;
    if (!hero || !this.view) return;
    hero.model.position.set(shown.x, shown.y, shown.z);
    hero.model.rotation.y = shown.facing + balance.controller.modelForwardYaw;
    // Walking clips follow the speed drawn here; any other clip is the move they are making.
    const reported = this.view.clip;
    const moving = reported === 'walk' || reported === 'run' || reported === 'idle' || reported === 'idle_relaxed';
    const speed = this.track.speed;
    const pace = speed < idleSpeedThreshold ? null : speed < runSpeedThreshold ? 'walk' : 'run';
    const clip = moving ? (pace ?? reported) : reported;
    if (clip !== this.clip && hero.anim.hasClip(clip)) {
      if (moving) hero.anim.play(clip, balance.controller.animationFade);
      else hero.anim.playOnce(clip, 0.12);
      this.clip = clip;
    }
    if (pace && clip === pace) hero.anim.setSpeed(pace, Math.max(0.5, speed / clipSpeeds[pace]));
    hero.anim.update(dt);
  }

  dispose(): void {
    this.disposed = true;
    if (this.hero) {
      this.hero.anim.dispose();
      this.hero.model.removeFromParent();
    }
  }
}

export interface PuppetTemplate {
  model: Object3D;
  clips: AnimationClip[];
  scale: number;
  /** Height of the health bar above the feet, metres. */
  barHeight: number;
}

/** Clips each server state plays, by enemy kind. */
const HOUND_CLIPS: Record<string, string> = {
  idle: 'idle', notice: 'notice', stalk: 'walk', charge: 'run', recoil: 'hit', return: 'walk', dead: 'death', chase: 'run',
};
const VILLAIN_CLIPS: Record<string, string> = {
  idle: 'idle', chase: 'run', recoil: 'idle', return: 'walk', dead: 'death',
};

/** An enemy the server moves. The browser only draws it and tells the server when a swing touched it. */
export class NetEnemy {
  readonly track = new RemoteTrack('auto');
  readonly model: Object3D;
  readonly anim: AnimationPlayer;
  view: EnemyView;
  /** The last swing of ours that touched it, so one swing reports once. */
  lastSwing = -1;
  readonly bar: HTMLDivElement;
  private readonly materials: MeshStandardMaterial[] = [];
  private flash = 0;
  private clip = '';
  private groundY: number;
  private deadFor = 0;
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

  constructor(view: EnemyView, template: PuppetTemplate, scene: Scene, hudRoot: HTMLElement, startY: number) {
    this.view = view;
    const holder = new Group();
    const body = cloneSkinned(template.model);
    body.scale.setScalar(template.scale);
    body.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const source = mesh.material as MeshStandardMaterial;
      const material = source.clone();
      material.onBeforeCompile = source.onBeforeCompile;
      material.customProgramCacheKey = source.customProgramCacheKey;
      mesh.material = material;
      this.materials.push(material);
    });
    holder.add(body);
    this.model = holder;
    this.anim = new AnimationPlayer(body, template.clips, { defaultFadeDuration: 0.2 });
    this.groundY = startY;
    scene.add(holder);
    this.bar = document.createElement('div');
    this.bar.className = 'enemy-health';
    this.bar.innerHTML = '<div class="fill"></div>';
    this.bar.dataset.enemy = view.id;
    hudRoot.appendChild(this.bar);
    this.barHeight = template.barHeight;
    this.push(view);
  }

  readonly barHeight: number;

  get alive(): boolean { return this.view.state !== 'dead'; }
  get radius(): number { return this.view.kind === 'hound' ? 0.6 : 0.38; }

  push(v: EnemyView, at?: number, now?: number): void {
    const wasDead = this.view.state === 'dead';
    this.view = v;
    if (at !== undefined) this.track.push({ at, x: v.x, y: 0, z: v.z, vx: v.vx, vz: v.vz, facing: v.facing }, now);
    if (wasDead && v.state !== 'dead') this.deadFor = 0;
  }

  /** A judged hit landed: flash white. */
  struck(): void { this.flash = 0.1; }

  /** Finds the ground under the enemy so it walks the town's slopes and steps. */
  private ground(world: RAPIER.World, x: number, z: number, exclude: RAPIER.RigidBody | undefined): number {
    this.ray.origin = { x, y: this.groundY + 1.6, z };
    const hit = world.castRay(this.ray, 6, true, undefined, undefined, undefined, exclude);
    if (hit) this.groundY = this.groundY + 1.6 - hit.timeOfImpact;
    return this.groundY;
  }

  update(serverNow: number, dt: number, world: RAPIER.World, exclude?: RAPIER.RigidBody): void {
    if (!this.track.ready) return;
    const shown = this.track.update(serverNow, dt);
    const y = this.ground(world, shown.x, shown.z, exclude);
    this.model.position.set(shown.x, y, shown.z);
    this.model.rotation.y = shown.facing;
    const state = this.view.state;
    const [base, strikeClip] = state.split(':') as [string, string | undefined];
    const kindClips = this.view.kind === 'hound' ? HOUND_CLIPS : VILLAIN_CLIPS;
    let clip = strikeClip ?? kindClips[base] ?? 'idle';
    if (this.view.kind !== 'hound' && base === 'chase' && this.track.speed < 2.5) clip = 'walk';
    if (!this.anim.hasClip(clip)) clip = 'idle';
    if (clip !== this.clip) {
      if (base === 'strike' || base === 'dead' || base === 'recoil') this.anim.playOnce(clip, 0.12);
      else this.anim.play(clip, 0.2);
      this.clip = clip;
    }
    this.anim.update(dt);
    if (base === 'dead') this.deadFor += dt;
    this.model.visible = this.deadFor < 6;
    this.flash = Math.max(0, this.flash - dt);
    for (const m of this.materials) {
      if (!m.emissive) continue;
      if (this.flash > 0) { m.emissive.setRGB(1, 0.9, 0.8); m.emissiveIntensity = 1.2; }
      else { m.emissive.setRGB(0, 0, 0); m.emissiveIntensity = 0; }
    }
  }

  /** Places the health bar over the enemy; hidden at full health and when dead. */
  drawBar(camera: import('three').Camera, point: Vector3): void {
    const v = this.view;
    const show = v.state !== 'dead' && v.hp < v.maxHp;
    if (!show) { this.bar.style.display = 'none'; return; }
    point.copy(this.model.position).setY(this.model.position.y + this.barHeight).project(camera);
    const visible = point.z < 1 && Math.abs(point.x) < 1.1 && Math.abs(point.y) < 1.1;
    this.bar.style.display = visible ? '' : 'none';
    if (!visible) return;
    const x = (point.x + 1) / 2 * window.innerWidth;
    const y = (1 - point.y) / 2 * window.innerHeight;
    this.bar.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    (this.bar.firstChild as HTMLDivElement).style.transform = `scaleX(${v.hp / v.maxHp})`;
  }

  dispose(): void {
    this.anim.dispose();
    for (const m of this.materials) m.dispose();
    this.model.removeFromParent();
    this.bar.remove();
  }
}
