import type { SindrAnchor } from './sindr.js';

export interface WaterSample { x: number; z: number; surface: number; bed: number }
export interface WaterReach { id: string; source: string; kind: 'fresh' | 'hot' | 'lava'; samples: WaterSample[]; downstream?: string }

/** Returns data errors; physical door access is checked against built collision on the client. */
export function validateAnchors(anchors: readonly SindrAnchor[]): string[] {
  const errors: string[] = [], ids = new Set<string>(), institutions = new Set<string>();
  for (const a of anchors) {
    if (ids.has(a.id)) errors.push(`Duplicate place ${a.id}`);
    ids.add(a.id);
    if (![a.x, a.y, a.z, a.yaw, a.reach].every(Number.isFinite) || a.reach <= 0) errors.push(`Invalid place ${a.id}`);
    if (a.institution) {
      if (institutions.has(a.institution)) errors.push(`Duplicate institution ${a.institution}`);
      institutions.add(a.institution);
    }
    if (a.kind === 'counting_house' && (!a.institution || !a.door)) errors.push(`Missing counting-house entrance ${a.id}`);
    if (a.door && ![a.door.x, a.door.z].every(Number.isFinite)) errors.push(`Invalid door ${a.id}`);
  }
  return errors;
}

/** Ordered samples follow flow; a connected unpowered reach never rises downstream. */
export function validateWater(reaches: readonly WaterReach[]): string[] {
  const errors: string[] = [], byId = new Map(reaches.map(r => [r.id, r]));
  if (byId.size !== reaches.length) errors.push('Duplicate water reach');
  for (const r of reaches) {
    if (!r.source || r.samples.length < 2) errors.push(`Missing water source/profile ${r.id}`);
    r.samples.forEach((p, i) => {
      if (![p.x, p.z, p.surface, p.bed].every(Number.isFinite) || p.bed >= p.surface) errors.push(`Invalid water depth ${r.id}:${i}`);
      if (i && p.surface > r.samples[i - 1]!.surface) errors.push(`Water rises downstream ${r.id}:${i}`);
    });
    if (r.downstream) {
      const next = byId.get(r.downstream), end = r.samples.at(-1), start = next?.samples[0];
      if (!next || !end || !start) { errors.push(`Missing downstream ${r.id}`); continue; }
      if (end.x !== start.x || end.z !== start.z || end.surface !== start.surface) errors.push(`Disconnected water ${r.id}`);
      if (r.kind !== next.kind) errors.push(`Contradictory water kind ${r.id}`);
    }
  }
  for (const r of reaches) {
    const visited = new Set<string>(); let current: WaterReach | undefined = r;
    while (current) {
      if (visited.has(current.id)) { errors.push(`Water cycle ${r.id}`); break; }
      visited.add(current.id); current = current.downstream ? byId.get(current.downstream) : undefined;
    }
  }
  return errors;
}
