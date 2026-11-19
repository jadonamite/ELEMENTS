import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Object3D } from 'three';
import { itemName, describeLoot, lootItems } from '../src/economy/items.ts';
import { seatedPose } from '../src/story/mission-actor.ts';

test('seated posture stays at the bench height across repeated frames and floor changes', () => {
  const model = new Group();
  for (const name of ['thigh_l', 'thigh_r', 'calf_l', 'calf_r']) {
    const joint = new Object3D(); joint.name = name; model.add(joint);
  }
  for (let frame = 0; frame < 600; frame++) seatedPose(model, 0);
  assert.equal(model.position.y, -0.45);
  assert.equal(model.getObjectByName('thigh_l').rotation.x, 1.35);
  assert.equal(model.getObjectByName('calf_r').rotation.x, -1.6);
  seatedPose(model, 11);
  assert.equal(model.position.y, 10.55);
});


test('the reserved invitation keeps its story name in the satchel and collected-loot description', () => {
  const items = lootItems({ shards: {}, materials: {}, gear: { arena_ticket: 1 } });
  assert.equal(itemName('arena_ticket'), 'Arena invitation');
  assert.equal(describeLoot(0, items), '1 Arena invitation');
});
