import {
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  Matrix4,
  Vector3,
} from 'three';
import type { WorldBuilder } from './builder.js';
import type { Surface } from './materials.js';

export interface RoofSpec {
  w: number;
  d: number;
  base: number;
  pitch: number;
  overhang: number;
  curve: number;
  cornerLift: number;
  gableRatio: number;
  tiers?: number;
  tile: 'roof_tile_red' | 'roof_tile_charcoal';
  trim: boolean;
}

/**
 * Builds a parametric hip-and-gable (irimoya/xieshan) roof with curved slopes,
 * upturned eaves, thickness, ridges, gable ends, and round eave tile ends.
 */
export function roof(b: WorldBuilder, spec: RoofSpec, rand: () => number = () => 0.5): void {
  const tiers = spec.tiers ?? 1;
  let curW = spec.w;
  let curD = spec.d;
  let curBase = spec.base;

  for (let tier = 0; tier < tiers; tier++) {
    const isTopTier = tier === tiers - 1;
    const overhang = isTopTier ? spec.overhang : spec.overhang * 0.85;
    const pitch = spec.pitch;
    const cornerLift = isTopTier ? spec.cornerLift : spec.cornerLift * 0.7;
    const curve = spec.curve;
    const gableRatio = spec.gableRatio;

    buildSingleRoofTier(b, {
      w: curW,
      d: curD,
      base: curBase,
      pitch,
      overhang,
      curve,
      cornerLift,
      gableRatio,
      tile: spec.tile,
      trim: spec.trim,
    });

    if (tier < tiers - 1) {
      // Intermediate tower wall section between tiers
      const wallH = 1.0;
      const nextW = curW * 0.82;
      const nextD = curD * 0.82;
      const rise = Math.tan(pitch) * (curD / 2 + overhang) * 0.85;
      const wallBase = curBase + rise;

      const wallMat: Surface = spec.trim ? 'lime_plaster' : 'ashlar_stone_blocks';
      b.box(wallMat, 0, wallBase + wallH / 2, 0, nextW, wallH, nextD);

      curW = nextW;
      curD = nextD;
      curBase = wallBase + wallH;
    }
  }
}

