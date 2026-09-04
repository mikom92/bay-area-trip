(function(global){
  const PUBLIC_RATES = Object.freeze({
    carBase: 600,
    carPerDay: 75,
    carLabel: 'Car rental (estimate) + IDP',
    lodgingRate: 340,
    lodgingLabel: 'South Bay hotel (estimate)'
  });

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

  global.BayTripState = Object.freeze({
    createPublicRates,
    resetToPublicRates,
    findActiveCardIndex,
    normalizeVariant
  });
})(globalThis);
