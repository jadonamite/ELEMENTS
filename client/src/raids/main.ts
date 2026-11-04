import '../ui/tokens.css';
import './raids.css';
import RAPIER from '@dimforge/rapier3d-compat';
import { BoxGeometry, Mesh, Vector3 } from 'three';
import balance from '../../../shared/balance.json';
import { createCombatRules, type CombatBalance } from '../../../shared/src/combat/index.js';
import { fighterHealth, type DungeonDef, type FightersConfig, type LootRule } from '../../../shared/src/raids/index.js';
import { ShoulderCamera } from '../camera.js';
import { Combat, type CombatAction, type FightingStyle } from '../combat.js';
import { FixedStepper, HeroController, locomotionForSpeed, turnToward, type MoveInput } from '../controller.js';
import { loadEnemyTemplate, type Enemy, type EnemyTemplate, type VillainKind } from '../enemy.js';
import { Fight, type HeroView } from '../fight.js';
import { FpsCounter } from '../fps.js';
import { loadHero } from '../hero.js';
import { FightHud } from '../hud.js';
import { GameInput } from '../input.js';
import { SoundManager } from '../audio.js';
import { SwordStance } from '../sword.js';
import { Ally, Figure, RaidFoe } from './bodies.js';
import { RaidNet, type Board, type RunView } from './net.js';
import { buildHall, buildRoom, HALL, layoutRun, type PlacedRoom } from './places.js';
import { Stage } from './stage.js';
import { Banner, BossBar, Counter, h, layer, Log, modal, NameTags, PartyFrame, Prompt, Status, type Tab } from './ui.js';

const params = new URLSearchParams(location.search);
const SERVER = params.get('server') ?? `http://${location.hostname}:2670`;
const FIGHTERS = (balance as unknown as { raids: { fighters: FightersConfig } }).raids.fighters;
const rules = createCombatRules(balance.combat as unknown as CombatBalance);

async function signIn(): Promise<string> {
  const given = params.get('as');
  if (given) return given.toLowerCase();
  const saved = sessionStorage.getItem('raid-name');
  return new Promise((resolve) => {
    const input = h('input', { 'aria-label': 'Your name', placeholder: 'Your name', value: saved ?? '', autocomplete: 'off' });
    const go = h('button', { class: 'raid-btn primary', type: 'button' }, 'Walk in');
    const box = h('section', { class: 'raid-signin raid-panel' },
      h('h1', { class: 'raid-title' }, 'The Raid Hall, Sindr'),
      h('p', { class: 'raid-sub' }, 'Local test sign-in. Each name is a separate player, so two windows can be two players in one party.'),
      input, go);
    layer.append(box);
    input.focus();
    const done = (): void => {
      const name = input.value.trim().toLowerCase();
      if (!/^[a-z0-9_-]{2,24}$/.test(name)) { input.setAttribute('aria-invalid', 'true'); return; }
      sessionStorage.setItem('raid-name', name);
      box.remove();
      resolve(name);
    };
    go.addEventListener('click', done);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(); });
  });
}

/** Steers like a player at the keys: the same move input and attack presses, for unattended filming. */
class Pilot {
  move: MoveInput = { forward: 0, right: 0, running: false };
  private queue: CombatAction[] = [];
  private cool = 0;
  blocking = false;
  take(): CombatAction[] { const q = this.queue; this.queue = []; return q; }
  steer(from: Vector3, to: Vector3, cameraYaw: number, run: boolean, stopAt = 0.6): boolean {
    const dx = to.x - from.x, dz = to.z - from.z, d = Math.hypot(dx, dz);
    if (d < stopAt) { this.move = { forward: 0, right: 0, running: false }; return true; }
    const x = dx / d, z = dz / d;
    this.move = { forward: -(x * Math.sin(cameraYaw) + z * Math.cos(cameraYaw)), right: x * Math.cos(cameraYaw) - z * Math.sin(cameraYaw), running: run };
    return false;
  }
  attack(delta: number, foe: Enemy | null, from: Vector3): void {
    this.cool -= delta;
    this.blocking = false;
    if (!foe) return;
    const d = foe.controller.position.distanceTo(from);
    if (foe.attacking && d < 3 && Math.random() < 0.5) { this.blocking = true; return; }
    if (d < 2.6 && this.cool <= 0) { this.queue.push(Math.random() < 0.25 ? 'heavy' : 'light'); this.cool = 0.32 + Math.random() * 0.2; }
  }
}

