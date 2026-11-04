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

export interface CorpseDropItem {
  id: string;
  name: string;
  count: number;
}

export interface WorldCorpseDrop {
  id: string;
  x: number;
  y: number;
  z: number;
  items: CorpseDropItem[];
  mesh: Group;
  light: PointLight;
}

/**
 * Creates visual beacon and loot pouch markers for death drops.
 */
export class CorpseDropManager {
  private drops: WorldCorpseDrop[] = [];
  group = new Group();

  constructor(private scene: Scene) {
    this.scene.add(this.group);
  }

  /** Spawns physical container where the hero fell with the dropped materials. */
  spawnDropMesh(x: number, y: number, z: number, items: CorpseDropItem[] = []): WorldCorpseDrop {
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

  removeDrop(drop: WorldCorpseDrop): void {
    this.group.remove(drop.mesh);
    drop.light.dispose();
    const idx = this.drops.indexOf(drop);
    if (idx !== -1) this.drops.splice(idx, 1);
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
