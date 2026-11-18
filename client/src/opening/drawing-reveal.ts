import type { Element } from '../../../shared/src/index.js';
import type { RisingResult } from '../../../shared/src/rising/types.js';
import { EMBLEM_PATHS, EMBLEM_RING, GLYPH_ELEMENTS, HUSH_EMBLEM_PATH } from '../ui/loader-turn.js';

/**
 * The Drawing reveal. It plays itself: the card rises face down, the four elements circle it, then either the drawn
 * element dives into the card (a Shaper) or every element leaves and the forge answers (a Hush, who then draws a
 * nation). Timed to the score: its hit at 12 s is the flip.
 */

export const NATION_COLOUR: Record<Element, string> = {
  IGNIS: '#e8453c',
  AQUES: '#38bdf8',
  TERRA: '#e09f3e',
  AURA: '#f1efe6',
};
const FORGE_GOLD = '#d9a441';

/** Where each nation is, from the lore. */
const NATION_PLACE: Record<Element, string> = {
  IGNIS: 'The volcanic forge city',
  AQUES: 'The river delta',
  TERRA: 'The canyon fortress',
  AURA: 'The high cliffs',
};
const NATION_POWER: Record<Element, string> = {
  IGNIS: 'You bend fire',
  AQUES: 'You bend water',
  TERRA: 'You bend stone',
  AURA: 'You bend air',
};

/** Seconds from the start of the reveal. The score's hit lands at FLIP. */
const T = {
  rise: 0.4,
  orbit: 1.8,
  tremble: 8.2,
  part: 10.0,
  flip: 12.0,
  dive: 14.6,
  words: 15.4,
  nationDraw: 15.8,
  nationPick: 19.4,
  done: { Shaper: 17.2, Hush: 21.6 },
} as const;

/** Whole turns the Hush's nation wheel makes before it rests on the drawn nation. */
const WHEEL_TURNS = 2;

const emblemIndex = (e: Element): number => GLYPH_ELEMENTS.indexOf(e as (typeof GLYPH_ELEMENTS)[number]);
const emblemPath = (e: Element): string => EMBLEM_PATHS[emblemIndex(e)]!;

function emblemSvg(e: Element, cls: string): string {
  return `<svg class="${cls}" viewBox="0 0 64 64" aria-hidden="true"><path fill-rule="evenodd" d="${EMBLEM_RING}"/><path fill-rule="evenodd" d="${emblemPath(e)}"/></svg>`;
}

function cardBack(): string {
  const ring = GLYPH_ELEMENTS.map((e, i) => {
    const a = (i / 4) * Math.PI * 2 - Math.PI / 2;
    return `<g transform="translate(${50 + Math.cos(a) * 27} ${75 + Math.sin(a) * 27}) scale(.26) translate(-32 -32)"><path fill-rule="evenodd" d="${EMBLEM_RING}"/><path fill-rule="evenodd" d="${emblemPath(e)}"/></g>`;
  }).join('');
  return `<div class="draw-face draw-back">
    <svg class="draw-back-art" viewBox="0 0 100 150" aria-hidden="true">
      <rect class="draw-back-rule" x="6" y="6" width="88" height="138"/>
      <rect class="draw-back-rule faint" x="9" y="9" width="82" height="132"/>
      <circle class="draw-back-rule" cx="50" cy="75" r="40"/>
      <circle class="draw-back-rule faint" cx="50" cy="75" r="14"/>
      ${ring}
      <text x="50" y="132" text-anchor="middle">THE LORD'S DRAWING</text>
    </svg>
  </div>`;
}

function cardFront(result: RisingResult): string {
  // A Shaper's card carries their nation's Shaper plate; the Hush's carries the forge mark, no person.
  const plate = result.role === 'Hush'
    ? `<svg class="draw-plate draw-hush-mark" viewBox="0 0 64 64" aria-hidden="true"><path fill-rule="evenodd" d="${EMBLEM_RING}"/><path fill-rule="evenodd" d="${HUSH_EMBLEM_PATH}"/></svg>`
    : `<img class="draw-plate" src="/assets/ui/loader/pictures/shaper-${result.element.toLowerCase()}.webp" alt="" width="667" height="1000" decoding="async">`;
  const name = result.role === 'Hush' ? 'The Hush' : `Shaper of ${result.element}`;
  const line = result.role === 'Hush' ? 'You forge from raw shards' : NATION_POWER[result.element];
  return `<div class="draw-face draw-front">
    <div class="draw-front-frame"></div>
    ${plate}
    <div class="draw-medallion">${emblemSvg(result.element, 'draw-emblem')}</div>
    <div class="draw-front-name"><span>${name}</span><small>${line}</small></div>
  </div>`;
}

