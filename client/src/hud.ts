import { type Camera, Vector3 } from 'three';
import type { Health } from '../../shared/src/index.js';
import type { Enemy } from './enemy.js';

/** Hero health in the corner, and a slim bar over each husk once it has been hurt. */
export class FightHud {
  private readonly root: HTMLDivElement;
  private readonly heroFill: HTMLDivElement;
  private readonly heroTrail: HTMLDivElement;
  private readonly banner: HTMLParagraphElement;
  private readonly bars = new Map<Enemy, HTMLDivElement>();
  private trail = 1;
  private readonly point = new Vector3();

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'fight-hud';
    this.root.innerHTML =
      '<div class="hero-health" role="meter" aria-label="Health" aria-valuemin="0" aria-valuemax="100">' +
      '<div class="trail"></div><div class="fill"></div></div>' +
      '<p class="fight-banner" role="status"></p>';
    document.body.appendChild(this.root);
    this.heroFill = this.root.querySelector('.fill')!;
    this.heroTrail = this.root.querySelector('.trail')!;
    this.banner = this.root.querySelector('.fight-banner')!;
  }

  /** Large centred line such as "You fell", or empty to clear it. */
  say(text: string): void { this.banner.textContent = text; }

  update(delta: number, hero: Health, enemies: readonly Enemy[], camera: Camera, barHeight: number): void {
    const share = hero.current / hero.maximum;
    // The pale trail drains after the fill, so a hit reads as a loss.
    this.trail = Math.max(share, this.trail - delta * 0.6);
    this.heroFill.style.transform = `scaleX(${share})`;
    this.heroTrail.style.transform = `scaleX(${this.trail})`;
    this.root.querySelector('.hero-health')!.setAttribute('aria-valuenow', String(Math.round(share * 100)));
    this.root.classList.toggle('low', share < 0.3);

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
