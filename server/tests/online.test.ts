import test from 'node:test';
import assert from 'node:assert/strict';
import { ZoneWorld, MAX_PLAYER_SPEED } from '../src/net/world.js';
import { onKill, type KillReport } from '../src/net/kill-hook.js';
import { REWIND_LIMIT } from '../src/net/hit-check.js';
import { SNAPSHOT_RATE } from '../src/net/constants.js';
import { identify } from '../src/rooms/ZoneRoom.js';
import { setTokenVerifier } from '../src/auth.js';
import { RemoteTrack, ServerClock, SNAPSHOT_HZ } from '../../shared/src/net/index.js';
import { balance } from '../src/net/balance.js';

const shaper = { accountId: 'acct_a', role: 'Shaper' as const, element: 'IGNIS' as const };
const other = { accountId: 'acct_b', role: 'Shaper' as const, element: 'AQUES' as const };

/** A world with the arena hound held still at (0, 8), and a player standing in reach facing it. */
function arena(now = 10) {
  const world = new ZoneWorld('arena', () => 0.5);
  const hound = world.enemies.get('hound_1')!;
  // Keep the hound idle and far from noticing: tests place it by hand.
  hound.history.push(now - 1, hound.x, hound.z, Math.PI);
  hound.history.push(now, hound.x, hound.z, Math.PI);
  hound.facing = Math.PI;
  const a = world.join('A', shaper, now);
  world.move('A', { t: now, x: 0, y: 0, z: 6, vx: 0, vz: 0, f: 0, a: 'idle', r: 1 }, now);
  return { world, hound, a };
}

const hit = (move: string, sw: number, t: number, extra: Record<string, unknown> = {}) =>
  ({ e: 'hound_1', m: move, sw, t, v: t, lit: false, ...extra });

test('Snapshot rate agrees between server and client', () => {
  assert.equal(SNAPSHOT_RATE, SNAPSHOT_HZ);
});

test('Hit: a fair sword swing in reach lands, and the damage comes from the rules, not the message', () => {
  const { world, hound } = arena();
  const events = world.hit('A', { ...hit('light_1', 1, 10), damage: 9999 }, 10.05);
  const result = events.find(e => e.type === 'hit_result')!;
  assert.equal(result.ok, true, JSON.stringify(result));
  const sword = balance.combat.weapons.sword.light_1.damage;
  // Struck from in front of the hound: no weak-spot bonus.
  assert.equal(hound.hp, hound.tune.maxHealth - sword);
  const shared = events.find(e => e.type === 'enemy_hit')!;
  assert.equal(shared.type === 'enemy_hit' && shared.hp, hound.hp);
});

test('Forged hit: out of reach is rejected and the hound is untouched', () => {
  const { world, hound } = arena();
  world.move('A', { t: 10.5, x: 0, y: 0, z: 0, vx: 0, vz: 0, f: 0, a: 'idle', r: 1 }, 10.5);
  const events = world.hit('A', hit('light_1', 1, 10.5), 10.55);
  const result = events[0]!;
  assert.equal(result.type === 'hit_result' && result.ok, false);
  assert.equal(result.type === 'hit_result' && result.reason, 'out_of_reach');
  assert.equal(hound.hp, hound.tune.maxHealth);
});

test('Forged hit: a second heavy swing inside its cooldown is rejected', () => {
  const { world, hound } = arena();
  const first = world.hit('A', hit('heavy_1', 1, 10), 10.02)[0]!;
  assert.equal(first.type === 'hit_result' && first.ok, true);
  const afterFirst = hound.hp;
  // heavy_1 cools for 1.2 s; a new swing 0.3 s later is too soon.
  const second = world.hit('A', hit('heavy_1', 2, 10.3), 10.32)[0]!;
  assert.equal(second.type === 'hit_result' && second.reason, 'cooldown');
  assert.equal(hound.hp, afterFirst);
  // Once it has cooled, the next swing lands.
  const third = world.hit('A', hit('heavy_1', 3, 11.3), 11.32)[0]!;
  assert.equal(third.type === 'hit_result' && third.ok, true);
});

test('Forged hit: claiming an old swing time to dodge the cooldown does not work', () => {
  const { world } = arena();
  world.hit('A', hit('heavy_1', 1, 10), 10.02);
  // Swing 2 claims it started before swing 1: the gap is negative, so still inside the cooldown.
  const back = world.hit('A', hit('heavy_1', 2, 9.5, { v: 10.3 }), 10.32)[0]!;
  assert.equal(back.type === 'hit_result' && back.ok, false);
});

test('Forged hit: the same swing cannot strike the same hound twice', () => {
  const { world } = arena();
  world.hit('A', hit('light_1', 1, 10), 10.02);
  const again = world.hit('A', hit('light_1', 1, 10), 10.04)[0]!;
  assert.equal(again.type === 'hit_result' && again.reason, 'repeat');
});

