import {
  Color,
  DirectionalLight,
  EquirectangularReflectionMapping,
  HemisphereLight,
  PCFShadowMap,
  Vector3,
  type Material,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import type { QualityProfile } from './types.js';

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
    readonly quality: QualityProfile
  ) {
    // Enable soft shadow filtering on renderer
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;

    // Calculate low golden hour sun vector
    const elevationRad = (SUN_ELEVATION_DEG * Math.PI) / 180;
    this.sunDirection.set(
      Math.cos(SUN_AZIMUTH) * Math.cos(elevationRad),
      Math.sin(elevationRad),
      Math.sin(SUN_AZIMUTH) * Math.cos(elevationRad)
    ).normalize();

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
      lightIntensity: 3.2,
    });

    // Tune cascade shadow lights
    for (const light of this.csm.lights) {
      light.color.copy(this.sunColor);
      light.shadow.bias = -0.00035;
      light.shadow.normalBias = 0.035;
      light.shadow.radius = 2.2;
    }

    this.sun = this.csm.lights[0] ?? new DirectionalLight(this.sunColor, 3.2);

    // Sky fill: cool slate-blue from above with warm earth bounce from below
    this.skyFill = new HemisphereLight(
      new Color().setRGB(0.36, 0.46, 0.62),
      new Color().setRGB(0.16, 0.12, 0.09),
      0.62
    );
    this.scene.add(this.skyFill);

    // Cool rim light from opposite the sun to pop character silhouettes against stone
    const rimAzimuth = SUN_AZIMUTH + Math.PI;
    const rimElevation = (14 * Math.PI) / 180;
    const rimDir = new Vector3(
      Math.cos(rimAzimuth) * Math.cos(rimElevation),
      Math.sin(rimElevation),
      Math.sin(rimAzimuth) * Math.cos(rimElevation)
    ).normalize();

    this.rimLight = new DirectionalLight(new Color().setRGB(0.40, 0.50, 0.68), 0.65);
    this.rimLight.position.copy(rimDir).multiplyScalar(50);
    this.rimLight.castShadow = false;
    this.scene.add(this.rimLight);

    this.loadSkyHdr();
  }

  private loadSkyHdr(): void {
    const skyYaw = (SKY_SUN_U - 0.5) * Math.PI * 2 - SUN_AZIMUTH;
    this.scene.backgroundRotation.set(0, skyYaw, 0);
    this.scene.environmentRotation.set(0, skyYaw, 0);
    // Keep sky and environment balanced so sky colors and clouds never clip to white
    this.scene.backgroundIntensity = 0.62;
    this.scene.environmentIntensity = 0.48;

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
