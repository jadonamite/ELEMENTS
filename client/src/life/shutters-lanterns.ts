import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface WindowShutterDef {
  x: number;
  y: number;
  z: number;
  yaw: number;
  w: number;
  h: number;
}

export interface LanternDef {
  x: number;
  y: number;
  z: number;
  hanging?: boolean;
}

export class ShuttersAndLanterns {
  group = new Group();

  private leftShuttersMesh: InstancedMesh;
  private rightShuttersMesh: InstancedMesh;
  private shutterDefs: WindowShutterDef[] = [];
  private lastShutterProgress = -1;

  private lanternPostsMesh: InstancedMesh | null = null;
  private lanternGlassMesh: InstancedMesh;
  private lanternDefs: LanternDef[] = [];
  private glassMaterial: MeshStandardMaterial;
  private haloMaterial: MeshBasicMaterial;
  private lastLanternGlow = -1;

  // Optimized warm dusk point light for market square illumination
  private marketLight: PointLight;

  private robberSpawned = false;
  private robberRef: unknown = null;

  constructor() {
    // 1. Windows with authentic shutters on town houses along main street and square
    this.shutterDefs = [
      // South Square House 1 (x: 109, z: 22, front facing -z at z = 17.0)
      { x: 107.2, y: 2.15, z: 16.86, yaw: Math.PI, w: 0.88, h: 1.18 },
      { x: 111.0, y: 2.15, z: 16.86, yaw: Math.PI, w: 0.88, h: 1.18 },
      { x: 109.2, y: 5.25, z: 16.46, yaw: Math.PI, w: 0.88, h: 1.18 },
      // South Square House 2 (x: 140, z: 22, front facing -z at z = 17.0) - DIRECTLY IN MARKET STANDPOINT
      { x: 136.8, y: 2.15, z: 16.86, yaw: Math.PI, w: 0.88, h: 1.18 },
      { x: 141.5, y: 2.15, z: 16.86, yaw: Math.PI, w: 0.88, h: 1.18 },
      { x: 138.8, y: 5.25, z: 16.46, yaw: Math.PI, w: 0.88, h: 1.18 },
      // West wall of South Square House 2 (facing -X toward hero/camera at x = 134.85)
      { x: 134.82, y: 2.15, z: 19.5, yaw: -Math.PI * 0.5, w: 0.88, h: 1.18 },
      { x: 134.82, y: 4.85, z: 19.5, yaw: -Math.PI * 0.5, w: 0.88, h: 1.18 },
      // North Square Inn (x: 109, z: -22, front facing +z at z = -17.0)
      { x: 107.2, y: 2.15, z: -16.86, yaw: 0, w: 0.88, h: 1.18 },
      { x: 111.0, y: 2.15, z: -16.86, yaw: 0, w: 0.88, h: 1.18 },
      { x: 108.5, y: 5.25, z: -16.46, yaw: 0, w: 0.88, h: 1.18 },
      // North Square House (x: 140, z: -22, front facing +z at z = -17.0)
      { x: 137.5, y: 2.15, z: -16.86, yaw: 0, w: 0.88, h: 1.18 },
      // Main Street Houses (North side at z = -6.0 facing +Z)
      { x: 58.0, y: 2.15, z: -5.98, yaw: 0, w: 0.85, h: 1.15 },
      { x: 72.0, y: 2.15, z: -5.98, yaw: 0, w: 0.85, h: 1.15 },
      { x: 88.0, y: 2.15, z: -5.98, yaw: 0, w: 0.85, h: 1.15 },
      // Main Street Houses (South side at z = +6.0 facing -Z)
      { x: 58.0, y: 2.15, z: 5.98, yaw: Math.PI, w: 0.85, h: 1.15 },
      { x: 94.0, y: 2.15, z: 5.98, yaw: Math.PI, w: 0.85, h: 1.15 },
    ];

    const shutterMat = new MeshStandardMaterial({
      color: 0x2e1e14,
      roughness: 0.9,
      metalness: 0.08,
    });
    // Single shutter panel: hinge sits at local origin x = 0
    const panelGeomParts = [
      new BoxGeometry(0.44, 1.16, 0.04).translate(0.22, 0, 0),
      new BoxGeometry(0.42, 0.08, 0.055).translate(0.22, 0.45, 0.01),
      new BoxGeometry(0.42, 0.08, 0.055).translate(0.22, -0.45, 0.01),
      new BoxGeometry(0.08, 0.08, 0.06).translate(0.38, 0, 0.015), // Iron latch
    ];
    const combinedPanel = mergeGeometries(panelGeomParts) ?? new BoxGeometry(0.44, 1.16, 0.04).translate(0.22, 0, 0);

    this.leftShuttersMesh = new InstancedMesh(combinedPanel, shutterMat, this.shutterDefs.length);
    this.leftShuttersMesh.castShadow = false;
    this.rightShuttersMesh = new InstancedMesh(combinedPanel, shutterMat, this.shutterDefs.length);
    this.rightShuttersMesh.castShadow = false;

    this.group.add(this.leftShuttersMesh);
    this.group.add(this.rightShuttersMesh);

    // 2. Lanterns positioned in square, stalls, forge lane, and street
    this.lanternDefs = [
      // Market square stall hanging lanterns (DIRECTLY IN MARKET STANDPOINT VIEW)
      { x: 113.0, y: 2.45, z: 6.8, hanging: true },
      { x: 137.0, y: 2.45, z: 6.8, hanging: true },
      { x: 113.0, y: 2.45, z: -6.8, hanging: true },
      { x: 137.0, y: 2.45, z: -6.8, hanging: true },
      // Slag well iron arch lantern
      { x: 125.0, y: 3.4, z: 0, hanging: true },
      // Square corner street posts
      { x: 108.0, y: 0, z: 12.0, hanging: false },
      { x: 125.0, y: 0, z: 13.5, hanging: false },
      { x: 142.0, y: 0, z: 12.0, hanging: false },
      { x: 106.0, y: 0, z: -16.5, hanging: false },
      { x: 112.0, y: 0, z: -16.5, hanging: false },
      { x: 142.0, y: 0, z: -12.0, hanging: false },
      // Main street between shrine and town
      { x: 36.0, y: 0, z: 0, hanging: false },
      { x: 54.0, y: 0, z: -4.5, hanging: false },
      { x: 70.0, y: 0, z: 4.5, hanging: false },
      { x: 88.0, y: 0, z: -4.5, hanging: false },
      { x: 160.0, y: 0, z: 4.5, hanging: false },
      { x: 175.0, y: 0, z: -4.5, hanging: false },
      { x: 190.0, y: 0, z: -42.0, hanging: false },
    ];

    // Build combined post and cage fixture geometry into a SINGLE draw call
    const postMat = new MeshStandardMaterial({
      color: 0x1e1915,
      roughness: 0.85,
      metalness: 0.6,
    });
    const postGeomParts = [
      new CylinderGeometry(0.08, 0.11, 2.7, 8).translate(0, 1.35, 0),
      new BoxGeometry(0.55, 0.08, 0.08).translate(0.22, 2.65, 0),
      new CylinderGeometry(0.18, 0.14, 0.10, 6).translate(0.48, 2.65, 0),
      new CylinderGeometry(0.015, 0.015, 0.22, 6).translate(0.48, 2.50, 0), // Chain link
      // Iron cage fixture
      new CylinderGeometry(0.04, 0.18, 0.12, 6).translate(0.48, 2.60, 0),
      new CylinderGeometry(0.16, 0.14, 0.05, 6).translate(0.48, 2.18, 0),
      new BoxGeometry(0.025, 0.38, 0.025).translate(0.48 + 0.12, 2.38, 0.12),
      new BoxGeometry(0.025, 0.38, 0.025).translate(0.48 - 0.12, 2.38, 0.12),
      new BoxGeometry(0.025, 0.38, 0.025).translate(0.48 + 0.12, 2.38, -0.12),
      new BoxGeometry(0.025, 0.38, 0.025).translate(0.48 - 0.12, 2.38, -0.12),
    ];
    const postCombined = mergeGeometries(postGeomParts);
    if (postCombined) {
      this.lanternPostsMesh = new InstancedMesh(postCombined, postMat, this.lanternDefs.length);
      this.group.add(this.lanternPostsMesh);
    }

    // Glass lamp flame core
    this.glassMaterial = new MeshStandardMaterial({
      color: 0xff8820,
      emissive: new Color(0xff5500),
      emissiveIntensity: 0,
      roughness: 0.15,
      metalness: 0.1,
    });
    const glassGeom = new CylinderGeometry(0.11, 0.09, 0.30, 8);
    this.lanternGlassMesh = new InstancedMesh(glassGeom, this.glassMaterial, this.lanternDefs.length);
    this.group.add(this.lanternGlassMesh);

    // Warm glow halo sphere
    this.haloMaterial = new MeshBasicMaterial({
      color: 0xffaa33,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });

    // Warm point light for market square illumination at dusk
    this.marketLight = new PointLight(0xff7718, 0, 14, 2.0);
    this.marketLight.position.set(125.0, 3.2, 0);

    // Initialize static lantern transforms ONCE
    this.setupStaticLanternTransforms();

    // Initial update for shutters
    this.update(0, 0);
  }

