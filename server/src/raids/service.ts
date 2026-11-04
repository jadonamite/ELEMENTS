import type { DatabaseSync } from 'node:sqlite';
import { randomInt, randomUUID } from 'node:crypto';
import {
  abandonRun, abandonedFighters, accept as acceptInvite, applyHallActions, applyRaidLoss, bagAdd, bagValue, clearRoom, createParty,
  currentRoom, decideFlee, decideJob, fighterDamage, fighterDied, fighterFled, fighterFromTemplate, fighterHealth, fighterWage,
  invite as inviteMember, isBarred, judgeComplaint, keyPrice, kick as kickMember, leave as leaveParty, memberDown, memberUp,
  planRun, recruit, salvageQuote, seededRng, setLootRule as setRule, setNeeds as setPartyNeeds, settleFighter, splitLoot, startRun,
  upheldAgainst, validateSalvageAction, TREASURY_ACCOUNT_ID,
  type Bag, type Complaint, type ComplaintKind, type Fighter, type FightSituation, type GearPiece, type HallObservation,
  type HallState, type LedgerReason, type LootRule, type Party, type RaidRun, type RunFacts, type SalvageState,
} from '@elements/shared';
import { getAccountBalance, recordTransaction } from '../economy/ledgerService.js';
import { HALL_ID, RAIDS } from './config.js';
import { RuleHallDecider, RuleSalvageDecider, type HallDecider, type SalvageDecider } from './deciders.js';
import { RaidStore } from './store.js';

export type RaidLedgerReason = 'raid_key_purchase' | 'raid_wage_escrow' | 'raid_wage_paid' | 'raid_wage_refund' | 'raid_loss'
  | 'raid_salvage_sale' | 'raid_salvage_onward' | 'raid_hall_founding' | 'raid_fighter_estate' | 'raid_recruit_purse' | 'raid_key_crafting';

export interface Pack { accountId: string; items: Bag; keys: Bag; gear: GearPiece[] }
export interface PartyRec extends Party { hired: string[]; lastOrder: string[] | null; runs: number }
export interface Presence { x: number; z: number; hp: number; maxHp: number; at: number }
export interface RunRec extends RaidRun {
  fleeChecks: Record<string, number>;
  presence: Record<string, Presence>;
  fighterHp: Record<string, number>;
  settled: boolean;
  summary: RunSummary | null;
}
export interface RunSummary {
  outcome: 'won' | 'lost' | 'abandoned';
  shares: Record<string, Bag>;
  losses: Record<string, { chroma: number; items: Bag }>;
  fighters: Array<{ id: string; name: string; outcome: string; paid: number; refunded: number; trained: boolean; replacedBy?: string }>;
  complaints: string[];
}

export class RaidError extends Error {}
const must = <T>(r: { ok: true; value: T } | { ok: false; reason: string }): T => { if (!r.ok) throw new RaidError(r.reason); return r.value; };

export interface RaidServiceOptions {
  now?: () => number;
  rand?: () => number;
  hallDecider?: HallDecider;
  salvageDecider?: SalvageDecider;
}

/** The Raid Hall branch in Sindr, its hired fighters, the salvage buyer, parties and private raid instances. */
export class RaidService {
  readonly store: RaidStore;
  private readonly now: () => number;
  private readonly rand: () => number;
  private readonly hallDecider: HallDecider;
  private readonly salvageDecider: SalvageDecider;

  constructor(readonly db: DatabaseSync, opts: RaidServiceOptions = {}) {
    this.store = new RaidStore(db);
    this.now = opts.now ?? Date.now;
    this.rand = opts.rand ?? (() => randomInt(0, 1_000_000) / 1_000_000);
    this.hallDecider = opts.hallDecider ?? new RuleHallDecider();
    this.salvageDecider = opts.salvageDecider ?? new RuleSalvageDecider();
    this.ensureWorld();
  }

  private move(from: string, to: string, amount: number, reason: RaidLedgerReason, refId: string): void {
    if (amount <= 0) return;
    recordTransaction({ from, to, amount: Math.round(amount), reason: reason as unknown as LedgerReason, refId, timestamp: this.now() }, this.db);
  }

  balance(id: string): number { return getAccountBalance(id, this.db); }

  // ---------- the world's agents ----------

