import RAPIER from '@dimforge/rapier3d-compat';
import {
  CircleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
  type Scene,
  SphereGeometry,
  type Vector3,
  AdditiveBlending,
} from 'three';
import { EconomyError, listLoot, type LootContents, type LootPile } from './api.js';
import { describeLoot, lootItems } from './items.js';

// Loot on the ground: piles the server holds near the player are drawn where they lie, and walking
// within reach of one picks it up. The server checks the distance and who may take it. Offline the
// piles are polled; online the zone room tells every player when a pile appears or goes.

const SEE_RADIUS = 40;
const POLL_SECONDS = 2;
const CLAIM_REACH = 1.35;
const RETRY_SECONDS = 3;

interface ShownPile {
  pile: LootPile;
  mesh: Group;
  retryAt: number;
}

export interface WorldLootEvents {
  picked(text: string): void;
  satchelChanged(): void;
  claim(pileId: string, x: number, z: number): Promise<LootContents>;
}

export class WorldLoot {
  private readonly root = new Group();
  private readonly shown = new Map<string, ShownPile>();
  private pollIn = 0;
  private polling = false;
  private time = 0;
  /** Off once the room pushes piles. */
  pollServer = true;
  private readonly pouchGeo = new SphereGeometry(0.18, 12, 8);
  private readonly coinGeo = new CylinderGeometry(0.05, 0.05, 0.012, 10);
  private readonly glowGeo = new CircleGeometry(0.55, 24);
  private readonly beaconGeo = new CylinderGeometry(0.03, 0.08, 2.2, 8);
  private readonly pouchMat = new MeshStandardMaterial({ color: 0x8a7458, roughness: 0.95 });
  private readonly coinMat = new MeshStandardMaterial({ color: 0xd9a441, metalness: 0.9, roughness: 0.35 });
  private readonly shardMat = new MeshStandardMaterial({ color: 0xc92a2a, emissive: 0x8b1e1e, emissiveIntensity: 1.4, roughness: 0.3 });
  private readonly glowMat = new MeshBasicMaterial({ color: 0xff7a3d, transparent: true, opacity: 0.22, depthWrite: false, blending: AdditiveBlending });
  private readonly beaconMat = new MeshBasicMaterial({ color: 0xffaa44, transparent: true, opacity: 0.65, depthWrite: false, blending: AdditiveBlending });

  constructor(
    scene: Scene,
    private readonly world: RAPIER.World,
    private readonly zoneName: string,
    private readonly events: WorldLootEvents,
  ) {
    this.root.name = 'world-loot';
    scene.add(this.root);
  }

  // Shows a pile at once (a kill or a death), before the next poll would find it.
  add(pile: LootPile): void {
    if (!this.shown.has(pile.id)) this.show(pile);
  }

  // A pile someone took or that expired.
  remove(id: string): void {
    const s = this.shown.get(id);
    if (s) this.hide(id, s);
  }

  // The room's full list of the zone's piles, as a player joins.
  replace(piles: LootPile[]): void {
    const live = new Set(piles.map((p) => p.id));
    for (const [id, s] of this.shown) if (!live.has(id)) this.hide(id, s);
    for (const pile of piles) this.add(pile);
  }

  update(dt: number, hero: Vector3): void {
    this.time += dt;
    for (const s of this.shown.values()) {
      s.mesh.rotation.y += dt * 0.6;
      const glow = s.mesh.children[0];
      if (glow) glow.scale.setScalar(1 + Math.sin(this.time * 2.4) * 0.08);
      const beacon = s.mesh.getObjectByName('beacon');
      if (beacon instanceof Mesh && beacon.material instanceof MeshBasicMaterial) {
        beacon.material.opacity = 0.55 + Math.sin(this.time * 3.0) * 0.2;
      }
    }

    this.pollIn -= dt;
    if (this.pollServer && this.pollIn <= 0 && !this.polling) {
      this.pollIn = POLL_SECONDS;
      void this.poll(hero.x, hero.z);
    }

    for (const s of this.shown.values()) {
      if (this.time < s.retryAt) continue;
      if (Math.hypot(hero.x - s.pile.x, hero.z - s.pile.z) <= CLAIM_REACH) {
        s.retryAt = this.time + RETRY_SECONDS;
        void this.claim(s, hero.x, hero.z);
      }
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const g of [this.pouchGeo, this.coinGeo, this.glowGeo, this.beaconGeo]) g.dispose();
    for (const m of [this.pouchMat, this.coinMat, this.shardMat, this.glowMat, this.beaconMat]) m.dispose();
  }

