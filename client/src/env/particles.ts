import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  NormalBlending,
  Points,
  ShaderMaterial,
  Vector3,
  type Scene,
} from 'three';
import type { QualityProfile } from './types.js';

import type { Element } from '../../../shared/src/index.js';
import { getNationGeography } from './nations.js';

export class ParticleSystem {
  readonly dustPoints: Points;
  readonly emberPoints: Points;
  readonly smokePoints: Points;

  private readonly dustMat: ShaderMaterial;
  private readonly emberMat: ShaderMaterial;
  private readonly smokeMat: ShaderMaterial;

  constructor(
    readonly scene: Scene,
    readonly quality: QualityProfile,
    readonly sunDir: Vector3,
    nation: Element = 'IGNIS'
  ) {
    const geoNation = getNationGeography(nation);
    const meteorology = geoNation.meteorology;

    /* --- 1. Atmospheric particles (ash, snow, wind, dust) --- */
    const dustCount = quality.dustCount;
    const dustGeo = new BufferGeometry();
    const dustPos = new Float32Array(dustCount * 3);
    const dustVel = new Float32Array(dustCount * 3);
    const dustRand = new Float32Array(dustCount);

    let seed = 999;
    const rand = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;

    for (let i = 0; i < dustCount; i++) {
      dustPos[i * 3 + 0] = (rand() - 0.5) * 36;
      dustPos[i * 3 + 1] = 0.2 + rand() * 5.5;
      dustPos[i * 3 + 2] = (rand() - 0.5) * 36;

      if (meteorology.particleType === 'snow') {
        dustVel[i * 3 + 0] = 0.4 + rand() * 0.6; // horizontal wind drift
        dustVel[i * 3 + 1] = -0.8 - rand() * 0.8; // falling snow
        dustVel[i * 3 + 2] = 0.2 + rand() * 0.4;
      } else if (meteorology.particleType === 'wind') {
        dustVel[i * 3 + 0] = 2.5 + rand() * 2.0; // howling gale
        dustVel[i * 3 + 1] = (rand() - 0.5) * 0.3;
        dustVel[i * 3 + 2] = 1.0 + rand() * 1.0;
      } else if (meteorology.particleType === 'mist') {
        dustVel[i * 3 + 0] = 0.12 + rand() * 0.18; // slow drift off the water
        dustVel[i * 3 + 1] = (rand() - 0.5) * 0.06;
        dustVel[i * 3 + 2] = 0.06 + rand() * 0.1;
      } else if (meteorology.particleType === 'dust') {
        dustVel[i * 3 + 0] = 0.8 + rand() * 1.2; // swirling sand
        dustVel[i * 3 + 1] = 0.1 + rand() * 0.3;
        dustVel[i * 3 + 2] = 0.6 + rand() * 0.8;
      } else {
        // ash / cinders
        dustVel[i * 3 + 0] = 0.15 + rand() * 0.25;
        dustVel[i * 3 + 1] = -0.2 - rand() * 0.3;
        dustVel[i * 3 + 2] = 0.08 + rand() * 0.18;
      }

      dustRand[i] = rand();
    }

    dustGeo.setAttribute('position', new BufferAttribute(dustPos, 3));
    dustGeo.setAttribute('aVel', new BufferAttribute(dustVel, 3));
    dustGeo.setAttribute('aRand', new BufferAttribute(dustRand, 1));

    const particleColor = meteorology.particleType === 'snow'
      ? new Color(0xd5eaff)
      : meteorology.particleType === 'wind'
        ? new Color(0xffffff)
        : meteorology.particleType === 'mist'
          ? new Color(0xc8dcd8)
          : meteorology.particleType === 'dust'
          ? new Color(0xe0b060)
          : new Color(0xff9944);

    this.dustMat = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: sunDir },
        uSunColor: { value: particleColor },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        attribute vec3 aVel;
        attribute float aRand;
        varying float vAlpha;

