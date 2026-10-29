import { ELEMENTS, IGNIS_MOVE_IDS } from './types.js';
import type { ActionState, CombatBalance, Combatant, Element, Health, HitInput, HitResult, IgnisMoveId, Position } from './types.js';
export * from './types.js';

// Mathematical identities, not adjustable combat tuning.
const ZERO = 0;
const ONE = 1;
const counters: Readonly<Record<Element, Element>> = { AQUES: 'IGNIS', IGNIS: 'AURA', AURA: 'TERRA', TERRA: 'AQUES' };
const nonnegative = (value: number): boolean => Number.isFinite(value) && value >= ZERO;
const positive = (value: number): boolean => nonnegative(value) && value > ZERO;
const isElement = (value: Element): boolean => ELEMENTS.includes(value);
const isMove = (value: string): value is IgnisMoveId => IGNIS_MOVE_IDS.some(id => id === value);
const validPosition = (p: Position): boolean => [p.x, p.y, p.z].every(Number.isFinite);
const validHealth = (h: Health): boolean => positive(h.maximum) && nonnegative(h.current) && h.current <= h.maximum;
const validCombatant = (c: Combatant): boolean => isElement(c.element) && validPosition(c.position) && validHealth(c.health) && nonnegative(c.armour);
const invalid = (): never => { throw new RangeError('Combat values must be finite and within their valid range.'); };

