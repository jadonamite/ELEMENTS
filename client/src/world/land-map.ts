import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, SRGBColorSpace, UnsignedByteType, Vector4 } from 'three';
import { IGNIS, LEGACY_SINDR_ORIGIN as O } from '../../../shared/src/world/ignis/coordinates.js';

export interface LandMap {
  /** Shader uniforms: the colour map and the rectangle of the scene it covers (x0, z0, 1/width, 1/depth). */
  uniforms: { tLand: { value: DataTexture }; uLandRect: { value: Vector4 }; uLandOn: { value: number } };
  /** Resolves when the coarse pass is in; the fine pass follows without holding the loader. */
  ready: Promise<void>;
  dispose(): void;
}

/**
 * The nation's ground colour as one texture, baked off the main thread from the shared land types.
 * A coarse pass lands first so the land is never one flat colour; the fine pass replaces it.
 */
export function createLandMap(steps: readonly number[] = [64, 16]): LandMap {
  const blank = new DataTexture(new Uint8Array([120, 112, 100, 0]), 1, 1, RGBAFormat, UnsignedByteType);
  blank.colorSpace = SRGBColorSpace; blank.needsUpdate = true;
  const uniforms = {
    tLand: { value: blank },
    uLandRect: { value: new Vector4(-O.x, -O.z, 1 / IGNIS.width, 1 / IGNIS.depth) },
    uLandOn: { value: 0 },
  };
  const worker = new Worker(new URL('./land-worker.ts', import.meta.url), { type: 'module' });
  let pending = 0, done!: () => void;
  const ready = new Promise<void>(resolve => { done = resolve; });
  worker.onmessage = (event: MessageEvent<{ nx: number; nz: number; rgba: Uint8Array }>) => {
    const { nx, nz, rgba } = event.data, texture = new DataTexture(rgba, nx, nz, RGBAFormat, UnsignedByteType);
    texture.colorSpace = SRGBColorSpace; texture.magFilter = LinearFilter; texture.minFilter = LinearMipmapLinearFilter;
    texture.generateMipmaps = true; texture.needsUpdate = true;
    uniforms.tLand.value.dispose(); uniforms.tLand.value = texture; uniforms.uLandOn.value = 1;
    done();
    if (pending < steps.length) worker.postMessage({ step: steps[pending++] }); else worker.terminate();
  };
  worker.onerror = () => { worker.terminate(); done(); };
  worker.postMessage({ step: steps[pending++] });
  return { uniforms, ready, dispose: () => { worker.terminate(); uniforms.tLand.value.dispose(); } };
}