  private ensureWorld(): void {
    const t = this.now();
    if (!this.store.get('hall', HALL_ID)) {
      const hall: HallState = {
        id: HALL_ID, nation: 'IGNIS', purse: RAIDS.hall.startingPurse,
        keyStock: Object.fromEntries(Object.entries(RAIDS.keys).map(([id, k]) => [id, k.startStock])),
        sales: [], complaints: [], barred: {}, jobs: [], memory: {},
      };
      this.move(TREASURY_ACCOUNT_ID, HALL_ID, hall.purse, 'raid_hall_founding', HALL_ID);
      this.store.put('hall', HALL_ID, hall, t);
    }
    for (const tpl of RAIDS.fighters.roster) {
      if (this.store.get('fighter', tpl.id)) continue;
      this.move(TREASURY_ACCOUNT_ID, tpl.id, tpl.purse, 'raid_recruit_purse', tpl.id);
      this.store.put('fighter', tpl.id, fighterFromTemplate(tpl), t);
    }
    const sv = RAIDS.salvage;
    if (!this.store.get('salvage', sv.id)) {
      this.move(TREASURY_ACCOUNT_ID, sv.id, sv.startingPurse, 'raid_hall_founding', sv.id);
      this.store.put('salvage', sv.id, { id: sv.id, purse: sv.startingPurse, holdings: {}, discount: sv.baseDiscount } satisfies SalvageState, t);
    }
  }

  hall(): HallState { return this.store.get<HallState>('hall', HALL_ID)!; }
  private saveHall(h: HallState): void { this.store.put('hall', HALL_ID, h, this.now()); }
  fighter(id: string): Fighter | null { return this.store.get<Fighter>('fighter', id); }
  fighters(): Fighter[] { return this.store.all<Fighter>('fighter'); }
  private saveFighter(f: Fighter): void { this.store.put('fighter', f.id, f, this.now()); }
  salvage(): SalvageState { return this.store.get<SalvageState>('salvage', RAIDS.salvage.id)!; }

  pack(accountId: string): Pack {
    return this.store.get<Pack>('pack', accountId) ?? { accountId, items: {}, keys: {}, gear: [] };
  }
  private savePack(p: Pack): void { this.store.put('pack', p.accountId, p, this.now()); }

  // ---------- parties ----------

  partyOf(accountId: string): PartyRec | null {
    return this.store.all<PartyRec>('party').find((p) => !p.disbanded && p.members.includes(accountId)) ?? null;
  }
  party(id: string): PartyRec | null { return this.store.get<PartyRec>('party', id); }
  private saveParty(p: PartyRec): PartyRec { return this.store.put('party', p.id, p, this.now()); }

  createParty(leader: string): PartyRec {
    const existing = this.partyOf(leader);
    if (existing) return existing;
    return this.saveParty({ ...createParty(`party_${randomUUID().slice(0, 8)}`, leader), hired: [], lastOrder: null, runs: 0 });
  }

  invite(by: string, target: string): PartyRec {
    if (by === target) throw new RaidError('You are already with yourself');
    if (this.partyOf(target)) throw new RaidError('They are already in a party');
    const p = this.partyOf(by) ?? this.createParty(by);
    if (p.members.length + p.hired.length >= RAIDS.party.maxSize) throw new RaidError('No room: hired fighters count toward the five');
    return this.saveParty({ ...p, ...must(inviteMember(p, by, target, this.now(), RAIDS.party)) });
  }

  invitesFor(accountId: string): PartyRec[] {
    const t = this.now();
    return this.store.all<PartyRec>('party').filter((p) => !p.disbanded && p.invites.some((i) => i.accountId === accountId && i.expiresAt > t));
  }

  acceptInvite(accountId: string, partyId: string): PartyRec {
    if (this.partyOf(accountId)) throw new RaidError('Leave your party first');
    const p = this.party(partyId);
    if (!p) throw new RaidError('No such party');
    if (p.members.length + p.hired.length >= RAIDS.party.maxSize) throw new RaidError('The party is full');
    return this.saveParty({ ...p, ...must(acceptInvite(p, accountId, this.now(), RAIDS.party)) });
  }

