/**
 * The hero's bending between moves: the combo meter, chains of bending moves,
 * the AQUES waterskin and the shards a Hush carries for Shard Sparks.
 */

import { Vector3 } from 'three';
import balance from '../../shared/balance.json';
import { createCombatRules, type BendMoveId, type CombatBalance, type Kit } from '../../shared/src/index.js';

const rules = createCombatRules(balance.combat as unknown as CombatBalance);
const skin = balance.combat.waterskin;
/** Seconds after a bending move during which the next one counts as a chain link. */
const CHAIN_WINDOW = 1.1;

export type BendRefusal = 'no_water' | 'cooldown' | 'tier' | 'hush' | 'no_shards';
export type BendStart =
  | { readonly go: true; readonly chained: boolean; readonly strength: number; readonly link: number; readonly fromSkin: boolean; readonly free?: boolean }
  | { readonly go: false; readonly why: BendRefusal };

export class BendState {
  meter = 0;
  /** Seconds since the hero last landed a hit, parried or blocked. */
  private idle = 99;
  private sinceBend = 99;
  private link = 0;
  waterskin = skin.charges;
  shards: number;
  private refill = 0;
  /** Moves with charges (AURA's Wind Step): uses left, and seconds until the next comes back. */
  charges = 0;
  private recharge = 0;

  constructor(public kit: Kit, public tier = 5, private readonly sources: () => readonly Vector3[] = () => []) {
    this.shards = kit.hush ? balance.combat.shardSpark.testShards : 0;
    this.charges = this.maxCharges;
  }

  private get maxCharges(): number { return this.kit.hush ? 0 : rules.moveFor('dash_strike', this.kit).charges ?? 0; }

  get max(): number { return rules.meter.max; }
  /** Below this, bending is weaker and chains are closed. */
  get weakBelow(): number { return rules.meter.weakBelow; }

  /** Whether a water source is within reach of this spot. */
  nearWater(at: Vector3): boolean {
    return this.sources().some(s => Math.hypot(s.x - at.x, s.z - at.z) <= skin.sourceRadius);
  }

  /** Per frame: the meter drains when idle, and standing at water refills the waterskin. */
  tick(delta: number, at: Vector3): void {
    this.idle += delta;
    this.sinceBend += delta;
    this.meter = rules.meterDrain(this.meter, this.idle, delta);
    if (this.charges < this.maxCharges && (this.recharge -= delta) <= 0) {
      this.charges += 1;
      this.recharge = rules.moveFor('dash_strike', this.kit).cooldownSeconds;
    }
    if (this.kit.element === 'AQUES' && this.waterskin < skin.charges && this.nearWater(at)) {
      this.refill += delta;
      if (this.refill >= skin.refillSeconds) { this.refill = 0; this.waterskin = skin.charges; }
    } else {
      this.refill = 0;
    }
  }

  gain(event: 'hit' | 'parry' | 'blocked'): void {
    this.meter = rules.meterGain(this.meter, event);
    this.idle = 0;
  }

  /**
   * Asked when a bending move is pressed. `ready` says whether its cooldown is over.
   * Inside the chain window a move can skip its cooldown by paying for a link from the meter.
   */
  begin(move: BendMoveId, ready: boolean, at: Vector3): BendStart {
    if (this.kit.hush) return { go: false, why: 'hush' };
    if (!rules.tierAllows(move, this.tier)) return { go: false, why: 'tier' };
    let fromSkin = false;
    if (this.kit.element === 'AQUES' && move !== 'dash_strike' && !this.nearWater(at)) {
      if (this.waterskin <= 0) return { go: false, why: 'no_water' };
      fromSkin = true;
    }
    const tierScale = rules.tierBendScale(this.tier);
    if (move === 'dash_strike' && this.maxCharges > 0) {
      if (this.charges <= 0) return { go: false, why: 'cooldown' };
      if (this.charges === this.maxCharges) this.recharge = rules.moveFor('dash_strike', this.kit).cooldownSeconds;
      this.charges -= 1;
      this.sinceBend = 0;
      return { go: true, chained: false, strength: tierScale, link: this.link, fromSkin: false, free: true };
    }
    const chaining = this.sinceBend <= CHAIN_WINDOW && move !== 'ultimate';
    if (chaining) {
      const chain = rules.chainBend(this.meter, this.link + 1, this.tier);
      if (chain) {
        this.meter = chain.meter;
        this.link += 1;
        return this.started(true, chain.damageScale * tierScale, fromSkin);
      }
    }
    if (!ready) return { go: false, why: 'cooldown' };
    this.link = 0;
    const spent = rules.spendBend(this.meter, move);
    this.meter = spent.meter;
    return this.started(false, spent.strength * tierScale, fromSkin);
  }

  /** A Hush throwing a spark spends one shard. */
  spark(ready: boolean): BendStart {
    if (!this.kit.hush) return { go: false, why: 'hush' };
    if (this.shards <= 0) return { go: false, why: 'no_shards' };
    if (!ready) return { go: false, why: 'cooldown' };
    this.shards -= 1;
    return { go: true, chained: false, strength: 1, link: 0, fromSkin: false };
  }

  private started(chained: boolean, strength: number, fromSkin: boolean): BendStart {
    if (fromSkin) this.waterskin -= 1;
    this.sinceBend = 0;
    return { go: true, chained, strength, link: this.link, fromSkin };
  }

  /** A new element or role: the Hush get their test shards, everyone a full waterskin. */
  setKit(kit: Kit): void {
    this.kit = kit;
    this.reset();
  }

  reset(): void {
    this.meter = 0;
    this.link = 0;
    this.sinceBend = 99;
    this.waterskin = skin.charges;
    this.shards = this.kit.hush ? balance.combat.shardSpark.testShards : 0;
    this.charges = this.maxCharges;
    this.recharge = 0;
  }
}
