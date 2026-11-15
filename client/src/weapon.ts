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

/** Weapon assets use metres, +Y along the blade, and named Grip and Tip markers. */
export interface WeaponHitShape {
  readonly kind: 'blade_segment';
  readonly from: 'Grip';
  readonly to: 'Tip';
}

export interface WeaponSlotData {
  readonly id: string;
  readonly name: string;
  readonly type: 'sword' | 'spear' | 'axe' | 'staff' | 'gauntlets';
  readonly assetPath: string;
  readonly hitShape: WeaponHitShape;
  readonly carry?: { readonly assetPath: string; readonly mount: 'back' | 'hip' };
  readonly reach: number;
  readonly moves: {
    readonly light: readonly string[];
    readonly heavy: readonly string[];
    readonly uppercut?: string;
    readonly ground_pound?: string;
    readonly dash?: string;
  };
}

export function heroWeaponFor(kit: { element: string; hush?: boolean }): 'staff' | 'sword' {
  return !kit.hush && kit.element === 'AURA' ? 'staff' : 'sword';
}

const hitShape = { kind: 'blade_segment', from: 'Grip', to: 'Tip' } as const;
const moves = {
  light: ['light_1', 'light_2', 'light_3'],
  heavy: ['heavy_1', 'heavy_2'],
  uppercut: 'uppercut', ground_pound: 'ground_pound', dash: 'dash_strike',
};
export const SWORD_WEAPON: WeaponSlotData = {
  id: 'worn_iron_sword', name: 'Worn Iron Sword', type: 'sword',
  assetPath: '/assets/weapons/worn-iron-sword.glb', hitShape,
  carry: { assetPath: '/assets/weapons/back-scabbard.glb', mount: 'back' },
  reach: 2.5, moves,
};
export const KNIFE_WEAPON: WeaponSlotData = {
  id: 'long_knife', name: 'Long knife', type: 'sword',
  assetPath: '/assets/weapons/long-knife.glb', hitShape, reach: 1.9, moves,
};
export const DESERTER_WEAPON: WeaponSlotData = {
  id: 'deserter_sword', name: 'Deserter arming sword', type: 'sword',
  assetPath: '/assets/weapons/deserter-sword.glb', hitShape, reach: 2.5, moves,
};
export const CLUB_WEAPON: WeaponSlotData = {
  id: 'bound_club', name: 'Bound hardwood club', type: 'axe',
  assetPath: '/assets/weapons/bound-club.glb', hitShape, reach: 2.1, moves,
};
// The existing staff stays in service until the second concept receives approval.
export const STAFF_WEAPON: WeaponSlotData = {
  id: 'aura_quarterstaff', name: 'Aura Quarterstaff', type: 'staff',
  assetPath: '/assets/weapons/staff.glb', hitShape, reach: 3.2, moves,
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