  leave(accountId: string): PartyRec | null {
    const p = this.partyOf(accountId);
    if (!p) return null;
    if (p.inRaid) throw new RaidError('Finish or abandon the raid first');
    const next = { ...p, ...must(leaveParty(p, accountId)) };
    if (next.disbanded) for (const id of p.hired) this.releaseFighter(p, id);
    return this.saveParty(next.disbanded ? { ...next, hired: [] } : next);
  }

  kick(by: string, member: string): PartyRec {
    const p = this.partyOf(by);
    if (!p) throw new RaidError('Not in a party');
    return this.saveParty({ ...p, ...must(kickMember(p, by, member)) });
  }

  setLootRule(by: string, rule: LootRule): PartyRec {
    const p = this.partyOf(by) ?? this.createParty(by);
    return this.saveParty({ ...p, ...must(setRule(p, by, rule, RAIDS.party)) });
  }

  setNeeds(by: string, kinds: string[]): PartyRec {
    const p = this.partyOf(by);
    if (!p) throw new RaidError('Not in a party');
    return this.saveParty({ ...p, ...must(setPartyNeeds(p, by, kinds.filter((k) => RAIDS.itemKinds[k]))) });
  }

  // ---------- the Hall's counter ----------

  keyQuote(keyId: string, buyer?: string): number {
    const key = RAIDS.keys[keyId];
    if (!key) throw new RaidError('No such key');
    return keyPrice(this.hall(), keyId, key, RAIDS.hall, this.now(), buyer);
  }

  buyKey(accountId: string, keyId: string): { price: number; pack: Pack } {
    const hall = this.hall();
    const key = RAIDS.keys[keyId];
    if (!key) throw new RaidError('No such key');
    if (isBarred(hall, accountId, this.now())) throw new RaidError('The Hall has barred you. Come back when the bar lifts.');
    if ((hall.keyStock[keyId] ?? 0) <= 0) throw new RaidError('No keys on the shelf. The crafters are working.');
    const price = this.keyQuote(keyId, accountId);
    if (this.balance(accountId) < price) throw new RaidError(`A key costs ${price} CHROMA`);
    this.move(accountId, HALL_ID, price, 'raid_key_purchase', keyId);
    this.saveHall({ ...hall, purse: hall.purse + price, keyStock: { ...hall.keyStock, [keyId]: hall.keyStock[keyId]! - 1 }, sales: [...hall.sales, { keyId, at: this.now() }].slice(-200) });
    const pack = this.pack(accountId);
    const next = { ...pack, keys: bagAdd(pack.keys, keyId, 1) };
    this.savePack(next);
    return { price, pack: next };
  }

  /** The roster as the counter shows it: wage, health and whether each fighter would take this party's job. */
  roster(accountId?: string): Array<Fighter & { wage: number; health: number; damage: number; answer?: { accept: boolean; reason: string } }> {
    const party = accountId ? this.partyOf(accountId) : null;
    const members = party?.members ?? (accountId ? [accountId] : []);
    const hall = this.hall();
    return this.fighters().filter((f) => f.status !== 'dead').map((f) => {
      const row = { ...f, wage: fighterWage(f, RAIDS.fighters), health: fighterHealth(f, RAIDS.fighters), damage: fighterDamage(f, RAIDS.fighters) };
      if (!accountId) return row;
      if (f.status === 'hired') return { ...row, answer: { accept: false, reason: f.hiredBy && party?.hired.includes(f.id) ? 'Hired by your party.' : `${f.name} is out on a job.` } };
      return { ...row, answer: this.jobAnswer(f, members, hall) };
    });
  }

  private jobAnswer(f: Fighter, members: string[], hall: HallState) {
    const danger = Object.values(RAIDS.dungeons)[0]?.danger ?? 1;
    const complaints = members.reduce((n, m) => n + upheldAgainst(hall, m, this.now(), RAIDS.hall), 0);
    if (isBarred(hall, f.id, this.now())) return { accept: false, reason: `The Hall won't hire out ${f.name} after what they did.` };
    return decideJob(f, { employerIds: members, danger, partyComplaints: complaints }, RAIDS.fighters);
  }

