import RAPIER from '@dimforge/rapier3d-compat';
import { BoxGeometry, ConeGeometry, Group, IcosahedronGeometry, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { surfaceColor } from '../world/materials.js';
import type { HoundDamageResult, HoundQuarry } from './hound.js';

type BullState = 'stalk' | 'windup' | 'charge' | 'sweep-windup' | 'sweep' | 'recover' | 'death';

/** A heavy, solitary basalt beast. Recovery opens the molten seam behind its shoulders. */
export class SlagBull {
  readonly kind = 'slag_bull';
  readonly model = new Group();
  readonly position = new Vector3();
  readonly controller = this;
  readonly maxHealth = 460;
  readonly height = 2.4;
  readonly radius = 1.15;
  health = this.maxHealth;
  facing = 0;
  state: BullState = 'stalk';
  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly character: RAPIER.KinematicCharacterController;
  private readonly torso = new Group();
  private readonly head = new Group();
  private readonly legs: Group[] = [];
  private readonly stone = new MeshStandardMaterial({ color: surfaceColor('basalt_rock_face'), roughness: 0.95, flatShading: true });
  private readonly horn = new MeshStandardMaterial({ color: 0x44352c, roughness: 0.7, flatShading: true });
  private readonly lava = new MeshStandardMaterial({ color: 0xff5918, emissive: 0xff3a06, emissiveIntensity: 2.5, roughness: 0.65 });
  private readonly seamMaterial = new MeshStandardMaterial({ color: 0x5b2410, emissive: 0xff6b0c, emissiveIntensity: 0.5 });
  private readonly geometries = [new IcosahedronGeometry(1, 1), new BoxGeometry(1, 1, 1), new ConeGeometry(1, 1, 6)];
  private readonly movement = new Vector3();
  private readonly before = new Vector3();
  private readonly seam = new Vector3();
  private timer = 0;
  private clock = 0;
  private attackHit = false;
  private verticalSpeed = 0;
  private flash = 0;
  private turn = 1;
  private disposed = false;

  constructor(private readonly world: RAPIER.World, spawn: { x: number; y: number; z: number }) {
    this.position.set(spawn.x, spawn.y, spawn.z);
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + 1.2, spawn.z));
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(0.25, 0.95), this.body);
    this.character = world.createCharacterController(0.03);
    this.character.setSlideEnabled(true);
    this.character.enableSnapToGround(0.4);
    this.character.setMaxSlopeClimbAngle(Math.PI / 5);
    this.character.setMinSlopeSlideAngle(Math.PI / 4);
    this.character.enableAutostep(0.3, 0.6, false);
    this.character.setApplyImpulsesToDynamicBodies(false);
    this.world.propagateModifiedBodyPositionsToColliders();
    this.model.name = 'Slag Bull';
    this.model.add(this.torso);
    const mesh = (parent: Group, geometry: number, material: MeshStandardMaterial,
      x: number, y: number, z: number, sx: number, sy: number, sz: number): Mesh => {
      const part = new Mesh(this.geometries[geometry]!, material);
      part.position.set(x, y, z); part.scale.set(sx, sy, sz);
      part.castShadow = true; part.receiveShadow = true; parent.add(part);
      return part;
    };
    mesh(this.torso, 0, this.stone, 0, 1.5, -0.15, 0.95, 0.85, 1.45);
    mesh(this.torso, 0, this.stone, 0, 1.9, 0.65, 1.05, 0.9, 0.85);
    this.head.position.set(0, 1.65, 1.1); this.torso.add(this.head);
    mesh(this.head, 0, this.stone, 0, 0, 0.35, 0.7, 0.65, 0.75);
    mesh(this.head, 1, this.stone, 0, -0.3, 0.9, 0.85, 0.55, 0.6);
    for (const side of [-1, 1]) {
      const horn = mesh(this.head, 2, this.horn, side * 0.85, 0.4, 0.45, 0.25, 1.1, 0.25);
      horn.rotation.z = -side * 0.95;
      mesh(this.head, 0, this.lava, side * 0.53, 0.12, 0.78, 0.1, 0.09, 0.12);
      for (const z of [-0.95, 0.8]) {
        const leg = new Group(); leg.position.set(side * 0.68, 1.1, z); this.torso.add(leg); this.legs.push(leg);
        mesh(leg, 0, this.stone, 0, -0.4, 0, 0.32, 0.65, 0.37);
        mesh(leg, 1, this.horn, 0, -0.92, 0.05, 0.45, 0.3, 0.55);
        mesh(leg, 1, this.lava, side * 0.22, -0.6, 0, 0.035, 0.3, 0.12);
      }
      mesh(this.torso, 1, this.seamMaterial, side * 0.88, 1.55, -0.45, 0.045, 0.65, 0.7).rotation.x = 0.25;
    }
    for (let i = 0; i < 5; i++) {
      mesh(this.torso, 0, this.stone, 0, 2.15, 0.6 - i * 0.45, 0.45, 0.35 + i * 0.03, 0.3);
      mesh(this.torso, 1, this.lava, 0, 2.05, 0.45 - i * 0.45, 0.07, 0.06, 0.3);
    }
    mesh(this.torso, 1, this.seamMaterial, 0, 1.65, -1.43, 0.4, 0.75, 0.045);
    const tail = mesh(this.torso, 2, this.horn, 0, 1.1, -1.75, 0.13, 0.9, 0.13);
    tail.rotation.x = -1.2;
    this.model.position.copy(this.position);
  }

  get alive(): boolean { return this.health > 0; }

  private enter(state: BullState): void { this.state = state; this.timer = 0; this.attackHit = false; }

  hit(amount: number, at: Vector3, origin: Vector3, element?: string): HoundDamageResult {
    if (!this.alive) return { damage: 0, isWeakSpot: false, stagger: false, staggerDuration: 0 };
    const rear = (origin.x - this.position.x) * Math.sin(this.facing) + (origin.z - this.position.z) * Math.cos(this.facing) < -0.3;
    this.seam.set(-Math.sin(this.facing), 1.65, -Math.cos(this.facing)).add(this.position);
    const weak = this.state === 'recover' && (rear || this.seam.distanceToSquared(at) < 0.7 * 0.7);
    const elementScale = element === 'IGNIS' ? 0.3 : element === 'AQUES' ? 1.4 : 1;
    const damage = Math.max(0, Math.round(amount * elementScale * (weak ? 2.5 : 0.6)));
    this.health = Math.max(0, this.health - damage);
    this.flash = 0.12;
    if (!this.alive) { this.enter('death'); this.collider.setEnabled(false); }
    return { damage, isWeakSpot: weak, stagger: false, staggerDuration: 0 };
  }

  update(dt: number, quarry: HoundQuarry): void {
    if (this.disposed) return;
    this.timer += dt; this.clock += dt; this.flash = Math.max(0, this.flash - dt);
    const dx = quarry.position.x - this.position.x, dz = quarry.position.z - this.position.z;
    const distance = Math.hypot(dx, dz), heading = Math.atan2(dx, dz);
    let speed = 0, moveYaw = this.facing;
    if (this.alive && quarry.alive) {
      switch (this.state) {
        case 'stalk': {
          const angle = Math.atan2(Math.sin(heading - this.facing), Math.cos(heading - this.facing));
          this.facing += Math.max(-dt * 1.4, Math.min(dt * 1.4, angle));
          moveYaw = heading + (distance < 6 ? this.turn * 1.05 : 0);
          speed = distance > 3 ? 2.2 : 0;
          if (this.timer > 2 && Math.abs(angle) < 0.3) {
            this.enter(distance < 4.6 ? 'sweep-windup' : 'windup');
          }
          break;
        }
        case 'windup': if (this.timer >= 1.25) this.enter('charge'); break;
        case 'charge':
          speed = 12;
          if (!this.attackHit && distance < 2.1 && Math.abs(quarry.position.y - this.position.y) < 2.6) {
            this.attackHit = true; quarry.takeHit?.(36, this.position);
          }
          if (this.timer >= 1.5) this.enter('recover');
          break;
        case 'sweep-windup': if (this.timer >= 0.95) this.enter('sweep'); break;
        case 'sweep':
          this.facing += this.turn * dt * 4.5;
          if (!this.attackHit && this.timer >= 0.18 && distance < 3.8
            && Math.abs(quarry.position.y - this.position.y) < 2.6
            && Math.cos(heading - this.facing) > -0.2) {
            this.attackHit = true; quarry.takeHit?.(24, this.position);
          }
          if (this.timer >= 0.65) this.enter('recover');
          break;
        case 'recover': if (this.timer >= 3) { this.turn *= -1; this.enter('stalk'); } break;
      }
    }
    if (this.alive) {
      if (!quarry.alive && this.state !== 'stalk') this.enter('stalk');
      this.before.copy(this.position);
      const previous = this.body.translation();
      this.verticalSpeed -= 24 * dt;
      this.movement.set(Math.sin(moveYaw) * speed * dt, this.verticalSpeed * dt, Math.cos(moveYaw) * speed * dt);
      this.character.computeColliderMovement(this.collider, this.movement);
      const moved = this.character.computedMovement();
      if (this.character.computedGrounded()) this.verticalSpeed = 0;
      this.body.setNextKinematicTranslation({ x: previous.x + moved.x, y: previous.y + moved.y, z: previous.z + moved.z });
      this.position.set(previous.x + moved.x, previous.y + moved.y - 1.2, previous.z + moved.z);
      if (this.state === 'charge' && this.timer > 0.15 && this.before.distanceToSquared(this.position) < speed * speed * dt * dt * 0.12) this.enter('recover');
    }
    const winding = this.state === 'windup' || this.state === 'sweep-windup';
    this.lava.emissiveIntensity = this.flash > 0 ? 7 : winding ? 3 + Math.sin(this.timer * 20) * 1.5 : 2;
    this.seamMaterial.emissiveIntensity = this.state === 'recover' ? 5 : 0.4;
    this.head.rotation.x = winding || this.state === 'charge' ? 0.45 : this.state === 'recover' ? 0.2 : 0;
    this.head.rotation.y = this.state === 'sweep-windup' ? -this.turn * 0.6 : 0;
    for (let i = 0; i < this.legs.length; i++) this.legs[i]!.rotation.x = speed > 0 ? Math.sin(this.clock * (speed > 4 ? 13 : 5) + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.35 : 0;
    this.torso.position.y = speed > 0 ? Math.abs(Math.sin(this.clock * 6)) * 0.05 : 0;
    this.torso.rotation.z = this.alive ? 0 : -Math.min(1.45, this.timer * 1.3);
    this.model.position.copy(this.position); this.model.rotation.y = this.facing;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.world.removeCharacterController(this.character); this.world.removeRigidBody(this.body);
    this.geometries.forEach(geometry => geometry.dispose());
    [this.stone, this.horn, this.lava, this.seamMaterial].forEach(material => material.dispose());
    this.model.removeFromParent();
  }
}
