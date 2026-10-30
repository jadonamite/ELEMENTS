import { type Camera, Vector3 } from 'three';
import type { Health } from '../../shared/src/index.js';
import type { Enemy } from './enemy.js';

export interface CooldownItem {
  move: string;
  remaining: number;
  total: number;
}

export interface RoundHudInfo {
  round: number;
  totalRounds: number;
  target: number;
  remaining: number;
  isVictory: boolean;
  intermission: number;
}

/** Hero health, round status, bending perks, abilities tray, and enemy overhead health bars. */
export class FightHud {
  private readonly root: HTMLDivElement;
  private readonly heroFill: HTMLDivElement;
  private readonly heroTrail: HTMLDivElement;
  private readonly banner: HTMLParagraphElement;
  private readonly modeBadge: HTMLSpanElement;
  private readonly stanceBadge: HTMLSpanElement;
  private readonly perkBadge: HTMLSpanElement;
  private readonly roundTracker: HTMLDivElement;
  private readonly roundTitle: HTMLSpanElement;
  private readonly roundSub: HTMLSpanElement;
  private readonly lockReticle: HTMLDivElement;
  private readonly abilitySlots = new Map<string, { fill: HTMLDivElement; timer: HTMLSpanElement; root: HTMLDivElement }>();
  private readonly bars = new Map<Enemy, HTMLDivElement>();
  private readonly meter: HTMLDivElement;
  private readonly meterFill: HTMLDivElement;
  private readonly meterLine: HTMLDivElement;
  private readonly supply: HTMLSpanElement;
  private trail = 1;
  private throwName = 'throw';
  private sweepName = 'sweep';
  private readonly point = new Vector3();

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'fight-hud';
    this.root.innerHTML =
      '<div class="round-tracker">' +
      '<span class="round-title">ROUND 1/8</span>' +
      '<span class="round-sub">1 Villain • Remaining: 1</span>' +
      '</div>' +
      '<div class="combat-status">' +
      '<span class="mode-badge">Unlit</span>' +
      '<span class="stance-badge">Barehanded</span>' +
      '<span class="perk-badge">Physical Mode</span>' +
      '</div>' +
      '<div class="hero-health" role="meter" aria-label="Health" aria-valuemin="0" aria-valuemax="100">' +
      '<div class="trail"></div><div class="fill"></div></div>' +
      '<div class="hero-meter" role="meter" aria-label="Combo meter" aria-valuemin="0" aria-valuemax="100">' +
      '<div class="meter-fill"></div><div class="meter-line"></div></div>' +
      '<span class="hero-supply" aria-live="polite"></span>' +
      '<div class="ability-tray" aria-label="Abilities">' +
      '<div class="ability-slot" data-slot="uppercut"><div class="cd-fill"></div><span class="slot-key">Q</span><span class="slot-name">Uppercut</span><span class="slot-timer"></span></div>' +
      '<div class="ability-slot" data-slot="ground_pound"><div class="cd-fill"></div><span class="slot-key">E</span><span class="slot-name">Slam</span><span class="slot-timer"></span></div>' +
      '<div class="ability-slot" data-slot="dash_strike"><div class="cd-fill"></div><span class="slot-key">F</span><span class="slot-name">Dash</span><span class="slot-timer"></span></div>' +
      '<div class="ability-slot" data-slot="ultimate"><div class="cd-fill"></div><span class="slot-key">G</span><span class="slot-name">Ultimate</span><span class="slot-timer"></span></div>' +
      '<div class="ability-slot" data-slot="dodge"><div class="cd-fill"></div><span class="slot-key">Space</span><span class="slot-name">Dodge</span><span class="slot-timer"></span></div>' +
      '</div>' +
      '<div class="lock-reticle"></div>' +
      '<p class="fight-banner" role="status"></p>';
    document.body.appendChild(this.root);

    this.roundTracker = this.root.querySelector('.round-tracker')!;
    this.roundTitle = this.root.querySelector('.round-title')!;
    this.roundSub = this.root.querySelector('.round-sub')!;
    this.heroFill = this.root.querySelector('.fill')!;
    this.heroTrail = this.root.querySelector('.trail')!;
    this.banner = this.root.querySelector('.fight-banner')!;
    this.modeBadge = this.root.querySelector('.mode-badge')!;
    this.stanceBadge = this.root.querySelector('.stance-badge')!;
    this.perkBadge = this.root.querySelector('.perk-badge')!;
    this.lockReticle = this.root.querySelector('.lock-reticle')!;
    this.meter = this.root.querySelector('.hero-meter')!;
    this.meterFill = this.root.querySelector('.meter-fill')!;
    this.meterLine = this.root.querySelector('.meter-line')!;
    this.supply = this.root.querySelector('.hero-supply')!;

