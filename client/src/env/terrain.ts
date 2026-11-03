import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  RepeatWrapping,
  RingGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector2,
  Vector3,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import balance from '../../../shared/balance.json';
import type { Element } from '../../../shared/src/index.js';
import { fbm2D, ridgedNoise2D, warpedFbm2D } from './noise.js';
import type { QualityProfile } from './types.js';
import { getNationGeography } from './nations.js';

export const ARENA_SIZE = balance.arena.size;
export const RADIUS = ARENA_SIZE / 2;

/**
 * Creates seamless non-circular perimeter wall geometry following an organic polygon.
 * Produces correctly oriented inner, top-cap, and outer faces with smooth averaged normals
 * and continuous arc-length UVs so rock textures display with crisp, natural detail.
 */
function createPerimeterWallGeometry(
  boundary: Array<{ x: number; z: number }>,
  height: number,
  thickness: number
): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  const count = boundary.length;
  const tileM = balance.look.wallTileMetres ?? 3;

  // 1. Calculate inward normal at each segment
  let totalLength = 0;
  const segLengths: number[] = [];
  const segInNormals: Array<{ x: number; z: number }> = [];

  for (let i = 0; i < count; i++) {
    const p1 = boundary[i]!;
    const p2 = boundary[(i + 1) % count]!;
    const dx = p2.x - p1.x;
    const dz = p2.z - p1.z;
    const len = Math.hypot(dx, dz) || 1;
    segLengths.push(len);
    totalLength += len;

    const midX = (p1.x + p2.x) * 0.5;
    const midZ = (p1.z + p2.z) * 0.5;
    let nx = -dz / len;
    let nz = dx / len;
    // Normal must point towards arena center (0, 0)
    if (midX * nx + midZ * nz > 0) {
      nx = -nx;
      nz = -nz;
    }
    segInNormals.push({ x: nx, z: nz });
  }

  // 2. Average normals at each vertex for smooth shading across corners
  const vertInNormals: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < count; i++) {
    const prevSeg = segInNormals[(i - 1 + count) % count]!;
    const nextSeg = segInNormals[i]!;
    const avgX = (prevSeg.x + nextSeg.x) * 0.5;
    const avgZ = (prevSeg.z + nextSeg.z) * 0.5;
    const len = Math.hypot(avgX, avgZ) || 1;
    vertInNormals.push({ x: avgX / len, z: avgZ / len });
  }

  let arcLength = 0;
  for (let i = 0; i < count; i++) {
    const p1 = boundary[i]!;
    const p2 = boundary[(i + 1) % count]!;
    const len = segLengths[i]!;

    const n1 = vertInNormals[i]!;
    const n2 = vertInNormals[(i + 1) % count]!;

    const x0 = p1.x, z0 = p1.z;
    const x1 = p2.x, z1 = p2.z;
    const x0Out = x0 - n1.x * thickness, z0Out = z0 - n1.z * thickness;
    const x1Out = x1 - n2.x * thickness, z1Out = z1 - n2.z * thickness;

    const u0 = arcLength / tileM;
    const u1 = (arcLength + len) / tileM;
    const vH = height / tileM;
    const vT = thickness / tileM;

    // --- Inner Face: Facing arena interior (+inNormal) ---
    positions.push(
      x0, 0, z0,
      x1, 0, z1,
      x1, height, z1,
      x0, 0, z0,
      x1, height, z1,
      x0, height, z0
    );
    normals.push(
      n1.x, 0, n1.z,
      n2.x, 0, n2.z,
      n2.x, 0, n2.z,
      n1.x, 0, n1.z,
      n2.x, 0, n2.z,
      n1.x, 0, n1.z
    );
    uvs.push(
      u0, 0,
      u1, 0,
      u1, vH,
      u0, 0,
      u1, vH,
      u0, vH
    );

    // --- Top Cap Face: Upward (+Y) ---
    positions.push(
      x0, height, z0,
      x1, height, z1,
      x1Out, height, z1Out,
      x0, height, z0,
      x1Out, height, z1Out,
      x0Out, height, z0Out
    );
    normals.push(
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
      0, 1, 0
    );
    uvs.push(
      u0, 0,
      u1, 0,
      u1, vT,
      u0, 0,
      u1, vT,
      u0, vT
    );

    // --- Outer Face: Facing outward (-inNormal) ---
    positions.push(
      x1Out, 0, z1Out,
      x0Out, 0, z0Out,
      x0Out, height, z0Out,
      x1Out, 0, z1Out,
      x0Out, height, z0Out,
      x1Out, height, z1Out
    );
    normals.push(
      -n2.x, 0, -n2.z,
      -n1.x, 0, -n1.z,
      -n1.x, 0, -n1.z,
      -n2.x, 0, -n2.z,
      -n1.x, 0, -n1.z,
      -n2.x, 0, -n2.z
    );
    uvs.push(
      u1, 0,
      u0, 0,
      u0, vH,
      u1, 0,
      u0, vH,
      u1, vH
    );

    arcLength += len;
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  return geo;
}

