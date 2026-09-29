/**
 * Guided city tours as Director scene recipes.
 *
 * A tour is authored as a short list of landmark STOPS, not raw camera
 * keyframes. `cityTourToRecipe` turns each stop into two shots — an arrival
 * and a slow orbit — so the Director's own cubic easing does the camera work.
 * The stop's `story` never enters the scene document (the document schema has
 * no narration field); `cityTourStory` looks it up by scene and shot title so
 * the presenter can caption and narrate playback.
 *
 * To add a city: append a definition to CITY_TOURS. See docs/CITY-TOURS.md.
 */

/** Metres of latitude per degree (WGS84 mean). */
const METRES_PER_DEG_LAT = 111_320;

/** Seconds spent flying from one stop to the next. */
const TRANSIT_SEC = 6;
/** Seconds the arrival pose rests before the orbit begins. */
const ARRIVAL_HOLD_SEC = 0.6;
/** Degrees of heading the camera sweeps during a stop's orbit. */
const ORBIT_SWEEP_DEG = 40;

/**
 * @typedef {object} CityTourStop
 * @property {string} id            Stable id, unique within the tour.
 * @property {string} title         Shown in the shot list and caption.
 * @property {number} lat           Landmark latitude.
 * @property {number} lon           Landmark longitude.
 * @property {number} rangeM        Camera distance from the landmark.
 * @property {number} heading       Direction the camera LOOKS (degrees).
 * @property {number} pitch         Camera pitch (negative looks down).
 * @property {number} [heightM=40]  Landmark height; the camera aims at half.
 * @property {number} [holdSec=14]  Orbit duration at this stop.
 * @property {string} story         One or two sentences for caption/narration.
 */

/**
 * @typedef {object} CityTour
 * @property {string} id
 * @property {string} title
 * @property {string} city
 * @property {number} groundEllipsoidM  Ground height above the WGS84 ellipsoid
 *   (orthometric height + geoid undulation). Coarse: ±30 m is fine.
 * @property {{ lat: number, lon: number, alt: number, heading: number, pitch: number, story: string }} establish
 * @property {CityTourStop[]} stops
 */