async function main(): Promise<void> {
  const name = await signIn();
  const net = new RaidNet(SERVER, `dev:${name}`);
  await fetch(`${SERVER}/api/raids/dev/grant`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }).catch(() => null);
  const cfg = await net.config();
  const dungeonId = Object.keys(cfg.dungeons)[0]!;
  const dungeon: DungeonDef = cfg.dungeons[dungeonId]!;

  const canvas = h('canvas', { id: 'raid', tabindex: '0', 'aria-label': 'The Raid Hall. WASD to move, mouse to look, C to talk or use.' });
  document.body.prepend(canvas);
  const stage = await Stage.create(canvas, params.get('fxQuality') === 'low');
  const { scene, camera, world } = stage;
  const status = new Status();
  status.set('The Raid Hall, Sindr', 'Loading');
  const [hero, template] = await Promise.all([loadHero(), loadEnemyTemplate()]);
  scene.add(hero.model);
  const controller = new HeroController(world, HALL.spawn, undefined, false);
  controller.facing = HALL.spawn.facing;
  const shoulder = new ShoulderCamera(camera, world, false);
  shoulder.yaw = controller.facing + Math.PI;
  const enterBtn = h('button', { class: 'raid-btn', type: 'button', hidden: true }, 'Play');
  layer.append(enterBtn);
  const input = new GameInput(canvas, enterBtn, (dx, dy) => shoulder.orbit(dx, dy), (t) => status.set('The Raid Hall, Sindr', t));
  const pilot = params.has('autopilot') ? new Pilot() : null;
  const fps = params.has('debug') ? new FpsCounter() : null;
  const sound = new SoundManager();
  const fightHud = new FightHud();
  const frame = new PartyFrame();
  const banner = new Banner();
  const prompt = new Prompt();
  const log = new Log();
  const bossBar = new BossBar();
  const tags = new NameTags();

  // ---------- the fight ----------
  let lastKiller = name;
  let fight: Fight;
  const makeFoe = (t: EnemyTemplate, w: RAPIER.World, p: { x: number; z: number }, max: number, kind: VillainKind): Enemy => {
    const foe = new RaidFoe(t, w, p, max, kind);
    foe.onAllyStruck = (ally, damage, by) => {
      const killed = ally.hurt(damage, by.controller.position);
      sound.playImpact(killed, false);
      if (killed) onAllyDied(ally);
    };
    return foe;
  };
  fight = new Fight(template, world, scene, {
    heroHit(blocked) { shoulder.shake(blocked ? 0.15 : 0.25); sound.playImpact(false, blocked); if (!blocked) { sound.playHeroHurt(); if (!combat.current) combat.react('hit'); } },
    heroParried() { shoulder.shake(0.22); sound.playImpact(false, true); fightHud.say('Parry'); setTimeout(() => fightHud.say(''), 900); },
    heroDied() { combat.react('death'); fightHud.say('You fell'); void onHeroDown(); },
    enemyHit(enemy, killed, damage = 35, hitPos) {
      if (killed) { lastKiller = name; sound.playVillainDeath(enemy.controller.position); } else sound.playVillainHurt(enemy.controller.position);
      sound.playImpact(killed, false);
      fightHud.showDamage(hitPos ?? enemy.controller.position, damage, false);
      shoulder.shake(killed ? 0.3 : 0.12);
    },
  }, makeFoe);
  fight.stopWaves();
  const combat = new Combat(hero.anim, (m) => fight.ready(m, false), (m, at) => { fight.startMove(m, at, false); });
  const sword = new SwordStance(hero);
  let style: FightingStyle = 'weapon';
  combat.setStyle(style);
  input.onStyleSelect = (s) => {
    if (s === 'bending') return;
    style = s; combat.setStyle(s);
    if (s === 'weapon') sword.draw(false); else sword.forceSheathe();
  };
  let locked: Enemy | null = null;
  input.onLockToggle = () => { locked = fight.findLockTarget(controller.position, locked); };

  // ---------- state ----------
  let mode: 'hall' | 'dungeon' = 'hall';
  let board: Board | null = null;
  const figures = new Map<string, Figure>();
  const allies = new Map<string, Ally>();
  let run: RunView | null = null;
  let rooms: PlacedRoom[] = [];
  const gates = new Map<number, { mesh: Mesh; collider: RAPIER.Collider }>();
  let roomFoes: RaidFoe[] = [];
  let spawnedRoom = -1;
  let reportedRoom = -1;
  let roomKills: Record<string, number> = {};
  let checkTimer = 0;
  let assignTimer = 0;
  let presenceTimer = 0;
  let pollTimer = 0;
  let boardTimer = 0;
  let reviveIn = 0;
  let ending = false;
  const others = new Map<string, Figure>();

  const counter = new Counter({
    buyKey: async (id) => { const r = await net.buyKey(id); log.add(`Bought a key for ${r.price} CHROMA.`); await refresh(); },
    hire: async (id) => { const r = await net.hire(id); log.add(`${board?.roster.find((f) => f.id === id)?.name} hired for ${r.wage}.`); await refresh(); },
    dismiss: async (id) => { await net.dismiss(id); await refresh(); },
    invite: async (n) => { await net.invite(n.toLowerCase()); log.add(`Invited ${n}.`); await refresh(); },
    accept: async (pid) => { await net.accept(pid); await refresh(); },
    leave: async () => { await net.leave(); await refresh(); },
    lootRule: async (r: LootRule) => { await net.lootRule(r); await refresh(); },
    needs: async (k) => { await net.needs(k); await refresh(); },
    sell: async (k, q) => { const r = await net.sell(k, q); log.add(`Sold for ${r.paid} CHROMA.`); await refresh(); },
    enter: async () => { const r = await net.enter(dungeonId); closeCounter(); await enterDungeon(r); },
    complain: async (kind, against, runId) => { await net.complain(kind, against, runId, ''); await net.tick(); await refresh(); },
    close: () => closeCounter(),
  }, cfg.itemKinds);
  (window as unknown as { raid: unknown }).raid = { net, counter, get board() { return board; }, get run() { return run; }, controller, fight, allies, get mode() { return mode; }, openCounter: (t: Tab) => openCounter(t), refresh: () => refresh() };

  function openCounter(tab: Tab): void {
    counter.open(tab);
    document.exitPointerLock?.();
    void refresh();
  }
  function closeCounter(): void { counter.hide(); canvas.focus(); }

  async function refresh(): Promise<void> {
    board = await net.board();
    counter.update(board);
    if (mode === 'hall') syncHallPeople();
    if (mode === 'hall' && board.party?.inRaid && !ending) {
      // Another member turned the key: follow them down.
      const r = await net.run(board.party.inRaid);
      if (r.state === 'active') await enterDungeon(r);
    }
  }

  // ---------- the Hall ----------
  function showHall(): void {
    mode = 'hall';
    stage.show(buildHall);
    for (const f of figures.values()) f.dispose();
    figures.clear();
    figures.set('broker', new Figure(template, scene, HALL.broker.x, HALL.broker.z, 0, 1));
    figures.set('salvage', new Figure(template, scene, HALL.salvageBuyer.x, HALL.salvageBuyer.z, -Math.PI / 2, 2));
    bossBar.set(null);
    syncHallPeople();
  }

  function syncHallPeople(): void {
    if (!board) return;
    const hired = new Set(board.party?.hired ?? []);
    const mine = board.party?.leaderId === name || !board.party;
    board.roster.forEach((f, i) => {
      const spot = { x: HALL.fighters.x, z: HALL.fighters.z + i * HALL.fighters.step };
      const key = `f:${f.id}`;
      if (hired.has(f.id) && mine) {
        figures.get(key)?.dispose(); figures.delete(key);
        if (!allies.has(f.id)) allies.set(f.id, new Ally(f.id, f.name, f.element, f.health, f.damage, template, world, scene, { x: controller.position.x - 1.5, z: controller.position.z + 1 }));
      } else {
        const ally = allies.get(f.id);
        if (ally) { ally.dispose(); allies.delete(f.id); }
        if (!figures.has(key)) figures.set(key, new Figure(template, scene, spot.x, spot.z, Math.PI / 2, i + 3));
      }
    });
    for (const [key, fig] of figures) {
      if (key.startsWith('f:') && !board.roster.some((f) => `f:${f.id}` === key)) { fig.dispose(); figures.delete(key); }
    }
  }

  // ---------- the ruin ----------
  async function enterDungeon(r: RunView): Promise<void> {
    if (mode === 'dungeon') return;
    run = r;
    mode = 'dungeon';
    ending = false;
    for (const f of figures.values()) f.dispose();
    figures.clear();
    rooms = layoutRun(r.order, dungeon);
    stage.show((b) => rooms.forEach((room, i) => buildRoom(b, room, i === rooms.length - 1)));
    for (const g of gates.values()) { g.mesh.removeFromParent(); world.removeCollider(g.collider, false); }
    gates.clear();
    const iron = stage.surface('blackened_rusted_iron');
    for (const room of rooms) {
      if (!room.gate) continue;
      const mesh = new Mesh(new BoxGeometry(room.gate.w, 4.2, 0.3), iron);
      mesh.position.set(room.gate.x, 2.1, room.gate.z);
      mesh.castShadow = true;
      scene.add(mesh);
      const collider = world.createCollider(RAPIER.ColliderDesc.cuboid(room.gate.w / 2, 2.1, 0.3).setTranslation(room.gate.x, 2.1, room.gate.z));
      gates.set(room.index, { mesh, collider });
    }
    for (let i = 0; i < r.roomIndex; i++) openGate(i);
    const start = rooms[r.roomIndex]!.start;
    teleportHero(start.x, start.z, 0);
    // Hired fighters walk down with the party; the other members' fighters are theirs to lead.
    const hiredHere = r.fighters.filter((f) => f.employer === name);
    for (const [id, a] of allies) if (!hiredHere.some((f) => f.id === id)) { a.dispose(); allies.delete(id); }
    for (const [i, hire] of hiredHere.entries()) {
      const row = board?.roster.find((f) => f.id === hire.id);
      let a = allies.get(hire.id);
      if (!a && row) { a = new Ally(row.id, row.name, row.element, row.health, row.damage, template, world, scene, start); allies.set(row.id, a); }
      a?.teleport(start.x + (i ? 1.6 : -1.6), start.z - 1.2);
    }
    spawnedRoom = r.roomIndex === 0 ? 0 : -1;
    reportedRoom = r.roomIndex - 1;
    log.reset();
    log.fromRun(r);
    banner.show(dungeon.name, `Rooms tonight: ${r.order.slice(1, -1).map((id) => dungeon.rooms[id]!.name.replace(/^The /, '')).join(', ')}, then the Warden`, 5);
  }

  function teleportHero(x: number, z: number, facing: number): void {
    controller.place(x, controller.position.y, z);
    controller.facing = facing;
    shoulder.yaw = facing + Math.PI;
  }

  function openGate(index: number): void {
    const g = gates.get(index);
    if (!g) return;
    g.mesh.removeFromParent();
    world.removeCollider(g.collider, false);
    gates.delete(index);
  }

  function spawnRoom(room: PlacedRoom): void {
    spawnedRoom = room.index;
    roomKills = {};
    const def = dungeon.rooms[room.id]!;
    let i = 0;
    for (const group of def.enemies) {
      for (let k = 0; k < group.count; k++) {
        const at = room.spawns[i++] ?? { x: 0, z: room.z0 + 14 };
        const foe = fight.spawnVillain(at, group.kind as VillainKind, group.health) as RaidFoe;
        if (group.boss) {
          foe.model.scale.setScalar(dungeon.boss.scale);
          foe.damageScale = dungeon.boss.damage / 12;
          foe.afflict({ slowScale: dungeon.boss.speed, slowSeconds: 99999 });
          foe.model.userData.boss = true;
        }
        roomFoes.push(foe);
      }
    }
    banner.show(room.name, room.kind === 'boss' ? dungeon.boss.name : `Room ${room.index} of ${rooms.length - 2}`);
  }

  async function reportClear(room: PlacedRoom): Promise<void> {
    if (!run) return;
    reportedRoom = room.index;
    const boss = room.kind === 'boss';
    try {
      run = await net.clear(run.id, room.id, roomKills, boss ? lastKiller : undefined);
      openGate(room.index);
      log.fromRun(run);
      if (run.state !== 'active') await endRun();
      else if (!boss && room.kind !== 'entry') banner.show(`${room.name} is clear`, 'The gate grinds open');
    } catch (e) {
      reportedRoom = room.index - 1;
      if (e instanceof Error && /too fast/.test(e.message)) return;
      log.add(e instanceof Error ? e.message : String(e), 'death');
    }
  }

  function onAllyDied(ally: Ally): void {
    log.add(`${ally.name} is down and does not get up.`, 'death');
    banner.show(`${ally.name} is dead`, 'Hired fighters can die. The Hall will have to replace them.', 3);
    if (run) void net.fighterKilled(run.id, ally.id).then((r) => { run = r; }).catch(() => null);
  }

  async function onHeroDown(): Promise<void> {
    if (!run || run.state !== 'active') return;
    try {
      run = await net.down(run.id);
      log.fromRun(run);
      if (run.state !== 'active') setTimeout(() => void endRun(), 2200);
      else reviveIn = 1e9;
    } catch { /* the run already ended */ }
  }

  async function endRun(): Promise<void> {
    if (!run || ending) return;
    ending = true;
    run = await net.run(run.id);
    const s = run.summary;
    const lines: Array<Node | string> = [];
    if (s?.outcome === 'won') {
      lines.push(h('h2', { class: 'raid-title' }, `${dungeon.boss.name} is dead`), h('p', { class: 'raid-sub' }, 'The haul, split as the party agreed:'));
      for (const [m, bag] of Object.entries(s.shares)) lines.push(h('p', {}, `${m}: ${Object.entries(bag).map(([k, q]) => `${q} ${cfg.itemKinds[k]?.name ?? k}`).join(', ') || 'nothing'}`));
    } else if (s?.outcome === 'lost') {
      lines.push(h('h2', { class: 'raid-title' }, 'The party is beaten'), h('p', { class: 'raid-sub' }, 'The ruin keeps a quarter of what each of you carried, and your gear takes heavy wear.'));
      for (const [m, l] of Object.entries(s.losses)) lines.push(h('p', {}, `${m} lost ${l.chroma} CHROMA${Object.keys(l.items).length ? ` and ${Object.entries(l.items).map(([k, q]) => `${q} ${cfg.itemKinds[k]?.name ?? k}`).join(', ')}` : ''}.`));
    } else lines.push(h('h2', { class: 'raid-title' }, 'The party turned back'));
    for (const f of s?.fighters ?? []) {
      const what = f.outcome === 'stayed' ? `stood to the end and was paid ${f.paid}${f.trained ? ', and spends it on training' : ''}` : f.outcome === 'fled' ? `ran. Their wage of ${f.refunded} comes back to you, and the Hall has it on record` : `died. Their wage of ${f.refunded} comes back to you${f.replacedBy ? `; ${f.replacedBy} joins the Hall in their place` : ''}`;
      lines.push(h('p', {}, `${f.name} ${what}.`));
    }
    const out = h('button', { class: 'raid-btn primary', type: 'button', 'data-act': 'climb-out' }, 'Climb out');
    const m = modal('raid-summary', ...lines, out);
    document.exitPointerLock?.();
    out.addEventListener('click', () => { m.close(); void leaveDungeon(s?.outcome === 'won'); });
  }

  async function leaveDungeon(sell: boolean): Promise<void> {
    if (run) counter.lastRunId = run.id;
    for (const f of roomFoes) f.target = null;
    fight.dispose();
    roomFoes = [];
    for (const a of allies.values()) a.dispose();
    allies.clear();
    for (const o of others.values()) o.dispose();
    others.clear();
    tags.clear();
    for (const g of gates.values()) { g.mesh.removeFromParent(); world.removeCollider(g.collider, false); }
    gates.clear();
    run = null;
    if (!fight.heroAlive) { fight.reviveHero(); fight.stopWaves(); fight.dispose(); combat.reset(); }
    showHall();
    teleportHero(HALL.salvage.x - 2.5, HALL.salvage.z, Math.PI / 2);
    ending = false;
    await net.tick().catch(() => null);
    await refresh();
    if (sell) openCounter('salvage');
  }

  // ---------- interaction ----------
  type Spot = { text: string; at: { x: number; z: number }; r: number; go: () => void };
  function spots(): Spot[] {
    if (mode === 'hall') {
      return [
        { text: 'Talk to the broker', at: HALL.counter, r: 2.8, go: () => openCounter('counter') },
        { text: 'Look over the fighters for hire', at: { x: HALL.fighters.x + 2, z: HALL.fighters.z + 5 }, r: 5, go: () => openCounter('fighters') },
        { text: 'Show your haul to the salvage buyer', at: HALL.salvage, r: 2.8, go: () => openCounter('salvage') },
        { text: 'Read the job and complaints board', at: { x: HALL.board.x - 1.2, z: HALL.board.z }, r: 2.6, go: () => openCounter('board') },
        { text: 'The stair to the Undervault', at: { x: HALL.stair.x, z: HALL.stair.z + 2 }, r: 2.6, go: () => openCounter('counter') },
      ];
    }
    const room = rooms[run?.roomIndex ?? 0];
    const out: Spot[] = [];
    if (room?.kind === 'entry' && room.gate && gates.has(0) && reportedRoom < 0) {
      out.push({ text: 'Turn the key in the vault door', at: { x: room.gate.x, z: room.gate.z - 1.5 }, r: 3, go: () => void reportClear(room) });
    }
    for (const r of rooms) {
      if (r.carving && r.carvingText) out.push({ text: 'Read the carving', at: r.carving, r: 2.6, go: () => {
        const close = h('button', { class: 'raid-btn', type: 'button' }, 'Step back');
        const m = modal('raid-carving', h('p', { class: 'raid-sub' }, `Carved in ${r.name}`), h('blockquote', {}, r.carvingText!), close);
        document.exitPointerLock?.();
        close.addEventListener('click', () => { m.close(); canvas.focus(); });
        setTimeout(() => m.close(), 9000);
      } });
    }
    return out;
  }
  let nearSpot: Spot | null = null;
  input.onInteract = () => nearSpot?.go();

  // ---------- the loop ----------
  showHall();
  await refresh();
  status.set('The Raid Hall, Sindr', 'Click to look around. C to talk.');
  const resize = (): void => stage.setSize(window.innerWidth, window.innerHeight);
  resize();
  window.addEventListener('resize', resize);
  const stepper = new FixedStepper();
  let lastTime = performance.now();
  const drawn = new Vector3();
  const bladeBase = new Vector3(), bladeTip = new Vector3();
  const limbs = { handR: new Vector3(), handL: new Vector3(), footR: new Vector3(), footL: new Vector3(), kneeR: new Vector3(), kneeL: new Vector3() };
  const heroView: HeroView = { position: controller.position, facing: 0, bladeBase, bladeTip, ...limbs, get weaponReach() { return hero.weaponSlot.reach; }, get weaponSlot() { return hero.weaponSlot; } } as HeroView;
  const syncLimbs = (): void => {
    hero.sword.updateMatrixWorld(true);
    hero.sword.localToWorld(bladeBase.copy(hero.bladeBase));
    hero.sword.localToWorld(bladeTip.copy(hero.bladeTip));
    hero.getLimbWorldPosition('hand_r', limbs.handR); hero.getLimbWorldPosition('hand_l', limbs.handL);
    hero.getLimbWorldPosition('foot_r', limbs.footR); hero.getLimbWorldPosition('foot_l', limbs.footL);
    hero.getLimbWorldPosition('knee_r', limbs.kneeR); hero.getLimbWorldPosition('knee_l', limbs.kneeL);
  };
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const project = new Vector3();

  stage.renderer.setAnimationLoop(() => {
    const now = performance.now();
    const delta = Math.min((now - lastTime) / 1000, balance.controller.maxFrameDelta);
    lastTime = now;
    const paused = counter.isOpen;
    const alive = fight.heroAlive;
    const currentRoom = mode === 'dungeon' && run ? rooms[run.roomIndex] : undefined;
    const liveFoes = roomFoes.filter((f) => f.alive);

    // Pilot: walk the party through, fight what is in the room.
    if (pilot && mode === 'dungeon' && run && !ending) {
      const target = liveFoes.sort((a, b) => a.controller.position.distanceTo(controller.position) - b.controller.position.distanceTo(controller.position))[0] ?? null;
      if (target) {
        pilot.steer(controller.position, target.controller.position, shoulder.yaw, false, 1.9);
        locked = target;
        pilot.attack(delta, target, controller.position);
      } else if (currentRoom) {
        locked = null;
        const next = rooms[currentRoom.index + 1];
        const gateOpen = !gates.has(currentRoom.index);
        if (currentRoom.kind === 'entry' && !gateOpen) {
          if (pilot.steer(controller.position, new Vector3(0, 0, currentRoom.gate!.z - 1.5), shoulder.yaw, false, 0.8) && reportedRoom < 0) void reportClear(currentRoom);
        } else if (gateOpen && next) pilot.steer(controller.position, new Vector3(0, 0, next.z0 + 5), shoulder.yaw, true);
        else pilot.steer(controller.position, new Vector3(0, 0, (currentRoom.z0 + currentRoom.z1) / 2 + 3), shoulder.yaw, false);
      }
      // Keep the camera behind the direction of travel.
      const m = pilot.move;
      if (m.forward || m.right) {
        const dir = Math.atan2(m.right * Math.cos(shoulder.yaw) - m.forward * Math.sin(shoulder.yaw), -m.right * Math.sin(shoulder.yaw) - m.forward * Math.cos(shoulder.yaw));
        shoulder.yaw = turnToward(shoulder.yaw, locked ? Math.atan2(-(locked.controller.position.x - controller.position.x), -(locked.controller.position.z - controller.position.z)) : dir + Math.PI, delta * 0.35);
      }
    }

    const actions = alive && !paused ? [...input.takeActions(), ...(pilot?.take() ?? [])] : (input.takeActions(), []);
    for (const action of actions) {
      if (action === 'dodge') { if (fight.ready('dodge', false) && combat.press('dodge')) { fight.recordDodge(false); sound.playDodge(); } continue; }
      if (action !== 'light' && action !== 'heavy') { fightHud.say('Element moves come with the bending rebuild'); setTimeout(() => fightHud.say(''), 1200); continue; }
      if (style === 'weapon' && !sword.armed) { sword.draw(true); continue; }
      const mark = locked && locked.alive ? locked : fight.nearestInFront(controller.position, shoulder.yaw + Math.PI, balance.combat.aimAssistRange, balance.combat.aimAssistAngle);
      if (mark && !combat.current) controller.facing = Math.atan2(mark.controller.position.x - controller.position.x, mark.controller.position.z - controller.position.z);
      if (combat.press(action)) sound.playSwing(style === 'weapon' ? 1 : 1.2, action === 'heavy');
    }
    combat.blocking = alive && !paused && (input.blocking || !!pilot?.blocking) && !combat.current;
    if (combat.blocking) {
      const threat = locked ?? fight.nearestInFront(controller.position, controller.facing, balance.hero.guardTurnRange, Math.PI);
      if (threat) controller.facing = turnToward(controller.facing, Math.atan2(threat.controller.position.x - controller.position.x, threat.controller.position.z - controller.position.z), delta);
    }
    if (!paused) combat.update(delta);
    if (style === 'weapon') {
      if (liveFoes.length && fight.nearestDistance(controller.position) < balance.stance.engageRadius && alive) sword.draw(false);
      else if (!combat.current && !liveFoes.length) sword.sheathe();
    }
    // Indoors the close shoulder view always; the open-world view sits above the ceiling.
    shoulder.fight = 1;
    if (locked && !locked.alive) locked = null;
    shoulder.lockTarget = locked ? locked.controller.position : null;

    syncLimbs();
    heroView.facing = controller.facing;
    const rooted = combat.current !== null || combat.blocking || paused || !alive;
    const leader = controller.position;
    const alpha = stepper.advance(delta, () => {
      const stop = combat.current !== 'dodge' && fight.nearestDistance(controller.position) < balance.combat.lungeStopDistance;
      const move = rooted ? { forward: 0, right: 0, running: false } : (pilot && mode === 'dungeon' ? pilot.move : input.read());
      controller.step(move, shoulder.yaw, stop ? 0 : combat.lunge, 1);
      if (paused) { world.step(); return; }
      fight.step(heroView, combat, false);
      for (const a of allies.values()) {
        const struck = a.step(leader, liveFoes);
        if (struck && struck.alive) {
          const killed = struck.hurt(rules.applyDamage(struck.health, a.damage), 'light_1', a.position);
          sound.playImpact(killed, false);
          if (killed) { a.kills++; roomKills[a.id] = (roomKills[a.id] ?? 0) + 1; lastKiller = a.id; fight.defeatEnemy(struck); }
        }
      }
      // Every body has moved for this tick; the world steps once.
      world.step();
    });

    // Draw.
    drawn.lerpVectors(controller.previous, controller.position, alpha);
    hero.model.position.copy(drawn);
    hero.model.rotation.y = controller.facing + balance.controller.modelForwardYaw;
    if (combat.blocking) hero.anim.play('block', balance.combat.fade);
    else if (!combat.current) {
      const pace = locomotionForSpeed(controller.speed);
      hero.anim.play(pace === 'idle' && !sword.engaged ? 'idle_relaxed' : pace, balance.controller.animationFade);
      if (pace !== 'idle') hero.anim.setSpeed(pace, Math.max(0.5, controller.speed / balance.controller.clipSpeeds[pace]));
    }
    hero.anim.update(delta);
    sword.update(delta);
    fight.draw(paused ? 0 : delta, alpha, controller.position);
    for (const a of allies.values()) a.draw(paused ? 0 : delta, alpha);
    for (const f of figures.values()) f.update(delta);

    if (mode === 'dungeon' && run && !ending) {
      // Walking into the next room wakes what lives there.
      const room = rooms[run.roomIndex];
      if (room && room.kind !== 'entry' && spawnedRoom < room.index && controller.position.z > room.z0 + 2.5) spawnRoom(room);
      if (room && spawnedRoom === room.index && room.kind !== 'entry' && reportedRoom < room.index && roomFoes.length && roomFoes.every((f) => !f.alive)) {
        roomFoes = [];
        void reportClear(room);
      }
      // Foes pick fights with hired fighters too, not only with you.
      assignTimer -= delta;
      if (assignTimer <= 0) {
        assignTimer = 1.2;
        const fighting = [...allies.values()].filter((a) => a.fighting);
        const load = new Map<Ally, number>();
        for (const f of roomFoes) {
          if (!f.alive) continue;
          if (f.model.userData.boss) { f.target = fighting.length && Math.random() < 0.3 ? fighting[Math.floor(Math.random() * fighting.length)]! : null; continue; }
          if (f.target && f.target.fighting) { load.set(f.target, (load.get(f.target) ?? 0) + 1); continue; }
          const near = fighting.filter((a) => (load.get(a) ?? 0) < 1).sort((a, b) => a.position.distanceTo(f.controller.position) - b.position.distanceTo(f.controller.position))[0];
          if (near && near.position.distanceTo(f.controller.position) < controller.position.distanceTo(f.controller.position) + 2) { f.target = near; load.set(near, 1); }
        }
      }
      // Each hired fighter's nerve is weighed on the server every couple of seconds while foes are up.
      checkTimer -= delta;
      if (checkTimer <= 0 && liveFoes.length) {
        checkTimer = FIGHTERS.fleeCheckSeconds;
        const all = [...allies.values()];
        const standing = all.filter((a) => a.fighting).length + (alive ? 1 : 0);
        const foesHealth = Math.max(...liveFoes.map((f) => f.health.current / f.health.maximum));
        for (const a of all.filter((x) => x.fighting)) {
          const runId = run.id;
          void net.fighterCheck(runId, a.id, a.hp, {
            health: a.hp / a.maxHp, partyStanding: standing / Math.max(1, all.length + 1), fightersDown: all.filter((x) => x.state === 'dead').length,
            playersDown: alive ? 0 : 1, bossRoom: room?.kind === 'boss', foesHealth,
          }).then((res) => {
            run = res.run;
            if (res.flee && a.fighting) {
              a.flee(new Vector3(rooms[0]!.start.x, 0, rooms[0]!.start.z));
              for (const f of roomFoes) if (f.target === a) f.target = null;
              banner.show(`${a.name} breaks and runs`, 'The Raid Hall will hear of it', 3);
              log.add(`${a.name} breaks and runs for the stairs.`, 'flee');
            }
          }).catch(() => null);
        }
      }
      presenceTimer -= delta;
      if (presenceTimer <= 0) {
        presenceTimer = 0.5;
        void net.presence(run.id, { x: controller.position.x, z: controller.position.z, hp: fight.heroHealth.current, maxHp: fight.heroHealth.maximum }).catch(() => null);
      }
      pollTimer -= delta;
      if (pollTimer <= 0) {
        pollTimer = 1;
        void net.run(run.id).then((r) => {
          if (!run || r.id !== run.id) return;
          // Another member cleared a room: open the way and let its foes go.
          for (let i = 0; i < r.roomIndex; i++) if (gates.has(i)) { openGate(i); if (reportedRoom < i) reportedRoom = i; }
          run = { ...r };
          log.fromRun(r);
          if (r.state !== 'active') void endRun();
        }).catch(() => null);
      }
      const boss = roomFoes.find((f) => f.model.userData.boss);
      bossBar.set(boss && boss.alive ? dungeon.boss.name : null, boss?.health.current ?? 0, boss?.health.maximum ?? 1);
      status.set(dungeon.name, room ? `${room.name}${room.kind === 'fight' ? `, room ${room.index} of ${rooms.length - 2}` : ''}` : '');
    } else if (mode === 'hall') {
      status.set('The Raid Hall, Sindr', board ? `${board.chroma} CHROMA carried` : '');
      boardTimer -= delta;
      if (boardTimer <= 0 && !counter.isOpen) { boardTimer = 2.5; void refresh().catch(() => null); }
    }
    if (reviveIn < 1e8 && reviveIn > 0 && (reviveIn -= delta) <= 0) { fight.reviveHero(); fight.stopWaves(); combat.reset(); }

    // Party frame: players, then hired fighters.
    const rows = [{ name, tag: 'you', hp: fight.heroHealth.current, max: fight.heroHealth.maximum, fighter: false, out: alive ? null : 'down' }];
    for (const m of (run?.members ?? board?.party?.members ?? []).filter((m) => m !== name)) {
      const p = run?.presence[m];
      rows.push({ name: m, tag: 'player', hp: p?.hp ?? 1, max: p?.maxHp ?? 1, fighter: false, out: run?.down.includes(m) ? 'down' : null });
    }
    for (const a of allies.values()) rows.push({ name: a.name, tag: a.element, hp: a.hp, max: a.maxHp, fighter: true, out: a.state === 'dead' ? 'dead' : a.state === 'flee' || a.state === 'gone' ? 'ran' : null });
    if (run) for (const f of run.fighters) if (!allies.has(f.id)) {
      const row = board?.roster.find((x) => x.id === f.id);
      rows.push({ name: row?.name ?? f.id, tag: `${f.employer}'s`, hp: run.fighterHp[f.id] ?? 0, max: row ? fighterHealth(row, FIGHTERS) : 1, fighter: true, out: run.fighterStatus[f.id] === 'stayed' ? null : run.fighterStatus[f.id] === 'died' ? 'dead' : 'ran' });
    }
    frame.set(rows);

    // Other players in the same ruin, where they last said they were.
    if (run) for (const [m, p] of Object.entries(run.presence)) {
      if (m === name) continue;
      let fig = others.get(m);
      if (!fig) { fig = new Figure(template, scene, p.x, p.z, 0, 5); others.set(m, fig); }
      fig.walkTo(p.x, p.z, delta);
      fig.update(delta);
    }

    // Name tags over hired fighters and Hall people.
    const tag = (id: string, text: string, sub: string, pos: Vector3, y: number): void => {
      project.set(pos.x, y, pos.z).project(camera);
      const vis = project.z < 1 && Math.abs(project.x) < 1.1 && Math.abs(project.y) < 1.1 && camera.position.distanceTo(pos) < 22;
      tags.place(id, text, sub, (project.x + 1) / 2 * innerWidth, (1 - project.y) / 2 * innerHeight, vis);
    };
    for (const a of allies.values()) if (a.state !== 'gone') tag(a.id, a.name, a.state === 'dead' ? 'dead' : a.state === 'flee' ? 'running' : `hired, ${a.element}`, a.body.model.position, 2.15);
    if (mode === 'hall' && board) {
      board.roster.forEach((f) => { const fig = figures.get(`f:${f.id}`); if (fig) tag(f.id, f.name, `skill ${f.skill}, ${f.wage} a run`, fig.model.position, 2.15); });
      const b = figures.get('broker'); if (b) tag('broker', 'The broker', 'Raid Hall', b.model.position, 2.15);
      const s = figures.get('salvage'); if (s) tag('salvage', 'Ruth Callow', 'salvage buyer', s.model.position, 2.15);
    } else { for (const id of ['broker', 'salvage']) tags.drop(id); board?.roster.forEach((f) => { if (!allies.has(f.id)) tags.drop(f.id); }); }

    nearSpot = null;
    if (!paused) for (const s of spots()) if (Math.hypot(controller.position.x - s.at.x, controller.position.z - s.at.z) < s.r) { nearSpot = s; break; }
    prompt.set(nearSpot?.text ?? null);
    fightHud.update(delta, fight.heroHealth, fight.enemies, camera, balance.enemy.healthBarHeight, false, sword.armed, locked, [], 'IGNIS', undefined, style, false);
    shoulder.update(drawn, delta, reduced.matches);
    stage.focus.copy(drawn);
    sound.update(delta, camera, controller, fight.enemies, sword);
    fps?.tick();
    stage.render();
  });
}

main().catch((e: unknown) => {
  console.error('The raid page failed to start:', e);
  layer.append(h('p', { class: 'raid-error', style: 'position:fixed;left:24px;top:24px' }, `Could not reach the Raid Hall at ${SERVER}. Is the raid server running?`));
});
