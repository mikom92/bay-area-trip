(function(global){
  const PUBLIC_RATES = Object.freeze({
    carBase: 600,
    carPerDay: 75,
    carLabel: 'Car rental (estimate)',
    lodgingRate: 340,
    lodgingLabel: 'South Bay hotel (estimate)'
  });

  // Dollar costs. Held in złoty they would sit still while the rate slider moved,
  // which is exactly what they used to do.
  const USD = Object.freeze({
    hotelParkingPerNight: 10,
    sfDayParking: 32,      // one city day trip (Alcatraz + North Beach), no SF nights booked
    attractions: 116.8,    // CHM + Muir Woods (~$93.40) + Alcatraz night-vs-day delta ($23.40)
    warnerBros: 167,       // 2 tickets (~$147, estimated — the e-ticket carries no price) + $20 Burbank parking
    laGarage: 40,          // the LA room is covered by the host, the building garage is not: 2 nights at $20
    // Sunnyvale transfer 30 + Valley circuit 40 + down the PCH 400 + the LA day
    // itself 70 + back up the 101 380 + Alcatraz 90 + Muir Woods 130 + the
    // Peninsula move 20 + Livermore 80 + bootcamp week 60 + SFO drop 25.
    fuelMiles: 1300,
    fuelMpg: 17
  });

  const TARGET = Object.freeze({ low: 10000, high: 12000, gaugeMin: 8000, gaugeMax: 15000 });

  function createPublicRates(){
    return { ...PUBLIC_RATES };
  }

  function resetToPublicRates(rates){
    Object.assign(rates, PUBLIC_RATES);
  }

  function findActiveCardIndex(cards, date){
    return cards.findIndex(card => card.start <= date && date <= card.end);
  }

  // Self-paid meal days track the hotel stay: the 7-night default leaves 9 days
  // on your own (the reserved days and the second stay aside), so the offset is +2.
  function selfPaidDays(svNights){
    return svNights + 2;
  }

  // Every figure comes back in złoty. `fx` is złoty per dollar.
  function budgetTotals(input, rates){
    const { carDays, svNights, foodRate, gasPrice, fx } = input;

    const carCost = (rates.carBase + Math.max(0, carDays - 7) * rates.carPerDay) * fx;
    const svHotel = svNights * rates.lodgingRate;          // confirmed złoty booking
    const svParking = svNights * USD.hotelParkingPerNight * fx;
    const sfDayParking = USD.sfDayParking * fx;
    const fuel = (USD.fuelMiles / USD.fuelMpg) * gasPrice * fx;
    const foodDays = selfPaidDays(svNights);
    const foodCost = foodRate * foodDays;                  // the slider is złoty per day
    const attractions = USD.attractions * fx;
    const warnerBros = USD.warnerBros * fx;
    const laGarage = USD.laGarage * fx;

    const total = carCost + svHotel + svParking + sfDayParking
                + fuel + foodCost + attractions + warnerBros + laGarage;

    return { carCost, svHotel, svParking, sfDayParking, fuel, foodDays, foodCost,
             attractions, warnerBros, laGarage, total };
  }

  function budgetStatus(total){
    if (total < TARGET.low) return 'under';
    if (total <= TARGET.high) return 'good';
    return 'over';
  }

  function gaugePercent(total){
    const { gaugeMin: min, gaugeMax: max } = TARGET;
    return Math.min(100, Math.max(0, (total - min) / (max - min) * 100));
  }

  function clampToRange(value, min, max){
    return Math.min(max, Math.max(min, value));
  }

  // Which controls belong in a shareable link. The FX slider is set by the live
  // fetch as well as by hand, so it is only included once someone has actually
  // dragged it — otherwise an unrelated drag would pin that day's rate and
  // silence the fetch on every later visit.
  function shareableParams(entries, opts){
    const { fxPinned = false } = opts || {};
    const out = {};
    entries.forEach(({ key, value, defaultValue }) => {
      if (key === 'x' && !fxPinned) return;
      if (String(value) !== String(defaultValue)) out[key] = String(value);
    });
    return out;
  }

  // Hidden rows are still in the DOM — a category collapsed, or a list not yet
  // unlocked. Counting them would show "1 / 7 done" beside six visible items.
  function checklistProgress(rows){
    const shown = rows.filter(row => !row.hidden);
    const done = shown.filter(row => row.checked).length;
    const text = done + ' / ' + shown.length + ' done' + (done === shown.length ? ' — all set ✈' : '');
    return { done, total: shown.length, text };
  }

  /* Reconcile this browser's ticks with the stored copy.

     The rule this replaces was "the stored set wins for keys it knows", which
     has no notion of *when*. Every key exists in the table from the first
     push, so a tick that never reached the server — made while the page was
     still fetching, or while offline — met a stale `false` on the next load
     and was cleared on both sides. Ticks disappeared and nothing said so.

     Whichever side edited a key last wins, using the updated_at the table
     already carries. Two safeguards on top: a key the server has never seen
     cannot lose to a timestamp that does not exist, and a tie never resolves
     to un-ticked. Un-ticking still propagates — but only as the newer edit,
     never as the default value of a row nobody has written. */
  function mergeChecklist(local, remote){
    const at = entry => (entry && Date.parse(entry.at)) || 0;
    const merged = {}, toPush = [];

    new Set([...Object.keys(local), ...Object.keys(remote)]).forEach(key => {
      const mine = local[key], theirs = remote[key];

      if (!theirs){ if (mine){ merged[key] = mine; toPush.push(key); } return; }
      if (!mine){ merged[key] = theirs; return; }

      if (at(mine) > at(theirs)){ merged[key] = mine; toPush.push(key); return; }
      if (at(theirs) > at(mine)){ merged[key] = theirs; return; }

      // Same instant, or neither side timestamped: keep the tick.
      merged[key] = mine.done ? mine : theirs;
      if (merged[key].done !== theirs.done) toPush.push(key);
    });

    return { merged, toPush };
  }

  function formatMoney(pln, currency, fx){
    if (currency !== 'USD') return Math.round(pln).toLocaleString('en-US') + ' zł';
    return '$' + Math.round(pln / fx).toLocaleString('en-US');
  }

  const TRIP = Object.freeze({ start: '2026-09-13', end: '2026-09-25' });

  // Where the trip is relative to a given day. Dates are ISO strings so the
  // comparison is lexical and timezone-free, the same trick findActiveCardIndex
  // already uses.
  function tripPhase(today, start, end){
    start = start || TRIP.start; end = end || TRIP.end;
    const days = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
    const total = days(start, end) + 1;
    if (today < start){
      const n = days(today, start);
      return { phase: 'before', days: n, label: n === 1 ? 'Tomorrow' : n + ' days to departure' };
    }
    if (today <= end){
      const n = days(start, today) + 1;
      return { phase: 'during', days: n, label: 'Day ' + n + ' of ' + total };
    }
    return { phase: 'after', days: days(end, today), label: '' };
  }

  // What the page still has open, counted rather than restated. Entries come
  // from markers on the elements themselves, so this cannot drift from them.
  function openSummary(items){
    const decisions = items.filter(i => i.kind === 'decision').length;
    const bookings = items.filter(i => i.kind === 'booking').length;
    const part = (n, one) => n + ' ' + (n === 1 ? one : one + 's');
    const bits = [];
    if (decisions) bits.push(part(decisions, 'decision'));
    if (bookings) bits.push(part(bookings, 'booking'));
    return {
      decisions, bookings, total: decisions + bookings,
      text: bits.length ? bits.join(' and ') + ' still open' : 'nothing left open'
    };
  }

  global.BayTripState = Object.freeze({
    TRIP, tripPhase, openSummary,
    USD, TARGET,
    createPublicRates,
    resetToPublicRates,
    findActiveCardIndex,
    selfPaidDays,
    budgetTotals,
    budgetStatus,
    gaugePercent,
    clampToRange,
    shareableParams,
    checklistProgress,
    mergeChecklist,
    formatMoney
  });
})(globalThis);
