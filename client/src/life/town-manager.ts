import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Scene,
  Vector3,
  type AnimationMixer,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  SINDR_TOWNSFOLK,
  type RoutineActivity,
  type Townsperson,
  getTownspersonPosition,
} from './townsfolk.js';

export type TownsfolkBodyFactory = (npc: Townsperson) => Object3D;

let customBodyFactory: TownsfolkBodyFactory | null = null;

/**
 * Expose function for the people lane to replace default bodies with their line-ups.
 */
export function setTownsfolkBodyFactory(factory: TownsfolkBodyFactory | null): void {
  customBodyFactory = factory;
}

export interface LiveTownsperson {
  data: Townsperson;
  object?: Object3D;
  position: Vector3;
  targetPosition: Vector3;
  targetFacing: number;
  facing: number;
  currentActivity: RoutineActivity;
  walking: boolean;
  feelingScore: number; // 0..100 (LORE 15)
  category: 'dim' | 'lit' | 'smith' | 'guard' | 'child';
  instanceIndex: number;
  walkCycle: number;
}

export class TownManager {
  group = new Group();
  townsfolk: LiveTownsperson[] = [];
  private initialized = false;

  // Instanced meshes by archetype to stay strictly under the 200 draw call limit
  private dimMesh!: InstancedMesh;
  private litMesh!: InstancedMesh;
  private smithMesh!: InstancedMesh;
  private guardMesh!: InstancedMesh;
  private childMesh!: InstancedMesh;

  private customBodies: Object3D[] = [];

  constructor(private scene: Scene) {
    this.scene.add(this.group);
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    if (customBodyFactory) {
      this.spawnCustomBodies();
    } else {
      this.spawnInstancedCrowd();
    }

    this.initialized = true;
  }

  private buildHumanoidGeometry(role: string, isLit: boolean, scale = 1.0) {
    const parts = [
      // Torso / Tunic
      new BoxGeometry(0.44 * scale, 0.58 * scale, 0.28 * scale).translate(0, 1.05 * scale, 0),
      // Tunic skirt flaring over hips
      new BoxGeometry(0.48 * scale, 0.30 * scale, 0.32 * scale).translate(0, 0.68 * scale, 0),
      // Belt
      new BoxGeometry(0.49 * scale, 0.08 * scale, 0.33 * scale).translate(0, 0.79 * scale, 0),
      // Left leg & boot
      new CylinderGeometry(0.08 * scale, 0.07 * scale, 0.52 * scale, 8).translate(
        -0.13 * scale,
        0.35 * scale,
        0,
      ),
      new BoxGeometry(0.13 * scale, 0.15 * scale, 0.22 * scale).translate(
        -0.13 * scale,
        0.08 * scale,
        0.03 * scale,
      ),
      // Right leg & boot
      new CylinderGeometry(0.08 * scale, 0.07 * scale, 0.52 * scale, 8).translate(
        0.13 * scale,
        0.35 * scale,
        0,
      ),
      new BoxGeometry(0.13 * scale, 0.15 * scale, 0.22 * scale).translate(
        0.13 * scale,
        0.08 * scale,
        0.03 * scale,
      ),
      // Left arm with sleeve
      new CylinderGeometry(0.065 * scale, 0.055 * scale, 0.54 * scale, 8)
        .rotateZ(0.12)
        .translate(-0.28 * scale, 0.98 * scale, 0),
      // Right arm with sleeve
      new CylinderGeometry(0.065 * scale, 0.055 * scale, 0.54 * scale, 8)
        .rotateZ(-0.12)
        .translate(0.28 * scale, 0.98 * scale, 0),
      // Neck
      new CylinderGeometry(0.07 * scale, 0.08 * scale, 0.12 * scale, 8).translate(
        0,
        1.38 * scale,
        0,
      ),
      // Head
      new BoxGeometry(0.20 * scale, 0.24 * scale, 0.20 * scale).translate(0, 1.54 * scale, 0),
    ];

    if (isLit) {
      // Lit IGNIS: high mantle collar & shoulder brooch
      parts.push(
        new BoxGeometry(0.50, 0.18, 0.34).translate(0, 1.28, 0),
        new BoxGeometry(0.14, 0.12, 0.36).translate(-0.18, 1.34, 0),
      );
    } else if (role === 'smith') {
      // Smith: leather apron & heavy forge hammer
      parts.push(
        new BoxGeometry(0.40, 0.65, 0.30).translate(0, 0.95, 0.02),
        // Hammer handle
        new CylinderGeometry(0.02, 0.02, 0.45, 6).translate(0.32, 0.72, 0.1),
        // Hammer head
        new BoxGeometry(0.10, 0.12, 0.18).translate(0.32, 0.92, 0.1),
      );
    } else if (role === 'guard') {
      // Guard: iron kettle helm & spear shaft/head
      parts.push(
        // Helm
        new CylinderGeometry(0.13, 0.24, 0.18, 8).translate(0, 1.68, 0),
        // Spear
        new CylinderGeometry(0.02, 0.02, 2.3, 6).translate(0.35, 1.15, 0.1),
        new CylinderGeometry(0.01, 0.05, 0.35, 4).translate(0.35, 2.35, 0.1),
      );
    } else if (role === 'porter') {
      // Porter: cargo crate on back/shoulder
      parts.push(
        new BoxGeometry(0.38, 0.45, 0.42).translate(0, 1.15, -0.22),
      );
    } else {
      // Commoner cloth coif / hat
      parts.push(
        new BoxGeometry(0.22 * scale, 0.12 * scale, 0.22 * scale).translate(
          0,
          1.66 * scale,
          0,
        ),
      );
    }

    const merged = mergeGeometries(parts);
    return merged ?? new BoxGeometry(0.4, 1.7, 0.3);
  }