  hire(accountId: string, fighterId: string): { wage: number; party: PartyRec } {
    const party = this.partyOf(accountId) ?? this.createParty(accountId);
    if (party.leaderId !== accountId) throw new RaidError('The leader does the hiring');
    if (party.inRaid) throw new RaidError('Hire before you go down');
    if (party.members.length + party.hired.length >= RAIDS.party.maxSize) throw new RaidError('Five bodies at most, fighters included');
    const hall = this.hall();
    if (isBarred(hall, accountId, this.now())) throw new RaidError('The Hall has barred you');
    const f = this.fighter(fighterId);
    if (!f) throw new RaidError('No such fighter');
    const answer = this.jobAnswer(f, party.members, hall);
    if (!answer.accept) throw new RaidError(answer.reason);
    const wage = fighterWage(f, RAIDS.fighters);
    if (this.balance(accountId) < wage) throw new RaidError(`${f.name} asks ${wage} CHROMA for the run, paid into the Hall's keeping`);
    this.move(accountId, HALL_ID, wage, 'raid_wage_escrow', fighterId);
    this.saveHall({ ...hall, purse: hall.purse + wage });
    this.saveFighter({ ...f, status: 'hired', hiredBy: accountId });
    return { wage, party: this.saveParty({ ...party, hired: [...party.hired, fighterId] }) };
  }

  dismiss(accountId: string, fighterId: string): PartyRec {
    const party = this.partyOf(accountId);
    if (!party || party.leaderId !== accountId) throw new RaidError('The leader dismisses');
    if (party.inRaid) throw new RaidError('Not in the middle of a raid');
    if (!party.hired.includes(fighterId)) throw new RaidError('Not hired by you');
    this.releaseFighter(party, fighterId);
    return this.saveParty({ ...party, hired: party.hired.filter((h) => h !== fighterId) });
  }

  private releaseFighter(party: PartyRec, fighterId: string): void {
    const f = this.fighter(fighterId);
    if (!f || f.status !== 'hired') return;
    const wage = fighterWage(f, RAIDS.fighters);
    const hall = this.hall();
    this.move(HALL_ID, f.hiredBy ?? party.leaderId, wage, 'raid_wage_refund', fighterId);
    this.saveHall({ ...hall, purse: hall.purse - wage });
    this.saveFighter({ ...f, status: 'available', hiredBy: null });
  }

  // ---------- complaints and the Hall's mind ----------

  fileComplaint(by: string, kind: ComplaintKind, against: string, runId: string | null, note = ''): Complaint {
    if (!['fighter_fled', 'bad_split', 'cheated_buyer', 'left_to_die'].includes(kind)) throw new RaidError('Unknown complaint');
    const c: Complaint = { id: `c_${randomUUID().slice(0, 8)}`, kind, by, against, runId, note: note.slice(0, 200), at: this.now(), status: 'open' };
    const hall = this.hall();
    this.saveHall({ ...hall, complaints: [...hall.complaints, c] });
    return c;
  }

  private facts(runId: string | null): RunFacts | null {
    if (!runId) return null;
    const r = this.store.get<RunRec>('run', runId);
    if (!r) return null;
    const shareValues = r.summary ? Object.fromEntries(Object.entries(r.summary.shares).map(([m, b]) => [m, bagValue(b, RAIDS.itemKinds)])) : undefined;
    const party = this.party(r.partyId);
    return {
      runId, members: r.members, fighters: r.fighters.map((f) => f.id),
      fled: Object.entries(r.fighterStatus).filter(([, s]) => s === 'fled').map(([id]) => id),
      abandoned: abandonedFighters(r),
      ...(shareValues ? { shareValues } : {}),
      ...(party ? { lootRule: party.lootRule } : {}),
    };
  }

  /** One decision of the Hall broker: rules, model or not, all through the rule file. */
  async tickHall(): Promise<{ thought: string; applied: unknown[]; dropped: unknown[] }> {
    const hall = this.hall();
    const judgements = Object.fromEntries(hall.complaints.filter((c) => c.status === 'open').map((c) => [c.id, judgeComplaint(c, this.facts(c.runId))]));
    const obs: HallObservation = { hall, keys: RAIDS.keys, cfg: RAIDS.hall, now: this.now(), judgements };
    const decision = await this.hallDecider.decide(obs);
    const out = applyHallActions(obs, decision.actions, () => `job_${randomUUID().slice(0, 6)}`);
    // Keys are bought from the Dim crafters; until crafting exists their pay goes to the treasury.
    if (out.craftSpend > 0) this.move(HALL_ID, TREASURY_ACCOUNT_ID, out.craftSpend, 'raid_key_crafting', 'restock');
    this.saveHall(out.hall);
    this.store.think(HALL_ID, decision.reasoning, out.applied, out.dropped, this.now());
    return { thought: decision.reasoning, applied: out.applied, dropped: out.dropped };
  }

