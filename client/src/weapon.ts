import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  ShaderMaterial,
  Vector3,
  type Object3D,
} from 'three';

/**
 * Data-driven weapon slot definition.
 * All weapon geometry, socket positions, carrying transforms, hit shapes, and movesets
 * are specified via data so that new weapons (spear, axe, staff, gauntlets) can be
 * equipped without altering fight simulation logic.
 */

export interface WeaponHitShape {
  readonly kind: 'blade_segment';
  /** Fraction along mesh height where contact surface begins (skipping the hilt/grip). */
  readonly baseFraction: number;
  /** Fraction along mesh height where contact surface ends (the blade tip). */
  readonly tipFraction: number;
}

export interface WeaponSlotData {
  readonly id: string;
  readonly name: string;
  readonly type: 'sword' | 'spear' | 'axe' | 'staff' | 'gauntlets';
  readonly assetPath: string;
  readonly meshName?: string;
  /** Hand bone socketed to when drawn. */
  readonly handBone: string;
  readonly handOffset: readonly [number, number, number];
  readonly handRotation: readonly [number, number, number];
  readonly handScale: number;
  /** Bone socketed to when sheathed on the hero body. */
  readonly sheatheBone: string;
  readonly sheathePosition: readonly [number, number, number];
  readonly sheatheBladeDirection: readonly [number, number, number];
  readonly sheatheScale: number;
  /** Hit shape definition used for contact testing. */
  readonly hitShape: WeaponHitShape;
  readonly reach: number;
  readonly moves: {
    readonly light: readonly string[];
    readonly heavy: readonly string[];
    readonly uppercut?: string;
    readonly ground_pound?: string;
    readonly dash?: string;
  };
}

/**
 * Returns the nation/starting weapon for the hero kit.
 * AURA wields a staff; all others default to sword until their nation weapons exist.
 */
export function heroWeaponFor(kit: { element: string; hush?: boolean }): 'staff' | 'sword' {
  if (!kit.hush && kit.element === 'AURA') return 'staff';
  return 'sword';
}

/**
 * Standard Worn Iron Sword: the first weapon entry in the data-driven slot registry.
 */
export const SWORD_WEAPON: WeaponSlotData = {
  id: 'worn_iron_sword',
  name: 'Worn Iron Sword',
  type: 'sword',
  assetPath: '/assets/characters/sword.glb',
  meshName: 'Sword',
  handBone: 'hand_r',
  handOffset: [-0.027, 0.094, -0.053],
  handRotation: [1.402, 0.005, 0.006],
  handScale: 0.23,
  sheatheBone: 'spine_03',
  sheathePosition: [-0.12, 1.42, -0.17],
  sheatheBladeDirection: [0.42, -0.9, 0],
  sheatheScale: 0.23,
  hitShape: {
    kind: 'blade_segment',
    baseFraction: 0.2,
    tipFraction: 1.0,
  },
  reach: 2.5,
  moves: {
    light: ['light_1', 'light_2', 'light_3'],
    heavy: ['heavy_1', 'heavy_2'],
    uppercut: 'uppercut',
    ground_pound: 'ground_pound',
    dash: 'dash_strike',
  },
};

/**
 * AURA Quarterstaff: 1.7 m pale ash wood with worn steel caps and wrapped grip in the middle third.
 * Socketed to hand_r, held two-handed in stance, sheathed diagonally across the back.
 */
export const STAFF_WEAPON: WeaponSlotData = {
  id: 'aura_quarterstaff',
  name: 'Aura Quarterstaff',
  type: 'staff',
  assetPath: '/assets/weapons/staff.glb',
  meshName: 'Staff',
  handBone: 'hand_r',
  handOffset: [-0.027, 0.094, -0.053],
  handRotation: [1.402, 0.005, 0.006],
  handScale: 1.0,
  sheatheBone: 'spine_03',
  sheathePosition: [-0.14, 1.35, -0.16],
  sheatheBladeDirection: [0.52, -0.85, 0],
  sheatheScale: 1.0,
  hitShape: {
    kind: 'blade_segment',
    baseFraction: 0.05,
    tipFraction: 0.98,
  },
  reach: 3.2,
  moves: {
    light: ['light_1', 'light_2', 'light_3'],
    heavy: ['heavy_1', 'heavy_2'],
    uppercut: 'uppercut',
    ground_pound: 'ground_pound',
    dash: 'dash_strike',
  },
};

const MAX_STAFF_SAMPLES = 48;

