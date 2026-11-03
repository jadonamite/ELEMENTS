import { balance } from './balance.js';
import { PoseHistory } from './history.js';
import type { EnemyKind, EnemySpawn } from './zones.js';

const hound = balance.monsters.emberHound;
const villain = balance.enemy;

/** What an enemy needs to know about a player. */
export interface Quarry {
  id: string;
  x: number;
  z: number;
  alive: boolean;
}

/** An enemy's blow that reached a player this tick. */
export interface Strike {
  enemy: string;
  target: string;
  damage: number;
  /** Where the blow came from, to judge a raised guard. */
  fromX: number;
  fromZ: number;
}

interface KindTuning {
  maxHealth: number;
  /** Radius of the body a blade meets, metres. */
  radius: number;
  element: string;
  notice: number;
  walk: number;
  run: number;
  reach: number;
  damage: number;
  /** Seconds a strike takes, and the fraction through it when it lands. */
  strikeTime: number;
  strikeAt: number;
  cooldown: number;
  stagger: number;
  respawn: number;
  attacks: string[];
}

const villainKind = (kind: 'brawler' | 'armed'): KindTuning => {
  const k = villain.kinds[kind];
  return {
    maxHealth: villain.maxHealth,
    radius: balance.controller.radius + 0.08,
    element: villain.element,
    notice: 12,
    walk: k.walkSpeed,
    run: k.runSpeed,
    reach: k.attackRange,
    damage: k.attackDamage,
    strikeTime: 1 / k.attackSpeed,
    strikeAt: k.attackHitFraction,
    cooldown: k.attackCooldown,
    stagger: 0.5,
    respawn: villain.corpseSeconds + villain.sinkSeconds + villain.respawnSeconds + 10,
    attacks: k.attacks,
  };
};

export const KINDS: Record<EnemyKind, KindTuning> = {
  hound: {
    maxHealth: hound.health,
    radius: 0.6,
    element: 'IGNIS',
    notice: hound.noticeRange,
    walk: hound.speeds.walk,
    run: hound.speeds.charge,
    reach: hound.biteRange,
    damage: hound.biteDamage,
    strikeTime: hound.attackDuration,
    strikeAt: hound.attackHitFraction,
    cooldown: hound.chargeCooldown,
    stagger: hound.staggerDuration,
    respawn: 25,
    attacks: ['attack'],
  },
  brawler: villainKind('brawler'),
  armed: villainKind('armed'),
};

/** How far an enemy follows a player from where it lives before it gives up. */
const LEASH = 30;
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

export type EnemyState = 'idle' | 'notice' | 'stalk' | 'chase' | 'charge' | 'strike' | 'recoil' | 'return' | 'dead';

/** An enemy the server moves and keeps the health of. Clients only draw it. */
export class ServerEnemy {
  readonly id: string;
  readonly kind: EnemyKind;
  readonly tune: KindTuning;
  readonly home: { x: number; z: number };
  x: number;
  z: number;
  vx = 0;
  vz = 0;
  facing = 0;
  hp: number;
  state: EnemyState = 'idle';
  /** The clip a strike plays, chosen when it starts. */
  clip = '';
  target: string | null = null;
  readonly history = new PoseHistory(1);
  private timer = 0;
  private length = 0;
  private cooldown = 0;
  private struck = false;
  /** Side the hound circles to while it stalks. */
  private readonly flank: number;

  constructor(spawn: EnemySpawn, private readonly rand: () => number = Math.random) {
    this.id = spawn.id;
    this.kind = spawn.kind;
    this.tune = KINDS[spawn.kind];
    this.home = { x: spawn.x, z: spawn.z };
    this.x = spawn.x;
    this.z = spawn.z;
    this.hp = this.tune.maxHealth;
    this.flank = (this.rand() < 0.5 ? -1 : 1) * (hound.flankAngleDeg * Math.PI) / 180;
  }

  get alive(): boolean { return this.state !== 'dead'; }

  /** Takes a hit the server already judged. Returns true when it kills. */
  wound(damage: number, from: string): boolean {
    if (!this.alive) return false;
    this.hp = Math.max(0, this.hp - damage);
    this.target = from;
    if (this.hp === 0) {
      this.state = 'dead';
      this.vx = 0;
      this.vz = 0;
      this.timer = 0;
      this.length = this.tune.respawn;
      return true;
    }
    // A blow during a charge or bite knocks a hound off it; villains flinch briefly.
    if (this.kind === 'hound' ? this.state === 'charge' || this.state === 'strike' : this.state !== 'strike') {
      this.enter('recoil', this.tune.stagger);
    }
    return false;
  }

  private enter(state: EnemyState, length = 0): void {
    this.state = state;
    this.timer = 0;
    this.length = length;
  }

  private nearest(players: readonly Quarry[], range: number): Quarry | null {
    let best: Quarry | null = null;
    let bestD = range;
    for (const p of players) {
      if (!p.alive) continue;
      const d = Math.hypot(p.x - this.x, p.z - this.z);
      if (d <= bestD) { best = p; bestD = d; }
    }
    return best;
  }

