/**
 * Procedural 2D simplex / fractal noise utilities for terrain heightfields
 * and foliage clumping. Deterministic and fast.
 */

// Permutation table for gradient noise
const PERM = new Uint8Array(512);
const GRAD2 = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

// Initialize deterministic pseudo-random permutation table
(function initPermutation() {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let seed = 19880531;
  for (let i = 255; i > 0; i--) {
    seed = (seed * 16807 + 11) % 2147483647;
    const j = seed % (i + 1);
    const tmp = p[i]!;
    p[i] = p[j]!;
    p[j] = tmp;
  }
  for (let i = 0; i < 512; i++) {
    PERM[i] = p[i & 255]!;
  }
})();

function dot2(g: number[], x: number, y: number): number {
  return g[0]! * x + g[1]! * y;
}

/** 2D Perlin gradient noise in [-1, 1]. */
export function noise2D(x: number, y: number): number {
  const xi = Math.floor(x) & 255;
  const yi = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);

  // Quintic fade curve
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);

  const aa = PERM[PERM[xi]! + yi]! % 8;
  const ab = PERM[PERM[xi]! + yi + 1]! % 8;
  const ba = PERM[PERM[xi + 1]! + yi]! % 8;
  const bb = PERM[PERM[xi + 1]! + yi + 1]! % 8;

  const x1 = (1 - u) * dot2(GRAD2[aa]!, xf, yf) + u * dot2(GRAD2[ba]!, xf - 1, yf);
  const x2 = (1 - u) * dot2(GRAD2[ab]!, xf, yf - 1) + u * dot2(GRAD2[bb]!, xf - 1, yf - 1);

  return (1 - v) * x1 + v * x2;
}

/** Fractal Brownian Motion (multi-octave noise). */
export function fbm2D(x: number, y: number, octaves = 5, lacunarity = 2.0, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let maxAmp = 0;

  for (let i = 0; i < octaves; i++) {
    sum += noise2D(x * freq, y * freq) * amp;
    maxAmp += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / maxAmp;
}

/** Ridged multi-fractal noise: produces sharp ridges and eroded valleys. */
export function ridgedNoise2D(x: number, y: number, octaves = 4, lacunarity = 2.0, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let maxAmp = 0;

  for (let i = 0; i < octaves; i++) {
    let n = noise2D(x * freq, y * freq);
    n = 1.0 - Math.abs(n);
    n = n * n; // sharpen crests
    sum += n * amp;
    maxAmp += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / maxAmp;
}

/** Domain-warped fBm noise for organic, meandering terrain forms. */
export function warpedFbm2D(x: number, y: number): number {
  const qx = fbm2D(x + 1.2, y + 3.4, 3);
  const qy = fbm2D(x + 5.7, y + 8.1, 3);
  const wx = x + qx * 0.8;
  const wy = y + qy * 0.8;
  return fbm2D(wx, wy, 5);
}
