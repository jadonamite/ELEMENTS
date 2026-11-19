import type { Element } from '../../../shared/src/index.js';
import type { RisingResult } from '../../../shared/src/rising/types.js';
import { EMBLEM_RING, HUSH_EMBLEM_PATH } from '../ui/loader-turn.js';

/**
 * The Drawing reveal. It plays itself: a heavy metal card rises out of the dark and the four element tokens spin round
 * the socket on its back, slowing to rest. A Shaper's element slides into the centre seat and glows, and its element
 * rises behind the card. A Hush sees all four go dark and the forge mark take the seat; then the ring turns again and
 * stops with their nation at the top. Timed to the score: its hit at 12 s is the glow.
 */

export const NATION_COLOUR: Record<Element, string> = {
  IGNIS: '#ff5a2c',
  AQUES: '#4cc3ff',
  TERRA: '#f0a640',
  AURA: '#e9eef5',
};
const FORGE_GOLD = '#d9a441';

/** Where each nation is, from the lore. */
const NATION_PLACE: Record<Element, string> = {
  IGNIS: 'The volcanic forge city',
  AQUES: 'The river delta',
  TERRA: 'The canyon fortress',
  AURA: 'The high cliffs',
};

const RING: readonly Element[] = ['IGNIS', 'AQUES', 'AURA', 'TERRA'];
const ART = '/assets/ui/drawing';
/** Each token's quarter of the token sheet (2x2). */
const SHEET: Record<Element, [number, number]> = { IGNIS: [0, 0], AQUES: [1, 0], AURA: [0, 1], TERRA: [1, 1] };
/** The socket on the card back, as fractions of the card: centre, track radius and token size (of the width). */
const SOCKET = { x: 0.493, y: 0.484, track: 0.288, token: 0.2, seat: 1.55, tokenFill: 0.86 };
/** The element behind the card: its clip, where its loop restarts (null plays once and fades), how it sits. */
const PLATE: Record<Element, { src: string; loopFrom: number | null; y: number; opacity: number; filter: string }> = {
  IGNIS: { src: `${ART}/ignis.mp4`, loopFrom: 4.5, y: 0.75, opacity: 1, filter: 'none' },
  AQUES: { src: `${ART}/aques.mp4`, loopFrom: 0, y: 0.05, opacity: 0.95, filter: 'none' },
  AURA: { src: `${ART}/aura.mp4`, loopFrom: 0, y: 0.7, opacity: 0.85, filter: 'brightness(.9)' },
  TERRA: { src: `${ART}/terra.mp4`, loopFrom: null, y: 0.1, opacity: 1, filter: 'none' },
};

/** Seconds from the start of the reveal. The score's hit lands on `glow`. */
const T = {
  rise: 0.3,
  risen: 1.9,
  spin: 1.8,
  stop: 10.6,
  seat: 10.8,
  seated: 11.9,
  glow: 12.0,
  words: 12.8,
  nationSpin: 13.6,
  nationStop: 16.8,
  nationWords: 17.4,
  done: { Shaper: 15.2, Hush: 19.6 },
} as const;
/** Whole turns the ring makes before it rests. */
const TURNS = 5;
const NATION_TURNS = 2;
/** The card's thickness, drawn as stacked darkened copies of its back. */
const EDGE_LAYERS = 14;

const ease = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));
/** Eased progress from `from` to `to`, fast at first and slowing to rest. */
const spinK = (t: number, from: number, to: number): number => 1 - Math.pow(1 - clamp01((t - from) / (to - from)), 3);

export interface RevealOptions {
  reducedMotion: boolean;
  /** Plays a one-shot sound from the game's audio folder. */
  sound: (name: string, volume?: number) => void;
}

