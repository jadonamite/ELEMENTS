import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type Scene,
} from 'three';
import { RADIUS } from './terrain.js';
import { fbm2D } from './noise.js';
import type { QualityProfile } from './types.js';

/**
 * Creates curved, tapered 4-segment polygonal blade geometry.
 * 4 blades arranged in a natural clump radiating outwards with curvature.
 * No alpha-test cutout required; fast early-Z and smooth silhouetting.
 */
export function createCurvedBladeClumpGeometry(): BufferGeometry {
  const geo = new BufferGeometry();

  const numBlades = 3;
  const segments = 4;
  const vertsPerBlade = (segments + 1) * 2;
  const trisPerBlade = segments * 2;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const widths = [0.038, 0.032, 0.024, 0.014, 0.003];
  const heights = [0.0, 0.25, 0.50, 0.75, 1.0];
  const bends = [0.0, 0.012, 0.038, 0.082, 0.145];

  for (let b = 0; b < numBlades; b++) {
    const bladeAngle = (b / numBlades) * Math.PI * 2 + (b * 0.25);
    const cosA = Math.cos(bladeAngle);
    const sinA = Math.sin(bladeAngle);
    const perpX = -sinA;
    const perpZ = cosA;

    const baseIndex = (positions.length / 3);

    for (let s = 0; s <= segments; s++) {
      const h = heights[s]!;
      const halfW = widths[s]! * 0.5;
      const bend = bends[s]!;

      // Center offset from curvature in blade forward direction
      const cx = cosA * bend;
      const cz = sinA * bend;

      // Left vertex
      positions.push(cx - perpX * halfW, h, cz - perpZ * halfW);
      normals.push(-sinA * 0.3, 0.95, cosA * 0.3);
      uvs.push(0.0, h);

      // Right vertex
      positions.push(cx + perpX * halfW, h, cz + perpZ * halfW);
      normals.push(sinA * 0.3, 0.95, -cosA * 0.3);
      uvs.push(1.0, h);
    }

    // Indices for quads along the blade segments
    for (let s = 0; s < segments; s++) {
      const i0 = baseIndex + s * 2;
      const i1 = i0 + 1;
      const i2 = i0 + 2;
      const i3 = i0 + 3;

      indices.push(i0, i1, i2);
      indices.push(i1, i3, i2);
    }
  }

  geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geo.setIndex(indices);
  return geo;
}

/**
 * Creates slender seed-head stalk geometry (wild barley / wheat head).
 */
export function createSeedHeadGeometry(): BufferGeometry {
  const geo = new BufferGeometry();
  const segments = 4;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const hStep = 1.0 / segments;
  const w = 0.008;

  for (let s = 0; s <= segments; s++) {
    const h = s * hStep;
    const bend = Math.pow(h, 2.0) * 0.18;
    const width = s === segments ? 0.024 : (s >= 3 ? 0.020 : w);

    positions.push(-width, h, bend);
    positions.push(width, h, bend);
    normals.push(0, 0.8, 0.6);
    normals.push(0, 0.8, 0.6);
    uvs.push(0, h);
    uvs.push(1, h);
  }

  for (let s = 0; s < segments; s++) {
    const i = s * 2;
    indices.push(i, i + 1, i + 2);
    indices.push(i + 1, i + 3, i + 2);
  }

  geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geo.setIndex(indices);
  return geo;
}

export class FoliageSystem {
  readonly instancedGrass: InstancedMesh;
  readonly instancedSeedHeads: InstancedMesh;
  readonly instancedPebbles: InstancedMesh;

  private readonly grassMat: MeshStandardMaterial;
  private readonly seedMat: MeshStandardMaterial;
  private readonly pebbleMat: MeshStandardMaterial;

