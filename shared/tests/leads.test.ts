import test from 'node:test';
import assert from 'node:assert/strict';
import { LeadManager, SINDR_LEADS } from '../src/story/leads.js';

test('Innkeeper lead system: purchase lead and verify marker location', () => {
  const manager = new LeadManager(SINDR_LEADS);
  const available = manager.getAvailableLeads();
  assert.ok(available.length >= 3, 'Must have at least 3 leads available in Sindr');

  const firstLead = available[0]!;
  assert.equal(firstLead.purchased, false);
  assert.equal(firstLead.completed, false);

  // Purchase lead from innkeeper
  const purchased = manager.purchaseLead(firstLead.id);
  assert.ok(purchased !== null);
  assert.equal(purchased.purchased, true);
  assert.equal(manager.activeLeadId, firstLead.id);

  const active = manager.getActiveLead();
  assert.ok(active !== null);
  assert.equal(active.id, firstLead.id);
  assert.ok(active.target.x !== 0 || active.target.z !== 0);

  // Check target distance reached
  const tooFar = manager.checkTargetReached(0, 0);
  assert.equal(tooFar, null, 'Should not complete when far from target');

  // Arrive at target coordinates
  const reached = manager.checkTargetReached(active.target.x, active.target.z);
  assert.ok(reached !== null, 'Should complete when reaching target');
  assert.equal(reached.completed, true);
  assert.equal(manager.getActiveLead(), null, 'No active lead once completed');
});
