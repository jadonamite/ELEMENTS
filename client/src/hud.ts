import { type Camera, Vector3 } from 'three';
import balance from '../../shared/balance.json';
import { type Health } from '../../shared/src/index.js';

import type { Enemy } from './enemy.js';

export interface RoundHudInfo {
  round: number;
  totalRounds: number;
  target: number;
  remaining: number;
  isVictory: boolean;
  intermission: number;
}

interface DamagePopup {
  el: HTMLDivElement;
  pos: Vector3;
  elapsed: number;
  duration: number;
  vy: number;
}

const ART = '/assets/ui/hud';

/**
 * The playing screen keeps purse and standing top right, vitals bottom left.
 * Vitals show only in fight stance (the same signal that turns on the
 * fight camera, which includes being hurt). ?debug shows every part all the time.
 */
export class FightHud {
  private readonly root: HTMLDivElement;
  private readonly heroFill: HTMLDivElement;
  private readonly heroTrail: HTMLDivElement;
  private readonly heroScars: HTMLDivElement;
  private readonly banner: HTMLParagraphElement;
  private readonly modeBadge: HTMLSpanElement;
  private readonly stanceBadge: HTMLSpanElement;
  private readonly purse: HTMLDivElement;
  private readonly coinAmount: HTMLElement;
  private readonly flags: HTMLDivElement;
  private readonly elementArt: HTMLImageElement;
  debug = new URLSearchParams(window.location.search).has('debug');
  private chroma: number | null = null;
  private standing = { redFlags: 0, hasBounty: false };
  private readonly roundTracker: HTMLDivElement;
  private readonly roundTitle: HTMLSpanElement;
  private readonly roundSub: HTMLSpanElement;
  private readonly lockReticle: HTMLDivElement;
  private readonly bars = new Map<Enemy, HTMLDivElement>();
  private damagePopups: DamagePopup[] = [];
  private readonly meter: HTMLDivElement;
  private readonly meterFill: HTMLDivElement;
  private readonly meterLine: HTMLDivElement;
  private readonly supply: HTMLSpanElement;
  onSatchelClick?: () => void;
  private trail = 1;
  private readonly point = new Vector3();

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'fight-hud';
    this.root.innerHTML =
      '<div class="round-tracker">' +
      '<span class="round-title">ROUND 1/8</span>' +
      '<span class="round-sub">1 Villain • Remaining: 1</span>' +
      '</div>' +
      '<div class="hud-purse" hidden>' +
      `<button type="button" class="purse-coin" aria-label="Open satchel (I)" title="Open satchel (I)"><img src="${ART}/coin.png" alt=""><b class="coin-amount" aria-label="CHROMA">0</b></button>` +
      '<div class="purse-flags" role="status"></div>' +
      '</div>' +
      '<div class="hud-vitals">' +
      `<div class="vital"><img class="vital-art" src="${ART}/heart.png" alt="">` +
      '<div class="hero-health" role="meter" aria-label="Health" aria-valuemin="0" aria-valuemax="100">' +
      '<div class="trail"></div><div class="fill"></div><div class="scars"></div></div></div>' +
      `<div class="vital"><img class="vital-art element-art" src="${ART}/shard-ignis.png" alt="">` +
      '<div class="hero-meter" role="meter" aria-label="Bending meter" aria-valuemin="0" aria-valuemax="100">' +
      '<div class="meter-fill"></div><div class="meter-line"></div></div>' +
      '<span class="hero-supply" aria-live="polite"></span></div>' +
      '<div class="combat-status">' +
      '<span class="mode-badge">Unlit</span>' +
      '<span class="stance-badge">Barehanded</span>' +
      '</div>' +
      '</div>' +
      '<div class="lock-reticle"></div>' +
      '<p class="fight-banner" role="status"></p>';
    this.root.classList.toggle('debug', this.debug);
    document.body.appendChild(this.root);

