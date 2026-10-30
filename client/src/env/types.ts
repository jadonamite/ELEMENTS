import type { Camera, Scene, Texture, WebGLRenderer } from 'three';

export type QualityLevel = 'high' | 'low';

export interface QualityProfile {
  level: QualityLevel;
  textureSuffix: '2k' | '1k';
  grassCount: number;
  dustCount: number;
  emberCount: number;
  smokeCount: number;
  csmCascades: number;
  csmShadowMapSize: number;
  enableGTAO: boolean;
  enableGodRays: boolean;
  enablePOM: boolean;
  enableSMAA: boolean;
}

export interface EnvContext {
  scene: Scene;
  camera: Camera;
  renderer: WebGLRenderer;
  quality: QualityProfile;
}

export interface UpdatableEnv {
  update(time: number, delta: number, camera: Camera): void;
  dispose(): void;
}