function buildSingleRoofTier(
  b: WorldBuilder,
  spec: {
    w: number;
    d: number;
    base: number;
    pitch: number;
    overhang: number;
    curve: number;
    cornerLift: number;
    gableRatio: number;
    tile: 'roof_tile_red' | 'roof_tile_charcoal';
    trim: boolean;
  }
): void {
  const { w, d, base, pitch, overhang, curve, cornerLift, gableRatio, tile, trim } = spec;

  const halfEW = w / 2 + overhang;
  const halfED = d / 2 + overhang;
  const halfRidgeW = Math.max(1.0, (w * gableRatio) / 2);
  const rise = Math.tan(pitch) * halfED;
  const ridgeY = base + rise;
  const thickness = 0.12;

  // The hip junction sits at x = +-halfRidgeW, z = 0 at ridgeY, sloping down to the gable base.
  // The gable triangle sits at x = +-halfRidgeW, from y = (base + rise * 0.5) to ridgeY.
  const gableBaseY = base + rise * 0.55;
  const gableHalfD = halfED * 0.45;

  // 1. Build North (-z) and South (+z) curved slope meshes
  buildSlopeMesh(b, tile, {
    dir: 'z',
    sign: 1,
    halfEW,
    halfED,
    halfRidgeW,
    baseY: base,
    ridgeY,
    curve,
    cornerLift,
    thickness,
  });

  buildSlopeMesh(b, tile, {
    dir: 'z',
    sign: -1,
    halfEW,
    halfED,
    halfRidgeW,
    baseY: base,
    ridgeY,
    curve,
    cornerLift,
    thickness,
  });

  // 2. Build East (+x) and West (-x) hipped slopes (below the gables)
  buildHippedEndMesh(b, tile, {
    sign: 1,
    halfEW,
    halfED,
    halfRidgeW,
    baseY: base,
    gableBaseY,
    gableHalfD,
    curve,
    cornerLift,
    thickness,
  });

  buildHippedEndMesh(b, tile, {
    sign: -1,
    halfEW,
    halfED,
    halfRidgeW,
    baseY: base,
    gableBaseY,
    gableHalfD,
    curve,
    cornerLift,
    thickness,
  });

  // 3. Gable vertical walls and bargeboards at East (+x) and West (-x)
  const gableMat: Surface = trim ? 'lime_plaster' : 'charred_timber_beams';
  for (const sx of [-1, 1]) {
    const gx = sx * halfRidgeW;
    buildGableTriangle(b, gableMat, trim ? 'red_lacquer' : 'charred_timber_beams', {
      x: gx,
      baseY: gableBaseY,
      ridgeY,
      halfD: gableHalfD,
      normalSign: sx,
    });
  }

  // 4. Main Ridge Cap along local X
  const ridgeMat: Surface = trim ? 'gold_trim' : tile;
  const ridgeLen = halfRidgeW * 2 + 0.4;
  b.cylinder(ridgeMat, 0, ridgeY + 0.08, 0, 0.18, 0.18, ridgeLen, 8);

  // Upturned ornament at the ridge ends
  for (const sx of [-1, 1]) {
    const rx = sx * (halfRidgeW + 0.2);
    b.box(ridgeMat, rx, ridgeY + 0.2, 0, 0.22, 0.35, 0.28, { z: sx * 0.35 });
    if (trim) {
      b.box('gold_trim', rx + sx * 0.1, ridgeY + 0.32, 0, 0.14, 0.16, 0.18);
    }
  }

  // 5. Hip Ridges along the 4 diagonal corners
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      buildHipRidge(b, ridgeMat, {
        startX: sx * halfRidgeW,
        startY: gableBaseY,
        startZ: sz * gableHalfD,
        endX: sx * halfEW,
        endY: base + cornerLift,
        endZ: sz * halfED,
        curve,
      });
    }
  }

  // 6. Round tile end caps along South (+z) and North (-z) eaves
  const endCapMat: Surface = tile;
  const capSpacing = 0.28;
  const numCapsX = Math.floor((halfEW * 2) / capSpacing);
  for (let i = 0; i <= numCapsX; i++) {
    const u = -halfEW + (i / numCapsX) * (halfEW * 2);
    const cornerFactor = Math.pow(Math.abs(u) / halfEW, 2);
    const yEave = base + cornerLift * cornerFactor;

    // South eave
    b.cylinder(endCapMat, u, yEave - thickness / 2, halfED, 0.08, 0.08, 0.16, 8);
    // North eave
    b.cylinder(endCapMat, u, yEave - thickness / 2, -halfED, 0.08, 0.08, 0.16, 8);
  }

  // Round tile end caps along East (+x) and West (-x) eaves
  const numCapsZ = Math.floor((halfED * 2) / capSpacing);
  for (let i = 0; i <= numCapsZ; i++) {
    const v = -halfED + (i / numCapsZ) * (halfED * 2);
    const cornerFactor = Math.pow(Math.abs(v) / halfED, 2);
    const yEave = base + cornerLift * cornerFactor;

    // East eave
    b.cylinder(endCapMat, halfEW, yEave - thickness / 2, v, 0.08, 0.08, 0.16, 8);
    // West eave
    b.cylinder(endCapMat, -halfEW, yEave - thickness / 2, v, 0.08, 0.08, 0.16, 8);
  }

  // 7. Gold edge fascia trim if noble
  if (trim) {
    const goldMat: Surface = 'gold_trim';
    const fasciaH = 0.08;
    // South and North fascia
    b.box(goldMat, 0, base - thickness / 2, halfED + 0.02, halfEW * 2, fasciaH, 0.04);
    b.box(goldMat, 0, base - thickness / 2, -halfED - 0.02, halfEW * 2, fasciaH, 0.04);
    // East and West fascia
    b.box(goldMat, halfEW + 0.02, base - thickness / 2, 0, 0.04, fasciaH, halfED * 2);
    b.box(goldMat, -halfEW - 0.02, base - thickness / 2, 0, 0.04, fasciaH, halfED * 2);
  }
}

/**
 * Builds a curved parametric slope mesh for North or South faces.
 */
