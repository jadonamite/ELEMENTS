import { Mesh, type Object3D, type Vector3 } from 'three';

/** A standing body overlapping the view segment to the hero's torso, including different street levels. */
export function hidesHero(eye: Vector3, hero: Vector3, feet: Vector3, height = 1.8): boolean {
  const dx = hero.x - eye.x, dz = hero.z - eye.z;
  const length = dx * dx + dz * dz;
  if (length < 0.01) return false;
  const t = ((feet.x - eye.x) * dx + (feet.z - eye.z) * dz) / length;
  if (t <= 0.02 || t >= 0.98) return false;
  const x = eye.x + dx * t - feet.x, z = eye.z + dz * t - feet.z;
  const y = eye.y + (hero.y + 1.1 - eye.y) * t;
  return x * x + z * z < 0.62 ** 2 && y > feet.y + 0.1 && y < feet.y + height;
}

/** Per-person opaque screen-door fade. Each material keeps its existing skin/cloth shader. */
export class CrowdOcclusion {
  readonly uniform = { value: 1 };
  private readonly materials = new Set<import('three').Material>();

  attach(root: Object3D): void {
    root.traverse(node => {
      if (!(node as Mesh).isMesh) return;
      const mesh = node as Mesh;
      const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const materials = source.map(original => {
        const material = original.clone();
        const compile = original.onBeforeCompile;
        const key = original.customProgramCacheKey();
        material.onBeforeCompile = (shader, renderer) => {
          compile.call(material, shader, renderer);
          shader.uniforms.uCrowdVisible = this.uniform;
          shader.fragmentShader = 'uniform float uCrowdVisible;\n' + shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
            float crowdThreshold = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
            if (crowdThreshold > uCrowdVisible) discard;`);
        };
        material.customProgramCacheKey = () => `${key}:crowd-occlusion`;
        this.materials.add(material);
        return material;
      });
      mesh.material = Array.isArray(mesh.material) ? materials : materials[0]!;
    });
  }

  update(blocking: boolean, delta: number): void {
    const target = blocking ? 0.04 : 1;
    this.uniform.value += (target - this.uniform.value) * (1 - Math.exp(-delta / (blocking ? 0.08 : 0.18)));
  }

  dispose(): void { for (const material of this.materials) material.dispose(); this.materials.clear(); }
}
