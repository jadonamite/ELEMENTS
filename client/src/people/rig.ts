import { Bone, Matrix4, type MeshStandardMaterial, Object3D, Skeleton, SkinnedMesh, Vector3 } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * Puts a body built on another skeleton onto the game's skeleton.
 *
 * The body arrives posed in the reference rest pose, with bones named like ours. The result
 * keeps every reference bone's own rotation (so the game's clips mean the same thing on it)
 * and moves each joint to where the body has it, so its proportions are its own.
 */
export function fitToReference(body: Object3D, reference: Object3D, opts: { outfit?: boolean } = {}): Object3D {
  body.updateMatrixWorld(true);
  const rig = cloneSkinned(reference);
  // The reference's own meshes (the commoner's rags) follow the moved bones when asked for.
  rig.traverse((n) => { if ((n as SkinnedMesh).isSkinnedMesh) n.visible = !!opts.outfit; });
  rig.updateMatrixWorld(true);

  // Joint positions of the source body, by name, in the rig's space.
  const toRig = new Matrix4().copy(rig.matrixWorld).invert();
  const joints = new Map<string, Vector3>();
  body.traverse((n) => {
    if ((n as Bone).isBone) joints.set(n.name, new Vector3().setFromMatrixPosition(n.matrixWorld).applyMatrix4(toRig));
  });

  // Parents first: each bone's local position becomes the source joint seen from its parent.
  const bones: Bone[] = [];
  rig.traverse((n) => { if ((n as Bone).isBone) bones.push(n as Bone); });
  for (const bone of bones) {
    const target = joints.get(bone.name);
    if (!target || !bone.parent) continue;
    bone.parent.updateMatrixWorld(true);
    const local = target.clone().applyMatrix4(new Matrix4().copy(rig.matrixWorld))
      .applyMatrix4(new Matrix4().copy(bone.parent.matrixWorld).invert());
    bone.position.copy(local);
    bone.updateMatrixWorld(true);
  }
  rig.updateMatrixWorld(true);
  const byName = new Map(bones.map((b) => [b.name, b]));

  // Rebind each skinned mesh of the body to the moved bones, bound at the new rest pose.
  const meshes: SkinnedMesh[] = [];
  body.traverse((n) => { if ((n as SkinnedMesh).isSkinnedMesh) meshes.push(n as SkinnedMesh); });
  for (const src of meshes) {
    const boneList = src.skeleton.bones.map((b) => byName.get(b.name) ?? byName.get('root')!);
    const material = (src.material as MeshStandardMaterial).clone();
    // Lashes, brows and hair are cut-out cards: alpha test, not blending, so they sort and shadow cleanly.
    if (/eyebrow|eyelash|hair/i.test(src.name) || material.transparent || material.alphaTest > 0) {
      material.transparent = false;
      material.alphaTest = 0.5;
      material.depthWrite = true;
    }
    const mesh = new SkinnedMesh(src.geometry.clone(), material);
    mesh.name = src.name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    // At rest a vertex sits at bindMatrix * v in world space; carry it into the rig's space.
    mesh.geometry.applyMatrix4(new Matrix4().multiplyMatrices(toRig, src.bindMatrix));
    rig.add(mesh);
    mesh.updateMatrixWorld(true);
    const skeleton = new Skeleton(boneList);
    skeleton.calculateInverses();
    mesh.bind(skeleton);
  }
  return rig;
}