test('Forged hit: facing away from the hound is out of line', () => {
  const { world } = arena();
  world.move('A', { t: 10.1, x: 0, y: 0, z: 6, vx: 0, vz: 0, f: Math.PI, a: 'idle', r: 1 }, 10.1);
  const r = world.hit('A', hit('light_1', 1, 10.1), 10.12)[0]!;
  assert.equal(r.type === 'hit_result' && r.reason, 'out_of_line');
});

test('Forged hit: a view time older than the rewind limit, or in the future, is stale', () => {
  const { world } = arena(20);
  const old = world.hit('A', hit('light_1', 1, 20 - REWIND_LIMIT - 0.2), 20)[0]!;
  assert.equal(old.type === 'hit_result' && old.reason, 'stale');
  const future = world.hit('A', hit('light_1', 2, 21), 20)[0]!;
  assert.equal(future.type === 'hit_result' && future.reason, 'stale');
});

test('Forged hit: a Hush cannot bend, an unknown move and a malformed message are refused', () => {
  const world = new ZoneWorld('arena', () => 0.5);
  const hound = world.enemies.get('hound_1')!;
  hound.history.push(10, 0, 8, Math.PI);
  world.join('H', { accountId: 'hush', role: 'Hush', element: 'TERRA' }, 10);
  world.move('H', { t: 10, x: 0, y: 0, z: 6, vx: 0, vz: 0, f: 0, a: 'idle', r: 1 }, 10);
  const bend = world.hit('H', { e: 'hound_1', m: 'bend_palm', sw: 1, t: 10, v: 10, lit: true }, 10.02)[0]!;
  assert.equal(bend.type === 'hit_result' && bend.reason, 'wrong_element');
  const unknown = world.hit('H', { e: 'hound_1', m: 'instant_kill', sw: 2, t: 10, v: 10 }, 10.02)[0]!;
  assert.equal(unknown.type === 'hit_result' && unknown.reason, 'unknown_move');
  const junk = world.hit('H', { e: 5, m: null }, 10.02)[0]!;
  assert.equal(junk.type === 'hit_result' && junk.reason, 'invalid_input');
  assert.equal(hound.hp, hound.tune.maxHealth);
});

test('Hit: the server judges against where the hound was when the attacker saw it', () => {
  const { world, hound } = arena(10);
  // The hound has since run 6 m away; the attacker saw it at 10.0, when it was in reach.
  hound.x = 0; hound.z = 14;
  hound.history.push(10.2, 0, 14, Math.PI);
  const r = world.hit('A', hit('light_1', 1, 10), 10.2)[0]!;
  assert.equal(r.type === 'hit_result' && r.ok, true, JSON.stringify(r));
});

test('Two players hit the same hound: one health, seen by both, and the kill goes to the hook once', () => {
  const kills: KillReport[] = [];
  const stop = onKill(k => kills.push(k));
  const { world, hound } = arena(10);
  world.join('B', other, 10);
  world.move('B', { t: 10, x: 1, y: 0, z: 6.5, vx: 0, vz: 0, f: 0, a: 'idle', r: 1 }, 10);
  let t = 10;
  let sw = 0;
  const hp: number[] = [];
  while (hound.alive && t < 40) {
    for (const who of ['A', 'B']) {
      sw++;
      const ev = world.hit(who, hit('heavy_1', sw, t), t + 0.02);
      for (const e of ev) if (e.type === 'enemy_hit') hp.push(e.hp);
    }
    t += 1.3;
    hound.history.push(t, hound.x, hound.z, hound.facing);
    world.move('A', { t, x: 0, y: 0, z: 6, vx: 0, vz: 0, f: 0, a: 'idle', r: 1 }, t);
    world.move('B', { t, x: 1, y: 0, z: 6.5, vx: 0, vz: 0, f: 0, a: 'idle', r: 1 }, t);
  }
  stop();
  assert.equal(hound.alive, false);
  // Every reported health is lower than the one before: one pool, never two.
  for (let i = 1; i < hp.length; i++) assert.ok(hp[i]! < hp[i - 1]!);
  assert.equal(hp[hp.length - 1], 0);
  assert.equal(kills.length, 1);
  const k = kills[0]!;
  assert.equal(k.kind, 'hound');
  assert.equal(k.zone, 'arena');
  assert.ok(k.damageBy.acct_a! > 0 && k.damageBy.acct_b! > 0);
  assert.equal(k.damageBy.acct_a! + k.damageBy.acct_b!, hound.tune.maxHealth);
  // A dead hound takes no more hits.
  const late = world.hit('A', hit('light_1', ++sw, t), t + 0.02)[0]!;
  assert.equal(late.type === 'hit_result' && late.reason, 'target_dead');
});