/** Supply trusted balance.combat once; the factory snapshots tuning against later mutation. */
export function createCombatRules(balance: CombatBalance) {
  const rules = { ...balance.rules };
  if (!nonnegative(rules.counterBonus) || !positive(rules.armourScale) ||
      !positive(rules.damageWindowSeconds) || !positive(rules.maxDamagePerSecond) ||
      !positive(rules.defaultMaxHealth) || !nonnegative(rules.defaultArmour) ||
      !Number.isFinite(rules.damageWindowSeconds * rules.maxDamagePerSecond)) invalid();
  const moves = Object.fromEntries(IGNIS_MOVE_IDS.map(id => {
    const move = { ...balance.ignisStarterMoves[id] };
    if ((move.kind !== 'attack' && move.kind !== 'dodge') || !nonnegative(move.damage) ||
        !nonnegative(move.reach) || !positive(move.cooldownSeconds) ||
        (move.kind === 'attack' && !positive(move.damage)) ||
        (move.kind === 'dodge' && move.damage !== ZERO)) invalid();
    return [id, move];
  })) as Record<IgnisMoveId, CombatBalance['ignisStarterMoves'][IgnisMoveId]>;

  function counterMultiplier(attacker: Element, target: Element): number {
    if (!isElement(attacker) || !isElement(target)) invalid();
    return counters[attacker] === target ? ONE + rules.counterBonus : ONE;
  }
  function calculateDamage(baseDamage: number, attacker: Element, target: Element, armour = rules.defaultArmour): number {
    if (!nonnegative(baseDamage) || !nonnegative(armour)) invalid();
    const damage = baseDamage * counterMultiplier(attacker, target) / (ONE + armour / rules.armourScale);
    if (!nonnegative(damage)) invalid();
    return damage;
  }
  function createHealth(maximum = rules.defaultMaxHealth): Health {
    if (!positive(maximum)) invalid();
    return { current: maximum, maximum };
  }
  function applyDamage(health: Health, damage: number): Health {
    if (!validHealth(health) || !nonnegative(damage)) invalid();
    return { ...health, current: Math.max(ZERO, health.current - damage) };
  }
  function isDead(health: Health): boolean {
    if (!validHealth(health)) invalid();
    return health.current === ZERO;
  }
  function createActionState(): ActionState {
    return { lastActionAt: null, cooldowns: {}, damageHistory: [] };
  }
  function validState(state: ActionState): boolean {
    const last = state.lastActionAt;
    return (last === null || nonnegative(last)) &&
      Object.entries(state.cooldowns).every(([id, at]) => isMove(id) && nonnegative(at) && last !== null && at <= last) &&
      state.damageHistory.every((hit, index, history) => nonnegative(hit.at) && nonnegative(hit.damage) &&
        last !== null && hit.at <= last && (index === ZERO || hit.at >= history[index - ONE]!.at));
  }
  /** A ready move returns zero; a backwards clock is invalid. */
  function cooldownRemaining(moveId: IgnisMoveId, state: ActionState, now: number): number {
    if (!isMove(moveId) || !validState(state) || !nonnegative(now) ||
        (state.lastActionAt !== null && now < state.lastActionAt)) invalid();
    const last = state.cooldowns[moveId];
    return last === undefined ? ZERO : Math.max(ZERO, moves[moveId].cooldownSeconds - (now - last));
  }
  function recordAction(state: ActionState, moveId: IgnisMoveId, now: number, damage?: number): ActionState {
    const damageHistory = state.damageHistory.filter(hit => now - hit.at < rules.damageWindowSeconds);
    if (damage !== undefined) damageHistory.push({ at: now, damage });
    return { lastActionAt: now, cooldowns: { ...state.cooldowns, [moveId]: now }, damageHistory };
  }
  /** Commit target and state together, serially, in the server's attacker/target records. */
  function checkHit({ attacker, target, moveId, now, state }: HitInput): HitResult {
    if (!validCombatant(attacker) || !validCombatant(target) || !nonnegative(now) || !validState(state)) return { accepted: false, reason: 'invalid_input' };
    if (!isMove(moveId)) return { accepted: false, reason: 'unknown_move' };
    const move = moves[moveId];
    if (move.kind !== 'attack') return { accepted: false, reason: 'not_attack' };
    if (attacker.element !== 'IGNIS') return { accepted: false, reason: 'wrong_element' };
    if (isDead(attacker.health)) return { accepted: false, reason: 'attacker_dead' };
    if (isDead(target.health)) return { accepted: false, reason: 'target_dead' };
    if (state.lastActionAt !== null && now < state.lastActionAt) return { accepted: false, reason: 'clock_reversed' };
    const distance = Math.hypot(attacker.position.x - target.position.x, attacker.position.y - target.position.y, attacker.position.z - target.position.z);
    if (distance > move.reach) return { accepted: false, reason: 'out_of_reach' };
    if (cooldownRemaining(moveId, state, now) > ZERO) return { accepted: false, reason: 'cooldown' };
    const grossDamage = move.damage * counterMultiplier(attacker.element, target.element);
    const spent = state.damageHistory.reduce((sum, hit) => now - hit.at < rules.damageWindowSeconds ? sum + hit.damage : sum, ZERO);
    if (!nonnegative(grossDamage) || !nonnegative(spent)) return { accepted: false, reason: 'invalid_input' };
    if (spent + grossDamage > rules.maxDamagePerSecond * rules.damageWindowSeconds) return { accepted: false, reason: 'damage_cap' };
    const health = applyDamage(target.health, calculateDamage(move.damage, attacker.element, target.element, target.armour));
    return { accepted: true, damage: target.health.current - health.current,
      target: { ...target, health }, state: recordAction(state, moveId, now, grossDamage) };
  }
  /** Dodge only consumes its cooldown here; invulnerability belongs to the fight simulation. */
  function useDodge(state: ActionState, now: number): { accepted: true; state: ActionState } | { accepted: false; reason: 'invalid_input' | 'clock_reversed' | 'cooldown' } {
    if (!validState(state) || !nonnegative(now)) return { accepted: false, reason: 'invalid_input' };
    if (state.lastActionAt !== null && now < state.lastActionAt) return { accepted: false, reason: 'clock_reversed' };
    if (cooldownRemaining('dodge', state, now) > ZERO) return { accepted: false, reason: 'cooldown' };
    return { accepted: true, state: recordAction(state, 'dodge', now) };
  }
  return { counterMultiplier, calculateDamage, createHealth, applyDamage, isDead, createActionState, cooldownRemaining, checkHit, useDodge };
}