  async tickSalvage(): Promise<{ thought: string; applied: unknown[] }> {
    let s = this.salvage();
    const d = await this.salvageDecider.decide(s, RAIDS.itemKinds, RAIDS.salvage);
    const applied: unknown[] = [];
    for (const a of d.actions) {
      if (!validateSalvageAction(s, a, RAIDS.salvage).valid) continue;
      if (a.type === 'set_discount') s = { ...s, discount: a.discount };
      else {
        // Shipped onward to the merchants at base price less the merchants' margin.
        const pay = Math.floor((RAIDS.itemKinds[a.kind]?.basePrice ?? 0) * a.quantity * 0.8);
        this.move(TREASURY_ACCOUNT_ID, s.id, pay, 'raid_salvage_onward', a.kind);
        s = { ...s, purse: s.purse + pay, holdings: bagAdd(s.holdings, a.kind, -a.quantity) };
      }
      applied.push(a);
    }
    this.store.put('salvage', s.id, s, this.now());
    this.store.think(s.id, d.reasoning, applied, [], this.now());
    return { thought: d.reasoning, applied };
  }

  // ---------- the private instance ----------

  /** The leader turns a key: the party, its hired fighters and a new room order go down into a private copy of the ruin. */
  enter(accountId: string, dungeonId: string): RunRec {
    const party = this.partyOf(accountId) ?? this.createParty(accountId);
    if (party.leaderId !== accountId) throw new RaidError('The leader turns the key');
    if (party.inRaid) throw new RaidError('Your party is already inside');
    const dungeon = RAIDS.dungeons[dungeonId];
    if (!dungeon) throw new RaidError('No such dungeon');
    if (party.members.length < dungeon.minPlayers || party.members.length > dungeon.maxPlayers) throw new RaidError(`${dungeon.minPlayers} to ${dungeon.maxPlayers} players`);
    const keyId = Object.entries(RAIDS.keys).find(([, k]) => k.dungeon === dungeonId)?.[0];
    const pack = this.pack(accountId);
    if (!keyId || (pack.keys[keyId] ?? 0) <= 0) throw new RaidError('You need a key. Only the Dim craft them; the Hall sells them.');
    this.savePack({ ...pack, keys: bagAdd(pack.keys, keyId, -1) });
    const seed = randomInt(1, 2 ** 31);
    const plan = planRun(dungeon, seed, party.lastOrder ?? undefined);
    const fighters = party.hired.map((id) => {
      const f = this.fighter(id)!;
      return { id, wage: fighterWage(f, RAIDS.fighters), employer: f.hiredBy ?? accountId };
    });
    const base = startRun({ id: `run_${randomUUID().slice(0, 8)}`, dungeonId, partyId: party.id, members: party.members, fighters, seed: plan.seed, order: plan.order, now: this.now() });
    const run: RunRec = {
      ...base, fleeChecks: {}, presence: {}, settled: false, summary: null,
      fighterHp: Object.fromEntries(party.hired.map((id) => [id, fighterHealth(this.fighter(id)!, RAIDS.fighters)])),
    };
    this.store.put('run', run.id, run, this.now());
    this.saveParty({ ...party, inRaid: run.id, lastOrder: plan.order, runs: party.runs + 1 });
    return run;
  }

  run(runId: string): RunRec | null { return this.store.get<RunRec>('run', runId); }

  /** Only party members on the run may see or act in its instance: that is what makes it private. */
  private member(accountId: string, runId: string): RunRec {
    const r = this.run(runId);
    if (!r) throw new RaidError('No such run');
    if (!r.members.includes(accountId)) throw new RaidError('This ruin belongs to another party');
    return r;
  }

  view(accountId: string, runId: string): RunRec { return this.member(accountId, runId); }

  private saveRun(r: RunRec): RunRec {
    this.store.put('run', r.id, r, this.now());
    if (r.state !== 'active' && !r.settled) return this.settle(r);
    return r;
  }

