/** Semantic inputs shared by device bindings and character learning records. */
export const CONTROL_ACTIONS = [
  'move', 'look', 'run', 'strike', 'heavy', 'rise', 'ground', 'bend_move', 'ultimate',
  'block', 'parry', 'dodge', 'jump', 'weapon', 'hands', 'legs', 'stance', 'bending',
  'interact', 'lock', 'menu', 'technique', 'duel', 'spark', 'satchel',
] as const;
export type ControlAction = typeof CONTROL_ACTIONS[number];
export type ControlProgress = Partial<Record<ControlAction, { uses: number; shown: number }>>;
export const LEARNING_LIMIT = 3;

export function normalizeControlProgress(value: unknown): ControlProgress {
  const result: ControlProgress = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  const count = (n: unknown): number => typeof n === 'number' && Number.isFinite(n)
    ? Math.max(0, Math.min(LEARNING_LIMIT, Math.floor(n))) : 0;
  for (const action of CONTROL_ACTIONS) {
    const entry = (value as Record<string, unknown>)[action];
    if (entry && typeof entry === 'object') {
      const v = entry as Record<string, unknown>;
      result[action] = { uses: count(v.uses), shown: count(v.shown) };
    }
  }
  return result;
}

/** A stale device can never forget an action already learned on another device. */
export function mergeControlProgress(a: ControlProgress, b: ControlProgress): ControlProgress {
  const left = normalizeControlProgress(a), right = normalizeControlProgress(b);
  const result: ControlProgress = {};
  for (const action of CONTROL_ACTIONS) {
    if (!left[action] && !right[action]) continue;
    result[action] = { uses: Math.max(left[action]?.uses ?? 0, right[action]?.uses ?? 0),
      shown: Math.max(left[action]?.shown ?? 0, right[action]?.shown ?? 0) };
  }
  return result;
}

export function needsControlLesson(progress: ControlProgress, action: ControlAction): boolean {
  return (progress[action]?.uses ?? 0) < LEARNING_LIMIT && (progress[action]?.shown ?? 0) < LEARNING_LIMIT;
}