type Kind = 'fire' | 'water' | 'stone' | 'air' | 'spark';
const KIND: Record<Element, Kind> = { IGNIS: 'fire', AQUES: 'water', TERRA: 'stone', AURA: 'air' };

interface Particle {
  x: number; y: number; vx: number; vy: number; life: number; max: number; size: number;
  kind: Kind; front: boolean; spin: number; rot: number; hue: number;
}

interface Orbiter {
  element: Element;
  phase: number;
  speed: number;
  /** 1 while circling; shrinks to 0 when diving into the card, grows when leaving. */
  radius: number;
  alpha: number;
  state: 'circling' | 'leaving' | 'diving' | 'gone';
  since: number;
  tilt: number;
  trail: Array<{ x: number; y: number; front: boolean }>;
}

const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const ease = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export interface RevealOptions {
  reducedMotion: boolean;
  /** Plays a one-shot sound from the game's audio folder. */
  sound: (name: string, volume?: number) => void;
}

/** Plays the reveal inside `host`; resolves when the result is on screen and the player can go on. */
export function playDrawingReveal(host: HTMLElement, result: RisingResult, opts: RevealOptions): Promise<void> {
  const colour = result.role === 'Hush' ? FORGE_GOLD : NATION_COLOUR[result.element];
  host.innerHTML = `
    <div class="draw-stage" style="--draw-colour:${colour};--nation-colour:${NATION_COLOUR[result.element]}">
      <div class="draw-glow"></div>
      <canvas class="draw-layer draw-layer-back"></canvas>
      <header class="draw-words" aria-live="polite">
        <p class="opening-kicker">The Lord's Drawing</p>
        <h2 class="draw-title"></h2>
        <p class="draw-sub"></p>
      </header>
      <div class="draw-card-wrap">
        <div class="draw-card ${result.role === 'Hush' ? 'is-hush' : 'is-shaper'}">${cardBack()}${cardFront(result)}</div>
      </div>
      <canvas class="draw-layer draw-layer-front"></canvas>
      <div class="draw-flash"></div>
      <div class="draw-after"></div>
    </div>`;
  const stage = host.querySelector<HTMLElement>('.draw-stage')!;
  const card = stage.querySelector<HTMLElement>('.draw-card')!;
  const wrap = stage.querySelector<HTMLElement>('.draw-card-wrap')!;
  const title = stage.querySelector<HTMLElement>('.draw-title')!;
  const sub = stage.querySelector<HTMLElement>('.draw-sub')!;
  const flash = stage.querySelector<HTMLElement>('.draw-flash')!;
  const front = stage.querySelector<HTMLElement>('.draw-front')!;
  const back = stage.querySelector<HTMLCanvasElement>('.draw-layer-back')!;
  const fore = stage.querySelector<HTMLCanvasElement>('.draw-layer-front')!;

  const showWords = (main: string, line: string): void => {
    title.textContent = main;
    sub.textContent = line;
    stage.classList.add('words-in');
  };
  const finalWords = (): void => {
    if (result.role === 'Hush') showWords(`Hush of ${result.element}`, `${NATION_PLACE[result.element]} is your home`);
    else showWords(`Shaper of ${result.element}`, `${NATION_PLACE[result.element]} is your home`);
  };

  if (opts.reducedMotion) {
    stage.classList.add('reduced', 'risen');
    return new Promise(resolve => {
      setTimeout(() => { card.classList.add('flipped'); stage.classList.add('revealed'); front.classList.add('burned', 'nation-set'); }, 1200);
      setTimeout(() => { finalWords(); resolve(); }, 2000);
    });
  }

  const ctxBack = back.getContext('2d')!;
  const ctxFore = fore.getContext('2d')!;
  let W = 0, H = 0, dpr = 1, cx = 0, cy = 0, cw = 0, ch = 0;
  const measure = (): void => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = stage.clientWidth; H = stage.clientHeight;
    for (const c of [back, fore]) { c.width = W * dpr; c.height = H * dpr; c.style.width = `${W}px`; c.style.height = `${H}px`; }
    // Layout position, not the drawn one: the card is still mid-rise when this first runs.
    cw = wrap.offsetWidth; ch = wrap.offsetHeight;
    cx = wrap.offsetLeft + cw / 2; cy = wrap.offsetTop + ch / 2;
  };
  measure();
  const onResize = (): void => measure();
  window.addEventListener('resize', onResize);

  const orbiters: Orbiter[] = GLYPH_ELEMENTS.map((element, i) => ({
    element, phase: (i / 4) * Math.PI * 2, speed: 2.1, radius: 1, alpha: 0, state: 'circling', since: 0,
    tilt: [-0.16, 0.12, -0.06, 0.2][i]!, trail: [],
  }));
  const particles: Particle[] = [];
  const nationOrbit = { active: false, angle: 0, alpha: 0, chosenAt: -1 };

  const orbitPoint = (o: Orbiter): { x: number; y: number; front: boolean } => {
    const rx = cw * 0.78 * o.radius, ry = ch * 0.2 * o.radius;
    const s = Math.sin(o.phase), c = Math.cos(o.phase);
    return { x: cx + c * rx, y: cy + s * ry + c * rx * o.tilt, front: s > 0 };
  };

  const spawn = (kind: Kind, x: number, y: number, front: boolean, n: number, power = 1): void => {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(10, 60) * power;
      const max = kind === 'stone' ? rand(0.9, 1.6) : kind === 'spark' ? rand(0.5, 1.2) : rand(0.45, 0.9);
      particles.push({
        x: x + rand(-6, 6), y: y + rand(-6, 6), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (kind === 'fire' ? 40 : 0),
        life: max, max, size: kind === 'stone' ? rand(3, 8) : kind === 'spark' ? rand(1, 2.4) : rand(5, 15), kind, front,
        spin: rand(-6, 6), rot: rand(0, 6), hue: rand(0, 1),
      });
    }
  };

  const drawParticle = (g: CanvasRenderingContext2D, p: Particle): void => {
    const k = p.life / p.max;
    if (p.kind === 'fire') {
      g.globalCompositeOperation = 'lighter';
      const r = p.size * (0.4 + k);
      const grad = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      grad.addColorStop(0, `rgba(255,${200 - 120 * (1 - k)},${90 * k},${0.85 * k})`);
      grad.addColorStop(0.5, `rgba(${230},${60 + 40 * p.hue},20,${0.5 * k})`);
      grad.addColorStop(1, 'rgba(120,10,0,0)');
      g.fillStyle = grad; g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill();
    } else if (p.kind === 'water') {
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = `rgba(${150 + 90 * p.hue},${215 + 30 * p.hue},255,${0.75 * k})`;
      g.lineWidth = Math.max(1, p.size * 0.22 * k);
      g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx * 0.06, p.y - p.vy * 0.06); g.stroke();
      g.fillStyle = `rgba(220,245,255,${0.8 * k})`; g.beginPath(); g.arc(p.x, p.y, p.size * 0.18, 0, Math.PI * 2); g.fill();
    } else if (p.kind === 'stone') {
      g.globalCompositeOperation = 'source-over';
      g.save(); g.translate(p.x, p.y); g.rotate(p.rot);
      g.fillStyle = `rgba(${150 + 60 * p.hue},${95 + 40 * p.hue},${45 + 20 * p.hue},${Math.min(1, k * 1.6)})`;
      const s = p.size;
      g.beginPath(); g.moveTo(-s, -s * 0.4); g.lineTo(-s * 0.2, -s); g.lineTo(s, -s * 0.3); g.lineTo(s * 0.6, s * 0.8); g.lineTo(-s * 0.7, s * 0.6); g.closePath(); g.fill();
      g.fillStyle = `rgba(255,210,150,${0.35 * k})`; g.fillRect(-s * 0.5, -s * 0.6, s * 0.7, s * 0.25);
      g.restore();
    } else if (p.kind === 'air') {
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = `rgba(245,243,236,${0.45 * k})`; g.lineWidth = 1.2;
      g.beginPath(); g.arc(p.x, p.y, p.size * (1.6 - k), p.rot, p.rot + 1.6); g.stroke();
    } else {
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = `rgba(255,${190 + 50 * k},${110 * k},${k})`;
      g.fillRect(p.x, p.y, p.size, p.size);
    }
  };

  const drawTrail = (g: CanvasRenderingContext2D, o: Orbiter, front: boolean): void => {
    const col = NATION_COLOUR[o.element];
    g.globalCompositeOperation = 'lighter';
    for (let i = 1; i < o.trail.length; i++) {
      const a = o.trail[i - 1]!, b = o.trail[i]!;
      if (b.front !== front) continue;
      g.strokeStyle = col; g.globalAlpha = o.alpha * (i / o.trail.length) * (o.element === 'TERRA' ? 0.35 : 0.55);
      g.lineWidth = 1 + 5 * (i / o.trail.length);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
    g.globalAlpha = 1;
  };

  const emblemPaths = GLYPH_ELEMENTS.map(e => ({ ring: new Path2D(EMBLEM_RING), mark: new Path2D(emblemPath(e)), element: e as Element }));
  /** The Hush's second draw: the four nation emblems turn like a wheel and stop on the drawn one at the front. */
  const drawNationWheel = (g: CanvasRenderingContext2D, front: boolean, t: number): void => {
    if (!nationOrbit.active) return;
    const chosen = emblemIndex(result.element);
    emblemPaths.forEach((e, i) => {
      const a = nationOrbit.angle + (i / 4) * Math.PI * 2 - chosen * (Math.PI / 2) + Math.PI / 2;
      const s = Math.sin(a), isFront = s > 0;
      if (isFront !== front) return;
      const x = cx + Math.cos(a) * cw * 0.85, y = cy + ch * 0.06 + s * ch * 0.16;
      const scale = (0.55 + 0.25 * s) * (cw / 260);
      const picked = nationOrbit.chosenAt >= 0;
      const isChosen = i === chosen;
      const fade = picked && !isChosen ? Math.max(0, 1 - (t - nationOrbit.chosenAt) * 1.5) : 1;
      let px = x, py = y;
      if (picked && isChosen) {
        const k = ease((t - nationOrbit.chosenAt - 0.5) / 0.7);
        const mx = cx, my = cy - ch * 0.5 + ch * 0.17;
        px = x + (mx - x) * k; py = y + (my - y) * k;
        if (k >= 1) return;
      }
      g.save(); g.globalCompositeOperation = 'source-over';
      g.globalAlpha = nationOrbit.alpha * fade * (0.5 + 0.5 * Math.max(0, s));
      g.translate(px, py); g.scale(scale, scale); g.translate(-32, -32);
      g.shadowColor = NATION_COLOUR[e.element]; g.shadowBlur = 18;
      g.fillStyle = NATION_COLOUR[e.element];
      g.fill(e.ring, 'evenodd'); g.fill(e.mark, 'evenodd');
      g.restore();
    });
  };

  return new Promise(resolve => {
    const start = performance.now();
    let last = start, raf = 0;
    const fired = new Set<string>();
    const once = (key: string, at: number, t: number, fn: () => void): void => {
      if (t >= at && !fired.has(key)) { fired.add(key); fn(); }
    };
    const done = T.done[result.role];

    const frame = (now: number): void => {
      const t = (now - start) / 1000, dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      once('rise', T.rise, t, () => stage.classList.add('risen'));
      once('glow', T.orbit, t, () => stage.classList.add('charging'));
      once('tremble', T.tremble, t, () => card.classList.add('trembling'));
      once('part', T.part, t, () => {
        card.classList.remove('trembling');
        for (const o of orbiters) {
          if (result.role === 'Shaper' && o.element === result.element) { o.speed = 3.4; continue; }
          o.state = 'leaving'; o.since = t;
        }
      });
      once('flip', T.flip, t, () => {
        card.classList.add('flipped'); stage.classList.add('revealed');
        flash.classList.add('on'); setTimeout(() => flash.classList.remove('on'), 120);
        if (result.role === 'Hush') {
          opts.sound('ambient_forge_hammer', 0.9);
          spawn('spark', cx, cy + ch * 0.32, true, 140, 6);
          showWords('The Hush', 'You forge from raw shards. No one else can.');
        }
      });
      if (result.role === 'Shaper') {
        once('dive', T.dive, t, () => {
          const o = orbiters.find(x => x.element === result.element)!;
          o.state = 'diving'; o.since = t;
        });
        once('burn', T.dive + 0.6, t, () => {
          front.classList.add('burned', 'nation-set');
          spawn(KIND[result.element], cx, cy - ch * 0.33, true, 60, 3);
          opts.sound(result.element === 'TERRA' ? 'ground_pound_02' : 'fire_burst_02', result.element === 'IGNIS' ? 0.7 : 0.35);
        });
        once('words', T.words, t, finalWords);
      } else {
        once('wheel', T.nationDraw, t, () => { nationOrbit.active = true; });
        once('pick', T.nationPick, t, () => { nationOrbit.chosenAt = t; });
        once('nation', T.nationPick + 1.2, t, () => { front.classList.add('burned', 'nation-set'); stage.style.setProperty('--draw-colour', NATION_COLOUR[result.element]); finalWords(); });
      }

      // The orbiters: circling, leaving outward, or diving into the card's medallion.
      const intensity = ease((t - T.orbit) / 2.5);
      for (const o of orbiters) {
        if (o.state === 'gone') continue;
        o.phase += o.speed * dt * (0.7 + 0.5 * intensity);
        if (o.state === 'circling') o.alpha = intensity;
        if (o.state === 'leaving') {
          const k = (t - o.since) / 1.1;
          o.radius = 1 + k * 1.4; o.alpha = Math.max(0, 1 - k);
          if (k >= 1) o.state = 'gone';
        }
        if (o.state === 'diving') {
          const k = ease((t - o.since) / 0.6);
          o.radius = 1 - k * 0.98; o.alpha = 1;
          if (k >= 1) o.state = 'gone';
        }
        const p = orbitPoint(o);
        if (o.state === 'diving') { p.x += (cx - p.x) * 0; p.y += ((cy - ch * 0.33) - p.y) * ease((t - o.since) / 0.6); p.front = true; }
        o.trail.push(p); if (o.trail.length > 18) o.trail.shift();
        if (o.alpha > 0.05) spawn(KIND[o.element], p.x, p.y, p.front, o.element === 'TERRA' ? 1 : 3, 1);
      }

      if (nationOrbit.active) {
        nationOrbit.alpha = Math.min(1, nationOrbit.alpha + dt * 2);
        // The angle is a function of time, not summed per frame: two whole turns, slowing to rest exactly as the pick
        // lands, so the drawn emblem eases into the front at any frame rate.
        const k = Math.min(1, Math.max(0, (t - T.nationDraw) / (T.nationPick - T.nationDraw)));
        nationOrbit.angle = WHEEL_TURNS * Math.PI * 2 * (1 - (1 - k) * (1 - k));
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]!;
        p.life -= dt;
        if (p.life <= 0) { particles.splice(i, 1); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.spin * dt;
        if (p.kind === 'stone' || p.kind === 'spark') p.vy += 420 * dt;
        if (p.kind === 'water') p.vy += 120 * dt;
        if (p.kind === 'fire') p.vy -= 30 * dt;
      }

      for (const [g, isFront] of [[ctxBack, false], [ctxFore, true]] as const) {
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, W, H);
        for (const o of orbiters) if (o.state !== 'gone') drawTrail(g, o, isFront);
        for (const p of particles) if (p.front === isFront) drawParticle(g, p);
        g.globalCompositeOperation = 'source-over';
        drawNationWheel(g, isFront, t);
      }

      if (t >= done) {
        window.removeEventListener('resize', onResize);
        // Keep the embers drifting gently behind the result until the stage is replaced.
        const idle = (n: number): void => {
          if (!stage.isConnected) return;
          const dt2 = Math.min(0.05, (n - last) / 1000); last = n;
          if (Math.random() < 0.5) spawn(result.role === 'Hush' ? 'spark' : KIND[result.element], cx + rand(-cw * 0.6, cw * 0.6), cy + ch * 0.55, Math.random() < 0.5, 1, 0.6);
          for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i]!; p.life -= dt2;
            if (p.life <= 0) { particles.splice(i, 1); continue; }
            p.x += p.vx * dt2; p.y += (p.vy - 40) * dt2;
          }
          for (const [g, isFront] of [[ctxBack, false], [ctxFore, true]] as const) {
            g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
            for (const p of particles) if (p.front === isFront) drawParticle(g, p);
          }
          requestAnimationFrame(idle);
        };
        requestAnimationFrame(idle);
        resolve();
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    void raf;
  });
}