  private async poll(x: number, z: number): Promise<void> {
    this.polling = true;
    try {
      const piles = await listLoot(this.zoneName, x, z, SEE_RADIUS);
      const live = new Set(piles.map((p) => p.id));
      for (const [id, s] of this.shown) {
        if (!live.has(id)) this.hide(id, s);
      }
      for (const pile of piles) if (!this.shown.has(pile.id)) this.show(pile);
    } catch {
      // The next poll tries again.
    } finally {
      this.polling = false;
    }
  }

  private async claim(s: ShownPile, x: number, z: number): Promise<void> {
    try {
      const contents = await this.events.claim(s.pile.id, x, z);
      this.hide(s.pile.id, s);
      this.events.picked(`Picked up ${describeLoot(contents.chroma, lootItems(contents))}`);
      this.events.satchelChanged();
    } catch (err) {
      if (err instanceof EconomyError && /reserved for fight victor/.test(err.message)) {
        this.events.picked('That belongs to whoever won the fight, for now');
      } else if (err instanceof EconomyError && /already been claimed|expired|not found/.test(err.message)) {
        this.hide(s.pile.id, s);
      }
    }
  }

  private groundY(x: number, z: number): number {
    const ray = new RAPIER.Ray({ x, y: 200, z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, 400, true, RAPIER.QueryFilterFlags.ONLY_FIXED);
    return hit ? 200 - hit.timeOfImpact : 0;
  }

  private show(pile: LootPile): void {
    const g = new Group();
    const glow = new Mesh(this.glowGeo, this.glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.02;
    g.add(glow);

    const pouch = new Mesh(this.pouchGeo, this.pouchMat);
    pouch.scale.set(1, 0.7, 1);
    pouch.position.y = 0.12;
    pouch.castShadow = true;
    g.add(pouch);

    // Amber beacon beam and warm light for dropped loot piles
    const beacon = new Mesh(this.beaconGeo, this.beaconMat);
    beacon.name = 'beacon';
    beacon.position.y = 1.1;
    g.add(beacon);

    const light = new PointLight(0xff8822, 1.2, 5.0, 1.8);
    light.position.y = 0.5;
    g.add(light);

    const coins = Math.min(6, Math.ceil(pile.contents.chroma / 10));
    for (let i = 0; i < coins; i++) {
      const c = new Mesh(this.coinGeo, this.coinMat);
      const a = (i / Math.max(1, coins)) * Math.PI * 2;
      c.position.set(Math.cos(a) * 0.28, 0.01 + i * 0.004, Math.sin(a) * 0.28);
      c.rotation.z = (i % 3) * 0.2;
      g.add(c);
    }
    const shardCount = Object.values(pile.contents.shards ?? {}).reduce((a, b) => a + b, 0);
    for (let i = 0; i < Math.min(3, shardCount); i++) {
      const s = new Mesh(this.coinGeo, this.shardMat);
      s.scale.set(0.8, 6, 0.8);
      s.position.set(-0.22 + i * 0.12, 0.04, 0.2);
      s.rotation.set(0.5, i, 0.3);
      g.add(s);
    }

    g.position.set(pile.x, this.groundY(pile.x, pile.z), pile.z);
    this.root.add(g);
    this.shown.set(pile.id, { pile, mesh: g, retryAt: 0 });
  }

  private hide(id: string, s: ShownPile): void {
    s.mesh.removeFromParent();
    this.shown.delete(id);
  }
}