  constructor(
    readonly scene: Scene,
    readonly quality: QualityProfile,
    readonly onSetupMaterial: (mat: MeshStandardMaterial) => void
  ) {
    const count = quality.level === 'high' ? 7000 : 2200;
    const seedCount = quality.level === 'high' ? 500 : 120;
    const pebbleCount = quality.level === 'high' ? 160 : 50;

    const bladeGeo = createCurvedBladeClumpGeometry();
    const seedGeo = createSeedHeadGeometry();
    const pebbleGeo = new DodecahedronGeometry(0.065, 0);

    /* --- 1. Grass Blade Material with Wind & Golden-Hour Translucency --- */
    this.grassMat = new MeshStandardMaterial({
      roughness: 0.65,
      metalness: 0.05,
      side: DoubleSide,
    });

    this.grassMat.onBeforeCompile = (shader) => {
      shader.uniforms['uTime'] = { value: 0 };
      shader.uniforms['uSunDir'] = { value: new Vector3(0.5, 0.2, 0.8).normalize() };

      shader.vertexShader = `
        uniform float uTime;
        varying vec3 vGrassWorldPos;
        varying float vHeightNorm;
      ` + shader.vertexShader;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        
        vec4 instWorld = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vGrassWorldPos = (modelMatrix * (instanceMatrix * vec4(position, 1.0))).xyz;
        vHeightNorm = uv.y;
        
        // Traveling wind gust wave crossing the field
        float gustWave = sin(uTime * 1.45 + instWorld.x * 0.15 + instWorld.z * 0.10);
        // High frequency fluttering
        float flutter = sin(uTime * 4.4 + instWorld.x * 1.7 + instWorld.z * 1.4) * 0.18;
        float heightFactor = pow(uv.y, 1.6);
        float totalDisplace = (gustWave + flutter) * 0.18 * heightFactor;
        
        vec2 windDir = normalize(vec2(1.0, 0.45));
        transformed.x += totalDisplace * windDir.x;
        transformed.z += totalDisplace * windDir.y;
        `
      );

      shader.fragmentShader = `
        uniform vec3 uSunDir;
        varying vec3 vGrassWorldPos;
        varying float vHeightNorm;
      ` + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        /* glsl */ `
        #include <color_fragment>
        
        // Vertical gradient: dark earthy olive root -> instance golden hue -> bright amber tip
        vec3 rootColor = vec3(0.18, 0.17, 0.08);
        vec3 tipHighlight = vec3(0.96, 0.84, 0.44);
        
        diffuseColor.rgb = mix(rootColor, diffuseColor.rgb, smoothstep(0.0, 0.28, vHeightNorm));
        diffuseColor.rgb = mix(diffuseColor.rgb, tipHighlight, smoothstep(0.72, 1.0, vHeightNorm) * 0.45);

        // Soft backlight translucency when looking into the low golden sun
        vec3 viewDir = normalize(cameraPosition - vGrassWorldPos);
        float backScatter = max(0.0, dot(viewDir, -uSunDir));
        float transmission = pow(backScatter, 2.8) * vHeightNorm * 0.65;
        diffuseColor.rgb += vec3(1.0, 0.78, 0.38) * transmission;
        `
      );

      this.grassMat.userData['shader'] = shader;
    };

    onSetupMaterial(this.grassMat);

    this.instancedGrass = new InstancedMesh(bladeGeo, this.grassMat, count);
    this.instancedGrass.receiveShadow = true;
    this.instancedGrass.castShadow = false;

    /* --- 2. Seed Heads Material --- */
    this.seedMat = new MeshStandardMaterial({
      color: 0xcca658,
      roughness: 0.75,
      metalness: 0.02,
      side: DoubleSide,
    });
    this.seedMat.onBeforeCompile = (shader) => {
      shader.uniforms['uTime'] = { value: 0 };
      shader.vertexShader = `uniform float uTime;` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        vec4 instWorld = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float gust = sin(uTime * 1.5 + instWorld.x * 0.15 + instWorld.z * 0.10);
        float sway = gust * 0.26 * pow(uv.y, 1.8);
        transformed.x += sway;
        transformed.z += sway * 0.45;
        `
      );
      this.seedMat.userData['shader'] = shader;
    };
    onSetupMaterial(this.seedMat);

    this.instancedSeedHeads = new InstancedMesh(seedGeo, this.seedMat, seedCount);
    this.instancedSeedHeads.receiveShadow = true;
    this.instancedSeedHeads.castShadow = false;

    /* --- 3. Scattered Pebbles Material --- */
    this.pebbleMat = new MeshStandardMaterial({
      color: 0x6e6358,
      roughness: 0.9,
      metalness: 0.05,
    });
    onSetupMaterial(this.pebbleMat);

    this.instancedPebbles = new InstancedMesh(pebbleGeo, this.pebbleMat, pebbleCount);
    this.instancedPebbles.receiveShadow = true;
    this.instancedPebbles.castShadow = false;

    this.populateInstances(count, seedCount, pebbleCount);

