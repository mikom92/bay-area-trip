(function(global){
  const PUBLIC_RATES = Object.freeze({
    carBase: 600,
    carPerDay: 75,
    carLabel: 'Car rental (estimate) + IDP',
    lodgingRate: 340,
    lodgingLabel: 'South Bay hotel (estimate)'
  });

  // Dollar costs. Held in złoty they would sit still while the rate slider moved,
  // which is exactly what they used to do.
  const USD = Object.freeze({
    hotelParkingPerNight: 10,
    sfDayParking: 32,      // one city day trip (Alcatraz + North Beach), no SF nights booked
    attractions: 116.8,    // CHM + Muir Woods (~$93.40) + Alcatraz night-vs-day delta ($23.40)
    tastingEach: 37,
    fuelMiles: 900,
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

  // 15-17 Sep runs in two variants. Anything but an explicit "b" — a stale
  // localStorage value, a hand-edited ?v=, nothing at all — falls back to A,
  // so the page never renders a day range with no cards at all.
  function normalizeVariant(value){
    return String(value == null ? '' : value).trim().toLowerCase() === 'b' ? 'b' : 'a';
  }

  // Self-paid meal days track the hotel stay: the 7-night default leaves 9 days
  // on your own (the reserved days and the second stay aside), so the offset is +2.
  function selfPaidDays(svNights){
    return svNights + 2;
  }

  // Every figure comes back in złoty. `fx` is złoty per dollar.
  function budgetTotals(input, rates){
    const { carDays, svNights, foodRate, gasPrice, tastings, fx } = input;

    const carCost = (rates.carBase + Math.max(0, carDays - 7) * rates.carPerDay) * fx;
    const svHotel = svNights * rates.lodgingRate;          // confirmed złoty booking
    const svParking = svNights * USD.hotelParkingPerNight * fx;
    const sfDayParking = USD.sfDayParking * fx;
    const fuel = (USD.fuelMiles / USD.fuelMpg) * gasPrice * fx;
    const foodDays = selfPaidDays(svNights);
    const foodCost = foodRate * foodDays;                  // the slider is złoty per day
    const attractions = USD.attractions * fx;
    const tastingCost = tastings * USD.tastingEach * fx;

    const total = carCost + svHotel + svParking + sfDayParking
                + fuel + foodCost + attractions + tastingCost;

    return { carCost, svHotel, svParking, sfDayParking, fuel, foodDays, foodCost, attractions, tastingCost, total };
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
    const { variant = 'a', fxPinned = false } = opts || {};
    const out = {};
    entries.forEach(({ key, value, defaultValue }) => {
      if (key === 'x' && !fxPinned) return;
      if (String(value) !== String(defaultValue)) out[key] = String(value);
    });
    if (variant !== 'a') out.v = variant;
    return out;
  }

  // Rows of the hidden variant are still in the DOM. Counting them would show
  // "1 / 7 done" beside six visible items.
  function checklistProgress(rows){
    const shown = rows.filter(row => !row.hidden);
    const done = shown.filter(row => row.checked).length;
    const text = done + ' / ' + shown.length + ' done' + (done === shown.length ? ' — all set ✈' : '');
    return { done, total: shown.length, text };
  }

  // Sum the object, never a hand-written list of keys: adding a line to the
  // variant delta must move the net, and spelling the keys out is how that
  // silently stops happening.
  function sumDelta(delta){
    return Object.values(delta).reduce((a, b) => a + b, 0);
  }

  function formatMoney(pln, currency, fx){
    if (currency !== 'USD') return Math.round(pln).toLocaleString('en-US') + ' zł';
    return '$' + Math.round(pln / fx).toLocaleString('en-US');
  }

  function formatSignedUSD(usd, currency, fx){
    const sign = usd < 0 ? '−' : '+';
    return sign + formatMoney(Math.abs(usd) * fx, currency, fx);
  }

  global.BayTripState = Object.freeze({
    USD, TARGET,
    createPublicRates,
    resetToPublicRates,
    findActiveCardIndex,
    normalizeVariant,
    selfPaidDays,
    budgetTotals,
    budgetStatus,
    gaugePercent,
    clampToRange,
    shareableParams,
    checklistProgress,
    sumDelta,
    formatMoney,
    formatSignedUSD
  });
})(globalThis);