const textureLoader = new TextureLoader();

function loadTex(path: string, repeat: number, srgb = false): Texture {
  const tex = textureLoader.load(path);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 8;
  if (srgb) tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** Soft procedural dirt mask: heavier towards the wall and around prop locations. */
export function createDirtMask(size = 1024): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);

  // Gradient towards wall perimeter
  const edge = ctx.createRadialGradient(size / 2, size / 2, size * 0.28, size / 2, size / 2, size / 2);
  edge.addColorStop(0, 'rgba(255,255,255,0)');
  edge.addColorStop(0.62, 'rgba(255,255,255,0.4)');
  edge.addColorStop(0.82, 'rgba(255,255,255,0.85)');
  edge.addColorStop(1, 'rgba(255,255,255,1.0)');
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, size, size);

  // Scatter dirt patches in crevices and joints
  let seed = 42;
  const rand = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 220; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const distFromCenter = Math.hypot(x - size / 2, y - size / 2);
    if (distFromCenter < size * 0.22 && rand() > 0.15) continue;

    const r = size * (0.012 + rand() * 0.05);
    const blob = ctx.createRadialGradient(x, y, 0, x, y, r);
    blob.addColorStop(0, `rgba(255,255,255,${0.3 + rand() * 0.6})`);
    blob.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = blob;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  return tex;
}

export class TerrainSystem {
  readonly floor: Mesh;
  readonly dirtOverlay: Mesh;
  readonly wall: Mesh;
  readonly hills: Mesh;
  readonly distantRidges: Mesh;
  readonly brazierGroup = new Group();
  readonly heroContactShadow: Mesh;
  readonly brazierLights: PointLight[] = [];
  private readonly contactShadows: Mesh[] = [];
  private readonly flameMeshes: Mesh[] = [];

