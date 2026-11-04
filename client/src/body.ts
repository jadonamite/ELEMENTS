/**
 * Builds fighters in commoner's rags: the outfit carries the skeleton, the creator body
 * gives only its head, eyes and brows, plus skin tone, hair, body preset, and animation
 * clips fitted to the outfit's proportions.
 */

import {
  AnimationClip,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Skeleton,
  SkinnedMesh,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  BODY_PRESET_OPTIONS,
  type CharacterConfig,
  HAIR_COLOR_PRESETS,
  HAIR_STYLE_OPTIONS,
  SKIN_TONE_PRESETS,
  type Sex,
} from './creator/creator-types.js';

export type BodyLook = 'hero' | 'villain';

/** Pelvis rest height of the mannequin the clips were authored on. */
const CLIP_PELVIS_HEIGHT = 0.918;
const BODY_PATH: Record<Sex, string> = {
  male: '/assets/characters/creator/male.glb',
  female: '/assets/characters/creator/female.glb',
};
const OUTFIT_PATH: Record<Sex, string> = {
  male: '/assets/characters/creator/peasant_male.glb',
  female: '/assets/characters/creator/peasant_female.glb',
};
const OUTFIT_FILES = new Set(Object.values(OUTFIT_PATH));
/** Patched, greener rags for robbers. */
const WORN_RAGS_PATH = '/assets/characters/creator/peasant_worn.webp';
/** Bones whose vertices make up the head kept from the creator body. */
const HEAD_BONES = new Set(['Head', 'neck_01']);

interface SkinUniforms {
  uSkinColor: { value: Color };
  uCloth: { value: Color };
  uVillain: { value: number };
}

/**
 * Tints the base body: skin takes the chosen tone with the texture's shading kept,
 * the plain underwear fabric becomes cloth. Villains get ashen skin and ember-black cloth.
 */
