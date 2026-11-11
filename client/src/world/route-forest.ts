import RAPIER from '@dimforge/rapier3d-compat';
import { AmbientLight, Color, DirectionalLight, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, NoToneMapping, OrthographicCamera, FogExp2, PlaneGeometry, Scene, Vector3, WebGLRenderTarget, type Material, type WebGLRenderer } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { groundHeight, mineAt, minePointAt, RIVER, SETTLEMENTS, waterHeight } from '../../../shared/src/world/ignis/ground.js';
import { LEGACY_SINDR_ORIGIN as O } from '../../../shared/src/world/ignis/coordinates.js';
import { cellLods, seeded, type Placement } from './builder.js';
import { terrainAir } from './national-view.js';
import { existingTree } from './trees.js';

/** A small seeded stand of the existing ginkgo kit, north of the road and on the river banks. */
export function routeForest(renderer: WebGLRenderer, bark: Material, world: RAPIER.World, low: boolean, fog: FogExp2): {
  group: Group; spots: Placement[]; countNear(x: number, z: number, radius: number): number;
  update(point: Vector3): void; dispose(): void;
} {
  const rand = seeded(941), spots: Placement[] = [];
  const add = (x: number, z: number): void => {
    if (SETTLEMENTS.some(p => Math.hypot(x - p.x, z - p.z) < p.radius + 8) || mineAt(x, z).distance < 20) return;
    const h = groundHeight(x, z), water = waterHeight(x, z);
    if (water !== null && water > h - 0.3) return;
    const slope = Math.hypot(groundHeight(x + 2, z) - groundHeight(x - 2, z), groundHeight(x, z + 2) - groundHeight(x, z - 2)) / 4;
    if (slope > Math.tan(40 * Math.PI / 180)) return;
    spots.push({ x: x - O.x, y: h - O.y, z: z - O.z, yaw: rand() * Math.PI * 2, scale: 1.15 + rand() * 0.7 });
  };
  for (let s = 60; s <= 1140; s += 20) {
    const p = minePointAt(s), q = minePointAt(s + 1), len = Math.hypot(q.x - p.x, q.z - p.z);
    for (const band of [28, 52, 80, 110, 145]) {
      const across = band + (rand() - 0.5) * 10;
      add(p.x + (q.z - p.z) / len * across + (rand() - 0.5) * 12, p.z - (q.x - p.x) / len * across + (rand() - 0.5) * 12);
    }
  }
  for (let i = 5; i < 8; i++) {
    const a = RIVER[i - 1]!, b = RIVER[i]!;
    const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 45);
    for (let j = 0; j <= steps; j++) for (let k = 0; k < 3; k++) {
      const t = j / steps; add(a[0] + (b[0] - a[0]) * t - 45 - rand() * 180, a[1] + (b[1] - a[1]) * t + (rand() - 0.5) * 35);
    }
  }
  const kit = existingTree('ginkgo', low ? 0.06 : 0.45);
  const imageScene = new Scene(), camera = new OrthographicCamera(-8, 8, 12, -4, 0.1, 80);
  camera.position.set(0, 6, 30); camera.lookAt(0, 6, 0);
  imageScene.add(new Mesh(kit.crown, kit.leaves)); if (kit.wood) imageScene.add(new Mesh(kit.wood, bark));
  imageScene.add(new AmbientLight(0xffffff, 0.6));
  const light = new DirectionalLight(0xffffff, 1.5); light.position.set(10, 20, 10); imageScene.add(light);
  const target = new WebGLRenderTarget(256, 256), previous = renderer.getRenderTarget(), color = renderer.getClearColor(new Color()), alpha = renderer.getClearAlpha();
  let captured = false;
  const capture = (): void => {
    const tone = renderer.toneMapping; renderer.toneMapping = NoToneMapping;
    renderer.setRenderTarget(target); renderer.setClearColor(0, 0); renderer.clear(); renderer.render(imageScene, camera);
    renderer.setRenderTarget(previous); renderer.setClearColor(color, alpha); renderer.toneMapping = tone; captured = true;
  };
  const farMaterial = terrainAir(new MeshStandardMaterial({ map: target.texture, alphaTest: 0.35, side: DoubleSide, roughness: 1 }), fog);
  const leaves = terrainAir(kit.leaves as MeshStandardMaterial, fog), routeBark = terrainAir(bark as MeshStandardMaterial, fog);
  const card = new PlaneGeometry(16, 16).translate(0, 4, 0), cross = card.clone().rotateY(Math.PI / 2);
  const impostor = mergeGeometries([card, cross], false)!; card.dispose(); cross.dispose();
  const near = [{ geometry: kit.crown, material: leaves, castShadow: false, name: 'route-ginkgo-leaves' },
    ...(kit.wood ? [{ geometry: kit.wood, material: routeBark, castShadow: false, name: 'route-ginkgo-wood' }] : [])];
  const group = new Group(); group.name = 'route-forest';
  for (const lod of cellLods(spots, [{ from: 0, parts: near }, { from: 600, parts: [{ geometry: impostor, material: farMaterial, castShadow: false, name: 'route-ginkgo-impostor' }] }], 2400, 65536)) group.add(lod);
  const colliders = new Map<number, RAPIER.Collider>(); let cx = NaN, cz = NaN;
  return { group, spots, countNear(x, z, radius) { return spots.filter(p => p.z <= z && Math.hypot(x - p.x, z - p.z) <= radius).length; },
    update(point) {
      const loader = document.querySelector('#elements-loader');
      if (!captured && (!loader || loader.classList.contains('loader-hidden'))) capture();
      const x = Math.floor(point.x / 32), z = Math.floor(point.z / 32);
      if (x === cx && z === cz) return; cx = x; cz = z;
      spots.forEach((p, i) => {
        const near = Math.hypot(point.x - p.x, point.z - p.z) < 192, old = colliders.get(i);
        if (near && !old) colliders.set(i, world.createCollider(RAPIER.ColliderDesc.cylinder(2 * p.scale, 0.3 * p.scale).setTranslation(p.x, p.y + 2 * p.scale, p.z)));
        if (!near && old) { world.removeCollider(old, false); colliders.delete(i); }
      });
    }, dispose() {
      for (const c of colliders.values()) world.removeCollider(c, false);
      group.removeFromParent(); kit.crown.dispose(); kit.wood?.dispose(); kit.leaves.dispose(); leaves.dispose(); routeBark.dispose(); impostor.dispose(); farMaterial.dispose(); target.dispose();
    },
  };
}