    for (const slot of this.root.querySelectorAll<HTMLDivElement>('.ability-slot')) {
      const name = slot.dataset.slot;
      if (!name) continue;
      this.abilitySlots.set(name, {
        root: slot,
        fill: slot.querySelector('.cd-fill')!,
        timer: slot.querySelector('.slot-timer')!,
      });
    }
  }

  /** Names the Q, E, F and G slots after the element's own moves. */
  setMoveNames(names: Partial<Record<string, string>>, element: string): void {
    this.throwName = names.bend_palm ?? this.throwName;
    this.sweepName = names.bend_sweep ?? this.sweepName;
    for (const [move, slot] of this.abilitySlots) {
      const name = names[move];
      if (name) slot.root.querySelector('.slot-name')!.textContent = name;
    }
    this.root.dataset.element = element.toLowerCase();
  }

  /**
   * The combo meter, with a mark where bending turns weak, plus what the hero carries:
   * waterskin charges for AQUES, shards for a Hush. Pass null to hide a count.
   */
  setBending(meter: number, max: number, weakBelow: number, supply: string | null): void {
    const share = Math.max(0, Math.min(1, meter / max));
    this.meterFill.style.transform = `scaleX(${share})`;
    this.meterLine.style.left = `${(weakBelow / max) * 100}%`;
    this.meter.classList.toggle('weak', meter < weakBelow);
    this.meter.setAttribute('aria-valuenow', String(Math.round(meter)));
    this.supply.textContent = supply ?? '';
  }

  /** Large centred line such as "You fell" or "Round Cleared", or empty to clear it. */
  say(text: string): void { this.banner.textContent = text; }

  update(
    delta: number,
    hero: Health,
    enemies: readonly Enemy[],
    camera: Camera,
    barHeight: number,
    isLit = false,
    isArmed = false,
    lockedEnemy: Enemy | null = null,
    cooldowns: CooldownItem[] = [],
    element = 'IGNIS',
    roundInfo?: RoundHudInfo,
    fightingStyle: 'weapon' | 'bare_hands' | 'legs' | 'bending' = 'weapon',
    isDim = false,
  ): void {
    if (isDim) {
      this.modeBadge.textContent = 'Dim (Non-Shaper)';
      this.modeBadge.className = 'mode-badge dim';
    } else {
      this.modeBadge.textContent = isLit
        ? `${element} Lit (Bending)`
        : `${element} (Physical)`;
      this.modeBadge.className = isLit ? 'mode-badge lit' : 'mode-badge';
    }

    if (fightingStyle === 'weapon') {
      this.stanceBadge.textContent = isArmed ? 'Style: Weapon (Drawn)' : 'Style: Weapon (Ready)';
      this.stanceBadge.className = 'stance-badge';
    } else if (fightingStyle === 'legs') {
      this.stanceBadge.textContent = 'Style: Legs';
      this.stanceBadge.className = 'stance-badge hands';
    } else if (fightingStyle === 'bare_hands') {
      this.stanceBadge.textContent = 'Style: Bare Hands';
      this.stanceBadge.className = 'stance-badge hands';
    } else {
      this.stanceBadge.textContent = isDim ? 'Style: Bending (Locked)' : `Style: Bending (${element})`;
      this.stanceBadge.className = isDim ? 'stance-badge dim' : 'stance-badge bending';
    }

    // Update combat perk display
    if (isDim) {
      this.perkBadge.className = 'perk-badge dim';
      this.perkBadge.textContent = 'Dim: 1 weapon • 2 hands • 3 legs • Q shard spark • wider parry';
    } else if (fightingStyle === 'bending') {
      this.perkBadge.className = 'perk-badge lit';
      this.perkBadge.textContent = `Bending: ${this.throwName} (left click) • ${this.sweepName} (right click)`;
    } else if (fightingStyle === 'legs') {
      this.perkBadge.className = isLit ? 'perk-badge lit' : 'perk-badge';
      this.perkBadge.textContent = 'Legs: snap and side kick (left click) • roundhouse (right click)';
    } else if (fightingStyle === 'bare_hands') {
      this.perkBadge.className = isLit ? 'perk-badge lit' : 'perk-badge';
      this.perkBadge.textContent = isLit
        ? `Hands, bending: ${this.throwName} (left click) • ${this.sweepName} (right click)`
        : 'Bare hands: jab, cross, knee (left click) • hook (right click)';
    } else {
      this.perkBadge.className = isLit ? 'perk-badge lit' : 'perk-badge';
      this.perkBadge.textContent = isLit
        ? 'Weapon, bending: +60% damage • Q, E, F and G bend'
        : 'Weapon: 1 weapon • 2 hands • 3 legs • B bending';
    }

    // Update round tracker
    if (roundInfo) {
      if (roundInfo.isVictory) {
        this.roundTracker.className = 'round-tracker victory';
        this.roundTitle.textContent = 'VICTORY';
        this.roundSub.textContent = 'All waves cleared';
      } else if (roundInfo.intermission > 0) {
        this.roundTracker.className = 'round-tracker intermission';
        this.roundTitle.textContent = `ROUND ${roundInfo.round} CLEARED`;
        this.roundSub.textContent = `Next Wave (${roundInfo.target} Villains) in ${roundInfo.intermission.toFixed(1)}s`;
      } else {
        this.roundTracker.className = 'round-tracker';
        this.roundTitle.textContent = `ROUND ${roundInfo.round}/${roundInfo.totalRounds}`;
        const plural = roundInfo.target === 1 ? 'Villain' : 'Villains';
        this.roundSub.textContent = `${roundInfo.target} ${plural} • Remaining: ${roundInfo.remaining}`;
      }
    }

    // Update ability cooldown slots
    for (const cd of cooldowns) {
      const slot = this.abilitySlots.get(cd.move);
      if (!slot) continue;
      const onCd = cd.remaining > 0;
      slot.root.classList.toggle('on-cooldown', onCd);
      const ratio = onCd ? Math.min(1, cd.remaining / cd.total) : 0;
      slot.fill.style.transform = `scaleY(${ratio})`;
      slot.timer.textContent = onCd ? (cd.remaining > 1 ? cd.remaining.toFixed(0) : cd.remaining.toFixed(1)) : '';
    }

    const share = hero.current / hero.maximum;
    // The pale trail drains after the fill, so a hit reads as a loss.
    this.trail = Math.max(share, this.trail - delta * 0.6);
    this.heroFill.style.transform = `scaleX(${share})`;
    this.heroTrail.style.transform = `scaleX(${this.trail})`;
    this.root.querySelector('.hero-health')!.setAttribute('aria-valuenow', String(Math.round(share * 100)));
    this.root.classList.toggle('low', share < 0.3);

    // Lock reticle tracking
    if (lockedEnemy && lockedEnemy.alive) {
      this.point.copy(lockedEnemy.model.position).setY(lockedEnemy.model.position.y + 1.2).project(camera);
      const visible = this.point.z < 1 && Math.abs(this.point.x) < 1.1 && Math.abs(this.point.y) < 1.1;
      this.lockReticle.style.display = visible ? 'block' : 'none';
      if (visible) {
        const lx = (this.point.x + 1) / 2 * window.innerWidth;
        const ly = (1 - this.point.y) / 2 * window.innerHeight;
        this.lockReticle.style.transform = `translate(${lx}px, ${ly}px) translate(-50%, -50%)`;
      }
    } else {
      this.lockReticle.style.display = 'none';
    }

    for (const [enemy, bar] of this.bars) {
      if (enemies.includes(enemy) && enemy.alive) continue;
      bar.remove();
      this.bars.delete(enemy);
    }
    for (const enemy of enemies) {
      if (!enemy.alive || enemy.health.current >= enemy.health.maximum) continue;
      let bar = this.bars.get(enemy);
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'enemy-health';
        bar.innerHTML = '<div class="fill"></div>';
        this.root.appendChild(bar);
        this.bars.set(enemy, bar);
      }
      this.point.copy(enemy.model.position).setY(enemy.model.position.y + barHeight).project(camera);
      const visible = this.point.z < 1 && Math.abs(this.point.x) < 1.1 && Math.abs(this.point.y) < 1.1;
      bar.style.display = visible ? '' : 'none';
      if (!visible) continue;
      const x = (this.point.x + 1) / 2 * window.innerWidth;
      const y = (1 - this.point.y) / 2 * window.innerHeight;
      bar.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      (bar.firstChild as HTMLDivElement).style.transform = `scaleX(${enemy.health.current / enemy.health.maximum})`;
    }
  }

  dispose(): void {
    this.root.remove();
    this.bars.clear();
    this.abilitySlots.clear();
  }
}