  presence(accountId: string, runId: string, p: Omit<Presence, 'at'>): RunRec {
    const r = this.member(accountId, runId);
    return this.saveRun({ ...r, presence: { ...r.presence, [accountId]: { ...p, at: this.now() } } });
  }

  clear(accountId: string, runId: string, roomId: string, kills: Record<string, number> = {}, bossKiller?: string): RunRec {
    const found = this.member(accountId, runId);
    const isBoss = RAIDS.dungeons[found.dungeonId]?.rooms[roomId]?.kind === 'boss';
    const r = isBoss && bossKiller && (found.members.includes(bossKiller) || found.fighterStatus[bossKiller] === 'stayed') ? { ...found, bossKilledBy: bossKiller } : found;
    const dungeon = RAIDS.dungeons[r.dungeonId]!;
    return this.saveRun({ ...r, ...must(clearRoom(r, roomId, dungeon, this.now(), kills)) });
  }

  down(accountId: string, runId: string): RunRec {
    const r = this.member(accountId, runId);
    return this.saveRun({ ...r, ...must(memberDown(r, accountId, this.now())) });
  }

  up(accountId: string, runId: string): RunRec {
    const r = this.member(accountId, runId);
    return this.saveRun({ ...r, ...memberUp(r, accountId) });
  }

  abandon(accountId: string, runId: string): RunRec {
    const r = this.member(accountId, runId);
    return this.saveRun({ ...r, ...must(abandonRun(r, this.now())) });
  }

  fighterKilled(accountId: string, runId: string, fighterId: string): RunRec {
    const r = this.member(accountId, runId);
    const f = this.fighter(fighterId);
    return this.saveRun({ ...r, ...must(fighterDied(r, fighterId, f?.name ?? fighterId, this.now())), fighterHp: { ...r.fighterHp, [fighterId]: 0 } });
  }

  /**
   * The client reports how the fight stands for one hired fighter; the fighter's own mind decides on the server
   * whether to hold or run. At most one check per fighter every fleeCheckSeconds.
   */
  fighterCheck(accountId: string, runId: string, fighterId: string, s: Omit<FightSituation, 'loyalty'>, hp: number): { flee: boolean; morale: number; run: RunRec } {
    const r = this.member(accountId, runId);
    const f = this.fighter(fighterId);
    if (!f || r.fighterStatus[fighterId] !== 'stayed') return { flee: false, morale: 0, run: r };
    const last = r.fleeChecks[fighterId] ?? 0;
    const at = this.now();
    let next: RunRec = { ...r, fighterHp: { ...r.fighterHp, [fighterId]: Math.max(0, hp) } };
    if (at - last < RAIDS.fighters.fleeCheckSeconds * 1000) return { flee: false, morale: -1, run: this.saveRun(next) };
    const employer = r.fighters.find((x) => x.id === fighterId)?.employer ?? '';
    const situation: FightSituation = {
      health: clamp01(s.health), partyStanding: clamp01(s.partyStanding), fightersDown: Math.max(0, s.fightersDown | 0),
      playersDown: Math.max(0, s.playersDown | 0), bossRoom: !!s.bossRoom, foesHealth: clamp01(s.foesHealth),
      loyalty: f.memory[employer]?.score ?? 0,
    };
    const d = decideFlee(f, situation, RAIDS.fighters, this.rand());
    next = { ...next, fleeChecks: { ...next.fleeChecks, [fighterId]: at } };
    if (d.flee) next = { ...next, ...must(fighterFled(next, fighterId, f.name, at)) };
    return { flee: d.flee, morale: d.morale, run: this.saveRun(next) };
  }

  // ---------- after the run ----------

