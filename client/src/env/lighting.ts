import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  EquirectangularReflectionMapping,
  Float32BufferAttribute,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PCFShadowMap,
  PlaneGeometry,
  Points,
  PointsMaterial,
  SphereGeometry,
  Vector3,
  type Material,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import type { QualityProfile } from './types.js';

import type { Element } from '../../../shared/src/index.js';
import { getNationGeography } from './nations.js';

/** Sun horizontal coordinate in evening_road_01_puresky_1k.hdr. */
export const SKY_SUN_U = 0.6074;
/** Sun elevation in degrees measured from the HDR image. */
export const SUN_ELEVATION_DEG = 9.49;
/** Compass angle of the sun in world space radians (atan2(z, x)). */
export const SUN_AZIMUTH = 2.6;

export class LightingSystem {
  readonly sunDirection = new Vector3();
  readonly sunColor = new Color().setRGB(1.0, 0.76, 0.48);
  readonly sun: DirectionalLight;
  readonly skyFill: HemisphereLight;
  readonly rimLight: DirectionalLight;
  readonly csm: CSM;
  private disposed = false;

  constructor(
    readonly scene: Scene,
    readonly camera: PerspectiveCamera,
    readonly renderer: WebGLRenderer,
    readonly quality: QualityProfile,
    nation: Element = 'IGNIS',
    isFullMoon = false
  ) {
    const geo = getNationGeography(nation);
    const met = geo.meteorology;

    // Enable soft shadow filtering on renderer
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;

    // Attune lighting color and intensity to the designated nation
    if (nation === 'AQUES') {
      if (isFullMoon) {
        this.sunColor.setHex(0xb0d8ff); // Radiant full moon silvery-blue
      } else {
        this.sunColor.setHex(met.sunColor);
      }
    } else {
      this.sunColor.setHex(met.sunColor);
    }

    // Calculate sun or moon vector
    if (isFullMoon) {
      // Moon in front of the player's gaze
      this.sunDirection.set(-8, 24, 38).normalize();
    } else {
      const elevationRad = (SUN_ELEVATION_DEG * Math.PI) / 180;
      this.sunDirection.set(
        Math.cos(SUN_AZIMUTH) * Math.cos(elevationRad),
        Math.sin(elevationRad),
        Math.sin(SUN_AZIMUTH) * Math.cos(elevationRad)
      ).normalize();
    }

    // Cascaded Shadow Maps (CSM) for crisp near shadows and clean far coverage
    this.csm = new CSM({
      camera: this.camera,
      parent: this.scene,
      cascades: this.quality.csmCascades,
      maxFar: 65,
      mode: 'practical',
      shadowMapSize: this.quality.csmShadowMapSize,
      shadowBias: -0.0003,
      lightDirection: this.sunDirection.clone().negate(),
      lightIntensity: isFullMoon && nation === 'AQUES' ? 3.6 : met.sunIntensity,
    });

    // Tune cascade shadow lights
    for (const light of this.csm.lights) {
      light.color.copy(this.sunColor);
      light.shadow.bias = -0.00035;
      light.shadow.normalBias = 0.035;
      light.shadow.radius = 2.2;
    }

    this.sun = this.csm.lights[0] ?? new DirectionalLight(this.sunColor, met.sunIntensity);

    // Sky fill attuned to nation's meteorology
    const skyColor = nation === 'AQUES' ? (isFullMoon ? new Color(0x355880) : new Color(0x5a7fa8))
      : nation === 'AURA' ? new Color(0x7095be)
      : nation === 'TERRA' ? new Color(0x786048)
      : new Color().setRGB(0.52, 0.62, 0.78);
    const groundColor = nation === 'AQUES' ? (isFullMoon ? new Color(0x182c44) : new Color(0x283e58))
      : nation === 'AURA' ? new Color(0x384c60)
      : nation === 'TERRA' ? new Color(0x3c2c1e)
      : new Color().setRGB(0.28, 0.22, 0.18);

    this.skyFill = new HemisphereLight(skyColor, groundColor, isFullMoon ? 1.05 : met.ambientLight);
    this.scene.add(this.skyFill);

    // Rim light attuned to environment
    const rimAzimuth = SUN_AZIMUTH + Math.PI;
    const rimElevation = (14 * Math.PI) / 180;
    const rimDir = new Vector3(
      Math.cos(rimAzimuth) * Math.cos(rimElevation),
      Math.sin(rimElevation),
      Math.sin(rimAzimuth) * Math.cos(rimElevation)
    ).normalize();

    const rimColor = nation === 'AQUES' ? new Color(0x77bbff)
      : nation === 'AURA' ? new Color(0x99ccff)
      : nation === 'TERRA' ? new Color(0xeeaa66)
      : new Color().setRGB(0.50, 0.60, 0.78);

    this.rimLight = new DirectionalLight(rimColor, 0.85);
    this.rimLight.position.copy(rimDir).multiplyScalar(50);
    this.rimLight.castShadow = false;
    this.scene.add(this.rimLight);

    if (isFullMoon) {
      this.createNightFullMoon();
    } else {
      this.loadSkyHdr();
    }
  }