  private spawnInstancedCrowd(): void {
    // Categorize townsfolk
    const dimList: Townsperson[] = [];
    const litList: Townsperson[] = [];
    const smithList: Townsperson[] = [];
    const guardList: Townsperson[] = [];
    const childList: Townsperson[] = [];

    for (const npc of SINDR_TOWNSFOLK) {
      if (npc.role === 'guard') {
        guardList.push(npc);
      } else if (npc.role === 'smith') {
        smithList.push(npc);
      } else if (npc.role === 'child') {
        childList.push(npc);
      } else if (npc.isLit) {
        litList.push(npc);
      } else {
        dimList.push(npc);
      }
    }

    // Materials:
    // Dim: earthy muted linen/wool
    const dimMat = new MeshStandardMaterial({
      color: 0x56473a,
      roughness: 0.85,
      metalness: 0.05,
    });
    // Lit IGNIS: striking rich cinnabar crimson
    const litMat = new MeshStandardMaterial({
      color: 0x8e1f16,
      roughness: 0.65,
      metalness: 0.2,
      emissive: new Color(0x350804),
    });
    // Smith: soot-blackened leather apron
    const smithMat = new MeshStandardMaterial({
      color: 0x2e241c,
      roughness: 0.9,
      metalness: 0.1,
    });
    // Guard: iron plate armor & brigandine
    const guardMat = new MeshStandardMaterial({
      color: 0x444c52,
      roughness: 0.45,
      metalness: 0.5,
    });
    // Child: warm homespun cloth
    const childMat = new MeshStandardMaterial({
      color: 0x625042,
      roughness: 0.85,
    });

    const dimGeom = this.buildHumanoidGeometry('common', false);
    const litGeom = this.buildHumanoidGeometry('lit', true);
    const smithGeom = this.buildHumanoidGeometry('smith', false);
    const guardGeom = this.buildHumanoidGeometry('guard', false);
    const childGeom = this.buildHumanoidGeometry('child', false, 0.65);

    this.dimMesh = new InstancedMesh(dimGeom, dimMat, Math.max(1, dimList.length));
    this.dimMesh.castShadow = false;
    this.litMesh = new InstancedMesh(litGeom, litMat, Math.max(1, litList.length));
    this.litMesh.castShadow = false;
    this.smithMesh = new InstancedMesh(smithGeom, smithMat, Math.max(1, smithList.length));
    this.smithMesh.castShadow = false;
    this.guardMesh = new InstancedMesh(guardGeom, guardMat, Math.max(1, guardList.length));
    this.guardMesh.castShadow = false;
    this.childMesh = new InstancedMesh(childGeom, childMat, Math.max(1, childList.length));
    this.childMesh.castShadow = false;

    this.group.add(this.dimMesh);
    this.group.add(this.litMesh);
    this.group.add(this.smithMesh);
    this.group.add(this.guardMesh);
    this.group.add(this.childMesh);

    // Register each townsperson with their archetype index
    let dimIdx = 0, litIdx = 0, smithIdx = 0, guardIdx = 0, childIdx = 0;

    for (const npc of SINDR_TOWNSFOLK) {
      let category: 'dim' | 'lit' | 'smith' | 'guard' | 'child' = 'dim';
      let instanceIndex = 0;

      if (npc.role === 'guard') {
        category = 'guard';
        instanceIndex = guardIdx++;
      } else if (npc.role === 'smith') {
        category = 'smith';
        instanceIndex = smithIdx++;
      } else if (npc.role === 'child') {
        category = 'child';
        instanceIndex = childIdx++;
      } else if (npc.isLit) {
        category = 'lit';
        instanceIndex = litIdx++;
      } else {
        category = 'dim';
        instanceIndex = dimIdx++;
      }

      const startWp = npc.schedule.work;
      this.townsfolk.push({
        data: npc,
        position: new Vector3(startWp.x, startWp.y, startWp.z),
        targetPosition: new Vector3(startWp.x, startWp.y, startWp.z),
        targetFacing: startWp.facing,
        facing: startWp.facing,
        currentActivity: 'work',
        walking: false,
        feelingScore: 50,
        category,
        instanceIndex,
        walkCycle: Math.random() * Math.PI * 2,
      });
    }

    this.updateInstancedMatrices(0);
  }

