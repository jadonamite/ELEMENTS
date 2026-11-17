/**
 * Builds fighters: the outfit carries the skeleton, the creator body gives the parts the
 * outfit leaves bare (head, eyes and brows, and for armour the hands), plus skin tone, hair,
 * body preset, and animation clips fitted to the outfit's proportions.
 */

import {
  AnimationClip,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  Sphere,
  SRGBColorSpace,
  Texture,
  Vector3,
} from 'three';
import type { Loaders } from './assets/loaders.js';
import { skinStride } from './anim/skin-sample.js';
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

export type OutfitId = 'rags' | 'shaper_ignis' | 'hush_ignis' | 'hush_aques' | 'hush_aura' | 'hush_terra' | 'robber' | 'deserter' | 'warlord_ignis' | 'soldier';

interface Outfit {
  /** The outfit file per sex; a sex without one wears rags. */
  path: Partial<Record<Sex, string>>;
  /** Bones whose creator-body vertices the outfit leaves bare. */
  bareBones: ReadonlySet<string>;
  /** Materials that are cloth the game may dye; every other outfit material is left as made. */
  dyeable: (materialName: string) => boolean;
  /** Materials that are the wearer's skin, tinted to their skin tone. */
  skin: (materialName: string) => boolean;
  /** A whole person from a character sheet: their own head, hands, hair and skin; nothing is added. */
  whole?: boolean;
}

const HEAD = ['Head', 'neck_01'];
const HANDS = ['l', 'r'].flatMap(side => ['hand_' + side,
  ...['thumb', 'index', 'middle', 'ring', 'pinky'].flatMap(f => ['01', '02', '03', '04_leaf'].map(i => `${f}_${i}_${side}`))]);

function person(): Pick<Outfit, 'bareBones' | 'dyeable' | 'skin' | 'whole'> {
  return { bareBones: new Set(), dyeable: () => false, skin: () => false, whole: true };
}

const OUTFITS: Record<OutfitId, Outfit> = {
  rags: {
    path: { male: '/assets/characters/creator/peasant_male.glb', female: '/assets/characters/creator/peasant_female.glb' },
    bareBones: new Set(HEAD),
    dyeable: name => name.toLowerCase().includes('peasant'),
    skin: name => !name.toLowerCase().includes('peasant'),
  },
  shaper_ignis: {
    path: { male: '/assets/characters/outfits/shaper_ignis_male.glb' },
    bareBones: new Set([...HEAD, ...HANDS]),
    dyeable: () => false,
    skin: name => name === 'MI_Shaper_Skin',
  },
  hush_ignis: { path: { male: '/assets/characters/people/hush_ignis_male.glb', female: '/assets/characters/people/hush_ignis_female.glb' }, ...person() },
  hush_aques: { path: { male: '/assets/characters/people/hush_aques_male.glb', female: '/assets/characters/people/hush_aques_female.glb' }, ...person() },
  hush_aura: { path: { male: '/assets/characters/people/hush_aura_male.glb', female: '/assets/characters/people/hush_aura_female.glb' }, ...person() },
  hush_terra: { path: { male: '/assets/characters/people/hush_terra_male.glb', female: '/assets/characters/people/hush_terra_female.glb' }, ...person() },
  robber: { path: { female: '/assets/characters/people/robber_female.glb' }, ...person() },
  deserter: { path: { male: '/assets/characters/people/deserter_male.glb' }, ...person() },
  warlord_ignis: { path: { female: '/assets/characters/people/warlord_ignis_female.glb' }, ...person() },
  soldier: { path: { male: '/assets/characters/people/soldier_male.glb' }, ...person() },
};
const OUTFIT_FILES = new Set(Object.values(OUTFITS).flatMap(o => Object.values(o.path)));

/** How closely a kit's bodies are seen: the crowd (near), distant townsfolk (far), or the hero, masters and creator (close). */
export type BodyDetail = 'near' | 'far' | 'close';