/** Plays the reveal inside `host`; resolves when the result is on screen and the player can go on. */
export function playDrawingReveal(host: HTMLElement, result: RisingResult, opts: RevealOptions): Promise<void> {
  const nation = result.element;
  const hush = result.role === 'Hush';
  const plate = PLATE[nation];
  host.innerHTML = `
    <div class="draw-stage ${hush ? 'is-hush' : 'is-shaper'}" style="--nation:${NATION_COLOUR[nation]};--forge:${FORGE_GOLD}">
      <div class="draw-haze"></div>
      <div class="draw-plate"><video muted playsinline preload="auto" src="${plate.src}"></video></div>
      <header class="draw-words" aria-live="polite">
        <p class="opening-kicker">The Lord's Drawing</p>
        <h2 class="draw-title"></h2>
        <p class="draw-sub"></p>
      </header>
      <div class="draw-anchor"><div class="draw-card"></div></div>
      <canvas class="draw-sparks"></canvas>
      <div class="draw-after"></div>
    </div>`;
  const stage = host.querySelector<HTMLElement>('.draw-stage')!;
  const anchor = stage.querySelector<HTMLElement>('.draw-anchor')!;
  const card = stage.querySelector<HTMLElement>('.draw-card')!;
  const title = stage.querySelector<HTMLElement>('.draw-title')!;
  const sub = stage.querySelector<HTMLElement>('.draw-sub')!;
  const plateBox = stage.querySelector<HTMLElement>('.draw-plate')!;
  const video = plateBox.querySelector('video')!;
  const sparks = stage.querySelector<HTMLCanvasElement>('.draw-sparks')!;
  plateBox.style.setProperty('--plate-y', String(plate.y));
  plateBox.style.setProperty('--plate-o', String(plate.opacity));
  video.style.filter = plate.filter;
  video.loop = plate.loopFrom === 0;
  video.addEventListener('timeupdate', () => {
    if (plate.loopFrom && video.duration && video.currentTime > video.duration - 0.12) video.currentTime = plate.loopFrom;
  });
  video.addEventListener('ended', () => { if (plate.loopFrom === null) plateBox.classList.add('spent'); });

  const showWords = (main: string, line: string): void => {
    title.textContent = main;
    sub.textContent = line;
    stage.classList.add('words-in');
  };
  const finalWords = (): void =>
    showWords(`${hush ? 'Hush' : 'Shaper'} of ${nation}`, `${NATION_PLACE[nation]} is your home`);

  // The card: its back, darkened copies behind it for thickness, the drawn element's light, a sheen, the tokens.
  for (let i = EDGE_LAYERS; i >= 1; i--) {
    const slab = document.createElement('div');
    slab.className = 'draw-slab edge';
    slab.style.setProperty('--z', String(i / EDGE_LAYERS));
    card.appendChild(slab);
  }
  card.insertAdjacentHTML('beforeend', '<div class="draw-slab face"></div><div class="draw-face-light"></div><div class="draw-sheen"></div>');
  const faceLight = card.querySelector<HTMLElement>('.draw-face-light')!;
  faceLight.style.setProperty('--sx', `${SOCKET.x * 100}%`);
  faceLight.style.setProperty('--sy', `${SOCKET.y * 100}%`);
  const sheen = card.querySelector<HTMLElement>('.draw-sheen')!;
  const tokens = RING.map(element => {
    const el = document.createElement('div');
    el.className = 'draw-token';
    card.appendChild(el);
    return { el, element };
  });
  const hushToken = document.createElement('div');
  hushToken.className = 'draw-token draw-hush';
  hushToken.innerHTML = `<svg viewBox="0 0 64 64" aria-hidden="true"><path fill-rule="evenodd" d="${EMBLEM_RING}"/><path fill-rule="evenodd" d="${HUSH_EMBLEM_PATH}"/></svg>`;
  if (hush) card.appendChild(hushToken);

  let W = 0, H = 0, d = 0, dpr = 1;
  const measure = (): void => {
    W = anchor.offsetWidth; H = anchor.offsetHeight;
    d = W * SOCKET.token;
    const sheet = (d / SOCKET.tokenFill) * 2, q = sheet / 2;
    for (const t of tokens) {
      const [qx, qy] = SHEET[t.element];
      t.el.style.width = t.el.style.height = `${d}px`;
      t.el.style.backgroundSize = `${sheet}px ${sheet}px`;
      t.el.style.backgroundPosition = `${d / 2 - (qx * q + q / 2)}px ${d / 2 - (qy * q + q / 2)}px`;
    }
    hushToken.style.width = hushToken.style.height = `${d}px`;
    // Layout position, not the drawn one: the card is still rising when this first runs.
    plateBox.style.setProperty('--plate-left', `${anchor.offsetLeft + W / 2}px`);
    plateBox.style.setProperty('--plate-top', `${anchor.offsetTop + H / 2}px`);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    sparks.width = stage.clientWidth * dpr; sparks.height = stage.clientHeight * dpr;
  };
  measure();
  window.addEventListener('resize', measure);

  const cx = (): number => SOCKET.x * W, cy = (): number => SOCKET.y * H, R = (): number => SOCKET.track * W;
  const place = (el: HTMLElement, x: number, y: number, z: number, s: number): void => {
    el.style.transform = `translate3d(${x - d / 2}px, ${y - d / 2}px, ${z}px) scale(${s})`;
  };
  /** Token i on the ring when `ref` sits at the top and the ring has turned `angle`. */
  const onRing = (i: number, ref: number, angle: number): [number, number] => {
    const a = angle + (i - ref) * Math.PI / 2 - Math.PI / 2;
    return [cx() + Math.cos(a) * R(), cy() + Math.sin(a) * R()];
  };
  const chosen = RING.indexOf(nation);

  if (opts.reducedMotion) {
    stage.classList.add('reduced', 'risen', 'glowing', 'element-in');
    tokens.forEach((t, i) => {
      const [x, y] = onRing(i, chosen, 0);
      if (!hush && i === chosen) place(t.el, cx(), cy(), 6, SOCKET.seat);
      else place(t.el, x, y, 6, 1);
      t.el.classList.toggle('lit', i === chosen);
      t.el.classList.toggle('dim', i !== chosen);
    });
    if (hush) { place(hushToken, cx(), cy(), 6, SOCKET.seat); hushToken.style.opacity = '1'; }
    void video.play().catch(() => {});
    finalWords();
    window.removeEventListener('resize', measure);
    return Promise.resolve();
  }

  // Forge sparks off the Hush mark, on one canvas in front of the card.
  const g = sparks.getContext('2d')!;
  const embers: Array<{ x: number; y: number; vx: number; vy: number; life: number; max: number; s: number }> = [];
  const burst = (x: number, y: number, n: number, power: number): void => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = (40 + Math.random() * 260) * power;
      const life = 0.5 + Math.random() * 1.1;
      embers.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120 * power, life, max: life, s: 1 + Math.random() * 2.2 });
    }
  };

  let tiltX = 0, tiltY = 0, goalX = 0, goalY = 0;
  const onPointer = (e: PointerEvent): void => {
    goalY = (e.clientX / window.innerWidth - 0.5) * 14;
    goalX = -(e.clientY / window.innerHeight - 0.5) * 8;
  };
  window.addEventListener('pointermove', onPointer);

  // A Shaper's ring rests with their element on top, the doorway to the seat. A Hush's ring first rests with the
  // opposite token on top (all four then go dark), then turns again and rests with their nation on top. The second
  // turn starts from where the first ended, so the ring never jumps.
  const firstRef = hush ? (chosen + 2) % 4 : chosen;
  const handover = (firstRef - chosen) * Math.PI / 2;

  return new Promise(resolve => {
    const start = performance.now();
    let last = start, resolved = false;
    const fired = new Set<string>();
    const once = (key: string, at: number, t: number, fn: () => void): void => {
      if (t >= at && !fired.has(key)) { fired.add(key); fn(); }
    };

    requestAnimationFrame(measure);
    const frame = (now: number): void => {
      if (!stage.isConnected) {
        window.removeEventListener('pointermove', onPointer);
        window.removeEventListener('resize', measure);
        return;
      }
      const t = (now - start) / 1000, dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      tiltX += (goalX - tiltX) * 0.05; tiltY += (goalY - tiltY) * 0.05;

      once('rise', T.rise, t, () => stage.classList.add('risen'));
      const rise = ease((t - T.rise) / (T.risen - T.rise));
      const sway = Math.sin(t * 0.55) * 13 * rise, bob = Math.sin(t * 0.9) * 4;
      card.style.transform = `rotateX(${5 + tiltX}deg) rotateY(${sway + tiltY}deg) translateY(${bob}px)`;
      sheen.style.setProperty('--sheen', `${110 + sway * 3}deg`);

      const secondTurn = hush && t >= T.nationSpin;
      const ref = secondTurn ? chosen : firstRef;
      const angle = secondTurn
        ? -handover + spinK(t, T.nationSpin, T.nationStop) * (NATION_TURNS * Math.PI * 2 + handover)
        : spinK(t, T.spin, T.stop) * TURNS * Math.PI * 2;
      const spinning = (t > T.spin && t < T.stop) || (secondTurn && t < T.nationStop);
      const seat = ease((t - T.seat) / (T.seated - T.seat));
      tokens.forEach((tok, i) => {
        let [x, y] = onRing(i, ref, angle);
        let z = 6, s = 1;
        if (!hush && i === chosen) {
          x += (cx() - x) * seat; y += (cy() - y) * seat;
          z = 6 + 22 * Math.sin(Math.PI * seat) + 4 * seat;
          s = 1 + (SOCKET.seat - 1) * seat;
        }
        place(tok.el, x, y, z, s);
        const lit = i === chosen && (hush ? t >= T.nationStop : t >= T.glow);
        tok.el.classList.toggle('lit', lit);
        tok.el.classList.toggle('dim', t >= T.stop + 0.4 && !lit && !(secondTurn && spinning));
        tok.el.classList.toggle('blur', spinning);
      });

      if (hush) {
        const k = ease((t - T.seat) / (T.seated - T.seat));
        hushToken.style.opacity = String(k);
        place(hushToken, cx(), cy() - (1 - k) * H * 0.08, 6 + 26 * (1 - k), SOCKET.seat * (0.7 + 0.3 * k));
      }

      once('glow', T.glow, t, () => {
        stage.classList.add('glowing');
        if (hush) {
          opts.sound('ambient_forge_hammer', 0.9);
          const r = hushToken.getBoundingClientRect();
          burst(r.left + r.width / 2, r.top + r.height / 2, 120, 1);
          showWords('The Hush', 'You forge from raw shards. No one else can.');
        } else {
          stage.classList.add('element-in');
          void video.play().catch(() => {});
          opts.sound(nation === 'TERRA' ? 'ground_pound_02' : 'fire_burst_02', nation === 'IGNIS' ? 0.7 : 0.35);
        }
      });
      if (!hush) once('words', T.words, t, finalWords);
      else {
        once('nation', T.nationStop, t, () => {
          stage.classList.add('element-in', 'nation-set');
          void video.play().catch(() => {});
          opts.sound(nation === 'TERRA' ? 'ground_pound_02' : 'fire_burst_02', 0.35);
        });
        once('nationWords', T.nationWords, t, finalWords);
        if (t > T.glow && Math.random() < 0.35) {
          const r = hushToken.getBoundingClientRect();
          burst(r.left + r.width / 2, r.top + r.height * 0.4, 1, 0.35);
        }
      }

      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, sparks.width, sparks.height);
      g.globalCompositeOperation = 'lighter';
      for (let i = embers.length - 1; i >= 0; i--) {
        const p = embers[i]!;
        p.life -= dt;
        if (p.life <= 0) { embers.splice(i, 1); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 380 * dt; p.vx *= 0.99;
        const k = p.life / p.max;
        g.fillStyle = `rgba(255,${180 + 60 * k},${90 * k},${k})`;
        g.fillRect(p.x, p.y, p.s, p.s);
      }

      if (!resolved && t >= T.done[result.role]) { resolved = true; resolve(); }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}
