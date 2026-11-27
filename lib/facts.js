/* FarGems: one short, true fact about what you are looking at, for the "More" part of the details card.
 *   factFor(o)   o is an object from the sky list ({ kind, name, ac: { type }, altKm }). Returns a sentence, or null when there is nothing
 *                worth saying. Nothing here is a number that changes, so it never goes stale.
 * Plain data and string work, no network. Runs in the browser and under Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FarGemsFacts = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // First flight of the common airliner types, by their ICAO type code (the code a flight reports).
  const AIRCRAFT = {
    A318: 'The A318 is the smallest Airbus jet in the A320 family, nicknamed the Baby Bus.',
    A319: 'The A319 is a shortened A320 and can fly the same routes with fewer seats.',
    A320: 'The A320 first flew in 1987 and was the first airliner with digital fly-by-wire controls.',
    A321: 'The A321 is the stretched A320, and the longest of that family.',
    A20N: 'The A320neo has new, quieter, thriftier engines on the A320 design that first flew in 1987.',
    A21N: 'The A321neo is the stretched A320neo, now one of the best-selling jets.',
    A332: 'The A330-200 is a twin-engine long-haul Airbus that first flew in 1992.',
    A333: 'The A330-300 is a twin-engine long-haul Airbus that first flew in 1992.',
    A338: 'The A330-800 is the smaller of the new A330neo models.',
    A339: 'The A330-900 is a re-engined A330, flying since 2017.',
    A343: 'The A340 had four engines and was built for the longest routes before twin-engine jets took over.',
    A359: 'The A350-900 is built mostly of carbon fibre, and first flew in 2013.',
    A35K: 'The A350-1000 is the longest A350, and first flew in 2016.',
    A388: 'The A380 is the largest passenger airliner ever built, with two full decks. It first flew in 2005.',
    B734: 'The 737-400 is an older 737, first flown in 1988.',
    B737: 'The 737 has flown since 1967 and is the best-selling jet airliner of all time.',
    B738: 'The 737-800 first flew in 1997 and is one of the most common jets in the sky.',
    B739: 'The 737-900 is the longest of the classic-style 737s.',
    B38M: 'The 737 MAX 8 is the latest 737, with bigger, more efficient engines.',
    B744: 'The 747-400 is the “Queen of the Skies”, with its hump and four engines. The 747 first flew in 1969.',
    B748: 'The 747-8 is the last and longest 747.',
    B752: 'The 757 first flew in 1982 and climbs more steeply than most jets.',
    B763: 'The 767 first flew in 1981 and is still used for passengers and freight.',
    B772: 'The 777-200 first flew in 1994 and was the first airliner designed entirely on computers.',
    B77L: 'The 777-200LR is one of the longest-range airliners ever built.',
    B77W: 'The 777-300ER is the 777 most airlines use for long flights, with the largest jet engines ever fitted.',
    B788: 'The 787-8 Dreamliner first flew in 2009 and is built largely of carbon fibre.',
    B789: 'The 787-9 Dreamliner is the stretched 787, with windows that dim without blinds.',
    B78X: 'The 787-10 is the longest Dreamliner.',
    E170: 'The E170 is a Brazilian-built regional jet, in service since 2004.',
    E190: 'The E190 is a Brazilian-built regional jet, in service since 2005.',
    AT72: 'The ATR 72 is a turboprop built in France and Italy, made for short hops.',
    AT76: 'The ATR 72-600 is a turboprop built in France and Italy, made for short hops.',
    DH8D: 'The Q400 is a fast turboprop built in Canada.',
    CRJ9: 'The CRJ900 is a Canadian-built regional jet.',
    C172: 'The Cessna 172 is the most-built aircraft in history, flying since 1956.',
    BCS1: 'The A220-100 was designed by Bombardier in Canada, then taken on by Airbus.',
    BCS3: 'The A220-300 was designed by Bombardier in Canada, then taken on by Airbus.',
  };

  // Who runs a satellite, by the start of its name, and a line about it. The first match wins.
  const SATS = [
    [/^(ISS|ZARYA)\b/, 'The International Space Station is the biggest object people have built in space. It has been lived in nonstop since November 2000 and circles the Earth about every 90 minutes.'],
    [/^(CSS|TIANHE|TIANGONG)\b/, 'China’s Tiangong space station is lived in by crews of three, and circles the Earth about every 90 minutes.'],
    [/^HST\b|HUBBLE/, 'The Hubble Space Telescope has orbited since 1990 and is far above the weather, so its pictures are sharp.'],
    [/^STARLINK/, 'Starlink is a huge fleet of internet satellites. Newly launched ones sometimes cross the sky in a bright line, like a train.'],
    [/^ONEWEB/, 'OneWeb is a fleet of internet satellites that fly higher than Starlink.'],
    [/^IRIDIUM/, 'Iridium satellites make phone calls from anywhere. Their shiny antennas once threw bright “Iridium flares” across the sky.'],
    [/^(GPS|NAVSTAR)/, 'GPS satellites carry atomic clocks. Your phone works out where you are by listening to several at once.'],
    [/^(GLONASS|COSMOS)/, 'Cosmos is the name Russia gives to many of its satellites, including its navigation (GLONASS) fleet.'],
    [/^GALILEO/, 'Galileo is Europe’s satellite navigation system, and one of its clocks loses less than a second in millions of years.'],
    [/^(BEIDOU)/, 'BeiDou is China’s satellite navigation system.'],
    [/^(NOAA|GOES|METEOSAT|METOP|FENGYUN|INSAT)/, 'Weather satellites like this one watch clouds and storms, so the forecast can be made.'],
    [/^(TERRA|AQUA|LANDSAT|SENTINEL)/, 'Earth-watching satellites like this one photograph the planet to track forests, ice, cities and crops.'],
  ];

  const SAT_FALLBACK = {
    rocket: 'A spent rocket stage or a piece of debris. It is left over from a launch and is no longer working, but it still catches sunlight.',
    station: 'A space station, a home in space for astronauts.',
  };

  const BODIES = {
    Sun: 'The Sun holds 99.8% of everything in the solar system. Never look at it directly or through a camera.',
    Moon: 'The Moon is slowly drifting away from us, by about 3.8 cm each year, and always shows us the same face.',
    Mercury: 'Mercury is the smallest planet and the closest to the Sun. A day there lasts longer than its year.',
    Venus: 'Venus is the hottest planet, hotter than Mercury, and it spins backwards. It is the brightest planet in our sky.',
    Mars: 'Mars looks red because its dust is rusty. It has the tallest volcano in the solar system, Olympus Mons.',
    Jupiter: 'Jupiter is bigger than all the other planets put together. Its Great Red Spot is a storm that has lasted for centuries.',
    Saturn: 'Saturn is light enough to float on water, if there were a bath big enough. Its rings are mostly chunks of ice.',
    Uranus: 'Uranus rolls around the Sun tipped on its side. It was the first planet found with a telescope.',
    Neptune: 'Neptune has the fastest winds of any planet, over 2,000 km/h, and it is too faint to see without a telescope.',
  };

  const STARS = {
    Sirius: 'Sirius is the brightest star in the night sky, only about 8.6 light years away.',
    Canopus: 'Canopus is the second brightest star in the night sky. Ships and spacecraft have used it to find their way.',
    Arcturus: 'Arcturus is an orange giant, and one of the first stars ever seen in daylight with a telescope.',
    Vega: 'Vega was the first star other than the Sun to be photographed, in 1850. It will be the pole star in about 12,000 years.',
    Capella: 'Capella looks like one star but is really four.',
    Rigel: 'Rigel is a blue supergiant, tens of thousands of times brighter than the Sun.',
    Procyon: 'Procyon is only about 11.5 light years away, one of our nearest bright neighbours.',
    Betelgeuse: 'Betelgeuse is a red supergiant so big that it would swallow Mars if put where the Sun is. It will end as a supernova some day.',
    Altair: 'Altair spins so fast that it is squashed, taking under 10 hours per turn.',
    Aldebaran: 'Aldebaran is the red eye of Taurus the bull.',
    Antares: 'Antares is a red supergiant whose name means “rival of Mars”, for its colour.',
    Spica: 'Spica is really two stars that orbit each other, and are so close that they are pulled out of shape.',
    Pollux: 'Pollux has a planet, found in 2006, which was the first planet found around a giant star.',
    Fomalhaut: 'Fomalhaut was one of the first stars with a planet to be photographed directly.',
    Deneb: 'Deneb is one of the most distant stars you can see without a telescope, over 1,500 light years away.',
    Regulus: 'Regulus spins so fast that it is flattened. It marks the heart of Leo the lion.',
    Polaris: 'Polaris, the North Star, hardly moves, because it sits almost exactly above the Earth’s north pole.',
    Acrux: 'Acrux is the brightest star of the Southern Cross, and is really a group of stars.',
    'Alpha Centauri': 'Alpha Centauri is the nearest star system to the Sun, about 4.4 light years away.',
  };

  function factFor(o) {
    if (!o) return null;
    if (o.kind === 'body') return BODIES[o.name] || null;
    if (o.kind === 'star') return STARS[o.name] || null;
    if (o.kind === 'met') return 'Meteors are mostly specks of dust, smaller than a grain of sand, burning up high above the ground.';
    if (o.kind === 'air') {
      const t = o.ac && o.ac.type ? String(o.ac.type).toUpperCase() : '';
      return AIRCRAFT[t] || null;
    }
    if (o.kind === 'sat') {
      const n = String(o.name || '').toUpperCase();
      for (const [re, text] of SATS) if (re.test(n)) return text;
      if (/\bR\/B\b|ROCKET|BOOSTER|CENTAUR|\bDEB\b|\bDEBRIS\b|FREGAT/.test(n)) return SAT_FALLBACK.rocket;
      if (o.altKm > 0) {
        const mins = Math.round((2 * Math.PI * Math.sqrt(Math.pow(6371 + o.altKm, 3) / 398600.4418)) / 60);
        return `At ${Math.round(o.altKm).toLocaleString('en-US')} km up, it goes once around the Earth in about ${mins} minutes.`;
      }
    }
    return null;
  }

  return { factFor };
});
