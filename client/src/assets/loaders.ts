/**
 * The game's one KTX2 transcoder and one glTF loader (meshopt + KTX2). Every model and compressed
 * texture goes through these, so the transcoder runs one worker pool and a file asked for by
 * several systems (hero, villains, crowd) is fetched and parsed once.
 */

import type { Texture, WebGLRenderer } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const TRANSCODER_PATH = '/assets/env/ignis/basis/';

export interface Loaders {
  readonly gltf: GLTFLoader;
  readonly ktx2: KTX2Loader;
  /** A parsed file shared by every caller; callers clone what they change. */
  model(path: string): Promise<GLTF>;
  /** A KTX2 texture, transcoded to the GPU's compressed format. */
  texture(path: string): Promise<Texture>;
}

let shared: Loaders | null = null;

/** The shared loaders. The first renderer passed decides which compressed formats to transcode to. */
export function loaders(renderer: WebGLRenderer): Loaders {
  if (shared) return shared;
  const ktx2 = new KTX2Loader().setTranscoderPath(TRANSCODER_PATH).detectSupport(renderer);
  const gltf = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
  const files = new Map<string, Promise<GLTF>>();
  shared = {
    gltf,
    ktx2,
    model(path) {
      let pending = files.get(path);
      if (!pending) {
        pending = gltf.loadAsync(path);
        // A failed file is forgotten, so asking again retries it.
        pending.catch(() => files.delete(path));
        files.set(path, pending);
      }
      return pending;
    },
    texture: (path) => ktx2.loadAsync(path),
  };
  return shared;
}