export function applySkinShader(mat: MeshStandardMaterial, uniforms: SkinUniforms): void {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader =
      'uniform vec3 uSkinColor;\nuniform vec3 uCloth;\nuniform float uVillain;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `
      #ifdef USE_MAP
        vec4 sampledColor = texture2D( map, vMapUv );
        float maxDiff = max(abs(sampledColor.r - sampledColor.g), max(abs(sampledColor.g - sampledColor.b), abs(sampledColor.r - sampledColor.b)));
        float lum = dot(sampledColor.rgb, vec3(0.299, 0.587, 0.114));
        if (maxDiff < 0.045 && sampledColor.r < 0.65) {
          diffuseColor.rgb *= uCloth * (0.6 + lum);
        } else {
          vec3 skin = uSkinColor * (lum / 0.44);
          diffuseColor.rgb = mix(skin, mix(skin, vec3(dot(skin, vec3(0.333))) * vec3(0.8, 0.74, 0.7), 0.4) * 0.62, uVillain);
        }
      #endif
      `,
    );
  };
  mat.customProgramCacheKey = () => 'elements-skin';
  mat.needsUpdate = true;
}

function isBodyMesh(mesh: Mesh): boolean {
  const name = mesh.name.toLowerCase();
  const matName = ((mesh.material as MeshStandardMaterial)?.name ?? '').toLowerCase();
  return name.includes('superhero') || name.includes('retopology') || matName.includes('superhero');
}

/** The body's triangles whose vertices all hang mostly from the head or neck. */
function headOnly(mesh: SkinnedMesh): BufferGeometry {
  const src = mesh.geometry;
  const joints = src.getAttribute('skinIndex');
  const weights = src.getAttribute('skinWeight');
  const keep = new Uint8Array(joints.count);
  for (let v = 0; v < joints.count; v++) {
    let w = 0;
    for (let k = 0; k < 4; k++) {
      const bone = mesh.skeleton.bones[joints.getComponent(v, k)];
      if (bone && HEAD_BONES.has(bone.name)) w += weights.getComponent(v, k);
    }
    keep[v] = w >= 0.5 ? 1 : 0;
  }
  const index = src.getIndex();
  const count = index ? index.count : joints.count;
  const out: number[] = [];
  for (let i = 0; i < count; i += 3) {
    const a = index ? index.getX(i) : i;
    const b = index ? index.getX(i + 1) : i + 1;
    const c = index ? index.getX(i + 2) : i + 2;
    if (keep[a] && keep[b] && keep[c]) out.push(a, b, c);
  }
  const geo = new BufferGeometry();
  for (const [name, attr] of Object.entries(src.attributes)) geo.setAttribute(name, attr);
  geo.setIndex(out);
  geo.boundingSphere = src.boundingSphere;
  return geo;
}

/** A copy of a skinned mesh that keeps its own bind pose but follows the rig's bones. */
function rebind(src: SkinnedMesh, rig: Skeleton, geometry = src.geometry): SkinnedMesh {
  const mesh = new SkinnedMesh(geometry, (src.material as MeshStandardMaterial).clone());
  mesh.name = src.name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  const bones = src.skeleton.bones.map(b => rig.getBoneByName(b.name) ?? b);
  mesh.bind(new Skeleton(bones, src.skeleton.boneInverses), src.bindMatrix);
  return mesh;
}

/** Loads the creator's bodies and hair once; fighters are cloned from these. */
export class BodyKit {
  private readonly scenes = new Map<string, Object3D>();
  private readonly fitted = new Map<string, AnimationClip[]>();
  private readonly heads = new Map<string, BufferGeometry>();
  private wornRags: Promise<Texture> | null = null;

  constructor(private readonly loader = new GLTFLoader()) {}

  async preload(paths: readonly string[] = [...Object.values(BODY_PATH), ...Object.values(OUTFIT_PATH)]): Promise<void> {
    await Promise.all(paths.map(p => this.scene(p)));
  }

  private async scene(path: string): Promise<Object3D> {
    let s = this.scenes.get(path);
    if (!s) {
      s = (await this.loader.loadAsync(path)).scene;
      if (OUTFIT_FILES.has(path)) joinByMaterial(s);
      this.scenes.set(path, s);
    }
    return s;
  }

  private worn(): Promise<Texture> {
    this.wornRags ??= new TextureLoader().loadAsync(WORN_RAGS_PATH).then((t) => {
      t.flipY = false;
      t.colorSpace = SRGBColorSpace;
      return t;
    });
    return this.wornRags;
  }

  /** A posable fighter for this configuration, with its own materials; `cloth` dyes the outfit. */
  async build(config: CharacterConfig, look: BodyLook = 'hero', cloth?: number): Promise<Group> {
    const model = cloneSkinned(await this.scene(OUTFIT_PATH[config.sex]));
    const group = new Group();
    group.name = look === 'hero' ? 'Hero' : 'Villain';
    group.add(model);

    const skin = SKIN_TONE_PRESETS.find(p => p.id === config.skinToneId) ?? SKIN_TONE_PRESETS[5]!;
    const hair = HAIR_COLOR_PRESETS.find(c => c.id === config.hairColorId) ?? HAIR_COLOR_PRESETS[1]!;
    const uniforms: SkinUniforms = {
      uSkinColor: { value: new Color(skin.color) },
      uCloth: { value: cloth !== undefined ? new Color(cloth) : look === 'villain' ? new Color(0.16, 0.05, 0.035) : new Color(0.2, 0.18, 0.16) },
      uVillain: { value: look === 'villain' ? 1 : 0 },
    };
    const worn = look === 'villain' ? await this.worn() : null;

    let rig: SkinnedMesh | null = null;
    model.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh) return;
      const mat = (mesh.material as MeshStandardMaterial).clone();
      mesh.material = mat;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if ((mesh as SkinnedMesh).isSkinnedMesh && !rig) rig = mesh as SkinnedMesh;
      if (mat.name.toLowerCase().includes('peasant')) {
        if (worn) {
          mat.map = worn;
          mat.color.setRGB(0.62, 0.55, 0.5);
        }
        if (cloth !== undefined) mat.color.setHex(cloth);
      } else {
        applySkinShader(mat, uniforms);
      }
    });
    const rigMesh = rig as SkinnedMesh | null;
    if (!rigMesh) return group;

    // Head, eyes and brows come from the creator body, following the outfit's bones.
    const body = await this.scene(BODY_PATH[config.sex]);
    body.traverse((node) => {
      const src = node as SkinnedMesh;
      if (!src.isSkinnedMesh) return;
      let geometry = src.geometry;
      if (isBodyMesh(src)) {
        geometry = this.heads.get(config.sex) ?? headOnly(src);
        this.heads.set(config.sex, geometry);
      }
      const mesh = rebind(src, rigMesh.skeleton, geometry);
      const mat = mesh.material as MeshStandardMaterial;
      if (isBodyMesh(src)) applySkinShader(mat, uniforms);
      else if (mesh.name.toLowerCase().includes('eyebrow')) mat.color.setHex(hair.color);
      rigMesh.parent?.add(mesh);
    });

    const style = HAIR_STYLE_OPTIONS.find(h => h.id === config.hairStyleId);
    if (style?.assetFile) {
      const hairScene = await this.scene(`/assets/characters/creator/${style.assetFile}`);
      let source: SkinnedMesh | null = null;
      hairScene.traverse((n) => { if ((n as SkinnedMesh).isSkinnedMesh && !source) source = n as SkinnedMesh; });
      const src = source as SkinnedMesh | null;
      if (src) {
        const hairMesh = rebind(src, rigMesh.skeleton);
        (hairMesh.material as MeshStandardMaterial).color.setHex(hair.color);
        rigMesh.parent?.add(hairMesh);
      }
    }

    const preset = BODY_PRESET_OPTIONS.find(b => b.id === config.bodyPreset) ?? BODY_PRESET_OPTIONS[1]!;
    group.scale.set(...preset.scale);
    cullAsOneBody(group, rigMesh);
    group.userData.sex = config.sex;
    return group;
  }

  /**
   * Clips fitted to an outfit's rig: only the pelvis keeps its translation (scaled to the
   * rig's hip height) and scale tracks go, so each rig keeps its own bone lengths.
   */
  async fitClips(sex: Sex, clips: readonly AnimationClip[], cacheKey: string): Promise<AnimationClip[]> {
    const key = `${sex}:${cacheKey}`;
    const cached = this.fitted.get(key);
    if (cached) return cached;
    const rig = await this.scene(OUTFIT_PATH[sex]);
    const pelvis = rig.getObjectByName('pelvis');
    const ratio = pelvis ? pelvis.position.length() / CLIP_PELVIS_HEIGHT : 1;
    const out = clips.map(clip => fitClip(clip, ratio));
    this.fitted.set(key, out);
    return out;
  }
}

/**
 * Skinned parts that share a material and a skeleton become one mesh, so an outfit cut into
 * arms, body, legs and feet costs one draw instead of four. Parts missing vertex colour get white.
 */
function joinByMaterial(root: Object3D): void {
  const byMaterial = new Map<string, SkinnedMesh[]>();
  root.traverse((node) => {
    const mesh = node as SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const key = `${(mesh.material as MeshStandardMaterial).name}:${mesh.skeleton.uuid}`;
    byMaterial.set(key, [...(byMaterial.get(key) ?? []), mesh]);
  });
  for (const parts of byMaterial.values()) {
    if (parts.length < 2) continue;
    const coloured = parts.some(m => m.geometry.getAttribute('color'));
    const names = new Set(Object.keys(parts[0]!.geometry.attributes));
    for (const m of parts) for (const n of [...names]) if (!m.geometry.getAttribute(n)) names.delete(n);
    if (coloured) names.add('color');
    const geometries = parts.map((m) => {
      const g = new BufferGeometry();
      for (const n of names) {
        const a = m.geometry.getAttribute(n);
        g.setAttribute(n, a ?? new BufferAttribute(new Float32Array(m.geometry.getAttribute('position').count * 4).fill(1), 4));
      }
      g.setIndex(m.geometry.getIndex());
      return g;
    });
    const joined = mergeGeometries(geometries.map(g => (g.getAttribute('color') ? withRgba(g) : g)));
    if (!joined) continue;
    const [first, ...rest] = parts;
    first!.geometry = joined;
    (first!.material as MeshStandardMaterial).vertexColors = coloured;
    for (const m of rest) m.removeFromParent();
  }
}

/** Colour as four float components, so parts stored in different formats merge. */
function withRgba(g: BufferGeometry): BufferGeometry {
  const c = g.getAttribute('color');
  const out = new Float32Array(c.count * 4);
  for (let i = 0; i < c.count; i++) out.set([c.getX(i), c.getY(i), c.getZ(i), 1], i * 4);
  g.setAttribute('color', new BufferAttribute(out, 4));
  return g;
}

/** How far past the rest pose a swing, kick or fall can reach, as a share of the body's radius. */
const POSE_REACH = 1.6;

/**
 * Every part of a body is culled by one sphere: the rest pose's, widened for the reach of a
 * clip. Off-screen bodies then skip both the picture and the shadow passes.
 */
function cullAsOneBody(group: Group, rig: SkinnedMesh): void {
  group.updateMatrixWorld(true);
  rig.skeleton.update();
  rig.computeBoundingSphere();
  const world = rig.boundingSphere?.clone().applyMatrix4(rig.matrixWorld);
  if (!world) return;
  world.radius *= POSE_REACH;
  const toLocal = new Matrix4();
  group.traverse((node) => {
    const mesh = node as SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    mesh.boundingSphere = world.clone().applyMatrix4(toLocal.copy(mesh.matrixWorld).invert());
    mesh.frustumCulled = true;
  });
}

const tmp = new Vector3();

export function fitClip(clip: AnimationClip, pelvisRatio: number): AnimationClip {
  const copy = clip.clone();
  copy.tracks = copy.tracks.filter((track) => {
    const [bone, prop] = track.name.split('.');
    if (prop === 'scale') return false;
    if (prop === 'position') return bone === 'pelvis' || bone === 'root';
    return true;
  });
  for (const track of copy.tracks) {
    if (track.name !== 'pelvis.position' || pelvisRatio === 1) continue;
    const v = track.values;
    for (let i = 0; i < v.length; i += 3) {
      tmp.set(v[i]!, v[i + 1]!, v[i + 2]!).multiplyScalar(pelvisRatio);
      v[i] = tmp.x; v[i + 1] = tmp.y; v[i + 2] = tmp.z;
    }
  }
  return copy;
}