  private settle(r: RunRec): RunRec {
    const party = this.party(r.partyId);
    const kinds = RAIDS.itemKinds;
    const summary: RunSummary = { outcome: r.state as RunSummary['outcome'], shares: {}, losses: {}, fighters: [], complaints: [] };
    let hall = this.hall();

    if (r.state === 'won') {
      const live = r.members;
      summary.shares = splitLoot(r.loot, live, party?.lootRule ?? 'equal', kinds, { leaderId: party?.leaderId ?? live[0]!, needs: party?.needs ?? {} });
      for (const [m, bag] of Object.entries(summary.shares)) {
        const pack = this.pack(m);
        let items = pack.items;
        const gear = [...pack.gear];
        for (const [k, q] of Object.entries(bag)) {
          if (kinds[k]?.kind === 'gear') for (let i = 0; i < q; i++) gear.push({ id: `${k}_${randomUUID().slice(0, 6)}`, kind: k, wear: 0 });
          else items = bagAdd(items, k, q);
        }
        this.savePack({ ...pack, items, gear });
        hall = { ...hall, memory: { ...hall.memory, [m]: Math.min(100, (hall.memory[m] ?? 0) + 5) } };
      }
    }
    if (r.state === 'lost') {
      for (const m of r.members) {
        const pack = this.pack(m);
        const chroma = this.balance(m);
        const loss = applyRaidLoss({ chroma, items: pack.items, gear: pack.gear }, RAIDS.loss, seededRng(r.seed ^ chroma));
        this.move(m, TREASURY_ACCOUNT_ID, loss.lostChroma, 'raid_loss', r.id);
        this.savePack({ ...pack, items: loss.kept.items, gear: loss.kept.gear });
        summary.losses[m] = { chroma: loss.lostChroma, items: loss.lostItems };
      }
    }

    const left = abandonedFighters(r);
    const won = r.state === 'won';
    for (const hire of r.fighters) {
      const f = this.fighter(hire.id);
      if (!f) continue;
      const outcome = r.fighterStatus[hire.id] ?? 'stayed';
      const cut = Math.round(hire.wage * RAIDS.hall.hireCut);
      const abandoned = left.includes(hire.id);
      const s = settleFighter(f, r.members, { outcome, won, wage: hire.wage, hallCut: cut, abandoned, kills: r.kills[hire.id] ?? 0, bossKill: r.bossKilledBy === hire.id }, RAIDS.fighters);
      const row: RunSummary['fighters'][number] = { id: f.id, name: f.name, outcome, paid: 0, refunded: 0, trained: s.trained };
      if (outcome === 'stayed') {
        this.move(HALL_ID, f.id, s.paid, 'raid_wage_paid', r.id);
        hall = { ...hall, purse: hall.purse - s.paid };
        row.paid = s.paid;
        if (s.trained) this.move(f.id, TREASURY_ACCOUNT_ID, RAIDS.fighters.trainingCostPerSkill * f.skill + RAIDS.fighters.trainingCostPerSkill, 'raid_wage_paid', `${f.id}:training`);
      } else {
        // Ran or died: the wage held by the Hall goes back to whoever hired them.
        this.move(HALL_ID, hire.employer, hire.wage, 'raid_wage_refund', r.id);
        hall = { ...hall, purse: hall.purse - hire.wage };
        row.refunded = hire.wage;
      }
      if (outcome === 'fled') {
        const c: Complaint = { id: `c_${randomUUID().slice(0, 8)}`, kind: 'fighter_fled', by: 'hall', against: f.id, runId: r.id, note: `${f.name} ran from the ${RAIDS.dungeons[r.dungeonId]?.name}.`, at: this.now(), status: 'open' };
        hall = { ...hall, complaints: [...hall.complaints, c] };
        summary.complaints.push(c.note);
      }
      if (abandoned) {
        const c: Complaint = { id: `c_${randomUUID().slice(0, 8)}`, kind: 'left_to_die', by: 'hall', against: hire.employer, runId: r.id, note: `${f.name} was left standing in the dark.`, at: this.now(), status: 'open' };
        hall = { ...hall, complaints: [...hall.complaints, c] };
        summary.complaints.push(c.note);
      }
      if (outcome === 'died') {
        // A dead fighter's savings go to the treasury, and the Hall takes on a raw recruit in their place.
        this.move(f.id, TREASURY_ACCOUNT_ID, this.balance(f.id), 'raid_fighter_estate', f.id);
        const taken = new Set(this.fighters().map((x) => x.name));
        const id = `f_r${randomUUID().slice(0, 6)}`;
        const fresh = recruit(id, RAIDS.fighters, RAIDS.hall.recruitPurse, seededRng(r.seed + hire.id.length), taken);
        this.move(HALL_ID, id, RAIDS.hall.recruitPurse, 'raid_recruit_purse', id);
        hall = { ...hall, purse: hall.purse - RAIDS.hall.recruitPurse };
        this.saveFighter(fresh);
        row.replacedBy = fresh.name;
        this.saveFighter({ ...s.fighter, purse: 0 });
      } else {
        this.saveFighter({ ...s.fighter, skill: s.fighter.skill });
      }
      summary.fighters.push(row);
    }
    this.saveHall(hall);
    if (party) this.saveParty({ ...party, inRaid: null, hired: [] });
    const done: RunRec = { ...r, settled: true, summary };
    this.store.put('run', r.id, done, this.now());
    return done;
  }

