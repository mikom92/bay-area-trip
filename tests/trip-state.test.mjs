import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadTripState() {
  const source = readFileSync(path.join(root, 'assets/trip-state.js'), 'utf8');
  const context = {};
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'assets/trip-state.js' });
  return context.BayTripState;
}

test('restores public budget rates after private overrides are cleared', () => {
  const tripState = loadTripState();
  const rates = tripState.createPublicRates();

  Object.assign(rates, {
    carBase: 1_050,
    carPerDay: 95,
    carLabel: 'Private rental details',
    lodgingRate: 510,
    lodgingLabel: 'Private hotel name'
  });

  tripState.resetToPublicRates(rates);

  assert.deepEqual({ ...rates }, {
    carBase: 600,
    carPerDay: 75,
    carLabel: 'Car rental (estimate) + IDP',
    lodgingRate: 340,
    lodgingLabel: 'South Bay hotel (estimate)'
  });
});

test('keeps all dates in a grouped itinerary card eligible for Today', () => {
  const tripState = loadTripState();
  const cards = [
    { start: '2026-09-21', end: '2026-09-21' },
    { start: '2026-09-22', end: '2026-09-24' },
    { start: '2026-09-25', end: '2026-09-25' }
  ];

  assert.equal(tripState.findActiveCardIndex(cards, '2026-09-22'), 1);
  assert.equal(tripState.findActiveCardIndex(cards, '2026-09-23'), 1);
  assert.equal(tripState.findActiveCardIndex(cards, '2026-09-24'), 1);
  assert.equal(tripState.findActiveCardIndex(cards, '2026-09-25'), 2);
  assert.equal(tripState.findActiveCardIndex(cards, '2026-09-26'), -1);
});
