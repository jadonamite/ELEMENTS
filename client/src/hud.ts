import { type Camera, Vector3 } from 'three';
import type { Health } from '../../shared/src/index.js';
import type { Enemy } from './enemy.js';

export interface CooldownItem {
  move: string;
  remaining: number;
  total: number;
}

/** Hero health in the corner, and a slim bar over each husk once it has been hurt. */
export class FightHud {
  private readonly root: HTMLDivElement;
  private readonly heroFill: HTMLDivElement;
  private readonly heroTrail: HTMLDivElement;
  private readonly banner: HTMLParagraphElement;
  private readonly modeBadge: HTMLSpanElement;
  private readonly stanceBadge: HTMLSpanElement;
  private readonly lockReticle: HTMLDivElement;
  private readonly abilitySlots = new Map<string, { fill: HTMLDivElement; timer: HTMLSpanElement; root: HTMLDivElement }>();
  private readonly bars = new Map<Enemy, HTMLDivElement>();
  private trail = 1;
  private readonly point = new Vector3();

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'fight-hud';
    this.root.innerHTML =
      '<div class="combat-status">' +
      '<span class="mode-badge">Unlit</span>' +
      '<span class="stance-badge">Barehanded</span>' +
      '</div>' +
      '<div class="hero-health" role="meter" aria-label="Health" aria-valuemin="0" aria-valuemax="100">' +
      '<div class="trail"></div><div class="fill"></div></div>' +
      '<div class="ability-tray" aria-label="Abilities">' +
      '<div class="ability-slot" data-slot="uppercut"><div class="cd-fill"></div><span class="slot-key">Q</span><span class="slot-name">Uppercut</span><span class="slot-timer"></span></div>' +
      '<div class="ability-slot" data-slot="ground_pound"><div class="cd-fill"></div><span class="slot-key">E</span><span class="slot-name">Slam</span><span class="slot-timer"></span></div>' +
      '<div class="ability-slot" data-slot="dash_strike"><div class="cd-fill"></div><span class="slot-key">F</span><span class="slot-name">Dash</span><span class="slot-timer"></span></div>' +
      '<div class="ability-slot" data-slot="dodge"><div class="cd-fill"></div><span class="slot-key">Space</span><span class="slot-name">Dodge</span><span class="slot-timer"></span></div>' +
      '</div>' +
      '<div class="lock-reticle"></div>' +
      '<p class="fight-banner" role="status"></p>';
    document.body.appendChild(this.root);
    this.heroFill = this.root.querySelector('.fill')!;
    this.heroTrail = this.root.querySelector('.trail')!;
    this.banner = this.root.querySelector('.fight-banner')!;
    this.modeBadge = this.root.querySelector('.mode-badge')!;
    this.stanceBadge = this.root.querySelector('.stance-badge')!;
    this.lockReticle = this.root.querySelector('.lock-reticle')!;

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

  /** Large centred line such as "You fell", or empty to clear it. */
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
  ): void {
    const isHush = element === 'HUSH';
    this.modeBadge.textContent = isLit
      ? (isHush ? 'Hush Relic Overdrive' : `${element} Lit (Bending)`)
      : (isHush ? 'Hush Relic (Physical)' : 'Physical (Unlit)');
    this.modeBadge.classList.toggle('lit', isLit);
    this.stanceBadge.textContent = isArmed ? 'Armed' : 'Barehanded';

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

  dispose(): void { this.root.remove(); }
}