/** @type {readonly CityTour[]} */
export const CITY_TOURS = Object.freeze([
  {
    id: 'city-tour-rome',
    title: 'Rome: Heart of the Empire',
    city: 'Rome',
    groundEllipsoidM: 70,
    establish: {
      lat: 41.8945,
      lon: 12.4855,
      alt: 9500,
      heading: 20,
      pitch: -42,
      story:
        'Rome. City stacked on city. This pass stays in the ancient core: arena, forum, fountain, and a dome that is still unmatched.',
    },
    stops: [
      {
        id: 'colosseum',
        title: 'The Colosseum',
        lat: 41.8902,
        lon: 12.4922,
        rangeM: 820,
        heading: 240,
        pitch: -18,
        heightM: 52,
        holdSec: 18,
        story:
          "The Flavian amphitheatre. Vespasian built it on Nero's lake as a gift back to the city. Titus opened it in 80 AD. Under the floor, cages and ramps. The scars in the stone are later Rome quarrying it for palaces.",
      },
      {
        id: 'arch-of-titus',
        title: 'Arch of Titus',
        lat: 41.8906,
        lon: 12.4885,
        rangeM: 340,
        heading: 250,
        pitch: -20,
        heightM: 18,
        holdSec: 12,
        story:
          'Eighty-one AD. The Arch of Titus marks the siege of Jerusalem; the menorah in the relief still ties this street to another city.',
      },
      {
        id: 'forum',
        title: 'Forum and Curia',
        lat: 41.8925,
        lon: 12.4853,
        rangeM: 560,
        heading: 210,
        pitch: -30,
        heightM: 22,
        holdSec: 12,
        story:
          'The valley under us was the civic machine: speeches, markets, the Curia. This is why Rome became a government, not just a hill fort.',
      },
      {
        id: 'trevi',
        title: 'Trevi Fountain',
        lat: 41.9009,
        lon: 12.4833,
        rangeM: 260,
        heading: 5,
        pitch: -16,
        heightM: 20,
        holdSec: 15,
        story:
          "Nicola Salvi's eighteenth-century theatre for water. It is the showy end of Aqua Virgo, a Roman aqueduct still feeding the city. The coins are a later ritual.",
      },
      {
        id: 'pantheon',
        title: 'The Pantheon',
        lat: 41.8986,
        lon: 12.4769,
        rangeM: 380,
        heading: 215,
        pitch: -16,
        heightM: 48,
        holdSec: 18,
        story:
          "Hadrian's rebuild, about 126 AD. Largest unreinforced concrete dome on Earth. The oculus is the only light. Temple to all gods, then a church — which is why it is still standing.",
      },
    ],
  },
  {
    id: 'city-tour-paris',
    title: 'Paris: River and Axis',
    city: 'Paris',
    groundEllipsoidM: 80,
    establish: {
      lat: 48.8566,
      lon: 2.312,
      alt: 9500,
      heading: 80,
      pitch: -40,
      story:
        'Paris along the Seine. This pass follows a tourist day compressed: iron tower, triumphal arch, palace museum, and the island where the city began.',
    },
    stops: [
      {
        id: 'eiffel',
        title: 'Eiffel Tower',
        lat: 48.8584,
        lon: 2.2945,
        rangeM: 750,
        heading: 315,
        pitch: -22,
        heightM: 150,
        holdSec: 16,
        story:
          'The Eiffel Tower. Gustave Eiffel raised it for the 1889 Exposition — three hundred thirty metres of iron meant to be temporary. Paris kept it.',
      },
      {
        id: 'arc',
        title: 'Arc de Triomphe',
        lat: 48.8738,
        lon: 2.295,
        rangeM: 680,
        heading: 90,
        pitch: -16,
        heightM: 55,
        holdSec: 14,
        story:
          'Napoleon commissioned it in 1806; it was finished in 1836. Under the vault, the Tomb of the Unknown Soldier. The Champs-Élysées runs from here like a ruler.',
      },
      {
        id: 'louvre',
        title: 'The Louvre',
        lat: 48.8611,
        lon: 2.3358,
        rangeM: 620,
        heading: 250,
        pitch: -24,
        heightM: 30,
        holdSec: 16,
        story:
          "A fortress, then a palace, then a museum in 1793. I. M. Pei's glass pyramid from 1989 is the new door into the old royal courtyard.",
      },
      {
        id: 'notre-dame',
        title: 'Notre-Dame',
        lat: 48.853,
        lon: 2.3499,
        rangeM: 520,
        heading: 300,
        pitch: -20,
        heightM: 69,
        holdSec: 16,
        story:
          'Work began in 1163. The 2019 fire took the spire and the roof. The cathedral reopened in 2024. This island is where Paris was a city before it was a capital.',
      },
    ],
  },
  {
    id: 'city-tour-tokyo',
    title: 'Tokyo: Tower, Palace, Old Town',
    city: 'Tokyo',
    groundEllipsoidM: 45,
    establish: {
      lat: 35.68,
      lon: 139.77,
      alt: 12000,
      heading: 40,
      pitch: -38,
      story:
        "Tokyo. This pass jumps clusters: a 1958 broadcast tower, the imperial moat, Asakusa's oldest temple, then the tower that replaced the first one's job.",
    },
    stops: [
      {
        id: 'tokyo-tower',
        title: 'Tokyo Tower',
        lat: 35.6586,
        lon: 139.7454,
        rangeM: 850,
        heading: 20,
        pitch: -22,
        heightM: 110,
        holdSec: 14,
        story:
          "Tokyo Tower, 1958. Three hundred thirty-three metres. Eiffel as the model, painted orange and white for aviation. For decades this was the city's broadcast mast.",
      },
      {
        id: 'imperial-palace',
        title: 'Imperial Palace',
        lat: 35.6852,
        lon: 139.7528,
        rangeM: 900,
        heading: 0,
        pitch: -32,
        heightM: 20,
        holdSec: 14,
        story:
          "The Imperial Palace sits on Edo Castle. The East Gardens are public. The inner palace is still the Emperor's — a moated blank in the middle of the capital.",
      },
      {
        id: 'senso-ji',
        title: 'Senso-ji',
        lat: 35.7148,
        lon: 139.7967,
        rangeM: 450,
        heading: 0,
        pitch: -18,
        heightM: 30,
        holdSec: 16,
        story:
          "Senso-ji, Tokyo's oldest temple. Legend puts its founding in 628. Nakamise is the approach — a market street aimed at the gate like an arrow.",
      },
      {
        id: 'skytree',
        title: 'Tokyo Skytree',
        lat: 35.7101,
        lon: 139.8107,
        rangeM: 900,
        heading: 220,
        pitch: -20,
        heightM: 200,
        holdSec: 16,
        story:
          "Tokyo Skytree, 2012. Six hundred thirty-four metres. Japan's tallest structure, and the broadcast tower that took Tokyo Tower's job.",
      },
    ],
  },
  {
    id: 'city-tour-london',
    title: 'London: Bridge, Dome, Crown',
    city: 'London',
    groundEllipsoidM: 60,
    establish: {
      lat: 51.507,
      lon: -0.11,
      alt: 9500,
      heading: 300,
      pitch: -40,
      story:
        'London along the Thames. This pass runs upriver: a Victorian drawbridge, a cathedral dome, the clock tower of Parliament, and the palace at the end of the Mall.',
    },
    stops: [
      {
        id: 'tower-bridge',
        title: 'Tower Bridge',
        lat: 51.5055,
        lon: -0.0754,
        rangeM: 700,
        heading: 290,
        pitch: -20,
        heightM: 65,
        holdSec: 14,
        story:
          'Tower Bridge, opened in 1894. A bascule bridge dressed as a Gothic castle so it would sit beside the Tower of London. The two roadways still lift for tall ships.',
      },
      {
        id: 'st-pauls',
        title: "St Paul's Cathedral",
        lat: 51.5138,
        lon: -0.0984,
        rangeM: 620,
        heading: 20,
        pitch: -22,
        heightM: 111,
        holdSec: 16,
        story:
          "Christopher Wren's cathedral, finished in 1710 after the Great Fire took the medieval one. The dome is three shells, one inside another, and it survived the Blitz.",
      },
      {
        id: 'westminster',
        title: 'Palace of Westminster',
        lat: 51.5007,
        lon: -0.1246,
        rangeM: 640,
        heading: 250,
        pitch: -20,
        heightM: 96,
        holdSec: 16,
        story:
          'Parliament, rebuilt after an 1834 fire. The clock tower is the Elizabeth Tower; Big Ben is the bell inside it, first rung in 1859.',
      },
      {
        id: 'buckingham',
        title: 'Buckingham Palace',
        lat: 51.5014,
        lon: -0.1419,
        rangeM: 560,
        heading: 250,
        pitch: -24,
        heightM: 24,
        holdSec: 14,
        story:
          'A townhouse bought by George III, enlarged by Nash, and made the royal residence when Victoria moved in in 1837. The Mall runs straight at its front.',
      },
    ],
  },
]);

