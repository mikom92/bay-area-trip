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

test('falls back to the Bay Area variant unless B is asked for explicitly', () => {
  const tripState = loadTripState();

  assert.equal(tripState.normalizeVariant('b'), 'b');
  assert.equal(tripState.normalizeVariant('B'), 'b');
  assert.equal(tripState.normalizeVariant(' b '), 'b');

  assert.equal(tripState.normalizeVariant('a'), 'a');
  assert.equal(tripState.normalizeVariant(null), 'a');
  assert.equal(tripState.normalizeVariant(undefined), 'a');
  assert.equal(tripState.normalizeVariant(''), 'a');
  assert.equal(tripState.normalizeVariant('napa'), 'a');
});

test('budget: every dollar line follows the rate, złoty lines do not', () => {
  const tripState = loadTripState();
  const rates = tripState.createPublicRates();
  const input = { carDays: 12, svNights: 7, foodRate: 190, gasPrice: 5.75, tastings: 2 };

  const at = fx => tripState.budgetTotals({ ...input, fx }, rates);
  const lo = at(3.20), base = at(3.75), hi = at(4.80);

  // the confirmed złoty booking and the złoty-per-day slider must not move
  assert.equal(lo.svHotel, hi.svHotel);
  assert.equal(lo.foodCost, hi.foodCost);

  // everything else is a dollar cost — this is the regression that let ~838 zł
  // of the total sit frozen at the 3.75 fallback
  for (const line of ['carCost', 'svParking', 'sfDayParking', 'fuel', 'attractions', 'tastingCost']) {
    assert.ok(hi[line] > lo[line], `${line} should rise with the rate`);
    assert.equal(Math.round(hi[line] / lo[line] * 100) / 100, Math.round(4.80 / 3.20 * 100) / 100);
  }

  assert.equal(Math.round(base.total), 9986);
  assert.equal(base.foodDays, 9);
});

test('budget: signed-in rates replace the public estimates', () => {
  const tripState = loadTripState();
  const rates = tripState.createPublicRates();
  const input = { carDays: 12, svNights: 7, foodRate: 190, gasPrice: 5.75, tastings: 2, fx: 3.75 };
  const before = tripState.budgetTotals(input, rates).total;

  Object.assign(rates, { carBase: 900, carPerDay: 95, lodgingRate: 500 });
  const after = tripState.budgetTotals(input, rates).total;

  assert.ok(after > before);
  tripState.resetToPublicRates(rates);
  assert.equal(tripState.budgetTotals(input, rates).total, before);
});

test('budget: status and gauge agree on the target band', () => {
  const tripState = loadTripState();
  const { low, high, gaugeMin, gaugeMax } = tripState.TARGET;

  assert.equal(tripState.budgetStatus(low - 1), 'under');
  assert.equal(tripState.budgetStatus(low), 'good');
  assert.equal(tripState.budgetStatus(high), 'good');      // boundary is inclusive
  assert.equal(tripState.budgetStatus(high + 1), 'over');

  assert.equal(tripState.gaugePercent(gaugeMin), 0);
  assert.equal(tripState.gaugePercent(gaugeMax), 100);
  assert.equal(tripState.gaugePercent(gaugeMin - 5000), 0);   // clamped, never off-track
  assert.equal(tripState.gaugePercent(gaugeMax + 5000), 100);
});

test('shareable link omits the auto-fetched rate until it is dragged', () => {
  const tripState = loadTripState();
  const entries = [
    { key: 'f', value: '200', defaultValue: '190' },
    { key: 'x', value: '3.91', defaultValue: '3.75' }   // moved by the live fetch, not by hand
  ];

  // the bug: any unrelated drag pinned the rate, which silenced the live fetch
  // on every later visit and froze it at whatever it was that day
  assert.deepEqual({ ...tripState.shareableParams(entries, { fxPinned: false }) }, { f: '200' });
  assert.deepEqual({ ...tripState.shareableParams(entries, { fxPinned: true }) }, { f: '200', x: '3.91' });
});