/** The file a kit loads for a body path: far bodies from far/, close-ups from hd/ (sharper textures; see packed-assets.mjs). */
function detailFile(path: string, detail: BodyDetail): string {
  if (detail === 'far') return path.replace(/\/(creator|people)\//, '/$1/far/');
  if (detail === 'close') return path.replace(/\/(creator|outfits)\//, '/$1/hd/').replace(/\/people\/(hush_)/, '/people/hd/$1');
  return path;
}

export function parseOutfit(value: string | null | undefined): OutfitId {
  return value && value in OUTFITS ? (value as OutfitId) : 'rags';
}

/** A sheet person the player is, if their configuration names one that exists for their sex. */
export function personOf(config: CharacterConfig): OutfitId | null {
  const id = config.person as OutfitId | undefined;
  return id && OUTFITS[id]?.whole && outfitFits(id, config.sex) ? id : null;
}

/** What a player actually wears: their sheet person in place of rags, else the outfit itself. */
function wornBy(config: CharacterConfig, outfitId: OutfitId): OutfitId {
  const person = personOf(config);
  return outfitId === 'rags' && person ? person : outfitId;
}

function outfitFor(id: OutfitId, sex: Sex): { outfit: Outfit; path: string } {
  const own = OUTFITS[id].path[sex];
  return own ? { outfit: OUTFITS[id], path: own } : { outfit: OUTFITS.rags, path: OUTFITS.rags.path[sex]! };
}

/** Whether this outfit exists for this sex (otherwise rags are worn). */
export function outfitFits(id: OutfitId, sex: Sex): boolean {
  return OUTFITS[id].path[sex] !== undefined;
}

/** Patched, greener rags for robbers. */
const WORN_RAGS_PATH = '/assets/characters/creator/peasant_worn.ktx2';

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
  mat.userData.skinTint = uniforms.uSkinColor.value;
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

/** The body's triangles whose vertices all hang mostly from the given bones. */
function bareParts(mesh: SkinnedMesh, bones: ReadonlySet<string>): BufferGeometry {
  const src = mesh.geometry;
  const joints = src.getAttribute('skinIndex');
  const weights = src.getAttribute('skinWeight');
  const keep = new Uint8Array(joints.count);
  for (let v = 0; v < joints.count; v++) {
    let w = 0;
    for (let k = 0; k < 4; k++) {
      const bone = mesh.skeleton.bones[joints.getComponent(v, k)];
      if (bone && bones.has(bone.name)) w += weights.getComponent(v, k);
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
  private readonly scenes = new Map<string, Promise<Object3D>>();
  private readonly fitted = new Map<string, Promise<AnimationClip[]>>();
  private readonly bare = new Map<string, BufferGeometry>();
  private wornRags: Promise<Texture> | null = null;

  constructor(private readonly loaders: Loaders, private readonly detail: BodyDetail = 'near') {}

  async preload(paths: readonly string[] = [...Object.values(BODY_PATH), ...Object.values(OUTFITS.rags.path)]): Promise<void> {
    await Promise.all(paths.map(p => this.scene(p)));
  }

  /** The files `build` reads for this configuration and outfit. */
  files(config: CharacterConfig, outfitId: OutfitId = 'rags'): string[] {
    const { outfit, path } = outfitFor(wornBy(config, outfitId), config.sex);
    if (outfit.whole) return [path];
    const person = personOf(config);
    const style = person ? undefined : HAIR_STYLE_OPTIONS.find(h => h.id === config.hairStyleId);
    return [path, person ? OUTFITS[person].path[config.sex]! : BODY_PATH[config.sex],
      ...(style?.assetFile ? [`/assets/characters/creator/${style.assetFile}`] : [])];
  }

  private async scene(path: string): Promise<Object3D> {
    let pending = this.scenes.get(path);
    if (!pending) {
      const file = detailFile(path, this.detail);
      pending = this.loaders.model(file).then(({ scene }) => {
        if (OUTFIT_FILES.has(path)) joinByMaterial(scene);
        return scene;
      });
      this.scenes.set(path, pending);
    }
    return pending;
  }

  private worn(): Promise<Texture> {
    this.wornRags ??= this.loaders.texture(WORN_RAGS_PATH).then((t) => {
      t.colorSpace = SRGBColorSpace;
      return t;
    });
    return this.wornRags;
  }

  /** A posable fighter for this configuration, with its own materials; `cloth` dyes a dyeable outfit. */
  async build(config: CharacterConfig, look: BodyLook = 'hero', cloth?: number, outfitId: OutfitId = 'rags'): Promise<Group> {
    const { outfit, path } = outfitFor(wornBy(config, outfitId), config.sex);
    const model = cloneSkinned(await this.scene(path));
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
      if (outfit.dyeable(mat.name)) {
        if (worn) {
          mat.map = worn;
          mat.color.setRGB(0.62, 0.55, 0.5);
        }
        if (cloth !== undefined) mat.color.setHex(cloth);
      } else if (outfit.skin(mat.name)) {
        applySkinShader(mat, uniforms);
      }
    });
    const rigMesh = rig as SkinnedMesh | null;
    if (!rigMesh) return group;
    if (outfit.whole) {
      cullAsOneBody(group, rigMesh);
      group.userData.sex = config.sex;
      return group;
    }

    // The bare parts (head, and hands under armour) come from the player's sheet person, who
    // keeps their own face, hair and skin; without one, from the creator body with chosen hair.
    const person = personOf(config);
    const bodyPath = person ? OUTFITS[person].path[config.sex]! : BODY_PATH[config.sex];
    const body = await this.scene(bodyPath);
    body.traverse((node) => {
      const src = node as SkinnedMesh;
      if (!src.isSkinnedMesh) return;
      let geometry = src.geometry;
      const bare = person !== null || isBodyMesh(src);
      if (bare) {
        const key = `${bodyPath}:${path}`;
        geometry = this.bare.get(key) ?? bareParts(src, outfit.bareBones);
        this.bare.set(key, geometry);
      }
      const mesh = rebind(src, rigMesh.skeleton, geometry);
      const mat = mesh.material as MeshStandardMaterial;
      if (person) mesh.material = mat.clone();
      else if (isBodyMesh(src)) applySkinShader(mat, uniforms);
      else if (mesh.name.toLowerCase().includes('eyebrow')) mat.color.setHex(hair.color);
      rigMesh.parent?.add(mesh);
    });

    const style = person ? undefined : HAIR_STYLE_OPTIONS.find(h => h.id === config.hairStyleId);
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
   * rig's hip height) and scale tracks go, so each rig keeps its own bone lengths. A clip from a
   * marked pack is also turned from the rest pose it was made on to this rig's.
   */
  async fitClips(sex: Sex, clips: readonly AnimationClip[], cacheKey: string, outfitId: OutfitId = 'rags',
    person?: string): Promise<AnimationClip[]> {
    const { path } = outfitFor(wornBy({ sex, person } as CharacterConfig, outfitId), sex);
    const key = `${path}:${cacheKey}`;
    // The fitting in progress is cached, so builds running side by side share it.
    const cached = this.fitted.get(key);
    if (cached) return cached;
    const fitting = this.scene(path).then((rig) => {
      const pelvis = rig.getObjectByName('pelvis');
      const ratio = pelvis ? pelvis.position.length() / CLIP_PELVIS_HEIGHT : 1;
      // Each pack was made on its own rest pose; its clips are turned onto this rig's.
      const bodyRest = restOf(rig);
      const retargets = new Map<number, Retarget>();
      return clips.map((clip) => {
        const pack = clip.userData.rest as number | undefined;
        if (pack === undefined) return fitClip(clip, ratio);
        let retarget = retargets.get(pack);
        if (!retarget) retargets.set(pack, retarget = retargetBetween(packRests[pack]!, bodyRest));
        return fitClip(clip, ratio, retarget);
      });
    });
    this.fitted.set(key, fitting);
    return fitting;
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
/** A rig's skinned bounding sphere at rest, per source geometry: every clone of a body shares it, so it is measured once. */
const restSpheres = new WeakMap<BufferGeometry, Sphere>();

/** A skinned mesh's bounding sphere in its current pose, from an even sample of its vertices (as three measures it: box centre, farthest point). */
function sampledSphere(rig: SkinnedMesh): Sphere {
  rig.skeleton.update();
  const count = rig.geometry.getAttribute('position').count;
  const stride = skinStride(count);
  const points = new Float32Array(Math.ceil(count / stride) * 3);
  const box = new Box3();
  const point = new Vector3();
  for (let i = 0, k = 0; i < count; i += stride, k += 3) {
    rig.getVertexPosition(i, point).toArray(points, k);
    box.expandByPoint(point);
  }
  const sphere = new Sphere(box.getCenter(new Vector3()), 0);
  let farthest = 0;
  for (let k = 0; k < points.length; k += 3) farthest = Math.max(farthest, sphere.center.distanceToSquared(point.fromArray(points, k)));
  sphere.radius = Math.sqrt(farthest);
  return sphere;
}

function cullAsOneBody(group: Group, rig: SkinnedMesh): void {
  group.updateMatrixWorld(true);
  let rest = restSpheres.get(rig.geometry);
  if (!rest) {
    rest = sampledSphere(rig);
    restSpheres.set(rig.geometry, rest);
  }
  rig.boundingSphere = rest.clone();
  const world = rig.boundingSphere.clone().applyMatrix4(rig.matrixWorld);
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
const turn = new Quaternion();

/** Where each joint points when a skeleton rests, in the world, with its parent's. */
type Rest = Map<string, { own: Quaternion; parent: Quaternion }>;

const packRests: Rest[] = [];

export function restOf(root: Object3D): Rest {
  const rest: Rest = new Map();
  root.updateMatrixWorld(true);
  root.traverse((node) => {
    if (!node.name || !node.parent) return;
    rest.set(node.name, { own: node.getWorldQuaternion(new Quaternion()), parent: node.parent.getWorldQuaternion(new Quaternion()) });
  });
  return rest;
}

const marked = new WeakSet<Object3D>();

/**
 * Marks a pack's clips with the rest pose they were made on, which is the pack's own skeleton.
 * A pack is marked once however many systems use it; fitting then turns each clip onto the rest pose of the body it plays on.
 */
export function markRest(pack: { scene: Object3D; animations: AnimationClip[] }): AnimationClip[] {
  if (marked.has(pack.scene)) return pack.animations;
  marked.add(pack.scene);
  const id = packRests.push(restOf(pack.scene)) - 1;
  for (const clip of pack.animations) clip.userData.rest = id;
  return pack.animations;
}

/**
 * For each joint, the two turns that carry a rotation made on one rest pose over to another, so the
 * joint ends as far from the new rest, seen in the world, as the clip put it from the old one.
 */
type Retarget = Map<string, { before: Quaternion; after: Quaternion }>;

export function retargetBetween(from: Rest, to: Rest): Retarget {
  const out: Retarget = new Map();
  for (const [name, source] of from) {
    const target = to.get(name);
    if (!target) continue;
    const before = target.parent.clone().invert().multiply(source.parent);
    const after = source.own.clone().invert().multiply(target.own);
    if (Math.abs(before.w) > 0.99999 && Math.abs(after.w) > 0.99999) continue;
    out.set(name, { before, after });
  }
  return out;
}

export function fitClip(clip: AnimationClip, pelvisRatio: number, retarget?: Retarget): AnimationClip {
  const copy = clip.clone();
  copy.tracks = copy.tracks.filter((track) => {
    const [bone, prop] = track.name.split('.');
    if (prop === 'scale') return false;
    if (prop === 'position') return bone === 'pelvis' || bone === 'root';
    return true;
  });
  for (const track of copy.tracks) {
    const [bone, prop] = track.name.split('.');
    const joint = retarget?.get(bone!);
    if (!joint) continue;
    const v = track.values;
    if (prop === 'quaternion') {
      for (let i = 0; i < v.length; i += 4) {
        turn.set(v[i]!, v[i + 1]!, v[i + 2]!, v[i + 3]!).premultiply(joint.before).multiply(joint.after);
        v[i] = turn.x; v[i + 1] = turn.y; v[i + 2] = turn.z; v[i + 3] = turn.w;
      }
    } else if (prop === 'position') {
      for (let i = 0; i < v.length; i += 3) {
        tmp.set(v[i]!, v[i + 1]!, v[i + 2]!).applyQuaternion(joint.before);
        v[i] = tmp.x; v[i + 1] = tmp.y; v[i + 2] = tmp.z;
      }
    }
  }
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

const kits = new WeakMap<Loaders, Record<BodyDetail, BodyKit>>();

/** The game's one kit per detail level, shared by every body seen at that distance, so a body is built from one parse. */
export function bodyKit(loaders: Loaders, detail: BodyDetail = 'near'): BodyKit {
  let set = kits.get(loaders);
  if (!set) kits.set(loaders, set = { near: new BodyKit(loaders), far: new BodyKit(loaders, 'far'), close: new BodyKit(loaders, 'close') });
  return set[detail];
}
