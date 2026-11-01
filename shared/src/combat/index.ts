import { BEND_MOVE_IDS, ELEMENTS, MOVE_IDS, STARTER_MOVE_IDS, WEAPONS, WEAPON_MOVE_IDS } from './types.js';
import type { ActionState, BendMoveId, CombatBalance, CombatSituation, Combatant, Element, Health, HitInput, HitResult, Kit, MoveDefinition, MoveId, MoveStartResult, Position, RejectionReason, Weapon, WeaponMoveId } from './types.js';
export * from './types.js';

// Mathematical identities, not adjustable combat tuning.
const ZERO = 0;
const ONE = 1;
const nonnegative = (value: number): boolean => Number.isFinite(value) && value >= ZERO;
const positive = (value: number): boolean => nonnegative(value) && value > ZERO;
const isElement = (value: Element): boolean => ELEMENTS.includes(value);
const isWeapon = (value: Weapon): boolean => WEAPONS.includes(value);
const isMove = (value: string): value is MoveId => MOVE_IDS.some(id => id === value);
const isWeaponMove = (value: MoveId): value is WeaponMoveId => (WEAPON_MOVE_IDS as readonly string[]).includes(value);
export const isBendMove = (value: string): value is BendMoveId => (BEND_MOVE_IDS as readonly string[]).includes(value);
const validPosition = (p: Position): boolean => [p.x, p.y, p.z].every(Number.isFinite);
const validHealth = (h: Health): boolean => positive(h.maximum) && nonnegative(h.current) && h.current <= h.maximum;
const validCombatant = (c: Combatant): boolean => isElement(c.element) && validPosition(c.position) && validHealth(c.health) &&
  nonnegative(c.armour) && (c.weapon === undefined || isWeapon(c.weapon));
const invalid = (): never => { throw new RangeError('Combat values must be finite and within their valid range.'); };
const validMove = (move: MoveDefinition): boolean =>
  ['attack', 'dodge', 'heal'].includes(move.kind) && nonnegative(move.damage) && nonnegative(move.reach) &&
  positive(move.cooldownSeconds) && (move.kind !== 'attack' || positive(move.damage)) && (move.kind === 'attack' || move.damage === ZERO);