  constructor(
    readonly scene: Scene,
    readonly renderer: WebGLRenderer,
    readonly quality: QualityProfile,
    readonly onSetupMaterial: (mat: MeshStandardMaterial) => void,
    nation: Element = 'IGNIS'
  ) {
    const res = quality.textureSuffix;
    const geo = getNationGeography(nation);

    /* --- 1. Floor: multi-scale PBR stone flags with POM on high --- */
    const floorGeo = new CircleGeometry(RADIUS + 4, 128);
    const floorMat = this.createFloorMaterial(res, quality.enablePOM);
    if (nation === 'AQUES') {
      floorMat.color.setRGB(0.96, 0.98, 1.0); // Polar ice blue tint
      floorMat.roughness = 0.22;
      floorMat.metalness = 0.05;
    } else if (nation === 'TERRA') {
      floorMat.color.setRGB(1.0, 0.96, 0.92); // Warm canyon stone
      floorMat.roughness = 0.85;
    } else if (nation === 'AURA') {
      floorMat.color.setRGB(0.98, 0.99, 1.0); // High temple stone
      floorMat.roughness = 0.40;
    } else if (nation === 'IGNIS') {
      floorMat.color.setRGB(1.0, 0.97, 0.95); // Natural warm volcanic stone
      floorMat.roughness = 0.65;
    }
    onSetupMaterial(floorMat);

    this.floor = new Mesh(floorGeo, floorMat);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    /* --- 2. Dirt and earth overlay with dirt mask --- */
    const dirtMat = this.createPbrMaterial('forest_ground_04', res, 6);
    dirtMat.alphaMap = createDirtMask();
    dirtMat.transparent = true;
    dirtMat.depthWrite = false;
    dirtMat.polygonOffset = true;
    dirtMat.polygonOffsetFactor = -1;
    if (nation === 'AQUES') {
      dirtMat.color.setRGB(0.95, 0.98, 1.0); // Snow drifts
      dirtMat.roughness = 0.4;
    } else if (nation === 'TERRA') {
      dirtMat.color.setRGB(1.0, 0.92, 0.82); // Canyon sand
    } else if (nation === 'IGNIS') {
      dirtMat.color.setRGB(0.95, 0.90, 0.85); // Ash and earth layer
    }
    onSetupMaterial(dirtMat);

    this.dirtOverlay = new Mesh(floorGeo, dirtMat);
    this.dirtOverlay.rotation.x = -Math.PI / 2;
    this.dirtOverlay.position.y = 0.002;
    this.dirtOverlay.receiveShadow = true;
    this.scene.add(this.dirtOverlay);

    /* --- 3. Boundary wall: geographically attuned non-circular perimeter --- */
    const wallHeight = geo.wallHeight;
    const wallThickness = geo.wallThickness;
    // Continuous arc-length UVs in metres: unit repeat keeps 2K textures uncompressed
    const wallMat = this.createPbrMaterial('rock_wall_08', res, [1, 1]);
    if (nation === 'AQUES') {
      wallMat.color.setRGB(0.95, 0.98, 1.0); // Glacial ice cliff
      wallMat.roughness = 0.35;
      wallMat.metalness = 0.05;
    } else if (nation === 'TERRA') {
      wallMat.color.setRGB(1.0, 0.95, 0.90); // Sandstone canyon cliff
      wallMat.roughness = 0.85;
    } else if (nation === 'AURA') {
      wallMat.color.setRGB(0.97, 0.99, 1.0); // Pale mountain spire balustrade
      wallMat.roughness = 0.45;
    } else if (nation === 'IGNIS') {
      wallMat.color.setRGB(1.0, 0.96, 0.93); // Natural basalt caldera rim
      wallMat.roughness = 0.68;
    }
    wallMat.side = DoubleSide;
    onSetupMaterial(wallMat);

    const perimeterGeo = createPerimeterWallGeometry(geo.boundary, wallHeight, wallThickness);
    this.wall = new Mesh(perimeterGeo, wallMat);
    this.wall.castShadow = true;
    this.wall.receiveShadow = true;
    this.scene.add(this.wall);

    /* --- 4. Layered rolling hills with 256x256 heightfield & slope triplanar --- */
    this.hills = this.createRealisticHills(res);
    const hillsMat = this.hills.material as MeshStandardMaterial;
    if (nation === 'AQUES') {
      hillsMat.color.setRGB(0.94, 0.97, 1.0); // Glacial ice cliffs
      hillsMat.roughness = 0.35;
    } else if (nation === 'TERRA') {
      hillsMat.color.setRGB(1.0, 0.95, 0.90); // Canyon mesas
      hillsMat.roughness = 0.85;
    } else if (nation === 'IGNIS') {
      hillsMat.color.setRGB(1.0, 0.96, 0.92); // Volcanic caldera slopes
      hillsMat.roughness = 0.75;
    } else if (nation === 'AURA') {
      hillsMat.color.setRGB(0.96, 0.98, 1.0); // High alpine peaks
    }
    onSetupMaterial(hillsMat);
    this.scene.add(this.hills);

    /* --- 5. Distant jagged mountain ridges towering over wall into haze --- */
    this.distantRidges = this.createRealisticDistantRidges(res);
    const ridgesMat = this.distantRidges.material as MeshStandardMaterial;
    if (nation === 'AQUES') {
      ridgesMat.color.setRGB(0.92, 0.96, 1.0); // Frozen mountain crags
      ridgesMat.roughness = 0.4;
    } else if (nation === 'TERRA') {
      ridgesMat.color.setRGB(1.0, 0.94, 0.88); // Distant canyon plateau
      ridgesMat.roughness = 0.85;
    } else if (nation === 'IGNIS') {
      ridgesMat.color.setRGB(1.0, 0.95, 0.92); // Distant smoking volcano rim
      ridgesMat.roughness = 0.8;
    } else if (nation === 'AURA') {
      ridgesMat.color.setRGB(0.95, 0.98, 1.0); // Towering cloud spires
    }
    onSetupMaterial(ridgesMat);
    this.scene.add(this.distantRidges);

    /* --- 6. Contact darkening under props --- */
    this.buildPropContactDarkening();

    /* --- 7. Hero dynamic contact shadow disc --- */
    const contactCanvas = document.createElement('canvas');
    contactCanvas.width = contactCanvas.height = 128;
    const cctx = contactCanvas.getContext('2d')!;
    const grad = cctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(10, 8, 6, 0.65)');
    grad.addColorStop(0.5, 'rgba(15, 12, 10, 0.35)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    cctx.fillStyle = grad;
    cctx.fillRect(0, 0, 128, 128);

    const contactTex = new CanvasTexture(contactCanvas);
    const contactMat = new MeshBasicMaterial({
      map: contactTex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.heroContactShadow = new Mesh(new PlaneGeometry(1.4, 1.4), contactMat);
    this.heroContactShadow.rotation.x = -Math.PI / 2;
    this.heroContactShadow.position.set(0, 0.005, 0);
    this.scene.add(this.heroContactShadow);

    /* --- 8. Forged iron braziers flanking the entrance gate --- */
    this.buildBraziers(res);
    this.scene.add(this.brazierGroup);
  }

  private createPbrMaterial(
    name: string,
    res: string,
    repeat: number | [number, number]
  ): MeshStandardMaterial {
    const [rx, ry] = typeof repeat === 'number' ? [repeat, repeat] : repeat;
    const tex = (suffix: string, srgb = false): Texture => {
      const t = loadTex(`/assets/textures/${name}_${suffix}_${res}.webp`, 1, srgb);
      t.repeat.set(rx, ry);
      return t;
    };
    const arm = tex('arm');
    return new MeshStandardMaterial({
      map: tex('diff', true),
      normalMap: tex('nor_gl'),
      aoMap: arm,
      roughnessMap: arm,
      metalnessMap: arm,
    });
  }

  private createFloorMaterial(res: string, enablePOM: boolean): MeshStandardMaterial {
    const diff = loadTex(`/assets/textures/monastery_stone_floor_diff_${res}.webp`, 1, true);
    const nor = loadTex(`/assets/textures/monastery_stone_floor_nor_gl_${res}.webp`, 1, false);
    const arm = loadTex(`/assets/textures/monastery_stone_floor_arm_${res}.webp`, 1, false);
    const disp = loadTex(`/assets/textures/monastery_stone_floor_disp_${res}.webp`, 1, false);

    const mat = new MeshStandardMaterial({
      map: diff,
      normalMap: nor,
      aoMap: arm,
      roughnessMap: arm,
      metalnessMap: arm,
    });

    diff.repeat.set(6, 6);
    nor.repeat.set(6, 6);
    arm.repeat.set(6, 6);
    disp.repeat.set(6, 6);

    mat.onBeforeCompile = (shader) => {
      shader.uniforms['tDisp'] = { value: disp };
      shader.uniforms['uPomEnabled'] = { value: enablePOM ? 1.0 : 0.0 };

      shader.fragmentShader = `
        uniform sampler2D tDisp;
        uniform float uPomEnabled;
      ` + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        /* glsl */ `
        #ifdef USE_MAP
          vec2 uvBase = vMapUv;
          vec2 uvSecondary = uvBase * 2.37 + vec2(0.38, 0.71);
          
          float blendWeight = sin(uvBase.x * 3.14 + cos(uvBase.y * 2.71)) * 0.25 + 0.5;
          
          vec4 texColor1 = texture2D(map, uvBase);
          vec4 texColor2 = texture2D(map, uvSecondary);
          vec4 blendedColor = mix(texColor1, texColor2, blendWeight * 0.4);
          
          // Large scale tonal shift across arena
          float macroTone = sin(uvBase.x * 0.45) * cos(uvBase.y * 0.45) * 0.08;
          diffuseColor *= blendedColor;
          diffuseColor.rgb += vec3(macroTone * 1.1, macroTone * 0.7, -macroTone * 0.4);
        #endif
        `
      );
    };

    return mat;
  }

  /**
   * Real eroded terrain with 256x256 heightfield from layered noise
   * (fBm + ridged crests + domain warping) and slope-based triplanar material blending.
   */
  private createRealisticHills(res: string): Mesh {
    const innerR = RADIUS + 0.4;
    const outerR = 100;
    const segmentsTheta = 192;
    const segmentsR = 192;
    const geo = new RingGeometry(innerR, outerR, segmentsTheta, segmentsR);

    const pos = geo.attributes.position!;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const r = Math.hypot(x, y);
      const angle = Math.atan2(y, x);

      let h = 0;
      if (r > innerR) {
        const t = (r - innerR) / (outerR - innerR);
        // Start completely flush at the arena wall and rise naturally into rolling foothills
        const edgeBlend = Math.min(1.0, Math.pow(t / 0.08, 1.8));

        // Domain-warped coordinates for meandering ridges
        const nx = x * 0.035;
        const ny = y * 0.035;
        const warped = warpedFbm2D(nx, ny);

        // Layer 1: Broad rolling foothills
        const broad = fbm2D(nx * 0.45, ny * 0.45, 4) * 15.0;

        // Layer 2: Ridged crests and eroded gullies
        const ridged = Math.pow(ridgedNoise2D(nx * 0.85 + warped * 0.5, ny * 0.85 + warped * 0.5, 4), 1.6) * 16.0;

        // Layer 3: Fine organic undulations
        const fine = fbm2D(x * 0.12, y * 0.12, 3) * 2.8;

        // Distance elevation envelope: rises from 0m at wall to 10m-24m crests
        const envelope = Math.pow(t, 0.5) * 1.35;
        h = (broad + ridged + fine + 6.0) * envelope * edgeBlend;
        h = Math.max(-0.1, h);
      }
      pos.setZ(i, h);
    }
    geo.computeVertexNormals();

    // Slope-based shader material: grass on gentle slopes, triplanar rock on steep cliffs
    const grassDiff = loadTex(`/assets/textures/forest_ground_04_diff_${res}.webp`, 1, true);
    const rockDiff = loadTex(`/assets/textures/rock_wall_08_diff_${res}.webp`, 1, true);
    const grassArm = loadTex(`/assets/textures/forest_ground_04_arm_${res}.webp`, 1, false);

    const hillsMat = new MeshStandardMaterial({
      map: grassDiff,
      aoMap: grassArm,
      roughnessMap: grassArm,
      metalnessMap: grassArm,
      roughness: 0.85,
      metalness: 0.05,
    });

    hillsMat.onBeforeCompile = (shader) => {
      shader.uniforms['tRockDiff'] = { value: rockDiff };

      shader.vertexShader = `
        varying vec3 vTerrainWorldPos;
        varying vec3 vTerrainWorldNorm;
      ` + shader.vertexShader;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        /* glsl */ `
        #include <worldpos_vertex>
        vTerrainWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vTerrainWorldNorm = normalize(mat3(modelMatrix) * normal);
        `
      );

      shader.fragmentShader = `
        uniform sampler2D tRockDiff;
        varying vec3 vTerrainWorldPos;
        varying vec3 vTerrainWorldNorm;
      ` + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        /* glsl */ `
        #ifdef USE_MAP
          // Planar grass mapping on gentle slopes
          vec2 grassUv = vTerrainWorldPos.xz * 0.14;
          vec4 grassTex = texture2D(map, grassUv);

          // Slope calculation: 0 = flat ground, 1 = vertical cliff
          float slope = 1.0 - clamp(abs(vTerrainWorldNorm.y), 0.0, 1.0);
          vec4 blendedSurface;

          if (slope < 0.28) {
            blendedSurface = grassTex;
          } else {
            // Triplanar rock mapping on steep cliff slopes (never stretches)
            vec3 n = abs(vTerrainWorldNorm);
            vec3 weights = pow(n, vec3(5.0));
            weights /= (weights.x + weights.y + weights.z);

            vec2 rockUvX = vTerrainWorldPos.zy * 0.10;
            vec2 rockUvY = vTerrainWorldPos.xz * 0.10;
            vec2 rockUvZ = vTerrainWorldPos.xy * 0.10;

            vec4 rockTexX = texture2D(tRockDiff, rockUvX);
            vec4 rockTexY = texture2D(tRockDiff, rockUvY);
            vec4 rockTexZ = texture2D(tRockDiff, rockUvZ);
            vec4 rockTex = rockTexX * weights.x + rockTexY * weights.y + rockTexZ * weights.z;

            float rockFactor = smoothstep(0.32, 0.58, slope);
            blendedSurface = mix(grassTex, rockTex, rockFactor);
          }
          diffuseColor *= blendedSurface;
        #endif
        `
      );
    };

