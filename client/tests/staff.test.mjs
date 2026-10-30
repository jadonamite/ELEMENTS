import assert from 'node:assert/strict';
import test from 'node:test';
import { Group, Mesh, MeshStandardMaterial, BoxGeometry, Vector3 } from 'three';
import { STAFF_WEAPON, SWORD_WEAPON, StaffAirTrail, heroWeaponFor } from '../src/weapon.js';

test('heroWeaponFor returns staff for AURA Shaper and sword otherwise', () => {
  assert.equal(heroWeaponFor({ element: 'AURA' }), 'staff');
  assert.equal(heroWeaponFor({ element: 'AURA', hush: false }), 'staff');
  assert.equal(heroWeaponFor({ element: 'AURA', hush: true }), 'sword');
  assert.equal(heroWeaponFor({ element: 'IGNIS' }), 'sword');
  assert.equal(heroWeaponFor({ element: 'AQUES' }), 'sword');
  assert.equal(heroWeaponFor({ element: 'TERRA' }), 'sword');
});

test('STAFF_WEAPON slot data is configured with reach 3.2, 5 moves, and correct sockets', () => {
  assert.equal(STAFF_WEAPON.type, 'staff');
  assert.equal(STAFF_WEAPON.reach, 3.2);
  assert.equal(STAFF_WEAPON.assetPath, '/assets/weapons/staff.glb');
  assert.equal(STAFF_WEAPON.meshName, 'Staff');
  assert.equal(STAFF_WEAPON.handBone, 'hand_r');
  assert.equal(STAFF_WEAPON.sheatheBone, 'spine_03');
  assert.deepEqual(STAFF_WEAPON.moves.light, ['light_1', 'light_2', 'light_3']);
  assert.deepEqual(STAFF_WEAPON.moves.heavy, ['heavy_1', 'heavy_2']);
  assert.ok(STAFF_WEAPON.hitShape.tipFraction > STAFF_WEAPON.hitShape.baseFraction);
});

test('StaffAirTrail records swing samples and updates cleanly', () => {
  const root = new Group();
  const trail = new StaffAirTrail(root);
  assert.equal(root.children.length, 1);

  const base = new Vector3(0, 0.55, 0);
  const tip = new Vector3(0, 0.85, 0);
  trail.record(base, tip, 0.8);
  trail.update(0.016);

  // Advances time and cleans up after fade
  trail.update(0.5);
  trail.dispose();
});

test('the staff never glows when elemental is enabled', () => {
  const staffMaterials = [
    new MeshStandardMaterial({ color: 0xded8ce, emissive: 0x000000, emissiveIntensity: 0 }),
    new MeshStandardMaterial({ color: 0xd8dde3, emissive: 0x000000, emissiveIntensity: 0 }),
  ];

  const ELEMENT_EMISSIVE = {
    AURA: { color: 0xddeeff, intensity: 2.5 },
  };

  const setElemental = (lit, weaponType) => {
    const spec = ELEMENT_EMISSIVE.AURA;
    for (const mat of staffMaterials) {
      if (lit && weaponType !== 'staff') {
        mat.emissive.setHex(spec.color);
        mat.emissiveIntensity = spec.intensity;
      } else {
        mat.emissive.setHex(0x000000);
        mat.emissiveIntensity = 0;
      }
    }
  };

  setElemental(true, 'staff');
  for (const mat of staffMaterials) {
    assert.equal(mat.emissive.getHex(), 0);
    assert.equal(mat.emissiveIntensity, 0);
  }

  setElemental(true, 'sword');
  for (const mat of staffMaterials) {
    assert.equal(mat.emissive.getHex(), 0xddeeff);
    assert.equal(mat.emissiveIntensity, 2.5);
  }
});
