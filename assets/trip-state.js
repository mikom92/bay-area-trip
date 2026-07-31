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

  global.BayTripState = Object.freeze({
    createPublicRates,
    resetToPublicRates,
    findActiveCardIndex
  });
})(globalThis);
