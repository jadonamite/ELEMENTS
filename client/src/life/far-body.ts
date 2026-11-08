import { BufferAttribute, BufferGeometry, Color, MeshStandardMaterial, SkinnedMesh, SRGBColorSpace, type Group, type Texture } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const pixels = new WeakMap<Texture, ImageData>();

function textureColor(texture: Texture, u: number, v: number, color: Color): Color {
  let data = pixels.get(texture);
  if (!data) {
    const image = texture.image as CanvasImageSource & { width: number; height: number };
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(image, 0, 0);
    data = context.getImageData(0, 0, canvas.width, canvas.height);
    pixels.set(texture, data);
  }
  const x = Math.min(data.width - 1, Math.max(0, Math.floor(u * data.width)));
  const y = Math.min(data.height - 1, Math.max(0, Math.floor((texture.flipY ? 1 - v : v) * data.height)));
  const i = (y * data.width + x) * 4;
  return color.setRGB(data.data[i]! / 255, data.data[i + 1]! / 255, data.data[i + 2]! / 255, SRGBColorSpace);
}

/** Bake distant clothing, skin and hair colour into one surface, keeping the reduced rig and silhouette. */
export function mergeFarBody(model: Group): void {
  const sources: SkinnedMesh[] = [];
  model.traverse(n => { if ((n as SkinnedMesh).isSkinnedMesh && n.visible) sources.push(n as SkinnedMesh); });
  const rig = sources[0];
  if (!rig) return;
  const geometries: BufferGeometry[] = [];
  const color = new Color();
  for (const mesh of sources) {
    const geometry = new BufferGeometry(), source = mesh.geometry;
    for (const key of ['position', 'normal', 'skinWeight']) geometry.setAttribute(key, source.getAttribute(key));
    const joints = source.getAttribute('skinIndex'), remapped = new Uint16Array(joints.count * 4);
    const boneMap = mesh.skeleton.bones.map(b => rig.skeleton.bones.findIndex(r => r.name === b.name));
    for (let i = 0; i < joints.count; i++) for (let k = 0; k < 4; k++) remapped[i * 4 + k] = boneMap[joints.getComponent(i, k)]!;
    geometry.setAttribute('skinIndex', new BufferAttribute(remapped, 4));
    const material = mesh.material as MeshStandardMaterial, uv = source.getAttribute('uv');
    const existing = source.getAttribute('color'), out = new Float32Array(joints.count * 3);
    const skin = material.userData.skinTint as Color | undefined;
    for (let i = 0; i < joints.count; i++) {
      if (material.map && uv) textureColor(material.map, uv.getX(i), uv.getY(i), color); else color.setRGB(1, 1, 1);
      if (skin) {
        const lum = color.r * 0.299 + color.g * 0.587 + color.b * 0.114;
        color.copy(skin).multiplyScalar(lum / 0.44);
      } else color.multiply(material.color);
      if (existing && material.vertexColors) { color.r *= existing.getX(i); color.g *= existing.getY(i); color.b *= existing.getZ(i); }
      color.toArray(out, i * 3);
    }
    geometry.setAttribute('color', new BufferAttribute(out, 3));
    geometry.setIndex(source.index);
    geometries.push(geometry);
  }
  const merged = mergeGeometries(geometries);
  if (!merged) throw new Error('Far body geometry cannot be merged');
  const mesh = new SkinnedMesh(merged, new MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }));
  mesh.name = 'townsperson-far';
  mesh.bind(rig.skeleton, rig.bindMatrix);
  mesh.boundingSphere = rig.boundingSphere?.clone() ?? null;
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  rig.parent!.add(mesh);
  for (const source of sources) source.removeFromParent();
  for (const geometry of geometries) geometry.dispose();
}