        void main() {
          vec3 p = position;
          // Continuous drift with wrapping boundaries
          p.x = mod(p.x + aVel.x * uTime + 16.0, 32.0) - 16.0;
          p.z = mod(p.z + aVel.z * uTime + 16.0, 32.0) - 16.0;
          p.y = mod(p.y + sin(uTime * 0.8 + aRand * 6.28) * 0.25 - 0.3, 4.2) + 0.3;

          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          
          // Distance attenuation
          gl_PointSize = (12.0 + aRand * 16.0) / -mvPosition.z;
          gl_PointSize = clamp(gl_PointSize, 1.0, 14.0);

          // Glistening shimmer
          vAlpha = 0.35 + 0.65 * sin(uTime * 2.5 + aRand * 20.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunColor;
        varying float vAlpha;

        void main() {
          // Circular particle shape
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float circleAlpha = smoothstep(0.5, 0.05, d);
          
          gl_FragColor = vec4(uSunColor, circleAlpha * vAlpha * 0.65);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    this.dustPoints = new Points(dustGeo, this.dustMat);
    this.scene.add(this.dustPoints);

    /* --- 2. Brazier Embers --- */
    const emberCount = quality.emberCount * 2;
    const emberGeo = new BufferGeometry();
    const emberPos = new Float32Array(emberCount * 3);
    const emberOrigins = new Float32Array(emberCount * 3);
    const emberParams = new Float32Array(emberCount * 3); // phase, speed, scale

    const brazierCenters = [
      new Vector3(-3.2, 0.80, 14.1),
      new Vector3(3.2, 0.80, 14.1),
    ];

    for (let i = 0; i < emberCount; i++) {
      const center = brazierCenters[i % 2]!;
      emberOrigins[i * 3 + 0] = center.x + (rand() - 0.5) * 0.8;
      emberOrigins[i * 3 + 1] = center.y + rand() * 0.05;
      emberOrigins[i * 3 + 2] = center.z + (rand() - 0.5) * 0.8;

      emberPos[i * 3 + 0] = emberOrigins[i * 3 + 0]!;
      emberPos[i * 3 + 1] = emberOrigins[i * 3 + 1]!;
      emberPos[i * 3 + 2] = emberOrigins[i * 3 + 2]!;

      emberParams[i * 3 + 0] = rand();                // initial phase
      emberParams[i * 3 + 1] = 0.6 + rand() * 0.6;    // rise speed
      emberParams[i * 3 + 2] = 0.5 + rand() * 0.8;    // size
    }

    emberGeo.setAttribute('position', new BufferAttribute(emberPos, 3));
    emberGeo.setAttribute('aOrigin', new BufferAttribute(emberOrigins, 3));
    emberGeo.setAttribute('aParam', new BufferAttribute(emberParams, 3));

    this.emberMat = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        attribute vec3 aOrigin;
        attribute vec3 aParam;
        varying float vLife;

        void main() {
          float phase = aParam.x;
          float speed = aParam.y;
          float scale = aParam.z;

          float life = fract(phase + uTime * speed * 0.35);
          vLife = life;

          // Rises and drifts with wind & thermal turbulence
          vec3 p = aOrigin;
          p.y += life * 2.8;
          p.x += sin(life * 9.0 + aOrigin.x * 2.0) * 0.22 + life * 0.35;
          p.z += cos(life * 7.5 + aOrigin.z * 2.0) * 0.22 + life * 0.2;

          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;

          gl_PointSize = (scale * 28.0 * (1.0 - life * 0.4)) / -mvPosition.z;
          gl_PointSize = clamp(gl_PointSize, 1.0, 16.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vLife;

        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float shape = smoothstep(0.5, 0.05, d);

          // Color transition: hot yellow -> fiery ember orange -> dark red ash
          vec3 hot = vec3(1.0, 0.92, 0.45);
          vec3 mid = vec3(1.0, 0.35, 0.02);
          vec3 cold = vec3(0.5, 0.08, 0.02);

          vec3 color = mix(hot, mid, smoothstep(0.0, 0.4, vLife));
          color = mix(color, cold, smoothstep(0.4, 0.9, vLife));

          float fade = smoothstep(0.0, 0.1, vLife) * smoothstep(1.0, 0.75, vLife);
          gl_FragColor = vec4(color, shape * fade);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    this.emberPoints = new Points(emberGeo, this.emberMat);
    this.scene.add(this.emberPoints);

    /* --- 3. Thin Brazier Smoke --- */
    const smokeCount = quality.smokeCount * 2;
    const smokeGeo = new BufferGeometry();
    const smokePos = new Float32Array(smokeCount * 3);
    const smokeOrigins = new Float32Array(smokeCount * 3);
    const smokeParams = new Float32Array(smokeCount * 2);

    for (let i = 0; i < smokeCount; i++) {
      const center = brazierCenters[i % 2]!;
      smokeOrigins[i * 3 + 0] = center.x + (rand() - 0.5) * 0.4;
      smokeOrigins[i * 3 + 1] = center.y + 0.1;
      smokeOrigins[i * 3 + 2] = center.z + (rand() - 0.5) * 0.4;

      smokePos[i * 3 + 0] = smokeOrigins[i * 3 + 0]!;
      smokePos[i * 3 + 1] = smokeOrigins[i * 3 + 1]!;
      smokePos[i * 3 + 2] = smokeOrigins[i * 3 + 2]!;

      smokeParams[i * 2 + 0] = rand();             // phase
      smokeParams[i * 2 + 1] = 0.25 + rand() * 0.25; // speed
    }

    smokeGeo.setAttribute('position', new BufferAttribute(smokePos, 3));
    smokeGeo.setAttribute('aOrigin', new BufferAttribute(smokeOrigins, 3));
    smokeGeo.setAttribute('aParam', new BufferAttribute(smokeParams, 2));

    this.smokeMat = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        attribute vec3 aOrigin;
        attribute vec2 aParam;
        varying float vLife;

        void main() {
          float phase = aParam.x;
          float speed = aParam.y;
          float life = fract(phase + uTime * speed * 0.25);
          vLife = life;

          vec3 p = aOrigin;
          p.y += life * 3.4;
          p.x += sin(life * 4.0 + aOrigin.x) * 0.4 + life * 0.6;
          p.z += cos(life * 3.5 + aOrigin.z) * 0.4 + life * 0.35;

          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;

          // Smoke expands as it rises
          float size = mix(18.0, 75.0, life);
          gl_PointSize = size / -mvPosition.z;
          gl_PointSize = clamp(gl_PointSize, 2.0, 50.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vLife;

        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float shape = smoothstep(0.5, 0.0, d);

          // Soft translucent smoke
          float alpha = shape * smoothstep(0.0, 0.2, vLife) * smoothstep(1.0, 0.45, vLife) * 0.18;
          vec3 smokeColor = vec3(0.24, 0.22, 0.20);
          gl_FragColor = vec4(smokeColor, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
    });

    this.smokePoints = new Points(smokeGeo, this.smokeMat);
    this.scene.add(this.smokePoints);
  }

  update(time: number): void {
    this.dustMat.uniforms['uTime']!.value = time;
    this.emberMat.uniforms['uTime']!.value = time;
    this.smokeMat.uniforms['uTime']!.value = time;
  }

  dispose(): void {
    this.scene.remove(this.dustPoints);
    this.dustPoints.geometry.dispose();
    this.dustMat.dispose();

    this.scene.remove(this.emberPoints);
    this.emberPoints.geometry.dispose();
    this.emberMat.dispose();

    this.scene.remove(this.smokePoints);
    this.smokePoints.geometry.dispose();
    this.smokeMat.dispose();
  }
}