  private setupStaticLanternTransforms(): void {
    const mat = new Matrix4();
    const pos = new Vector3();
    const quat = new Quaternion();
    const scale = new Vector3(1, 1, 1);

    if (this.lanternPostsMesh) {
      for (let i = 0; i < this.lanternDefs.length; i++) {
        const l = this.lanternDefs[i]!;
        if (!l.hanging) {
          pos.set(l.x, l.y, l.z);
        } else {
          pos.set(l.x, -50, l.z); // Hide post under ground for hanging stall lanterns
        }
        mat.compose(pos, quat, scale);
        this.lanternPostsMesh.setMatrixAt(i, mat);
      }
      this.lanternPostsMesh.instanceMatrix.needsUpdate = true;
    }

    for (let i = 0; i < this.lanternDefs.length; i++) {
      const l = this.lanternDefs[i]!;
      const lampY = l.hanging ? l.y : l.y + 2.45;
      const lampX = l.hanging ? l.x : l.x + 0.48;
      const lampZ = l.z;

      pos.set(lampX, lampY, lampZ);
      mat.compose(pos, quat, scale);
      this.lanternGlassMesh.setMatrixAt(i, mat);
    }
    this.lanternGlassMesh.instanceMatrix.needsUpdate = true;
  }

  update(minute: number, nightFactor: number): void {
    void minute;
    // Shutter swing progress: 0 (day = open) to 1 (dusk/night = closed)
    const shutterProgress = Math.min(1.0, Math.max(0.0, (nightFactor - 0.05) / 0.22));

    // 1. Update shutters only when changed
    if (Math.abs(shutterProgress - this.lastShutterProgress) > 0.0005) {
      this.lastShutterProgress = shutterProgress;
      const mat = new Matrix4();
      const pos = new Vector3();
      const scale = new Vector3(1, 1, 1);

      for (let i = 0; i < this.shutterDefs.length; i++) {
        const def = this.shutterDefs[i]!;
        const openYaw = Math.PI * 0.48;
        const leftAngle = (1.0 - shutterProgress) * -openYaw;
        const rightAngle = (1.0 - shutterProgress) * openYaw;

        const baseQuat = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), def.yaw);

        const leftOffset = new Vector3(-def.w / 2, 0, 0).applyQuaternion(baseQuat);
        pos.set(def.x + leftOffset.x, def.y, def.z + leftOffset.z);
        const leftRot = baseQuat.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), leftAngle));
        mat.compose(pos, leftRot, scale);
        this.leftShuttersMesh.setMatrixAt(i, mat);

        const rightOffset = new Vector3(def.w / 2, 0, 0).applyQuaternion(baseQuat);
        pos.set(def.x + rightOffset.x, def.y, def.z + rightOffset.z);
        const rightRot = baseQuat
          .clone()
          .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI + rightAngle));
        mat.compose(pos, rightRot, scale);
        this.rightShuttersMesh.setMatrixAt(i, mat);
      }

      this.leftShuttersMesh.instanceMatrix.needsUpdate = true;
      this.rightShuttersMesh.instanceMatrix.needsUpdate = true;
    }

    // 2. Update lanterns glow
    const lanternGlow = Math.min(1.0, Math.max(0.0, (nightFactor - 0.04) / 0.20));

    if (Math.abs(lanternGlow - this.lastLanternGlow) > 0.005) {
      this.lastLanternGlow = lanternGlow;
      this.glassMaterial.emissiveIntensity = lanternGlow * 3.2;
      this.glassMaterial.color.setHex(lanternGlow > 0.05 ? 0xffaa33 : 0x221a14);

      if (lanternGlow > 0.05) {
        if (!this.marketLight.parent) this.group.add(this.marketLight);
        this.marketLight.intensity = lanternGlow * 12;
      } else {
        if (this.marketLight.parent) this.group.remove(this.marketLight);
      }
    }

    // 3. Robbers at night
    if (nightFactor > 0.8) {
      if (!this.robberSpawned) {
        this.spawnNightRobbers();
        this.robberSpawned = true;
      }
    } else if (nightFactor < 0.2) {
      if (this.robberSpawned) {
        this.despawnNightRobbers();
        this.robberSpawned = false;
      }
    }
  }

  private spawnNightRobbers(): void {
    const win = window as unknown as { creatures?: { spawnRobber?: (x: number, z: number) => unknown } };
    if (typeof win.creatures?.spawnRobber === 'function') {
      try {
        this.robberRef = win.creatures.spawnRobber(160, 20);
        return;
      } catch {
        // Fall back to stub
      }
    }
  }

  private despawnNightRobbers(): void {
    if (this.robberRef && typeof (this.robberRef as { despawn?: () => void }).despawn === 'function') {
      try {
        (this.robberRef as { despawn: () => void }).despawn();
      } catch {}
      this.robberRef = null;
    }
  }

  dispose(): void {
    this.leftShuttersMesh.geometry.dispose();
    this.rightShuttersMesh.geometry.dispose();
    (this.leftShuttersMesh.material as MeshStandardMaterial).dispose();

    if (this.lanternPostsMesh) {
      this.lanternPostsMesh.geometry.dispose();
      (this.lanternPostsMesh.material as MeshStandardMaterial).dispose();
    }
    this.lanternGlassMesh.geometry.dispose();
    this.glassMaterial.dispose();
    this.haloMaterial.dispose();

    this.group.clear();
  }
}
