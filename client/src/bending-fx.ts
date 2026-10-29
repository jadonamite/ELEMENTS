import {
  AdditiveBlending,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  type Scene,
  Vector3,
} from 'three';

interface Shockwave {
  mesh: Mesh;
  elapsed: number;
  duration: number;
  maxRadius: number;
}

interface FlamePillar {
  mesh: Mesh;
  elapsed: number;
  duration: number;
  maxHeight: number;
}

/**
 * Visual effects for elemental bending: expanding fire rings on ground pound,
 * rising flame pillars on uppercuts, and ignition bursts.
 */
export class BendingEffects {
  private readonly root = new Group();
  private readonly shockwaves: Shockwave[] = [];
  private readonly pillars: FlamePillar[] = [];

  constructor(private readonly scene: Scene) {
    this.root.name = 'BendingEffects';
    this.scene.add(this.root);
  }

  /** Triggers an expanding crimson fire ring on the ground. */
  spawnGroundPound(origin: Vector3): void {
    const geo = new RingGeometry(0.2, 0.65, 32);
    geo.rotateX(-Math.PI / 2);
    const mat = new MeshBasicMaterial({
      color: 0xff3b0a,
      blending: AdditiveBlending,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const mesh = new Mesh(geo, mat);
    mesh.position.set(origin.x, 0.05, origin.z);
    this.root.add(mesh);
    this.shockwaves.push({ mesh, elapsed: 0, duration: 0.55, maxRadius: 4.8 });
  }

  /** Triggers a rising vertical pillar of fire on an uppercut. */
  spawnUppercutPillar(origin: Vector3): void {
    const geo = new CylinderGeometry(0.35, 0.7, 3.2, 16, 1, true);
    const mat = new MeshBasicMaterial({
      color: 0xff4810,
      blending: AdditiveBlending,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    const mesh = new Mesh(geo, mat);
    mesh.position.set(origin.x, 1.6, origin.z);
    this.root.add(mesh);
    this.pillars.push({ mesh, elapsed: 0, duration: 0.45, maxHeight: 3.5 });
  }

  /** Update active effects each frame. */
  update(delta: number): void {
    // Update shockwaves
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i]!;
      sw.elapsed += delta;
      const t = Math.min(1, sw.elapsed / sw.duration);
      const scale = 1 + t * sw.maxRadius;
      sw.mesh.scale.set(scale, 1, scale);
      const mat = sw.mesh.material as MeshBasicMaterial;
      mat.opacity = (1 - t) * 0.9;
      if (t >= 1) {
        this.root.remove(sw.mesh);
        sw.mesh.geometry.dispose();
        mat.dispose();
        this.shockwaves.splice(i, 1);
      }
    }

    // Update flame pillars
    for (let i = this.pillars.length - 1; i >= 0; i--) {
      const p = this.pillars[i]!;
      p.elapsed += delta;
      const t = Math.min(1, p.elapsed / p.duration);
      p.mesh.scale.set(1 + t * 0.5, 1 + t * 0.8, 1 + t * 0.5);
      p.mesh.position.y = 1.6 + t * 0.8;
      const mat = p.mesh.material as MeshBasicMaterial;
      mat.opacity = (1 - t) * 0.85;
      if (t >= 1) {
        this.root.remove(p.mesh);
        p.mesh.geometry.dispose();
        mat.dispose();
        this.pillars.splice(i, 1);
      }
    }
  }

  dispose(): void {
    for (const sw of this.shockwaves) {
      sw.mesh.geometry.dispose();
      (sw.mesh.material as MeshBasicMaterial).dispose();
    }
    for (const p of this.pillars) {
      p.mesh.geometry.dispose();
      (p.mesh.material as MeshBasicMaterial).dispose();
    }
    this.shockwaves.length = 0;
    this.pillars.length = 0;
    this.scene.remove(this.root);
  }
}