  private createNightFullMoon(): void {
    // Arctic night sky background
    this.scene.background = new Color(0x0a1628);
    this.scene.environmentIntensity = 0.72;

    // Load HDR environment map to illuminate PBR materials under moonlight
    new HDRLoader().load('/assets/hdri/evening_road_01_puresky_1k.hdr', (hdr) => {
      if (this.disposed) {
        hdr.dispose();
        return;
      }
      hdr.mapping = EquirectangularReflectionMapping;
      this.scene.environment = hdr;
    });

    // 1. Starfield in the dark heavens
    const starCount = 380;
    const starPositions: number[] = [];
    for (let i = 0; i < starCount; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);
      const r = 95.0;
      const y = Math.abs(Math.sin(phi) * r) + 4;
      starPositions.push(Math.cos(theta) * Math.sin(phi) * r, y, Math.sin(theta) * Math.cos(phi) * r);
    }
    const starGeo = new BufferGeometry();
    starGeo.setAttribute('position', new Float32BufferAttribute(starPositions, 3));
    const starMat = new PointsMaterial({ color: 0xffffff, size: 0.9, transparent: true, opacity: 0.85 });
    const stars = new Points(starGeo, starMat);
    this.scene.add(stars);

    // 2. Radiant 3D Full Moon Sphere in front of player
    const moonGeo = new SphereGeometry(5.8, 32, 32);
    const moonMat = new MeshBasicMaterial({ color: 0xf5faff });
    const moonMesh = new Mesh(moonGeo, moonMat);
    moonMesh.position.set(-8, 22, 38);
    this.scene.add(moonMesh);

    // 3. Ethereal Lunar Halo
    const haloCanvas = document.createElement('canvas');
    haloCanvas.width = haloCanvas.height = 256;
    const hctx = haloCanvas.getContext('2d')!;
    const grad = hctx.createRadialGradient(128, 128, 15, 128, 128, 128);
    grad.addColorStop(0, 'rgba(215, 238, 255, 0.95)');
    grad.addColorStop(0.2, 'rgba(180, 220, 255, 0.55)');
    grad.addColorStop(0.55, 'rgba(110, 175, 240, 0.18)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    hctx.fillStyle = grad;
    hctx.fillRect(0, 0, 256, 256);

    const haloTex = new CanvasTexture(haloCanvas);
    const haloMat = new MeshBasicMaterial({
      map: haloTex,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const moonHalo = new Mesh(new PlaneGeometry(42, 42), haloMat);
    moonHalo.position.copy(moonMesh.position);
    moonHalo.lookAt(0, 2, 0);
    this.scene.add(moonHalo);
  }

  private loadSkyHdr(): void {
    const skyYaw = (SKY_SUN_U - 0.5) * Math.PI * 2 - SUN_AZIMUTH;
    this.scene.backgroundRotation.set(0, skyYaw, 0);
    this.scene.environmentRotation.set(0, skyYaw, 0);
    // Keep sky and environment bright and luminous
    this.scene.backgroundIntensity = 0.90;
    this.scene.environmentIntensity = 0.85;

    new HDRLoader().load('/assets/hdri/evening_road_01_puresky_1k.hdr', (hdr) => {
      if (this.disposed) {
        hdr.dispose();
        return;
      }
      hdr.mapping = EquirectangularReflectionMapping;
      this.scene.background = hdr;
      this.scene.environment = hdr;
    }, undefined, () => {
      new HDRLoader().load('/assets/hdri/belfast_sunset_puresky_1k.hdr', (fallbackHdr) => {
        if (this.disposed) {
          fallbackHdr.dispose();
          return;
        }
        fallbackHdr.mapping = EquirectangularReflectionMapping;
        this.scene.background = fallbackHdr;
        this.scene.environment = fallbackHdr;
      });
    });
  }

  setupMaterial(material: Material): void {
    this.csm.setupMaterial(material);
  }

  update(): void {
    this.csm.update();
  }

  dispose(): void {
    this.disposed = true;
    this.csm.dispose();
    this.scene.remove(this.skyFill);
    this.skyFill.dispose();
    this.scene.remove(this.rimLight);
    this.rimLight.dispose();
  }
}