  // ---------- the salvage buyer ----------

  salvageQuotes(accountId: string): Array<{ kind: string; name: string; have: number; unitPrice: number; accepts: number; reason?: string }> {
    const pack = this.pack(accountId);
    const s = this.salvage();
    const rows = Object.entries(pack.items).map(([kind, have]) => ({ kind, have }));
    const gearCounts = pack.gear.reduce<Bag>((b, g) => bagAdd(b, g.kind, 1), {});
    for (const [kind, have] of Object.entries(gearCounts)) rows.push({ kind, have });
    return rows.map(({ kind, have }) => {
      const q = salvageQuote(s, kind, have, RAIDS.itemKinds, RAIDS.salvage);
      return { kind, name: RAIDS.itemKinds[kind]?.name ?? kind, have, unitPrice: q.unitPrice, accepts: q.accepts, ...(q.reason ? { reason: q.reason } : {}) };
    });
  }

  sell(accountId: string, kind: string, qty: number): { paid: number; unitPrice: number } {
    if (!Number.isInteger(qty) || qty <= 0) throw new RaidError('Bad quantity');
    const pack = this.pack(accountId);
    const isGear = RAIDS.itemKinds[kind]?.kind === 'gear';
    const have = isGear ? pack.gear.filter((g) => g.kind === kind).length : pack.items[kind] ?? 0;
    if (have < qty) throw new RaidError('You do not carry that many');
    const s = this.salvage();
    const q = salvageQuote(s, kind, qty, RAIDS.itemKinds, RAIDS.salvage);
    if (q.accepts < qty) throw new RaidError(q.reason ?? `The buyer takes ${q.accepts} today`);
    // Worn gear sells for less.
    let paid = q.unitPrice * qty;
    let gear = pack.gear;
    if (isGear) {
      const sold = pack.gear.filter((g) => g.kind === kind).sort((a, b) => b.wear - a.wear).slice(0, qty);
      paid = sold.reduce((n, g) => n + Math.max(1, Math.floor(q.unitPrice * (1 - g.wear * 0.6))), 0);
      gear = pack.gear.filter((g) => !sold.includes(g));
    }
    this.move(s.id, accountId, paid, 'raid_salvage_sale', kind);
    this.store.put('salvage', s.id, { ...s, purse: s.purse - paid, holdings: bagAdd(s.holdings, kind, qty) }, this.now());
    this.savePack({ ...pack, items: isGear ? pack.items : bagAdd(pack.items, kind, -qty), gear });
    return { paid, unitPrice: q.unitPrice };
  }

  /** Everything a run's members see at once. */
  board(accountId: string): unknown {
    const party = this.partyOf(accountId);
    const hall = this.hall();
    return {
      you: accountId,
      chroma: this.balance(accountId),
      pack: this.pack(accountId),
      party: party ? { ...party, memberChroma: Object.fromEntries(party.members.map((m) => [m, this.balance(m)])) } : null,
      invites: this.invitesFor(accountId).map((p) => ({ partyId: p.id, leader: p.leaderId })),
      keys: Object.entries(RAIDS.keys).map(([id, k]) => ({ id, name: k.name, dungeon: k.dungeon, stock: hall.keyStock[id] ?? 0, price: this.keyQuote(id, accountId) })),
      roster: this.roster(accountId),
      hall: { purse: hall.purse, jobs: hall.jobs, complaints: hall.complaints.slice(-12), barred: hall.barred, feeling: hall.memory[accountId] ?? 0, mind: this.store.minds(HALL_ID, 3) },
      salvage: { name: RAIDS.salvage.name, purse: this.salvage().purse, discount: this.salvage().discount, quotes: this.salvageQuotes(accountId), mind: this.store.minds(RAIDS.salvage.id, 2) },
      barred: isBarred(hall, accountId, this.now()),
    };
  }
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

export { currentRoom };
