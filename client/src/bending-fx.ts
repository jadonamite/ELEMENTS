import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  type Scene,
  Vector3,
} from 'three';
import type { Element } from '../../shared/src/index.js';

export type BendingType = Element | 'HUSH';

const ELEMENT_COLORS: Record<BendingType, { shockwave: number; pillar: number }> = {
  IGNIS: { shockwave: 0xff3b0a, pillar: 0xff4810 },
  AQUES: { shockwave: 0x0088ff, pillar: 0x22bbff },
  TERRA: { shockwave: 0xd89524, pillar: 0xa56818 },
  AURA: { shockwave: 0xe2f0f8, pillar: 0xcce8ff },
  HUSH: { shockwave: 0x8877aa, pillar: 0x9988cc },
};

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
 * Visual effects for elemental bending across all four elements and Hush relics:
 * expanding shockwave rings on ground pound and rising geysers/pillars on uppercuts.
 */
export class BendingEffects {
  private readonly root = new Group();
  private readonly shockwaves: Shockwave[] = [];
  private readonly pillars: FlamePillar[] = [];

  constructor(private readonly scene: Scene) {
    this.root.name = 'BendingEffects';
    this.scene.add(this.root);
  }

  /** Triggers an expanding shockwave ring on the ground. */
  spawnGroundPound(origin: Vector3, element: BendingType = 'IGNIS'): void {
    const geo = new RingGeometry(0.2, 0.65, 32);
    geo.rotateX(-Math.PI / 2);
    const colors = ELEMENT_COLORS[element] ?? ELEMENT_COLORS.IGNIS;
    const mat = new MeshBasicMaterial({
      color: colors.shockwave,
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

  /** Triggers a rising vertical pillar of elemental force on an uppercut. */
  spawnUppercutPillar(origin: Vector3, element: BendingType = 'IGNIS'): void {
    const geo = new CylinderGeometry(0.35, 0.7, 3.2, 16, 1, true);
    const colors = ELEMENT_COLORS[element] ?? ELEMENT_COLORS.IGNIS;
    const mat = new MeshBasicMaterial({
      color: colors.pillar,
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