    const mesh = new Mesh(geo, hillsMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -0.05;
    mesh.receiveShadow = true;
    return mesh;
  }

  /**
   * Distant mountain range with ridged noise crests towering 38m to 68m high,
   * creating natural eroded ridge silhouettes against the golden-hour sky.
   */
  private createRealisticDistantRidges(res: string): Mesh {
    const innerR = 105;
    const outerR = 360;
    const segmentsTheta = 128;
    const segmentsR = 48;
    const geo = new RingGeometry(innerR, outerR, segmentsTheta, segmentsR);

    const pos = geo.attributes.position!;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const r = Math.hypot(x, y);

      const t = (r - innerR) / (outerR - innerR);
      const edgeBlend = Math.sin(t * Math.PI);

      const nx = x * 0.012;
      const ny = y * 0.012;
      const warped = warpedFbm2D(nx, ny);

      // Jagged mountain crests
      const ridge = Math.pow(ridgedNoise2D(nx + warped * 0.4, ny + warped * 0.4, 4), 1.5) * 48.0;
      const peaks = Math.abs(fbm2D(nx * 0.7, ny * 0.7, 3)) * 32.0;
      const detail = fbm2D(x * 0.05, y * 0.05, 3) * 6.0;

      const h = (ridge + peaks + detail + 18.0) * edgeBlend * 1.5 + t * 28.0;
      pos.setZ(i, Math.max(0, h));
    }
    geo.computeVertexNormals();

