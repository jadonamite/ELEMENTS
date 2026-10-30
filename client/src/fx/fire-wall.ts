import { AdditiveBlending, CylinderGeometry, DoubleSide, Mesh, ShaderMaterial, type Object3D } from 'three';
import { FX_COMMON_GLSL } from './shaders.js';

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uSeed;
uniform float uSwell;
uniform float uFade;
uniform float uCircumference;
uniform int uMode;
varying vec2 vUv;
${FX_COMMON_GLSL}
void main() {
  // x runs round the ring in metres, so the flame size stays the same as the ring grows.
  float x = vUv.x * uCircumference;
  float y = vUv.y;
  // Crests: a slow wave round the ring decides where the wall stands tall.
  float crest = smoothstep(0.15, 0.7, fxFbm(vec2(x * 0.35 + uSeed * 11.0, uSeed * 3.0)));
  float top = mix(0.45, 1.0, crest) * uSwell;
  // Tongues: noise scrolling upward breaks the top edge into licks.
  float lick = fxFbm(vec2(x * 1.6 + uSeed * 5.0, y * 2.2 - uTime * 3.2));
  float fine = fxNoise(vec2(x * 4.5 - uSeed * 2.0, y * 6.0 - uTime * 6.5));
  float edge = top * (0.7 + 0.6 * lick);
  float body = 1.0 - smoothstep(edge * 0.15, edge, y);
  // Orange body with a yellow core low down; the licks near the top stay red-orange.
  float h = body * (0.45 + 0.4 * fine) + body * body * 0.25;
  h *= smoothstep(0.0, 0.05, y);
  h = clamp(h * uFade, 0.0, 1.0);
  vec3 col = fxFireRamp(h, uMode) * 1.15;
  float a = smoothstep(0.05, 0.35, h) * 0.9;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
}
`;

interface Wall { mesh: Mesh; mat: ShaderMaterial; active: boolean }

/**
 * A ring-shaped wall of fire for the slam: one continuous surface, so it reads as a wall that
 * rolls outward rather than a ring of separate flames. The caller sets radius and height each frame.
 */
export class FireWalls {
  private readonly walls: Wall[] = [];

  constructor(parent: Object3D, time: { value: number }, count = 4) {
    // Open cylinder, unit radius at the base and slightly narrower at the top, so the flames
    // lean back behind the moving front.
    const geo = new CylinderGeometry(0.9, 1, 1, 96, 1, true);
    geo.translate(0, 0.5, 0);
    for (let i = 0; i < count; i++) {
      const mat = new ShaderMaterial({
        uniforms: {
          uTime: time,
          uSeed: { value: 0 },
          uSwell: { value: 0 },
          uFade: { value: 0 },
          uCircumference: { value: 6 },
          uMode: { value: 0 },
        },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
      });
      const mesh = new Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      parent.add(mesh);
      this.walls.push({ mesh, mat, active: false });
    }
  }

  /** Starts a wall and returns its slot, which the caller passes to `set` each frame. */
  start(x: number, y: number, z: number, seed: number, mode: number): number {
    let slot = this.walls.findIndex(w => !w.active);
    if (slot < 0) slot = 0;
    const wall = this.walls[slot]!;
    wall.active = true;
    wall.mesh.position.set(x, y, z);
    wall.mat.uniforms.uSeed!.value = seed;
    wall.mat.uniforms.uMode!.value = mode;
    wall.mesh.visible = true;
    return slot;
  }

  set(slot: number, radius: number, height: number, swell: number, fade: number): void {
    const wall = this.walls[slot];
    if (!wall?.active) return;
    wall.mesh.scale.set(radius, Math.max(0.01, height), radius);
    wall.mat.uniforms.uSwell!.value = swell;
    wall.mat.uniforms.uFade!.value = fade;
    wall.mat.uniforms.uCircumference!.value = Math.PI * 2 * radius;
  }

  stop(slot: number): void {
    const wall = this.walls[slot];
    if (!wall) return;
    wall.active = false;
    wall.mesh.visible = false;
  }

  dispose(): void {
    this.walls[0]?.mesh.geometry.dispose();
    for (const wall of this.walls) wall.mat.dispose();
  }
}
