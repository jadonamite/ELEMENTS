import {
  HalfFloatType,
  Vector2,
  WebGLRenderTarget,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { VignetteShader } from 'three/examples/jsm/shaders/VignetteShader.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { LUTPass } from 'three/examples/jsm/postprocessing/LUTPass.js';
import { LUTCubeLoader } from 'three/examples/jsm/loaders/LUTCubeLoader.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';
import balance from '../../../shared/balance.json';
import type { QualityProfile } from './types.js';
import type { GodRaysSystem } from './godrays.js';

const look = balance.look;

/**
 * Clamps every pixel between 0 and 64 to prevent NaN/Inf spreading through bloom.
 * MUST be first pass after RenderPass.
 */
export const SANITIZE_SHADER = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      gl_FragColor = max(min(texture2D(tDiffuse, vUv), vec4(64.0)), vec4(0.0));
    }
  `,
};

export class PostProcessingPipeline {
  readonly composer: EffectComposer;
  readonly renderPass: RenderPass;
  readonly sanitizePass: ShaderPass;
  readonly gtaoPass: GTAOPass | null = null;
  readonly bloomPass: UnrealBloomPass;
  readonly lutPass: LUTPass;
  readonly vignettePass: ShaderPass;
  readonly smaaPass: SMAAPass | null = null;
  readonly fxaaPass: FXAAPass | null = null;
  readonly outputPass: OutputPass;

  private width = 1;
  private height = 1;
  private scale = 1;
  private frames = 0;
  private frameTime = 0;
  private last = performance.now();

  constructor(
    readonly renderer: WebGLRenderer,
    readonly scene: Scene,
    readonly camera: PerspectiveCamera,
    readonly quality: QualityProfile,
    readonly godRays: GodRaysSystem
  ) {
    const renderTarget = new WebGLRenderTarget(1, 1, {
      type: HalfFloatType,
      samples: 0,
    });
    this.composer = new EffectComposer(renderer, renderTarget);

    // 1. Render Pass
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // 2. Sanitize Pass: MUST be first after RenderPass
    this.sanitizePass = new ShaderPass(SANITIZE_SHADER);
    this.composer.addPass(this.sanitizePass);

    // 3. Screen-Space Ambient Occlusion (half-res on high if enabled)
    if (quality.enableGTAO) {
      this.gtaoPass = new GTAOPass(scene, camera, 320, 180);
      this.gtaoPass.blendIntensity = 0.7;
      this.gtaoPass.updateGtaoMaterial({
        radius: 1.5,
        distanceExponent: 1.4,
        thickness: 1.0,
        scale: 1.0,
        samples: 6,
      });
      this.composer.addPass(this.gtaoPass);
    }

    // 4. Volumetric Light Shafts (God Rays from the sun)
    if (quality.enableGodRays) {
      this.composer.addPass(godRays.pass);
    }

    // 5. Bloom: subtle for elemental glowing effects and brazier coals
    this.bloomPass = new UnrealBloomPass(
      new Vector2(1, 1),
      look.bloomStrength ?? 0.15,
      0.4,
      look.bloomThreshold ?? 1.6
    );
    this.composer.addPass(this.bloomPass);

    // 6. Color Grading: LUTPass with golden_hour.cube
    this.lutPass = new LUTPass();
    this.lutPass.intensity = 0.0;
    this.composer.addPass(this.lutPass);

    new LUTCubeLoader().load('/assets/env/arena/golden_hour.cube', (result) => {
      this.lutPass.lut = result.texture3D;
      this.lutPass.intensity = 0.85;
    });

    // 7. Subtle Vignette
    this.vignettePass = new ShaderPass(VignetteShader);
    this.vignettePass.uniforms['offset']!.value = 0.95;
    this.vignettePass.uniforms['darkness']!.value = look.vignette ?? 0.82;
    this.composer.addPass(this.vignettePass);

    // 8. Anti-Aliasing (SMAA on high, FXAA on low)
    if (quality.enableSMAA) {
      this.smaaPass = new SMAAPass();
      this.composer.addPass(this.smaaPass);
      this.outputPass = new OutputPass();
      this.composer.addPass(this.outputPass);
    } else {
      this.outputPass = new OutputPass();
      this.composer.addPass(this.outputPass);
      this.fxaaPass = new FXAAPass();
      this.composer.addPass(this.fxaaPass);
    }
  }

  setSize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    this.applySize();
  }

  private applySize(): void {
    const ceiling = Math.min(window.devicePixelRatio, look.maxPixelRatio);
    const ratio = Math.max(look.minPixelRatio, ceiling * this.scale);

    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(this.width, this.height, false);

    this.composer.setPixelRatio(ratio);
    this.composer.setSize(this.width, this.height);

    const actualW = Math.floor(this.width * ratio);
    const actualH = Math.floor(this.height * ratio);

    if (this.gtaoPass) {
      this.gtaoPass.setSize(Math.max(1, Math.floor(actualW / 2)), Math.max(1, Math.floor(actualH / 2)));
    }
    if (this.smaaPass) {
      this.smaaPass.setSize(actualW, actualH);
    }
    if (this.fxaaPass) {
      this.fxaaPass.setSize(actualW, actualH);
    }
  }

  private govern(): void {
    const now = performance.now();
    const delta = now - this.last;
    this.last = now;
    if (delta > 100) return;
    this.frameTime += delta;
    if (++this.frames < 60) return;
    const average = this.frameTime / this.frames;
    this.frames = 0;
    this.frameTime = 0;

    const ceiling = Math.min(window.devicePixelRatio, look.maxPixelRatio);
    const ratio = this.renderer.getPixelRatio();
    if (average > look.slowFrameMs && ratio > look.minPixelRatio) {
      this.scale -= look.pixelRatioStep / ceiling;
      this.applySize();
    } else if (average < look.fastFrameMs && ratio < ceiling) {
      this.scale = Math.min(1, this.scale + look.pixelRatioStep / ceiling);
      this.applySize();
    }
  }

  render(): void {
    this.govern();
    this.composer.render();
  }

  dispose(): void {
    this.composer.dispose();
    this.gtaoPass?.dispose();
    this.bloomPass.dispose();
    this.lutPass.dispose();
    this.vignettePass.dispose();
    this.smaaPass?.dispose();
    this.fxaaPass?.dispose();
  }
}