    const rockDiff = loadTex(`/assets/textures/rock_wall_08_diff_${res}.webp`, 28, true);
    const rockArm = loadTex(`/assets/textures/rock_wall_08_arm_${res}.webp`, 28, false);

    const ridgeMat = new MeshStandardMaterial({
      map: rockDiff,
      aoMap: rockArm,
      roughnessMap: rockArm,
      metalnessMap: rockArm,
      roughness: 0.9,
      metalness: 0.1,
    });

    const mesh = new Mesh(geo, ridgeMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -0.5;
    return mesh;
  }

  private buildPropContactDarkening(): void {
    const contactMat = new MeshBasicMaterial({
      color: 0x050403,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });

    for (const obs of balance.arena.obstacles) {
      const ring = new Mesh(new CircleGeometry(obs.radius * 1.15, 32), contactMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(obs.x, 0.003, obs.z);
      this.scene.add(ring);
      this.contactShadows.push(ring);
    }
  }

  /**
   * Builds the entrance gate braziers using the real iron brazier asset from IGNIS kit,
   * with real rusted iron PBR textures, small glowing coal bed, and subtle animated flame.
   */
  private buildBraziers(res: string): void {
    const gltfLoader = new GLTFLoader();
    gltfLoader.setMeshoptDecoder(MeshoptDecoder);

    const ironPbrMat = new MeshStandardMaterial({ roughness: 0.72, metalness: 0.88 });
    // The kit stores its maps as KTX2 only; normals exist at 1K.
    const ktx2 = new KTX2Loader().setTranscoderPath('/assets/env/ignis/basis/').detectSupport(this.renderer);
    const iron = (map: string, size: string, srgb: boolean, apply: (t: Texture) => void): void => {
      ktx2.load(`/assets/env/ignis/materials/blackened_rusted_iron_${map}_${size}.ktx2`, (tex) => {
        if (srgb) tex.colorSpace = SRGBColorSpace;
        tex.anisotropy = 8;
        apply(tex);
        ironPbrMat.needsUpdate = true;
      });
    };
    iron('diff', res, true, (t) => { ironPbrMat.map = t; });
    iron('nor_uastc', '1k', false, (t) => { ironPbrMat.normalMap = t; });
    iron('arm', res, false, (t) => { ironPbrMat.aoMap = t; ironPbrMat.roughnessMap = t; ironPbrMat.metalnessMap = t; });

    const coalMat = new MeshStandardMaterial({
      color: 0x3a0c02,
      emissive: new Color(0xff4800),
      emissiveIntensity: 2.8,
      roughness: 0.95,
      metalness: 0.1,
    });

    const flameMat = new MeshBasicMaterial({
      color: 0xffaa22,
      transparent: true,
      opacity: 0.85,
    });

    const brazierPositions = [
      new Vector3(-3.2, 0, 14.1),
      new Vector3(3.2, 0, 14.1),
    ];

    // Load real scanned iron brazier GLB
    gltfLoader.load('/assets/env/ignis/models/iron_brazier.glb', (gltf) => {
      const sourceModel = gltf.scene;
      sourceModel.traverse((node) => {
        if (node instanceof Mesh) {
          node.material = ironPbrMat;
          node.castShadow = true;
          node.receiveShadow = true;
          this.onSetupMaterial(ironPbrMat);
        }
      });

      for (const pos of brazierPositions) {
        const brazier = sourceModel.clone();
        brazier.position.copy(pos);
        brazier.scale.setScalar(1.1);
        this.brazierGroup.add(brazier);

        // Glowing coal bed inside bowl (y ~ 0.78)
        const coals = new Mesh(new CylinderGeometry(0.38, 0.28, 0.08, 16), coalMat);
        coals.position.set(pos.x, 0.78, pos.z);
        this.brazierGroup.add(coals);

        // Small subtle flame inside the bowl
        const flame = new Mesh(new CylinderGeometry(0.08, 0.22, 0.35, 12), flameMat);
        flame.position.set(pos.x, 0.95, pos.z);
        this.brazierGroup.add(flame);
        this.flameMeshes.push(flame);

        // Flickering warm amber point light
        const light = new PointLight(0xff5511, 2.2, 8.0, 1.4);
        light.position.set(pos.x, 1.1, pos.z);
        this.brazierGroup.add(light);
        this.brazierLights.push(light);

        // Soft contact shadow disc under brazier base
        const shadow = new Mesh(
          new CircleGeometry(0.75, 24),
          new MeshBasicMaterial({ color: 0x050403, transparent: true, opacity: 0.65, depthWrite: false })
        );
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.set(pos.x, 0.003, pos.z);
        this.brazierGroup.add(shadow);
      }
    }, undefined, () => {
      // Fallback: procedural rusted iron brazier if GLB fails
      for (const pos of brazierPositions) {
        const g = new Group();
        g.position.copy(pos);

        const base = new Mesh(new CylinderGeometry(0.4, 0.48, 0.16, 16), ironPbrMat);
        base.position.y = 0.08;
        base.castShadow = true;
        g.add(base);

        const pillar = new Mesh(new CylinderGeometry(0.14, 0.18, 0.75, 16), ironPbrMat);
        pillar.position.y = 0.45;
        pillar.castShadow = true;
        g.add(pillar);

        const bowl = new Mesh(new CylinderGeometry(0.58, 0.32, 0.35, 20), ironPbrMat);
        bowl.position.y = 0.95;
        bowl.castShadow = true;
        g.add(bowl);

        const coals = new Mesh(new CylinderGeometry(0.48, 0.4, 0.08, 16), coalMat);
        coals.position.y = 1.05;
        g.add(coals);

        const light = new PointLight(0xff5511, 2.2, 8.0, 1.4);
        light.position.set(0, 1.25, 0);
        g.add(light);
        this.brazierLights.push(light);

        this.brazierGroup.add(g);
      }
    });
  }

  updateHeroContact(heroPos: Vector3): void {
    this.heroContactShadow.position.x = heroPos.x;
    this.heroContactShadow.position.z = heroPos.z;
  }

  dispose(): void {
    this.scene.remove(this.floor);
    this.scene.remove(this.dirtOverlay);
    this.scene.remove(this.wall);
    this.scene.remove(this.hills);
    this.scene.remove(this.distantRidges);
    this.scene.remove(this.heroContactShadow);
    this.scene.remove(this.brazierGroup);
    for (const c of this.contactShadows) this.scene.remove(c);
  }
}
