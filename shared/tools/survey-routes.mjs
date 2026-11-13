// Surveys each planned road on the land: a grade-limited path search between waypoints, with a cost for turning,
// so steep ground is climbed by contour bends and switchbacks. Writes src/world/ignis/route-lines.ts.
// Run after any change to the land or the plans: npx tsc && node tools/survey-routes.mjs
import { writeFileSync } from 'node:fs';
const dist = new URL('../dist/world/ignis/', import.meta.url);
const { baseGround, riverAt, LAKE } = await import(new URL('base-ground.js', dist));
const { ROUTE_PLANS } = await import(new URL('route-plans.js', dist));
const { nationalWaterAt } = await import(new URL('canals.js', dist));
// A town channel anywhere in or beside a cell counts like the river: cross it once, never follow it.
const canalNear = (x, z) => { for (let dx = -12; dx <= 12; dx += 6) for (let dz = -12; dz <= 12; dz += 6) if (nationalWaterAt(x + dx, z + dz)) return true; return false; };

const CELL = 16, W = 16000 / CELL + 1, D = 18000 / CELL + 1;
const height = new Float32Array(W * D), block = new Uint8Array(W * D);
for (let iz = 0; iz < D; iz++) for (let ix = 0; ix < W; ix++) {
  const x = ix * CELL, z = iz * CELL, g = baseGround(x, z), i = iz * W + ix;
  height[i] = g.height;
  const lake = Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz);
  block[i] = !g.inland || lake < 1.12 ? 2 : riverAt(x, z).distance < 26 || (Math.abs(x - 7000) < 500 && Math.abs(z - 9000) < 500 && canalNear(x, z)) ? 1 : 0;
}
const DIRS = [[1, 0], [2, 1], [1, 1], [1, 2], [0, 1], [-1, 2], [-1, 1], [-2, 1], [-1, 0], [-2, -1], [-1, -1], [-1, -2], [0, -1], [1, -2], [1, -1], [2, -1]];
const TURN = [0, 1, 8, 40, 90, 160, 160, 160, 160];

function leg(a, b, grade) {
  const margin = Math.max(900, Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.6);
  const x0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - margin) / CELL)), x1 = Math.min(W - 1, Math.ceil((Math.max(a[0], b[0]) + margin) / CELL));
  const z0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - margin) / CELL)), z1 = Math.min(D - 1, Math.ceil((Math.max(a[1], b[1]) + margin) / CELL));
  const w = x1 - x0 + 1, d = z1 - z0 + 1, n = w * d * 16;
  const cost = new Float64Array(n).fill(Infinity), from = new Int32Array(n).fill(-1);
  const sx = Math.round(a[0] / CELL), sz = Math.round(a[1] / CELL), ex = Math.round(b[0] / CELL), ez = Math.round(b[1] / CELL);
  const key = (ix, iz, dir) => ((iz - z0) * w + (ix - x0)) * 16 + dir;
  // Binary heap of [priority, state].
  const heapP = [], heapS = [];
  const push = (p, s) => { let i = heapP.length; heapP.push(p); heapS.push(s);
    while (i > 0) { const up = (i - 1) >> 1; if (heapP[up] <= p) break; heapP[i] = heapP[up]; heapS[i] = heapS[up]; i = up; } heapP[i] = p; heapS[i] = s; };
  const pop = () => { const top = heapS[0], p = heapP.pop(), s = heapS.pop(), m = heapP.length; if (m) { let i = 0;
    for (;;) { let c = i * 2 + 1; if (c >= m) break; if (c + 1 < m && heapP[c + 1] < heapP[c]) c++; if (heapP[c] >= p) break; heapP[i] = heapP[c]; heapS[i] = heapS[c]; i = c; }
    heapP[i] = p; heapS[i] = s; } return top; };
  for (let dir = 0; dir < 16; dir++) { cost[key(sx, sz, dir)] = 0; push(Math.hypot(ex - sx, ez - sz) * CELL, key(sx, sz, dir)); }
  let goal = -1;
  while (heapP.length) {
    const state = pop(), dir = state & 15, cellIndex = state >> 4, ix = cellIndex % w + x0, iz = Math.floor(cellIndex / w) + z0, base = cost[state];
    if (ix === ex && iz === ez) { goal = state; break; }
    const h0 = height[iz * W + ix];
    for (let turn = -8; turn < 8; turn++) {
      const nd = (dir + turn + 16) & 15, v = DIRS[nd], nx = ix + v[0], nz = iz + v[1];
      if (nx < x0 || nx > x1 || nz < z0 || nz > z1) continue;
      const cell = nz * W + nx, end = nx === ex && nz === ez;
      if (block[cell] === 2 && !end) continue;
      const length = Math.hypot(v[0], v[1]) * CELL, g = Math.abs(height[cell] - h0) / length;
      const over = Math.max(0, g - grade) / grade;
      let step = length * (1 + 30 * over * over) + TURN[Math.abs(turn)];
      if (block[cell] === 1) step += 400;
      // Keep through roads out of the built town.
      if (Math.hypot(nx * CELL - 7000, nz * CELL - 9000) < 260 && !end) step += length * 4;
      const total = base + step, k = key(nx, nz, nd);
      if (total >= cost[k]) continue;
      cost[k] = total; from[k] = state;
      push(total + Math.hypot(ex - nx, ez - nz) * CELL, k);
    }
  }
  if (goal < 0) throw new Error(`No way from ${a} to ${b}`);
  const path = [];
  for (let s = goal; s >= 0; s = from[s]) { const c = s >> 4; path.push([(c % w + x0) * CELL, (Math.floor(c / w) + z0) * CELL]); }
  path.reverse(); path[0] = [...a]; path[path.length - 1] = [...b];
  return path;
}

