import type { QualityLevel, QualityProfile } from './types.js';

export function getInitialQuality(): QualityLevel {
  const param = new URLSearchParams(window.location.search).get('fxQuality');
  return param === 'low' ? 'low' : 'high';
}

export function createQualityProfile(level: QualityLevel): QualityProfile {
  if (level === 'low') {
    return {
      level: 'low',
      textureSuffix: '1k',
      grassCount: 3500,
      dustCount: 180,
      emberCount: 25,
      smokeCount: 15,
      csmCascades: 2,
      csmShadowMapSize: 1024,
      enableGTAO: false,
      enableGodRays: false,
      enablePOM: false,
      enableSMAA: false,
    };
  }

  return {
    level: 'high',
    textureSuffix: '2k',
    grassCount: 7000,
    dustCount: 500,
    emberCount: 70,
    smokeCount: 35,
    csmCascades: 2,
    csmShadowMapSize: 1024,
    enableGTAO: false,
    enableGodRays: true,
    enablePOM: true,
    enableSMAA: true,
  };
}

export class QualityManager {
  profile: QualityProfile;
  private readonly listeners: Array<(profile: QualityProfile) => void> = [];
  private fallbackChecked = false;
  private frameCount = 0;
  private totalFrameTime = 0;
  private startTime = performance.now();

  constructor(initialLevel: QualityLevel = getInitialQuality()) {
    this.profile = createQualityProfile(initialLevel);
  }

  onChange(listener: (profile: QualityProfile) => void): void {
    this.listeners.push(listener);
  }

  /**
   * Samples frame duration for the first 5 seconds.
   * If average frame time exceeds 18 ms on high quality, auto-fallbacks to low.
   */
  sampleFrame(deltaSeconds: number): void {
    if (this.fallbackChecked || this.profile.level !== 'high') return;

    const deltaMs = deltaSeconds * 1000;
    if (deltaMs < 200) {
      this.totalFrameTime += deltaMs;
      this.frameCount++;
    }

    const elapsed = performance.now() - this.startTime;
    if (elapsed >= 5000) {
      this.fallbackChecked = true;
      if (this.frameCount > 30) {
        const avg = this.totalFrameTime / this.frameCount;
        if (avg > 18) {
          console.warn(`[Quality] High quality average frame time (${avg.toFixed(1)} ms > 18 ms) triggered fallback to low.`);
          this.setQuality('low');
        }
      }
    }
  }

  setQuality(level: QualityLevel): void {
    if (this.profile.level === level) return;
    this.profile = createQualityProfile(level);
    for (const listener of this.listeners) {
      listener(this.profile);
    }
  }
}