function buildSlopeMesh(
  b: WorldBuilder,
  bucket: Surface,
  p: {
    dir: 'z';
    sign: number;
    halfEW: number;
    halfED: number;
    halfRidgeW: number;
    baseY: number;
    ridgeY: number;
    curve: number;
    cornerLift: number;
    thickness: number;
  }
): void {
  const stepsU = 12;
  const stepsV = 8;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const sz = p.sign;
  const totalH = p.ridgeY - p.baseY;

  // Build top and bottom surfaces
  for (const layer of [0, 1]) {
    const yOff = layer === 0 ? 0 : -p.thickness;
    const baseIndexOffset = (layer * (stepsV + 1) * (stepsU + 1));

    for (let iv = 0; iv <= stepsV; iv++) {
      const tv = iv / stepsV; // 0 at ridge, 1 at eave
      const curZ = sz * (tv * p.halfED);
      const curHalfW = p.halfRidgeW + tv * (p.halfEW - p.halfRidgeW);

      // Sag curve: steeper at ridge, flatter at eave
      const sag = Math.sin(Math.PI * tv) * p.curve * totalH;
      const straightY = p.ridgeY - tv * totalH;

      for (let iu = 0; iu <= stepsU; iu++) {
        const tu = iu / stepsU; // 0 to 1 across width
        const curX = -curHalfW + tu * (curHalfW * 2);

        // Corner lift: increases as we approach both corners of the eave
        const cornerDist = Math.abs((tu - 0.5) * 2); // 0 at center, 1 at corner
        const lift = tv * p.cornerLift * Math.pow(cornerDist, 2);

        positions.push(curX, straightY - sag + lift + yOff, curZ);
        uvs.push(tu * 4, tv * 3);
      }
    }

    // Grid quad indices
    for (let iv = 0; iv < stepsV; iv++) {
      for (let iu = 0; iu < stepsU; iu++) {
        const i0 = baseIndexOffset + iv * (stepsU + 1) + iu;
        const i1 = i0 + 1;
        const i2 = i0 + (stepsU + 1);
        const i3 = i2 + 1;

        if (layer === 0) {
          // Top surface facing up
          if (sz > 0) {
            indices.push(i0, i2, i1, i1, i2, i3);
          } else {
            indices.push(i0, i1, i2, i1, i3, i2);
          }
        } else {
          // Bottom surface facing down
          if (sz > 0) {
            indices.push(i0, i1, i2, i1, i3, i2);
          } else {
            indices.push(i0, i2, i1, i1, i2, i3);
          }
        }
      }
    }
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geom.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();

  b.add(bucket, geom, new Matrix4(), { u: 1, v: 1 });
}

/**
 * Builds the hipped lower slope mesh at East (+x) or West (-x) ends below the gable.
 */
function buildHippedEndMesh(
  b: WorldBuilder,
  bucket: Surface,
  p: {
    sign: number;
    halfEW: number;
    halfED: number;
    halfRidgeW: number;
    baseY: number;
    gableBaseY: number;
    gableHalfD: number;
    curve: number;
    cornerLift: number;
    thickness: number;
  }
): void {
  const stepsU = 8;
  const stepsV = 6;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const sx = p.sign;
  const totalH = p.gableBaseY - p.baseY;

  for (let iv = 0; iv <= stepsV; iv++) {
    const tv = iv / stepsV; // 0 at gable base, 1 at eave
    const curX = sx * (p.halfRidgeW + tv * (p.halfEW - p.halfRidgeW));
    const curHalfD = p.gableHalfD + tv * (p.halfED - p.gableHalfD);
    const straightY = p.gableBaseY - tv * totalH;
    const sag = Math.sin(Math.PI * tv) * p.curve * totalH;

    for (let iu = 0; iu <= stepsU; iu++) {
      const tu = iu / stepsU; // 0 to 1 across depth (-z to +z)
      const curZ = -curHalfD + tu * (curHalfD * 2);
      const cornerDist = Math.abs((tu - 0.5) * 2);
      const lift = tv * p.cornerLift * Math.pow(cornerDist, 2);

      positions.push(curX, straightY - sag + lift, curZ);
      uvs.push(tu * 3, tv * 2);
    }
  }

  for (let iv = 0; iv < stepsV; iv++) {
    for (let iu = 0; iu < stepsU; iu++) {
      const i0 = iv * (stepsU + 1) + iu;
      const i1 = i0 + 1;
      const i2 = i0 + (stepsU + 1);
      const i3 = i2 + 1;

      if (sx > 0) {
        indices.push(i0, i1, i2, i1, i3, i2);
      } else {
        indices.push(i0, i2, i1, i1, i2, i3);
      }
    }
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geom.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();

  b.add(bucket, geom, new Matrix4(), { u: 1, v: 1 });
}

/**
 * Builds the vertical gable triangle and enclosing bargeboard trim.
 */
function buildGableTriangle(
  b: WorldBuilder,
  wallMat: Surface,
  trimMat: Surface,
  p: {
    x: number;
    baseY: number;
    ridgeY: number;
    halfD: number;
    normalSign: number;
  }
): void {
  const positions: number[] = [
    p.x, p.baseY, -p.halfD,
    p.x, p.baseY, p.halfD,
    p.x, p.ridgeY, 0,
  ];
  const uvs: number[] = [0, 0, 1, 0, 0.5, 1];
  const indices = p.normalSign > 0 ? [0, 1, 2] : [0, 2, 1];

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geom.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();

  b.add(wallMat, geom, new Matrix4(), { u: 1, v: 1 });

  // Bargeboard trim framing the gable slopes
  const boardThick = 0.16;
  const boardLen = Math.hypot(p.ridgeY - p.baseY, p.halfD);
  const angle = Math.atan2(p.ridgeY - p.baseY, p.halfD);

  b.box(trimMat, p.x + p.normalSign * 0.05, (p.baseY + p.ridgeY) / 2, p.halfD / 2, boardThick, 0.22, boardLen, { x: -angle });
  b.box(trimMat, p.x + p.normalSign * 0.05, (p.baseY + p.ridgeY) / 2, -p.halfD / 2, boardThick, 0.22, boardLen, { x: angle });
}

/**
 * Builds an arched hip ridge running down each of the four hip corners.
 */
function buildHipRidge(
  b: WorldBuilder,
  bucket: Surface,
  p: {
    startX: number;
    startY: number;
    startZ: number;
    endX: number;
    endY: number;
    endZ: number;
    curve: number;
  }
): void {
  const segments = 6;
  for (let i = 0; i < segments; i++) {
    const t0 = i / segments;
    const t1 = (i + 1) / segments;

    const x0 = p.startX + t0 * (p.endX - p.startX);
    const z0 = p.startZ + t0 * (p.endZ - p.startZ);
    const y0 = p.startY + t0 * (p.endY - p.startY) - Math.sin(Math.PI * t0) * p.curve * 1.5;

    const x1 = p.startX + t1 * (p.endX - p.startX);
    const z1 = p.startZ + t1 * (p.endZ - p.startZ);
    const y1 = p.startY + t1 * (p.endY - p.startY) - Math.sin(Math.PI * t1) * p.curve * 1.5;

    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const mz = (z0 + z1) / 2;

    const segLen = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    const yaw = Math.atan2(x1 - x0, z1 - z0);
    const pitch = -Math.atan2(y1 - y0, Math.hypot(x1 - x0, z1 - z0));

    b.box(bucket, mx, my + 0.05, mz, 0.22, 0.16, segLen + 0.02, { y: yaw, x: pitch });
  }
}

/**
 * Dougong-style stacked cantilever bracket sets under eaves for noble buildings.
 */
export function brackets(
  b: WorldBuilder,
  along: 'x' | 'z',
  positions: number[],
  y: number,
  depth: number,
  trim = true
): void {
  const mat: Surface = trim ? 'red_lacquer' : 'charred_timber_beams';
  const gold: Surface = 'gold_trim';

  for (const pos of positions) {
    // 3-tier stepped cantilever bracket
    for (let step = 0; step < 3; step++) {
      const stepY = y - (2 - step) * 0.14;
      const reach = (step + 1) * 0.22;
      const breadth = 0.5 - step * 0.08;

      if (along === 'x') {
        b.box(mat, pos, stepY, depth + reach / 2, breadth, 0.12, reach);
        if (trim && step === 2) {
          b.box(gold, pos, stepY, depth + reach + 0.02, breadth + 0.04, 0.14, 0.04);
        }
      } else {
        b.box(mat, depth + reach / 2, stepY, pos, reach, 0.12, breadth);
        if (trim && step === 2) {
          b.box(gold, depth + reach + 0.02, stepY, pos, 0.04, 0.14, breadth + 0.04);
        }
      }
    }
  }
}