test('Movement: a report farther than a body can run is refused and counted', () => {
  const world = new ZoneWorld('arena', () => 0.5);
  const p = world.join('A', shaper, 0);
  assert.equal(world.move('A', { t: 0, x: 0, y: 0, z: 0, vx: 0, vz: 0, f: 0, a: 'idle', r: 1 }, 0), true);
  assert.equal(world.move('A', { t: 0.05, x: 0.3, y: 0, z: 0, vx: 6, vz: 0, f: 0, a: 'run', r: 1 }, 0.05), true);
  assert.equal(world.move('A', { t: 0.1, x: 40, y: 0, z: 0, vx: 0, vz: 0, f: 0, a: 'run', r: 1 }, 0.1), false);
  assert.equal(p.x, 0.3);
  assert.equal(p.refusedMoves, 1);
  assert.equal(world.move('A', { t: 0.15, x: Number.NaN, y: 0, z: 0, vx: 0, vz: 0, f: 0, a: 'run', r: 1 }, 0.15), false);
  // A reported velocity faster than a body is capped.
  world.move('A', { t: 0.2, x: 0.6, y: 0, z: 0, vx: 500, vz: 0, f: 0, a: 'run', r: 1 }, 0.2);
  assert.ok(Math.hypot(p.vx, p.vz) <= MAX_PLAYER_SPEED + 1e-9);
});

test('Enemies: the hound notices, closes in and bites a player standing near it', () => {
  const world = new ZoneWorld('arena', () => 0.5);
  world.join('A', shaper, 0);
  world.move('A', { t: 0, x: 0, y: 0, z: 2, vx: 0, vz: 0, f: 0, a: 'idle', r: 1 }, 0);
  let hurt = 0;
  for (let t = 0; t < 20; t += 0.05) {
    for (const e of world.step(0.05, t)) if (e.type === 'hurt') hurt += e.d;
  }
  assert.ok(hurt >= balance.monsters.emberHound.biteDamage, `bitten for ${hurt}`);
  assert.ok(world.players.get('A')!.hp < world.players.get('A')!.maxHp);
});

test('Enemies: a raised guard facing the hound takes the guard share of a bite', () => {
  const world = new ZoneWorld('arena', () => 0.5);
  const p = world.join('A', shaper, 0);
  world.move('A', { t: 0, x: 0, y: 0, z: 2, vx: 0, vz: 0, f: 0, a: 'block', r: 1, g: true }, 0);
  const taken = p.takeStrike({ enemy: 'hound_1', target: 'A', damage: 18, fromX: 0, fromZ: 3 });
  assert.equal(taken, 18 * balance.hero.blockDamageScale);
  const behind = p.takeStrike({ enemy: 'hound_1', target: 'A', damage: 18, fromX: 0, fromZ: 0 });
  assert.equal(behind, 18);
});

test('Login: a token becomes the stored account and its rising; a forged guest kit is refused in production', async () => {
  setTokenVerifier(async () => { throw new Error('bad token'); });
  await assert.rejects(identify({}, 'forged'), /bad token/);
  setTokenVerifier(async () => ({ userId: `user_never_rose_${Date.now()}` }));
  await assert.rejects(identify({}, 'tok'), /has not risen/);
  setTokenVerifier(null);
  const before = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  await assert.rejects(identify({ element: 'AURA' }, null), /Login required/);
  process.env.NODE_ENV = before;
  const guest = await identify({ element: 'aura', role: 'Hush' }, null);
  assert.equal(guest.element, 'AURA');
  assert.equal(guest.role, 'Hush');
  assert.match(guest.accountId, /^guest:/);
});

/** A runner at 5.5 m/s going east for 2 s, then turning sharply north. */
function runner(t: number) {
  const speed = 5.5;
  if (t < 2) return { x: speed * t, z: 0, vx: speed, vz: 0 };
  return { x: speed * 2, z: speed * (t - 2), vx: 0, vz: speed };
}

test('Smoothing: a runner who turns is drawn on their real path, at the moment being drawn', () => {
  const track = new RemoteTrack();
  let worst = 0;
  // Samples arrive 0.2 s after they were taken, 20 a second, with 30 ms of jitter.
  const queue: Array<{ arrive: number; at: number }> = [];
  for (let k = 0; k * 0.05 < 5; k++) queue.push({ at: k * 0.05, arrive: k * 0.05 + 0.2 + ((k * 7) % 4) * 0.01 });
  for (let i = 0; i < 300; i++) {
    const now = i / 60;
    while (queue.length && queue[0]!.arrive <= now) {
      const s = queue.shift()!;
      const r = runner(s.at);
      track.push({ at: s.at, x: r.x, y: 0, z: r.z, vx: r.vx, vz: r.vz, facing: 0 }, now);
    }
    if (!track.ready) continue;
    const shown = track.update(now, 1 / 60);
    const truth = runner(now - track.behind());
    if (i > 40) worst = Math.max(worst, Math.hypot(shown.x - truth.x, shown.z - truth.z));
  }
  assert.ok(worst < 0.3, `worst ${worst}`);
});

test('Smoothing: the server clock estimate trusts the quickest round trip', () => {
  const clock = new ServerClock();
  clock.sample(100, 100.3, 50.2); // slow trip
  clock.sample(101, 101.1, 51.05); // quick trip: server was 50 s behind
  assert.ok(Math.abs(clock.now(102) - 52) < 0.01);
  assert.ok(Math.abs(clock.rtt - 0.1) < 1e-9);
});