    this.scene.add(this.instancedGrass);
    this.scene.add(this.instancedSeedHeads);
    this.scene.add(this.instancedPebbles);
  }

  private populateInstances(grassCount: number, seedCount: number, pebbleCount: number): void {
    const dummy = new Matrix4();
    const pos = new Vector3();
    const rot = new Quaternion();
    const scale = new Vector3();
    const col = new Color();

    let seed = 42817;
    const rand = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;

    // Golden-hour grass palette: dry gold, luminous wheat, dry golden olive, russet tan
    const grassPalette = [
      new Color(0xd8ac44), // Sun-dried gold
      new Color(0xe2be5c), // Luminous wheat
      new Color(0x9a943a), // Dry golden olive
      new Color(0xc59c48), // Warm amber straw
      new Color(0xa88f40), // Muted sage gold
      new Color(0xb88836), // Russet tan
    ];

    let placedGrass = 0;
    while (placedGrass < grassCount) {
      const angle = rand() * Math.PI * 2;
      const rRatio = rand();

      // Density distribution: dense from 10.5m to 14.7m; thinning gradually down to 6.2m; clear at center
      let r: number;
      if (rand() < 0.72) {
        // Outer dense perimeter near wall
        r = 10.5 + rRatio * (RADIUS - 0.35 - 10.5);
      } else {
        // Inward fade zone with quadratic thinning
        const innerT = Math.pow(rRatio, 1.8);
        r = 6.2 + innerT * (10.5 - 6.2);
      }

      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;

      // Natural bare patches and clumping from 2D procedural noise
      const clump = fbm2D(x * 0.24, z * 0.24, 3);
      if (clump < -0.35 && rand() > 0.18) {
        // Bare ground / stone patch
        continue;
      }

      // Height variation by clump (0.25m to 0.90m)
      const heightBase = 0.25 + Math.pow(Math.max(0, clump + 0.5) / 1.5, 1.3) * 0.65;
      const hScale = Math.min(0.90, Math.max(0.24, heightBase * (0.85 + rand() * 0.3)));
      const wScale = 0.8 + rand() * 0.4;

      pos.set(x, 0.003, z);
      rot.setFromAxisAngle(new Vector3(0, 1, 0), rand() * Math.PI * 2);
      scale.set(wScale, hScale, wScale);

      dummy.compose(pos, rot, scale);
      this.instancedGrass.setMatrixAt(placedGrass, dummy);

      // Per-blade golden-hour color variation
      const baseCol = grassPalette[Math.floor(rand() * grassPalette.length)]!;
      col.copy(baseCol);
      // Subtle micro-tint
      col.offsetHSL((rand() - 0.5) * 0.04, (rand() - 0.5) * 0.1, (rand() - 0.5) * 0.08);
      this.instancedGrass.setColorAt(placedGrass, col);

      placedGrass++;
    }
    this.instancedGrass.instanceMatrix.needsUpdate = true;
    if (this.instancedGrass.instanceColor) this.instancedGrass.instanceColor.needsUpdate = true;

    // Populate tall seed-head grasses
    let placedSeeds = 0;
    while (placedSeeds < seedCount) {
      const angle = rand() * Math.PI * 2;
      const r = 9.5 + rand() * (RADIUS - 0.5 - 9.5);
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;

      const clump = fbm2D(x * 0.24, z * 0.24, 3);
      if (clump < 0.0) continue; // Only grow in lush clumps

      const h = 0.85 + rand() * 0.28;
      pos.set(x, 0.003, z);
      rot.setFromAxisAngle(new Vector3(0, 1, 0), rand() * Math.PI * 2);
      scale.set(1.0, h, 1.0);

      dummy.compose(pos, rot, scale);
      this.instancedSeedHeads.setMatrixAt(placedSeeds, dummy);
      placedSeeds++;
    }
    this.instancedSeedHeads.instanceMatrix.needsUpdate = true;

    // Populate scattered pebbles along outer dirt border
    for (let i = 0; i < pebbleCount; i++) {
      const angle = rand() * Math.PI * 2;
      const r = 11.0 + rand() * (RADIUS - 0.2 - 11.0);
      pos.set(Math.cos(angle) * r, 0.02, Math.sin(angle) * r);
      rot.setFromAxisAngle(new Vector3(rand() - 0.5, 1, rand() - 0.5).normalize(), rand() * Math.PI * 2);
      const s = 0.5 + rand() * 0.8;
      scale.set(s * (1 + rand() * 0.5), s * 0.45, s * (1 + rand() * 0.5));

      dummy.compose(pos, rot, scale);
      this.instancedPebbles.setMatrixAt(i, dummy);
    }
    this.instancedPebbles.instanceMatrix.needsUpdate = true;
  }

  update(time: number): void {
    const grassShader = this.grassMat.userData['shader'];
    if (grassShader) {
      grassShader.uniforms['uTime'].value = time;
    }
    const seedShader = this.seedMat.userData['shader'];
    if (seedShader) {
      seedShader.uniforms['uTime'].value = time;
    }
  }

  dispose(): void {
    this.scene.remove(this.instancedGrass);
    this.scene.remove(this.instancedSeedHeads);
    this.scene.remove(this.instancedPebbles);
    this.instancedGrass.geometry.dispose();
    this.grassMat.dispose();
    this.instancedSeedHeads.geometry.dispose();
    this.seedMat.dispose();
    this.instancedPebbles.geometry.dispose();
    this.pebbleMat.dispose();
  }
}