  private spawnCustomBodies(): void {
    for (const npc of SINDR_TOWNSFOLK) {
      const startWp = npc.schedule.work;
      const obj = customBodyFactory ? customBodyFactory(npc) : new Group();
      obj.position.set(startWp.x, startWp.y, startWp.z);
      obj.rotation.y = startWp.facing;
      this.group.add(obj);
      this.customBodies.push(obj);

      this.townsfolk.push({
        data: npc,
        object: obj,
        position: new Vector3(startWp.x, startWp.y, startWp.z),
        targetPosition: new Vector3(startWp.x, startWp.y, startWp.z),
        targetFacing: startWp.facing,
        facing: startWp.facing,
        currentActivity: 'work',
        walking: false,
        feelingScore: 50,
        category: 'dim',
        instanceIndex: 0,
        walkCycle: 0,
      });
    }
  }

  update(delta: number, minute: number, playerPos: Vector3): void {
    void playerPos;

    for (const person of this.townsfolk) {
      // 1. Check schedule based on world clock minute
      const targetWp = getTownspersonPosition(minute, person.data);
      person.targetPosition.set(targetWp.x, targetWp.y, targetWp.z);
      person.targetFacing = targetWp.facing;

      // 2. Smooth locomotion / movement toward schedule waypoint
      const dx = person.targetPosition.x - person.position.x;
      const dz = person.targetPosition.z - person.position.z;
      const distSq = dx * dx + dz * dz;

      if (distSq > 0.08) {
        person.walking = true;
        const moveDist = Math.min(Math.sqrt(distSq), 1.8 * delta); // 1.8 m/s walk speed
        const angle = Math.atan2(dx, dz);
        person.facing = angle;
        person.position.x += Math.sin(angle) * moveDist;
        person.position.z += Math.cos(angle) * moveDist;
        person.position.y = targetWp.y;
        person.walkCycle += delta * 7.5;
      } else {
        person.walking = false;
        person.facing = person.targetFacing;
        person.position.x = targetWp.x;
        person.position.z = targetWp.z;
        person.position.y = targetWp.y;
        person.walkCycle += delta * 1.8;
      }

      if (person.object) {
        person.object.position.copy(person.position);
        person.object.rotation.y = person.facing;
      }
    }

    if (!customBodyFactory) {
      this.updateInstancedMatrices(delta);
    }
  }