/** Supply trusted balance.combat once; the factory snapshots tuning against later mutation. */
export function createCombatRules(balance: CombatBalance) {
  const rules = { ...balance.rules };
  const litDamageMultiplier = rules.litDamageMultiplier ?? 1.6;
  const litCooldownMultiplier = rules.litCooldownMultiplier ?? 0.7;
  if (!positive(rules.armourScale) ||
      !positive(rules.damageWindowSeconds) || !positive(rules.maxDamagePerSecond) ||
      !positive(rules.defaultMaxHealth) || !nonnegative(rules.defaultArmour) ||
      !positive(litDamageMultiplier) || !positive(litCooldownMultiplier) ||
      !Number.isFinite(rules.damageWindowSeconds * rules.maxDamagePerSecond)) invalid();
  const burnConfig = balance.burn ? { ...balance.burn } : {
    damagePerSecond: 16,
    tickSeconds: 0.25,
    patchDurationMin: 2.2,
    patchDurationMax: 3.8,
    patchRadius: 1.25,
    maxPatches: 16,
    villainBurnDuration: 2.5,
  };
  if (!positive(burnConfig.damagePerSecond) || !positive(burnConfig.tickSeconds) ||
      !positive(burnConfig.patchDurationMin) || !positive(burnConfig.patchDurationMax) ||
      !positive(burnConfig.patchRadius) || !positive(burnConfig.maxPatches) ||
      !positive(burnConfig.villainBurnDuration)) invalid();
  const copy = <K extends string>(ids: readonly K[], table: Readonly<Record<K, MoveDefinition>>): Record<K, MoveDefinition> =>
    Object.fromEntries(ids.map((id) => {
      const move = { ...table[id] };
      if (!validMove(move)) invalid();
      return [id, move];
    })) as Record<K, MoveDefinition>;
  const starter = copy(STARTER_MOVE_IDS, balance.starterMoves);
  const weapons = Object.fromEntries(WEAPONS.map(w => [w, copy(WEAPON_MOVE_IDS, balance.weapons[w])])) as Record<Weapon, Record<WeaponMoveId, MoveDefinition>>;
  const elements = Object.fromEntries(ELEMENTS.map(e => [e, copy(BEND_MOVE_IDS, balance.elements[e])])) as Record<Element, Record<BendMoveId, MoveDefinition>>;
  const nationWeapon = { ...balance.nationWeapon };
  const meter = { ...balance.meter, costs: { ...balance.meter.costs } };
  const parry = { ...balance.parry };
  const spark = { ...balance.shardSpark };
  const tiers = { names: [...balance.tiers.names], required: { ...balance.tiers.required }, bendScale: { ...balance.tiers.bendScale } };
  const bendWithWeapon = balance.bendWithWeapon ? { ...balance.bendWithWeapon } : undefined;
  const situationalCounters = balance.situationalCounters ? { ...balance.situationalCounters } : undefined;
  if (!ELEMENTS.every(e => isWeapon(nationWeapon[e])) || !positive(meter.max) || !nonnegative(meter.chainCost) ||
      !positive(meter.weakScale) || !nonnegative(meter.chainBonus) || !positive(parry.window) || !positive(parry.hushWindow) ||
      !positive(spark.damageScale) || !positive(spark.cooldownSeconds) || tiers.names.length === ZERO) invalid();

  const defaultKit = (element: Element = 'IGNIS'): Kit => ({ element, weapon: nationWeapon[element] });
  const kitOf = (c: Combatant): Kit => ({ element: c.element, weapon: c.weapon ?? nationWeapon[c.element], hush: c.hush === true });

  /** The numbers a move has for this fighter's element and weapon. */
  function moveFor(moveId: MoveId, kit: Kit): MoveDefinition {
    if (isWeaponMove(moveId)) return weapons[kit.weapon][moveId];
    if (isBendMove(moveId)) return elements[kit.element][moveId];
    if (moveId === 'shard_spark') {
      const throwMove = elements[kit.element].bend_palm;
      return { ...starter.shard_spark, damage: throwMove.damage * spark.damageScale, reach: throwMove.reach, cooldownSeconds: spark.cooldownSeconds };
    }
    return starter[moveId];
  }
  /** Whether this fighter may use the move at all: the Hush never bend, and only the Hush throw sparks. */
  function kitAllows(moveId: MoveId, kit: Kit): boolean {
    if (isBendMove(moveId)) return !kit.hush;
    if (moveId === 'shard_spark') return kit.hush === true;
    return true;
  }
  function calculateDamage(baseDamage: number, armour = rules.defaultArmour): number {
    if (!nonnegative(baseDamage) || !nonnegative(armour)) invalid();
    const damage = baseDamage / (ONE + armour / rules.armourScale);
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
  function heal(health: Health, amount: number): Health {
    if (!validHealth(health) || !nonnegative(amount)) invalid();
    return { ...health, current: Math.min(health.maximum, health.current + amount) };
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
  function cooldownRemaining(moveId: MoveId, state: ActionState, now: number, isLit = false, kit = defaultKit()): number {
    if (!isMove(moveId) || !validState(state) || !nonnegative(now) ||
        (state.lastActionAt !== null && now < state.lastActionAt)) invalid();
    const last = state.cooldowns[moveId];
    if (last === undefined) return ZERO;
    const cooldown = moveFor(moveId, kit).cooldownSeconds * (isLit ? litCooldownMultiplier : ONE);
    return Math.max(ZERO, cooldown - (now - last));
  }
  function recordAction(state: ActionState, moveId: MoveId, now: number, damage?: number, startedAt = now): ActionState {
    const damageHistory = state.damageHistory.filter(hit => now - hit.at < rules.damageWindowSeconds);
    if (damage !== undefined) damageHistory.push({ at: now, damage });
    return { lastActionAt: now, cooldowns: { ...state.cooldowns, [moveId]: startedAt }, damageHistory };
  }
  /**
   * Accept a move start and consume its cooldown from the start moment.
   * A chained bending move (paid for from the meter) skips its cooldown.
   */
  function startMove(state: ActionState, moveId: MoveId, now: number, isLit = false, kit = defaultKit(), chained = false): MoveStartResult {
    if (!validState(state) || !nonnegative(now)) return { accepted: false, reason: 'invalid_input' };
    if (!isMove(moveId)) return { accepted: false, reason: 'unknown_move' };
    if (!kitAllows(moveId, kit)) return { accepted: false, reason: 'wrong_element' };
    if (state.lastActionAt !== null && now < state.lastActionAt) return { accepted: false, reason: 'clock_reversed' };
    const skip = chained && isBendMove(moveId);
    if (!skip && cooldownRemaining(moveId, state, now, isLit, kit) > ZERO) return { accepted: false, reason: 'cooldown' };
    return { accepted: true, state: recordAction(state, moveId, now, undefined, now) };
  }
  /** Commit target and state together, serially, in the server's attacker/target records. */
  function checkHit({ attacker, target, moveId, now, state, swingAt: named, isLit = false, bendScale: scale = ONE, chained = false, situation }: HitInput): HitResult {
    const swingAt = named ?? now;
    if (!validCombatant(attacker) || !validCombatant(target) || !nonnegative(now) || !validState(state) ||
        !nonnegative(swingAt) || swingAt > now || !positive(scale)) return { accepted: false, reason: 'invalid_input' };
    if (!isMove(moveId)) return { accepted: false, reason: 'unknown_move' };
    const kit = kitOf(attacker);
    if (!kitAllows(moveId, kit)) return { accepted: false, reason: 'wrong_element' };
    const move = moveFor(moveId, kit);
    if (move.kind !== 'attack') return { accepted: false, reason: 'not_attack' };
    if (isDead(attacker.health)) return { accepted: false, reason: 'attacker_dead' };
    if (isDead(target.health)) return { accepted: false, reason: 'target_dead' };
    if (state.lastActionAt !== null && now < state.lastActionAt) return { accepted: false, reason: 'clock_reversed' };
    const distance = Math.hypot(attacker.position.x - target.position.x, attacker.position.y - target.position.y, attacker.position.z - target.position.z);
    if (distance > move.reach) return { accepted: false, reason: 'out_of_reach' };
    const lastUse = state.cooldowns[moveId];
    const sameSwing = named !== undefined && lastUse === named;
    const cooldownDuration = move.cooldownSeconds * (isLit ? litCooldownMultiplier : ONE);
    if (!sameSwing && !(chained && isBendMove(moveId)) && lastUse !== undefined && swingAt - lastUse < cooldownDuration) return { accepted: false, reason: 'cooldown' };
    const situationMult = calculateSituationalMultiplier(attacker.element, target.element, situation);
    const grossDamage = move.damage * (isLit ? litDamageMultiplier : ONE) * (isBendMove(moveId) ? scale : ONE) * situationMult;
    const spent = state.damageHistory.reduce((sum, hit) => now - hit.at < rules.damageWindowSeconds ? sum + hit.damage : sum, ZERO);
    if (!nonnegative(grossDamage) || !nonnegative(spent)) return { accepted: false, reason: 'invalid_input' };
    if (spent + grossDamage > rules.maxDamagePerSecond * rules.damageWindowSeconds) return { accepted: false, reason: 'damage_cap' };
    const health = applyDamage(target.health, calculateDamage(grossDamage, target.armour));
    return { accepted: true, damage: target.health.current - health.current,
      target: { ...target, health }, state: recordAction(state, moveId, now, grossDamage, swingAt) };
  }
  /** Dodge only consumes its cooldown here; invulnerability belongs to the fight simulation. */
  function useDodge(state: ActionState, now: number): { accepted: true; state: ActionState } | { accepted: false; reason: RejectionReason } {
    return startMove(state, 'dodge', now, false);
  }
  function calculateBurnDamage(duration: number, armour = rules.defaultArmour): number {
    if (!nonnegative(duration) || !nonnegative(armour)) invalid();
    return calculateDamage(burnConfig.damagePerSecond * duration, armour);
  }
  function applyBurnTick(targetHealth: Health, duration: number, armour = rules.defaultArmour): { health: Health; damage: number } {
    if (!validHealth(targetHealth) || !nonnegative(duration)) invalid();
    const dmg = calculateBurnDamage(duration, armour);
    const health = applyDamage(targetHealth, dmg);
    return { health, damage: targetHealth.current - health.current };
  }

  function calculateSituationalMultiplier(
    attackerElement: Element,
    targetElement: Element,
    situation?: CombatSituation
  ): number {
    if (!situationalCounters || !situationalCounters.enabled || !situation) return ONE;
    const rule = situationalCounters.situations[attackerElement];
    if (!rule || rule.advantageOver !== targetElement) return ONE;

    let hasEdge = false;
    if (situation.terrain && rule.terrains && rule.terrains.includes(situation.terrain)) {
      hasEdge = true;
    }
    if (situation.weather && rule.weathers && rule.weathers.includes(situation.weather)) {
      hasEdge = true;
    }
    const moveMod = situation.moveModifier ?? ONE;
    return (hasEdge ? situationalCounters.edgeMultiplier : ONE) * moveMod;
  }

  /** Tier gates: moves exist from the start, the tier decides what may be used. */
  function tierAllows(moveId: MoveId | 'chain', tier: number): boolean {
    return tier >= (tiers.required[moveId] ?? ONE);
  }
  /** Bending damage from tiers 6 and 7 up. */
  function tierBendScale(tier: number): number {
    let scale = ONE;
    for (const [from, value] of Object.entries(tiers.bendScale)) if (tier >= Number(from)) scale = Math.max(scale, value);
    return scale;
  }

  /** Meter after an event, clamped to its range. */
  function meterGain(value: number, event: 'hit' | 'parry' | 'blocked'): number {
    const gain = event === 'hit' ? meter.gainHit : event === 'parry' ? meter.gainParry : meter.gainBlocked;
    return Math.min(meter.max, value + gain);
  }
  /** Meter after draining for `seconds` once `idle` has passed the drain delay. */
  function meterDrain(value: number, idle: number, seconds: number): number {
    if (idle < meter.drainDelay) return value;
    return Math.max(ZERO, value - meter.drainPerSecond * seconds);
  }
  /**
   * What a bending move does to the meter. Bending never needs the bar: below the
   * weak line, or without enough to pay a heavy move, it fires at the weaker strength.
   */
  function spendBend(value: number, moveId: BendMoveId): { meter: number; strength: number } {
    const cost = meter.costs[moveId] ?? ZERO;
    const weak = value < meter.weakBelow || value < cost;
    return { meter: weak ? Math.max(ZERO, value - cost) : value - cost, strength: weak ? meter.weakScale : ONE };
  }
  /** A bending move chained straight from another; null when the meter or tier can't pay for it. */
  function chainBend(value: number, link: number, tier: number): { meter: number; damageScale: number } | null {
    if (!tierAllows('chain', tier) || value < meter.chainCost) return null;
    return { meter: value - meter.chainCost, damageScale: (ONE + meter.chainBonus) ** link };
  }

  function parryWindow(hush = false): number { return hush ? parry.hushWindow : parry.window; }
  function parryStagger(hush = false): number { return hush ? parry.hushStagger : parry.stagger; }

  function canBendWithWeapon(kit: Kit): boolean {
    if (!bendWithWeapon) return true;
    const allowed = bendWithWeapon[kit.element];
    if (allowed === 'any') return true;
    if (Array.isArray(allowed)) return allowed.includes(kit.weapon);
    return false;
  }

  return {
    canBendWithWeapon,
    bendWithWeapon: canBendWithWeapon,
    calculateDamage,
    calculateBurnDamage,
    applyBurnTick,
    burn: burnConfig,
    createHealth,
    applyDamage,
    heal,
    isDead,
    createActionState,
    cooldownRemaining,
    startMove,
    useMove: startMove,
    useDodge,
    checkHit,
    moveFor,
    kitAllows,
    defaultKit,
    tierAllows,
    tierBendScale,
    tierNames: tiers.names,
    meter,
    meterGain,
    meterDrain,
    spendBend,
    chainBend,
    parryWindow,
    parryStagger,
    litDamageMultiplier,
    litCooldownMultiplier,
    calculateSituationalMultiplier,
    situationalCounters,
  };
}