/** Bounded-by-ellipsoid camera pose that looks at a landmark from a range. */
export function lookAtPose({
  lat,
  lon,
  rangeM,
  heading,
  pitch,
  heightM = 40,
  groundEllipsoidM = 0,
}) {
  const pitchRad = (Math.abs(pitch) * Math.PI) / 180;
  const horizontal = rangeM * Math.cos(pitchRad);
  const vertical = rangeM * Math.sin(pitchRad);
  // The camera stands opposite the direction it looks.
  const bearingRad = (((heading + 180) % 360) * Math.PI) / 180;
  const dLat = (horizontal * Math.cos(bearingRad)) / METRES_PER_DEG_LAT;
  const dLon =
    (horizontal * Math.sin(bearingRad)) /
    (METRES_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  return {
    lat: Number((lat + dLat).toFixed(6)),
    lon: Number((lon + dLon).toFixed(6)),
    alt: Math.round(groundEllipsoidM + heightM / 2 + vertical),
    heading: ((heading % 360) + 360) % 360,
    pitch,
    roll: 0,
  };
}

/** Turn a tour definition into a Director recipe (see recipes.js). */
export function cityTourToRecipe(tour, { installAfter = 'omniscience-pullback' } = {}) {
  const ground = tour.groundEllipsoidM || 0;
  const cameraPath = [
    {
      lat: tour.establish.lat,
      lon: tour.establish.lon,
      alt: tour.establish.alt,
      heading: tour.establish.heading,
      pitch: tour.establish.pitch,
      roll: 0,
      duration: 8,
      hold: 1,
      title: `Approaching ${tour.city}`,
    },
  ];
  for (const stop of tour.stops) {
    const base = { ...stop, groundEllipsoidM: ground };
    const arrival = lookAtPose(base);
    const orbit = lookAtPose({ ...base, heading: stop.heading + ORBIT_SWEEP_DEG });
    cameraPath.push(
      { ...arrival, duration: TRANSIT_SEC, hold: ARRIVAL_HOLD_SEC, title: stop.title },
      {
        ...orbit,
        duration: Math.max(4, stop.holdSec || 14),
        hold: 0.4,
        title: stop.title,
      },
    );
  }
  return {
    id: tour.id,
    version: 1,
    title: tour.title,
    durationSec: cameraPath.reduce((sum, k) => sum + k.duration + k.hold, 0),
    style: 'normal',
    ui: { hidePanels: true, hudMode: 'off', safeFrame: '16:9' },
    layers: {},
    post: { bloom: 0, sharpen: false, detectionMode: 'OFF', mapStack: 'photoreal' },
    // Existing saved projects get the tour inserted after this scene. Each
    // tour anchors on the previous one, so they land in catalogue order.
    installAlongsideSceneId: installAfter,
    cameraPath,
  };
}

export const CITY_TOUR_RECIPES = Object.freeze(
  CITY_TOURS.map((tour, index) =>
    cityTourToRecipe(tour, {
      installAfter: index === 0 ? 'omniscience-pullback' : CITY_TOURS[index - 1].id,
    }),
  ),
);

const TOUR_BY_ID = new Map(CITY_TOURS.map((tour) => [tour.id, tour]));

/** Whether a scene id belongs to a bundled city tour. */
export function isCityTourScene(sceneId) {
  return TOUR_BY_ID.has(sceneId);
}

/**
 * Story text for a running shot, or null for non-tour scenes.
 * Arrival and orbit shots share a title, so both resolve to the same stop.
 */
export function cityTourStory(sceneId, shotTitle) {
  const tour = TOUR_BY_ID.get(sceneId);
  if (!tour) return null;
  if (shotTitle === `Approaching ${tour.city}`) {
    return { city: tour.city, title: shotTitle, story: tour.establish.story };
  }
  const stop = tour.stops.find((entry) => entry.title === shotTitle);
  return stop ? { city: tour.city, title: stop.title, story: stop.story } : null;
}