  /** Moves toward (tx, tz) at `speed`, stopping at the point. */
  private head(tx: number, tz: number, speed: number, dt: number): void {
    const dx = tx - this.x;
    const dz = tz - this.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) { this.vx = 0; this.vz = 0; return; }
    const step = Math.min(d, speed * dt);
    this.vx = (dx / d) * (step / dt);
    this.vz = (dz / d) * (step / dt);
    this.facing = Math.atan2(dx, dz);
  }

  /** One server tick. Returns the blows that landed on players. */
  step(dt: number, now: number, players: readonly Quarry[]): Strike[] {
    const strikes: Strike[] = [];
    this.timer += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.vx = 0;
    this.vz = 0;
    if (this.state === 'dead') {
      if (this.timer >= this.length) this.revive();
      this.history.push(now, this.x, this.z, this.facing);
      return strikes;
    }
    const tune = this.tune;
    let quarry = this.target ? players.find(p => p.id === this.target && p.alive) ?? null : null;
    if (!quarry) {
      this.target = null;
      if (this.state !== 'return' && this.state !== 'idle' && this.state !== 'recoil') this.enter('idle');
      quarry = this.state === 'return' ? null : this.nearest(players, tune.notice);
      if (quarry) {
        this.target = quarry.id;
        this.enter(this.kind === 'hound' ? 'notice' : 'chase', this.kind === 'hound' ? 1.3 : 0);
      }
    }
    const fromHome = Math.hypot(this.x - this.home.x, this.z - this.home.z);
    if (quarry && fromHome > LEASH) {
      this.target = null;
      quarry = null;
      this.enter('return');
    }
    const dx = quarry ? quarry.x - this.x : 0;
    const dz = quarry ? quarry.z - this.z : 0;
    const dist = Math.hypot(dx, dz);

    switch (this.state) {
      case 'idle':
        break;
      case 'return':
        this.head(this.home.x, this.home.z, tune.walk * 1.5, dt);
        if (fromHome < 0.5) this.enter('idle');
        break;
      case 'notice':
        if (quarry) this.facing = Math.atan2(dx, dz);
        if (this.timer >= this.length) this.enter('stalk');
        break;
      case 'stalk': {
        if (!quarry) break;
        // Circle to a point off the player's flank, then charge in when ready.
        const around = Math.atan2(-dx, -dz) + this.flank;
        const ring = (hound.stalkDistanceMin + hound.stalkDistanceMax) / 2;
        this.head(quarry.x + Math.sin(around) * ring, quarry.z + Math.cos(around) * ring, tune.walk, dt);
        if (this.cooldown === 0 && dist <= hound.stalkDistanceMax + 1.5 && this.timer > 0.8) {
          this.enter('charge', hound.chargeDistance / hound.speeds.charge + 0.3);
        }
        break;
      }
      case 'charge':
        if (!quarry) break;
        if (dist <= tune.reach) {
          this.startStrike();
        } else if (this.timer >= this.length) {
          this.cooldown = tune.cooldown;
          this.enter('stalk');
        } else {
          this.head(quarry.x, quarry.z, tune.run, dt);
        }
        break;
      case 'chase':
        if (!quarry) break;
        if (dist <= tune.reach * 0.9 && this.cooldown === 0) this.startStrike();
        else if (dist > tune.reach * 0.8) this.head(quarry.x, quarry.z, dist > 4 ? tune.run : tune.walk, dt);
        else this.facing = Math.atan2(dx, dz);
        break;
      case 'strike':
        if (quarry && dist > 0.01) this.facing = Math.atan2(dx, dz);
        if (!this.struck && this.timer >= this.length * tune.strikeAt) {
          this.struck = true;
          const facingOk = Math.abs(wrap(Math.atan2(dx, dz) - this.facing)) < 1.2;
          if (quarry && dist <= tune.reach + 0.4 && facingOk) {
            strikes.push({ enemy: this.id, target: quarry.id, damage: tune.damage, fromX: this.x, fromZ: this.z });
          }
        }
        if (this.timer >= this.length) {
          this.cooldown = tune.cooldown;
          this.enter(this.kind === 'hound' ? 'stalk' : 'chase');
        }
        break;
      case 'recoil':
        if (this.timer >= this.length) {
          this.cooldown = Math.max(this.cooldown, 0.5);
          this.enter(this.kind === 'hound' ? 'stalk' : 'chase');
        }
        break;
    }
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.history.push(now, this.x, this.z, this.facing);
    return strikes;
  }

  private startStrike(): void {
    this.clip = this.tune.attacks[Math.floor(this.rand() * this.tune.attacks.length)] ?? 'attack';
    this.struck = false;
    this.enter('strike', this.tune.strikeTime);
  }

  private revive(): void {
    this.x = this.home.x;
    this.z = this.home.z;
    this.hp = this.tune.maxHealth;
    this.target = null;
    this.history.clear();
    this.enter('idle');
  }

  /** The state name clients draw: a strike carries its clip. */
  get shownState(): string {
    return this.state === 'strike' ? `strike:${this.clip}` : this.state;
  }
}
