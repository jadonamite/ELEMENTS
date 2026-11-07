import assert from 'node:assert/strict';
import test from 'node:test';
import anchors from '../../shared/src/world/ignis/sindr.json' with { type: 'json' };
import { SINDR_STALLS, SINDR_COUNTING_HOUSES, SINDR_NOTICE_BOARD, placesFor } from '../../shared/src/net/places.ts';

// The server checks a player's position against the shared place list, and the town builds from the
// shared anchors file. If the two drift, a player stands at a stall or a bank door and is told they are
// nowhere near it. These tests hold the two lists together.

const byKind = (kind) => anchors.anchors.filter((a) => a.kind === kind);

test('every Sindr stall the server knows stands where the town builds it', () => {
  const stalls = byKind('stall').filter((a) => a.merchant);
  assert.equal(SINDR_STALLS.length, stalls.length);
  for (const place of SINDR_STALLS) {
    const anchor = stalls.find((a) => a.merchant === place.id);
    assert.ok(anchor, `no anchor builds the stall ${place.id}`);
    assert.equal(place.x, anchor.x, `${place.id} x`);
    assert.equal(place.z, anchor.z, `${place.id} z`);
  }
});

test('every Sindr counting house stands at the door its anchor builds', () => {
  const houses = byKind('counting_house');
  assert.equal(SINDR_COUNTING_HOUSES.length, houses.length);
  for (const place of SINDR_COUNTING_HOUSES) {
    const anchor = houses.find((a) => a.institution === place.id);
    assert.ok(anchor, `no anchor builds the counting house ${place.id}`);
    assert.ok(anchor.door, `${anchor.id} has no door to stand at`);
    assert.equal(place.x, anchor.door.x, `${place.id} door x`);
    assert.equal(place.z, anchor.door.z, `${place.id} door z`);
  }
});

test('the notice board the town checks stands where the town builds it', () => {
  const board = anchors.anchors.find((a) => a.kind === 'notice_board');
  assert.ok(board, 'Sindr builds a notice board');
  assert.equal(SINDR_NOTICE_BOARD.x, board.x);
  assert.equal(SINDR_NOTICE_BOARD.z, board.z);
});

test('the town gets the places, other zones get none', () => {
  assert.equal(placesFor('sindr').stalls.length, SINDR_STALLS.length);
  assert.equal(placesFor('sindr').countingHouses.length, SINDR_COUNTING_HOUSES.length);
  assert.equal(placesFor('sindr').noticeBoard?.id, 'notice_board');
  assert.deepEqual(placesFor('arena'), { stalls: [], countingHouses: [], noticeBoard: null });
});