  private updateInstancedMatrices(delta: number): void {
    void delta;
    const mat = new Matrix4();
    const pos = new Vector3();
    const quat = new Quaternion();
    const scale = new Vector3(1, 1, 1);

    for (const person of this.townsfolk) {
      // Apply walking bob or idle breathing
      const bobY = person.walking
        ? Math.abs(Math.sin(person.walkCycle)) * 0.04
        : Math.sin(person.walkCycle) * 0.015;

      pos.set(person.position.x, person.position.y + bobY, person.position.z);

      // Sway angle slightly on walk
      const sway = person.walking ? Math.sin(person.walkCycle) * 0.04 : 0;
      quat.setFromAxisAngle(new Vector3(0, 1, 0), person.facing + sway);

      mat.compose(pos, quat, scale);

      if (person.category === 'dim') {
        this.dimMesh.setMatrixAt(person.instanceIndex, mat);
      } else if (person.category === 'lit') {
        this.litMesh.setMatrixAt(person.instanceIndex, mat);
      } else if (person.category === 'smith') {
        this.smithMesh.setMatrixAt(person.instanceIndex, mat);
      } else if (person.category === 'guard') {
        this.guardMesh.setMatrixAt(person.instanceIndex, mat);
      } else if (person.category === 'child') {
        this.childMesh.setMatrixAt(person.instanceIndex, mat);
      }
    }

    if (this.dimMesh) this.dimMesh.instanceMatrix.needsUpdate = true;
    if (this.litMesh) this.litMesh.instanceMatrix.needsUpdate = true;
    if (this.smithMesh) this.smithMesh.instanceMatrix.needsUpdate = true;
    if (this.guardMesh) this.guardMesh.instanceMatrix.needsUpdate = true;
    if (this.childMesh) this.childMesh.instanceMatrix.needsUpdate = true;
  }

  getNearestTownsperson(heroPos: Vector3, maxRadius = 3.5): LiveTownsperson | null {
    let nearest: LiveTownsperson | null = null;
    let minDist = maxRadius;
    for (const person of this.townsfolk) {
      const dist = Math.hypot(heroPos.x - person.position.x, heroPos.z - person.position.z);
      if (dist < minDist) {
        minDist = dist;
        nearest = person;
      }
    }
    return nearest;
  }

  dispose(): void {
    for (const b of this.customBodies) {
      this.group.remove(b);
    }
    this.customBodies.length = 0;
    this.townsfolk.length = 0;

    if (this.dimMesh) {
      this.dimMesh.geometry.dispose();
      (this.dimMesh.material as MeshStandardMaterial).dispose();
    }
    if (this.litMesh) {
      this.litMesh.geometry.dispose();
      (this.litMesh.material as MeshStandardMaterial).dispose();
    }
    if (this.smithMesh) {
      this.smithMesh.geometry.dispose();
      (this.smithMesh.material as MeshStandardMaterial).dispose();
    }
    if (this.guardMesh) {
      this.guardMesh.geometry.dispose();
      (this.guardMesh.material as MeshStandardMaterial).dispose();
    }
    if (this.childMesh) {
      this.childMesh.geometry.dispose();
      (this.childMesh.material as MeshStandardMaterial).dispose();
    }

    this.group.clear();
    this.scene.remove(this.group);
  }
}