test('shareable link carries the variant only when it is not the default', () => {
  const tripState = loadTripState();
  const untouched = [{ key: 'f', value: '190', defaultValue: '190' }];

  assert.deepEqual({ ...tripState.shareableParams(untouched, { variant: 'a' }) }, {});
  assert.deepEqual({ ...tripState.shareableParams(untouched, { variant: 'b' }) }, { v: 'b' });
});

test('slider values from a link are clamped into range', () => {
  const tripState = loadTripState();
  assert.equal(tripState.clampToRange(99, 3.2, 4.8), 4.8);
  assert.equal(tripState.clampToRange(-99, 3.2, 4.8), 3.2);
  assert.equal(tripState.clampToRange(4, 3.2, 4.8), 4);
});

test('checklist progress counts only the rows on screen', () => {
  const tripState = loadTripState();
  const rows = [
    { checked: true,  hidden: false },
    { checked: false, hidden: false },
    { checked: true,  hidden: true }    // the other variant's row
  ];

  // the bug: counting every checkbox showed "2 / 3 done" beside two visible items
  const p = tripState.checklistProgress(rows);
  assert.equal(p.done, 1);
  assert.equal(p.total, 2);
  assert.equal(p.text, '1 / 2 done');

  assert.equal(tripState.checklistProgress([{ checked: true, hidden: false }]).text, '1 / 1 done — all set ✈');
});

test('variant delta net follows every line, including ones added later', () => {
  const tripState = loadTripState();

  // the bug: the net summed three named keys, so a fourth line rendered while
  // the total silently stayed behind
  assert.equal(tripState.sumDelta({ fuel: 185, food: 140, tastings: -110 }), 215);
  assert.equal(tripState.sumDelta({ fuel: 185, food: 140, studio: 167, tastings: -110 }), 382);
  assert.equal(tripState.sumDelta({}), 0);
});

test('money renders in the selected currency, signed where it is a delta', () => {
  const tripState = loadTripState();

  assert.equal(tripState.formatMoney(1432.5, 'PLN', 3.75), '1,433 zł');
  assert.equal(tripState.formatMoney(1432.5, 'USD', 3.75), '$382');

  assert.equal(tripState.formatSignedUSD(167, 'USD', 3.75), '+$167');
  assert.equal(tripState.formatSignedUSD(-110, 'USD', 3.75), '−$110');
  assert.equal(tripState.formatSignedUSD(-110, 'PLN', 3.75), '−413 zł');
});

test('trip phase reads the same way before, during and after', () => {
  const tripState = loadTripState();
  const { start, end } = tripState.TRIP;

  assert.deepEqual({ ...tripState.tripPhase('2026-09-06', start, end) },
    { phase: 'before', days: 7, label: '7 days to departure' });
  assert.equal(tripState.tripPhase('2026-09-12', start, end).label, 'Tomorrow');

  assert.equal(tripState.tripPhase(start, start, end).label, 'Day 1 of 13');
  assert.equal(tripState.tripPhase('2026-09-19', start, end).label, 'Day 7 of 13');
  assert.equal(tripState.tripPhase(end, start, end).label, 'Day 13 of 13');   // last day still counts

  assert.equal(tripState.tripPhase('2026-09-26', start, end).phase, 'after');
  assert.equal(tripState.tripPhase('2026-09-26', start, end).label, '');      // nothing to show
});

test('open summary counts decisions and bookings separately', () => {
  const tripState = loadTripState();
  const d = { kind: 'decision' }, b = { kind: 'booking' };

  assert.equal(tripState.openSummary([d, d, b]).text, '2 decisions and 1 booking still open');
  assert.equal(tripState.openSummary([d]).text, '1 decision still open');     // singular
  assert.equal(tripState.openSummary([b, b]).text, '2 bookings still open');
  assert.equal(tripState.openSummary([]).text, 'nothing left open');
  assert.equal(tripState.openSummary([d, b]).total, 2);
});
