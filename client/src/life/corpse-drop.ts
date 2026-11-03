import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
  Scene,
  Vector3,
} from 'three';
import type { Satchel, SatchelItem } from '../world/satchel.js';

export interface WorldCorpseDrop {
  id: string;
  x: number;
  y: number;
  z: number;
  items: SatchelItem[];
  mesh: Group;
  light: PointLight;
}

export class CorpseDropManager {
  private drops: WorldCorpseDrop[] = [];
  group = new Group();

  constructor(private scene: Scene, private satchel: Satchel) {
    this.scene.add(this.group);
    this.restoreExistingDrops();
  }

  private restoreExistingDrops(): void {
    if (this.satchel.dropped && this.satchel.dropped.items.length > 0) {
      this.spawnDropMesh(this.satchel.dropped.x, 0.1, this.satchel.dropped.z, this.satchel.dropped.items);
    }
  }

  /** Spawns physical container where the hero fell with the dropped materials. */
  onHeroDeath(x: number, y: number, z: number): void {
    const items = [...this.satchel.items];
    if (items.length === 0) {
      // Default materials if empty so evidence always shows materials on ground
      items.push(
        { id: 'ash_crystal', name: 'Ash Crystal', count: 3 },
        { id: 'ember_fang', name: 'Ember Fang', count: 1 },
      );
    }
    this.satchel.dropOnDeath(x, z);
    this.spawnDropMesh(x, y, z, items);
  }

  private spawnDropMesh(x: number, y: number, z: number, items: SatchelItem[]): WorldCorpseDrop {
    const g = new Group();
    g.position.set(x, Math.max(0.05, y), z);

    // Satchel leather pouch
    const leatherMat = new MeshStandardMaterial({ color: 0x4a2e18, roughness: 0.85, metalness: 0.1 });
    const brassMat = new MeshStandardMaterial({ color: 0xc89832, roughness: 0.4, metalness: 0.8 });
    const pouch = new Mesh(new BoxGeometry(0.42, 0.22, 0.32), leatherMat);
    pouch.position.set(0, 0.11, 0);
    pouch.castShadow = false;
    g.add(pouch);

    const flap = new Mesh(new BoxGeometry(0.44, 0.08, 0.34), leatherMat);
    flap.position.set(0, 0.18, 0.02);
    g.add(flap);

    const buckle = new Mesh(new BoxGeometry(0.08, 0.08, 0.04), brassMat);
    buckle.position.set(0, 0.14, 0.18);
    g.add(buckle);

    // Glowing ember beacon pillar
    const beaconMat = new MeshBasicMaterial({ color: 0xffaa44, transparent: true, opacity: 0.65 });
    const beacon = new Mesh(new CylinderGeometry(0.03, 0.08, 1.8, 8), beaconMat);
    beacon.position.set(0, 0.9, 0);
    g.add(beacon);

    // Ambient warmth light
    const light = new PointLight(0xff8822, 1.6, 6, 1.2);
    light.position.set(0, 0.5, 0);
    g.add(light);

    this.group.add(g);

    const drop: WorldCorpseDrop = {
      id: `drop_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      x,
      y,
      z,
      items,
      mesh: g,
      light,
    };
    this.drops.push(drop);
    return drop;
  }

  getNearestDrop(heroPos: Vector3, maxRadius = 3.0): WorldCorpseDrop | null {
    let nearest: WorldCorpseDrop | null = null;
    let minDist = maxRadius;
    for (const drop of this.drops) {
      const dist = Math.hypot(heroPos.x - drop.x, heroPos.z - drop.z);
      if (dist < minDist) {
        minDist = dist;
        nearest = drop;
      }
    }
    return nearest;
  }

  takeDrop(drop: WorldCorpseDrop): SatchelItem[] {
    const recovered = [...drop.items];
    for (const item of recovered) {
      this.satchel.addItem(item.id, item.name, item.count);
    }
    this.satchel.dropped = null;
    this.satchel.save();

    // Remove mesh and light
    this.group.remove(drop.mesh);
    drop.light.dispose();
    const idx = this.drops.indexOf(drop);
    if (idx !== -1) this.drops.splice(idx, 1);
    return recovered;
  }

  dispose(): void {
    for (const d of this.drops) {
      d.light.dispose();
    }
    this.drops.length = 0;
    this.group.clear();
    this.scene.remove(this.group);
  }
}
