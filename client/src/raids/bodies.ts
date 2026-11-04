import type RAPIER from '@dimforge/rapier3d-compat';
import { Color, Mesh, MeshBasicMaterial, type Object3D, RingGeometry, type Scene, Vector3 } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AnimationPlayer } from '../anim/index.js';
import { Enemy, type EnemyTemplate, type Quarry, type VillainKind } from '../enemy.js';

const ELEMENT_COLOR: Record<string, number> = { IGNIS: 0xff4a1a, AQUES: 0x2a8cff, TERRA: 0xc08a3a, AURA: 0xe8e4ff };

/** Something a foe can strike: the hero or a hired fighter. */
export interface Target { position: Vector3; alive: boolean }

/**
 * A hired fighter in the world: a Lit NPC body that follows its employer, picks a foe, fights it,
 * and can be killed or break and run. Built on the villain body, pointed at our enemies instead of us.
 */
export class Ally {
  readonly body: Enemy;
  hp: number;
  state: 'follow' | 'fight' | 'flee' | 'dead' | 'gone' = 'follow';
  foe: Enemy | null = null;
  kills = 0;
  private readonly ring: Mesh;
  private fleeTo = new Vector3();

  constructor(readonly id: string, readonly name: string, readonly element: string, readonly maxHp: number, readonly damage: number,
    template: EnemyTemplate, world: RAPIER.World, scene: Scene, at: { x: number; z: number }) {
    this.body = new Enemy(template, world, at, maxHp, 'armed');
    this.hp = maxHp;
    scene.add(this.body.model);
    // An element-coloured ring at the feet marks a hired fighter from a foe.
    this.ring = new Mesh(new RingGeometry(0.55, 0.68, 32).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: new Color(ELEMENT_COLOR[element] ?? 0xffffff), transparent: true, opacity: 0.75, depthWrite: false }));
    this.ring.position.y = 0.04;
    scene.add(this.ring);
  }

  get position(): Vector3 { return this.body.controller.position; }
  get alive(): boolean { return this.state !== 'dead' && this.state !== 'gone'; }
  get fighting(): boolean { return this.state === 'follow' || this.state === 'fight'; }

  teleport(x: number, z: number): void {
    const c = this.body.controller;
    c.body.setTranslation({ x, y: c.position.y, z }, true);
    c.position.set(x, c.position.y, z);
    c.previous.copy(c.position);
  }

  flee(toward: Vector3): void {
    if (!this.fighting) return;
    this.state = 'flee';
    this.foe = null;
    this.fleeTo.copy(toward);
  }

  /** Takes a blow; returns true if it killed. */
  hurt(amount: number, from: Vector3): boolean {
    if (!this.alive) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.body.flash = 0.08;
    const killed = this.hp <= 0;
    this.body.hurt({ current: this.hp, maximum: this.maxHp }, killed ? 'heavy_1' : 'light_1', from);
    if (killed) { this.state = 'dead'; this.foe = null; }
    return killed;
  }

  /** One physics step. Returns the foe struck this step, if any. */
  step(leader: Vector3, foes: readonly Enemy[]): Enemy | null {
    if (this.state === 'dead' || this.state === 'gone') { this.body.step({ position: leader, alive: false }, false); return null; }
    if (this.state === 'flee') {
      this.body.step({ position: this.fleeTo, alive: true }, false);
      if (this.position.distanceTo(this.fleeTo) < 2.5 || this.position.distanceTo(leader) > 40) this.vanish();
      return null;
    }
    if (!this.foe || !this.foe.alive) {
      this.foe = null;
      let best = 14;
      for (const f of foes) {
        if (!f.hittable) continue;
        const d = f.controller.position.distanceTo(this.position);
        if (d < best && f.controller.position.distanceTo(leader) < 18) { best = d; this.foe = f; }
      }
    }
    this.state = this.foe ? 'fight' : 'follow';
    if (this.foe) {
      const landed = this.body.step({ position: this.foe.controller.position, alive: this.foe.alive } satisfies Quarry, true);
      return landed ? this.foe : null;
    }
    // No foe: keep close to the employer without crowding them.
    this.body.step({ position: leader, alive: true }, false);
    return null;
  }

  vanish(): void {
    this.state = 'gone';
    this.body.model.visible = false;
    this.ring.visible = false;
    this.teleport(0, -500);
  }

  draw(delta: number, alpha: number): void {
    if (this.state === 'gone') return;
    this.body.draw(delta, alpha);
    this.ring.position.set(this.body.model.position.x, 0.04, this.body.model.position.z);
    this.ring.visible = this.state !== 'dead';
  }

  dispose(): void { this.body.dispose(); this.ring.removeFromParent(); this.ring.geometry.dispose(); }
}

/**
 * A ruin foe that may be turned on a hired fighter. Struck fighters take the blow here; the hero's
 * blows still come through the shared fight, so blocking and parrying work as everywhere else.
 */
export class RaidFoe extends Enemy {
  target: Ally | null = null;
  damageScale = 1;
  onAllyStruck: ((ally: Ally, damage: number, foe: RaidFoe) => void) | null = null;

  constructor(template: EnemyTemplate, world: RAPIER.World, spawn: { x: number; z: number }, maxHealth: number, kind: VillainKind) {
    super(template, world, spawn, maxHealth, kind);
  }

  override step(quarry: Quarry, mayAttack: boolean): boolean {
    if (this.target && this.target.fighting) {
      const landed = super.step({ position: this.target.position, alive: true }, true);
      if (landed) this.onAllyStruck?.(this.target, this.attackDamage * this.damageScale, this);
      return false;
    }
    this.target = null;
    const landed = super.step(quarry, mayAttack);
    if (landed) this.attackDamage *= this.damageScale;
    return landed;
  }
}

/** A standing NPC with no fight in it: the broker, the salvage buyer, fighters waiting for hire. */
export class Figure {
  readonly model: Object3D;
  private readonly anim: AnimationPlayer;
  constructor(template: EnemyTemplate, scene: Scene, x: number, z: number, facing: number, variant = 0) {
    const v = template.variants[variant % template.variants.length]!;
    this.model = cloneSkinned(v.model);
    this.model.position.set(x, 0, z);
    this.model.rotation.y = facing;
    this.model.traverse((o) => { if ((o as Mesh).isMesh) (o as Mesh).castShadow = true; });
    this.anim = new AnimationPlayer(this.model, v.clips, { defaultFadeDuration: 0.3 });
    this.anim.play('idle');
    this.anim.update(Math.random() * 2);
    scene.add(this.model);
  }
  walkTo(x: number, z: number, delta: number): void {
    const p = this.model.position;
    const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    if (d > 0.2) {
      const step = Math.min(d, 2.4 * delta);
      p.x += (dx / d) * step; p.z += (dz / d) * step;
      this.model.rotation.y = Math.atan2(dx, dz);
      this.anim.play('walk');
    } else this.anim.play('idle');
  }
  update(delta: number): void { this.anim.update(delta); }
  set visible(v: boolean) { this.model.visible = v; }
  dispose(): void { this.anim.dispose(); this.model.removeFromParent(); }
}