const STAFF_TRAIL_VERTEX = /* glsl */ `
attribute float aAge;
attribute float aSide;
attribute float aAlpha;
varying float vAge;
varying float vSide;
varying float vAlpha;
void main() {
  vAge = aAge;
  vSide = aSide;
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const STAFF_TRAIL_FRAGMENT = /* glsl */ `
uniform float uTime;
varying float vAge;
varying float vSide;
varying float vAlpha;
void main() {
  // Thin pale-white air ripple ribbon trailing the staff tip
  float ripple = sin(vAge * 22.0 - uTime * 8.0 + vSide * 10.0) * 0.06;
  float side = clamp(vSide + ripple, 0.0, 1.0);
  float band = smoothstep(0.2, 0.85, side) * (1.0 - smoothstep(0.96, 1.0, vSide));
  float tailFade = pow(1.0 - vAge, 1.25);
  float alpha = band * tailFade * vAlpha * 0.7;
  if (alpha < 0.005) discard;
  // AURA pale-white/silver air hue
  vec3 airColor = vec3(0.92, 0.96, 1.0);
  gl_FragColor = vec4(airColor, alpha);
}
`;

interface StaffTrailSample {
  base: Vector3;
  tip: Vector3;
  time: number;
  alpha: number;
}

/**
 * Pale-white air ripple trail that flows off the staff tip on each swing when AURA bends armed.
 */
export class StaffAirTrail {
  private readonly mesh: Mesh;
  private readonly mat: ShaderMaterial;
  private readonly geo = new BufferGeometry();
  private readonly positions = new Float32Array(MAX_STAFF_SAMPLES * 2 * 3);
  private readonly ages = new Float32Array(MAX_STAFF_SAMPLES * 2);
  private readonly alphas = new Float32Array(MAX_STAFF_SAMPLES * 2);
  private readonly samples: StaffTrailSample[] = [];
  private clock = 0;
  private readonly fadeTime = 0.22;

  constructor(parent: Object3D) {
    const sides = new Float32Array(MAX_STAFF_SAMPLES * 2);
    const index: number[] = [];
    for (let i = 0; i < MAX_STAFF_SAMPLES; i++) {
      sides[i * 2] = 0;
      sides[i * 2 + 1] = 1;
      if (i < MAX_STAFF_SAMPLES - 1) {
        const a = i * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    this.geo.setIndex(index);
    this.geo.setAttribute('position', new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage));
    this.geo.setAttribute('aAge', new BufferAttribute(this.ages, 1).setUsage(DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new BufferAttribute(this.alphas, 1).setUsage(DynamicDrawUsage));
    this.geo.setAttribute('aSide', new BufferAttribute(sides, 1));
    this.mat = new ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: STAFF_TRAIL_VERTEX,
      fragmentShader: STAFF_TRAIL_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
    });
    this.mesh = new Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 3;
    parent.add(this.mesh);
  }

  record(base: Vector3, tip: Vector3, alpha: number): void {
    const last = this.samples[this.samples.length - 1];
    if (last && last.tip.distanceTo(tip) > 2.0) this.samples.length = 0;
    if (last && last.time === this.clock) {
      last.base.copy(base);
      last.tip.copy(tip);
      last.alpha = Math.max(last.alpha, alpha);
      return;
    }
    const reuse = this.samples.length >= MAX_STAFF_SAMPLES ? this.samples.shift()! : { base: new Vector3(), tip: new Vector3(), time: 0, alpha: 0 };
    reuse.base.copy(base);
    reuse.tip.copy(tip);
    reuse.time = this.clock;
    reuse.alpha = alpha;
    this.samples.push(reuse);
  }

  update(delta: number): void {
    this.clock += delta;
    this.mat.uniforms.uTime!.value = this.clock;
    while (this.samples.length > 0 && this.clock - this.samples[0]!.time > this.fadeTime) {
      this.samples.shift();
    }
    const n = this.samples.length;
    const lit = this.samples.some(s => s.alpha > 0.01);
    this.mesh.visible = n >= 2 && lit;
    if (!this.mesh.visible) return;
    for (let i = 0; i < n; i++) {
      const s = this.samples[i]!;
      const age = Math.min(1, (this.clock - s.time) / this.fadeTime);
      this.positions.set([s.base.x, s.base.y, s.base.z, s.tip.x, s.tip.y, s.tip.z], i * 6);
      this.ages[i * 2] = age;
      this.ages[i * 2 + 1] = age;
      this.alphas[i * 2] = s.alpha;
      this.alphas[i * 2 + 1] = s.alpha;
    }
    this.geo.setDrawRange(0, (n - 1) * 6);
    for (const name of ['position', 'aAge', 'aAlpha']) {
      this.geo.getAttribute(name).needsUpdate = true;
    }
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