function resample(line, spacing) {
  const out = [line[0]]; let carry = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let at = spacing - carry;
    for (; at < length; at += spacing) out.push([a[0] + (b[0] - a[0]) * at / length, a[1] + (b[1] - a[1]) * at / length]);
    carry = length - (at - spacing);
  }
  out.push(line[line.length - 1]);
  return out;
}
function simplify(line, tolerance) {
  const keep = new Uint8Array(line.length); keep[0] = keep[line.length - 1] = 1;
  const stack = [[0, line.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let worst = 0, at = -1;
    const dx = line[b][0] - line[a][0], dz = line[b][1] - line[a][1], l = Math.hypot(dx, dz) || 1;
    for (let i = a + 1; i < b; i++) { const e = Math.abs((line[i][0] - line[a][0]) * dz - (line[i][1] - line[a][1]) * dx) / l; if (e > worst) { worst = e; at = i; } }
    if (worst > tolerance) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return line.filter((_, i) => keep[i]);
}

const lines = {};
for (const plan of ROUTE_PLANS) {
  const grade = plan.kind === 'cart' ? 0.068 : 0.15;
  let line = [];
  for (let i = 1; i < plan.waypoints.length; i++) {
    const part = resample(leg(plan.waypoints[i - 1], plan.waypoints[i], grade), 8);
    // Round the grid's corners; both ends of every leg stay on their waypoints.
    for (let pass = 0; pass < 10; pass++) { let prev = part[0];
      for (let j = 1; j < part.length - 1; j++) { const p = part[j]; part[j] = [(prev[0] + 2 * p[0] + part[j + 1][0]) / 4, (prev[1] + 2 * p[1] + part[j + 1][1]) / 4]; prev = p; } }
    line = line.concat(i === 1 ? part : part.slice(1));
  }
  // Ease the join between legs, except at the waypoints themselves.
  const pinned = new Set(plan.waypoints.map(p => p.join()));
  for (let pass = 0; pass < 4; pass++) { let prev = line[0];
    for (let j = 1; j < line.length - 1; j++) { const p = line[j]; if (!pinned.has(p.join())) line[j] = [(prev[0] + 2 * p[0] + line[j + 1][0]) / 4, (prev[1] + 2 * p[1] + line[j + 1][1]) / 4]; prev = p; } }
  lines[plan.id] = simplify(line, 0.6).map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
  let length = 0; for (let i = 1; i < line.length; i++) length += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  console.log(`${plan.id.padEnd(18)} ${length.toFixed(0)} m, ${lines[plan.id].length} points`);
}
const body = Object.entries(lines).map(([id, line]) => `  '${id}': [${line.map(p => `[${p[0]},${p[1]}]`).join(',')}],`).join('\n');
writeFileSync(new URL('../src/world/ignis/route-lines.ts', import.meta.url),
  `// Generated by tools/survey-routes.mjs from route-plans.ts and the land. Do not edit by hand.\nexport const ROUTE_LINES: Readonly<Record<string, readonly (readonly [number, number])[]>> = {\n${body}\n};\n`);