    this.roundTracker = this.root.querySelector('.round-tracker')!;
    this.roundTitle = this.root.querySelector('.round-title')!;
    this.roundSub = this.root.querySelector('.round-sub')!;
    this.heroFill = this.root.querySelector('.fill')!;
    this.heroTrail = this.root.querySelector('.trail')!;
    this.heroScars = this.root.querySelector('.scars')!;
    this.banner = this.root.querySelector('.fight-banner')!;
    this.modeBadge = this.root.querySelector('.mode-badge')!;
    this.stanceBadge = this.root.querySelector('.stance-badge')!;
    this.purse = this.root.querySelector('.hud-purse')!;
    this.coinAmount = this.root.querySelector('.coin-amount')!;
    this.purse.querySelector('.purse-coin')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onSatchelClick?.();
    });
    this.flags = this.root.querySelector('.purse-flags')!;
    this.elementArt = this.root.querySelector('.element-art')!;
    this.lockReticle = this.root.querySelector('.lock-reticle')!;
    this.meter = this.root.querySelector('.hero-meter')!;
    this.meterFill = this.root.querySelector('.meter-fill')!;
    this.meterLine = this.root.querySelector('.meter-line')!;
    this.supply = this.root.querySelector('.hero-supply')!;

  }

  setElement(element: string): void { this.root.dataset.element = element.toLowerCase(); }

  /** The shard shown beside the bending meter: the kit's element, also for a Hush carrying its shards. */
  setElementArt(element: string): void {
    this.elementArt.src = `${ART}/shard-${element.toLowerCase()}.png`;
  }

  /** Coin the player carries, or null where there is no purse (the arena, offline without a sign-in). */
  setPurse(chroma: number | null): void {
    if (chroma === this.chroma) return;
    this.chroma = chroma;
    if (chroma !== null) this.coinAmount.textContent = String(chroma);
    this.showPurse();
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

  /** Red flags with the town watch, one flag each, or the bounty they turned into. */
  setStanding(redFlags: number, hasBounty: boolean): void {
    this.standing = { redFlags, hasBounty };
    const label = hasBounty ? 'Wanted: a bounty is on you' : `${redFlags} red flag${redFlags === 1 ? '' : 's'}`;
    this.flags.setAttribute('aria-label', redFlags || hasBounty ? label : '');
    this.flags.title = label;
    this.flags.innerHTML = hasBounty
      ? `<img src="${ART}/bounty.png" alt=""><span>Wanted</span>`
      : Array.from({ length: redFlags }, () => `<img src="${ART}/flag.png" alt="">`).join('');
    this.showPurse();
  }

  private showPurse(): void {
    this.purse.hidden = this.chroma === null && this.standing.redFlags === 0 && !this.standing.hasBounty && !this.debug;
    this.purse.querySelector<HTMLElement>('.purse-coin')!.hidden = this.chroma === null && !this.debug;
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
    element = 'IGNIS',
    roundInfo?: RoundHudInfo,
    fightingStyle: 'weapon' | 'bare_hands' | 'legs' | 'bending' = 'weapon',
    isDim = false,
    inFight = true,
  ): void {
    this.root.classList.toggle('calm', !inFight && !this.debug);
    const name = element.charAt(0) + element.slice(1).toLowerCase();
    this.modeBadge.textContent = isDim ? 'Hush' : isLit ? `${name}, lit` : name;
    this.modeBadge.className = isDim ? 'mode-badge dim' : isLit ? 'mode-badge lit' : 'mode-badge';
    this.stanceBadge.textContent = fightingStyle === 'weapon' ? (isArmed ? 'Blade drawn' : 'Blade')
      : fightingStyle === 'legs' ? 'Kicks' : fightingStyle === 'bare_hands' ? 'Hands' : 'Bending';
    this.stanceBadge.className = 'stance-badge';

    // Update round tracker; open zones have no rounds.
    this.roundTracker.style.display = roundInfo ? '' : 'none';
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

    const share = hero.current / hero.maximum;
    const scars = hero.scars ?? 0;
    const scarShare = Math.min(1, scars / hero.maximum);
    this.heroScars.style.width = `${scarShare * 100}%`;
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

    // Update floating damage numbers
    for (let i = this.damagePopups.length - 1; i >= 0; i--) {
      const p = this.damagePopups[i]!;
      p.elapsed += delta;
      p.pos.y += p.vy * delta;
      p.vy = Math.max(0.1, p.vy - delta * 1.6);
      if (p.elapsed >= p.duration) {
        p.el.remove();
        this.damagePopups.splice(i, 1);
        continue;
      }
      this.point.copy(p.pos).project(camera);
      const visible = this.point.z < 1 && Math.abs(this.point.x) < 1.15 && Math.abs(this.point.y) < 1.15;
      p.el.style.display = visible ? '' : 'none';
      if (visible) {
        const x = (this.point.x + 1) / 2 * window.innerWidth;
        const y = (1 - this.point.y) / 2 * window.innerHeight;
        const progress = p.elapsed / p.duration;
        const opacity = progress > 0.65 ? Math.max(0, 1 - (progress - 0.65) / 0.35) : 1;
        const scale = progress < 0.12 ? 0.7 + (progress / 0.12) * 0.45 : 1.15 - (progress - 0.12) * 0.2;
        p.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${scale})`;
        p.el.style.opacity = String(opacity);
      }
    }
  }

  /** Spawns a floating damage number in 3D world space that rises and pops. */
  showDamage(worldPos: Vector3, damage: number, isCrit = false, label?: string): void {
    const el = document.createElement('div');
    el.className = isCrit ? 'damage-number crit' : 'damage-number';
    el.textContent = label ?? `-${Math.round(damage)}${isCrit ? ' CRIT' : ''}`;
    this.root.appendChild(el);
    this.damagePopups.push({
      el,
      pos: worldPos.clone().add(new Vector3((Math.random() - 0.5) * 0.5, 1.25 + Math.random() * 0.35, (Math.random() - 0.5) * 0.5)),
      elapsed: 0,
      duration: 0.85,
      vy: 1.35,
    });
  }

  dispose(): void {
    for (const p of this.damagePopups) p.el.remove();
    this.damagePopups = [];
    this.root.remove();
    this.bars.clear();
  }
}
