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

/** localStorage key for the city-tours switch (see readCityToursEnabled). */
export const CITY_TOURS_STORAGE_KEY = 'gev-city-tours';

/**
 * Whether bundled city tours are installed into the Director project. Off by
 * default: tours are opt-in content, so a fresh or existing install never
 * gains scenes it did not ask for. `GEV_CITY_TOURS=1` turns them on for the
 * build; a saved `gev-city-tours` of `1` or `0` in localStorage overrides it.
 * Tours already saved in a project are the user's and stay either way.
 */
export function readCityToursEnabled(
  storage = globalThis.localStorage,
  envFlag = import.meta.env?.GEV_CITY_TOURS,
) {
  try {
    const stored = storage?.getItem?.(CITY_TOURS_STORAGE_KEY);
    if (stored === '1') return true;
    if (stored === '0') return false;
  } catch {
    // private mode / missing storage
  }
  return envFlag === '1';
}

/** Metres of latitude per degree (WGS84 mean). */
const METRES_PER_DEG_LAT = 111_320;

/** Seconds spent flying from one stop to the next. */
const TRANSIT_SEC = 6;
/** Seconds the arrival pose rests before the stop's move begins. */
const ARRIVAL_HOLD_SEC = 0.8;
/** Degrees of heading the camera sweeps during an orbit. */
const ORBIT_SWEEP_DEG = 40;

/**
 * Cinematic moves a stop can ask for. Each one is realised as the pair of
 * poses the Director eases between: the arrival pose and the end pose.
 */
export const SHOT_TYPES = Object.freeze({
  orbit: { label: 'Orbit', sweep: ORBIT_SWEEP_DEG },
  truck: { label: 'Truck', sweep: 18 },
  crane: { label: 'Crane', pitchDelta: -10, rangeScale: 1.08 },
  pushIn: { label: 'Push in', rangeScale: 0.62, pitchDelta: 4 },
  pullOut: { label: 'Pull out', rangeScale: 1.55, pitchDelta: -6 },
  lockOff: { label: 'Lock-off' },
  birdsEye: { label: "Bird's eye", pitch: -56, rangeScale: 1.7, sweep: ORBIT_SWEEP_DEG },
  lowAngle: { label: 'Low angle', pitch: -14, rangeScale: 0.78, sweep: 30 },
});

/** Stops that do not choose a move cycle through these, never the same twice in a row. */
const DEFAULT_SHOT_CYCLE = ['orbit', 'pushIn', 'birdsEye', 'truck', 'crane', 'lowAngle', 'pullOut'];

/** How to get from the previous stop, keyed by the `/api/route` profile (rail has none). */
export const TRAVEL_MODES = Object.freeze({
  foot: { verb: 'Walk', icon: '🚶', profile: 'foot' },
  bike: { verb: 'Cycle', icon: '🚲', profile: 'bike' },
  car: { verb: 'Drive', icon: '🚗', profile: 'car' },
  rail: { verb: 'Ride', icon: '🚇', profile: null },
  air: { verb: 'Fly', icon: '✈', profile: null },
});

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
 * @property {number} [holdSec=14]  Duration of the stop's camera move.
 * @property {keyof SHOT_TYPES} [shot]  Cinematic move; cycles when omitted.
 * @property {{ mode: keyof TRAVEL_MODES, story?: string }} [travel]
 *   How we got here from the previous stop; drawn as a route on the map.
 * @property {{ label: string, lat: number, lon: number, heightM?: number, say?: string[] }[]} [callouts]
 *   Places the story points at. Marked on the map during the stop and lit
 *   up when the narrator says one of their `say` words (default: the label).
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
        callouts: [
          { label: 'Arena floor', lat: 41.8902, lon: 12.4922, heightM: 30, say: ['floor'] },
          { label: 'Arch of Constantine', lat: 41.8898, lon: 12.4907, heightM: 25, say: ['Constantine'] },
        ],
        shot: 'orbit',
        title: 'The Colosseum',
        lat: 41.8902,
        lon: 12.4922,
        rangeM: 820,
        heading: 240,
        pitch: -18,
        heightM: 52,
        holdSec: 18,
        story:
          "The Flavian amphitheatre. Vespasian built it on Nero's lake as a gift back to the city. Titus opened it in 80 AD. Under the floor, cages and ramps. The scars in the stone are later Rome quarrying it for palaces. The Arch of Constantine stands at its gate.",
      },
      {
        id: 'arch-of-titus',
        shot: 'pushIn',
        travel: {
          mode: 'foot',
          story:
            'A few minutes on foot along the old triumphal axis, and the Forum opens under us.',
        },
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
        shot: 'birdsEye',
        travel: {
          mode: 'foot',
          story:
            'A short hop across the Forum floor to the valley where Rome did its business.',
        },
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
        shot: 'lowAngle',
        travel: {
          mode: 'foot',
          story:
            'A short walk north through the lanes, and water starts to steal the scene.',
        },
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
        callouts: [
          { label: 'Oculus', lat: 41.8986, lon: 12.4769, heightM: 48, say: ['oculus'] },
          { label: 'Piazza della Rotonda', lat: 41.899, lon: 12.4767, heightM: 10, say: ['piazza', 'fountain'] },
        ],
        shot: 'crane',
        travel: {
          mode: 'foot',
          story:
            'Another few minutes on foot west, and the dome that still has no equal comes into view.',
        },
        title: 'The Pantheon',
        lat: 41.8986,
        lon: 12.4769,
        rangeM: 380,
        heading: 215,
        pitch: -16,
        heightM: 48,
        holdSec: 18,
        story:
          "Hadrian's rebuild, about 126 AD. Largest unreinforced concrete dome on Earth. The oculus is the only light. Temple to all gods, then a church — which is why it is still standing. The fountain in the piazza came fifteen centuries later.",
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
        callouts: [
          { label: 'Champ de Mars', lat: 48.8556, lon: 2.2986, heightM: 10, say: ['Champ de Mars'] },
          { label: 'Trocadéro', lat: 48.862, lon: 2.288, heightM: 30, say: ['Trocadéro'] },
        ],
        shot: 'orbit',
        title: 'Eiffel Tower',
        lat: 48.8584,
        lon: 2.2945,
        rangeM: 750,
        heading: 315,
        pitch: -22,
        heightM: 150,
        holdSec: 16,
        story:
          'The Eiffel Tower. Gustave Eiffel raised it for the 1889 Exposition — three hundred thirty metres of iron meant to be temporary. Paris kept it. The Champ de Mars runs from its feet; the Trocadéro faces it across the river.',
      },
      {
        id: 'arc',
        shot: 'birdsEye',
        travel: {
          mode: 'rail',
          story:
            'After a short metro ride toward the Étoile, the arch sits at the star of twelve avenues.',
        },
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
        callouts: [
          { label: 'Glass pyramid', lat: 48.861, lon: 2.3358, heightM: 21, say: ['pyramid'] },
        ],
        shot: 'pushIn',
        travel: {
          mode: 'car',
          story:
            'Following the fastest street route down the Champs-Élysées, you roll toward the palace that became a museum.',
        },
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
        callouts: [
          { label: 'Spire', lat: 48.853, lon: 2.3499, heightM: 96, say: ['spire'] },
        ],
        shot: 'truck',
        travel: {
          mode: 'foot',
          story:
            'A walk along the river to the island — the medieval seed of Paris.',
        },
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
        shot: 'orbit',
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
        shot: 'birdsEye',
        travel: {
          mode: 'rail',
          story:
            'A short subway ride north to the palace moat, and the city turns to walls and pine.',
        },
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
        callouts: [
          { label: 'Nakamise street', lat: 35.7128, lon: 139.7966, heightM: 12, say: ['Nakamise'] },
          { label: 'Kaminarimon gate', lat: 35.7107, lon: 139.7967, heightM: 12, say: ['gate'] },
        ],
        shot: 'pushIn',
        travel: {
          mode: 'rail',
          story:
            'Another rail hop east toward Asakusa — the old town the towers were built to look over.',
        },
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
        shot: 'pullOut',
        travel: {
          mode: 'foot',
          story:
            'A short hop to Skytree — walk, taxi, or one train. The new mast is already in the skyline.',
        },
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
        callouts: [
          { label: 'Tower of London', lat: 51.5081, lon: -0.0759, heightM: 27, say: ['Tower of London'] },
        ],
        shot: 'orbit',
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
        shot: 'crane',
        travel: {
          mode: 'foot',
          story:
            'Fifteen minutes west along the river and up Ludgate Hill, and the dome fills the street.',
        },
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
        callouts: [
          { label: 'Elizabeth Tower', lat: 51.5007, lon: -0.1246, heightM: 96, say: ['Elizabeth Tower', 'Big Ben'] },
          { label: 'Westminster Abbey', lat: 51.4993, lon: -0.1273, heightM: 40, say: ['Abbey'] },
        ],
        shot: 'truck',
        travel: {
          mode: 'rail',
          story:
            'A Tube ride on the District line, Blackfriars to Westminster, and Parliament stands on the bank.',
        },
        title: 'Palace of Westminster',
        lat: 51.5007,
        lon: -0.1246,
        rangeM: 640,
        heading: 250,
        pitch: -20,
        heightM: 96,
        holdSec: 16,
        story:
          'Parliament, rebuilt after an 1834 fire. The clock tower is the Elizabeth Tower; Big Ben is the bell inside it, first rung in 1859. Westminster Abbey sits across the square.',
      },
      {
        id: 'buckingham',
        shot: 'pushIn',
        travel: {
          mode: 'foot',
          story:
            'Through St James\'s Park on foot; the palace closes the view at the far end of the lake.',
        },
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

/** Resolve a stop's move: the framing the camera arrives at and the one it eases to. */
export function shotFraming(stop, index = 0) {
  const type =
    stop.shot && SHOT_TYPES[stop.shot]
      ? stop.shot
      : DEFAULT_SHOT_CYCLE[index % DEFAULT_SHOT_CYCLE.length];
  const spec = SHOT_TYPES[type];
  const rangeM = spec.rangeScale && spec.sweep ? stop.rangeM * spec.rangeScale : stop.rangeM;
  const pitch = spec.pitch ?? stop.pitch;
  const sweep = spec.sweep || 0;
  const start = { rangeM, heading: stop.heading - sweep / 2, pitch };
  const end = {
    rangeM: spec.sweep ? rangeM : rangeM * (spec.rangeScale || 1),
    heading: stop.heading + sweep / 2,
    pitch: Math.max(-70, Math.min(-10, pitch + (spec.pitchDelta || 0))),
  };
  return { type, label: spec.label, start, end };
}

/** Title of the shot that travels to a stop; the stop's own title names its hold. */
export function travelShotTitle(stop) {
  const mode = TRAVEL_MODES[stop.travel?.mode] || TRAVEL_MODES.air;
  return `${mode.verb} → ${stop.title}`;
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
  tour.stops.forEach((stop, index) => {
    const base = { ...stop, groundEllipsoidM: ground };
    const framing = shotFraming(stop, index);
    const arrival = lookAtPose({ ...base, ...framing.start });
    const settled = lookAtPose({ ...base, ...framing.end });
    cameraPath.push(
      { ...arrival, duration: TRANSIT_SEC, hold: ARRIVAL_HOLD_SEC, title: travelShotTitle(stop) },
      { ...settled, duration: Math.max(4, stop.holdSec || 14), hold: 0.4, title: stop.title },
    );
  });
  return {
    id: tour.id,
    version: 2,
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
 * What a running shot means, or null for non-tour scenes.
 * - `kind: 'establish'` — the opening approach.
 * - `kind: 'travel'` — the flight into a stop, with the route to draw.
 * - `kind: 'stop'` — the stop's own move and story.
 */
export function cityTourStory(sceneId, shotTitle) {
  const tour = TOUR_BY_ID.get(sceneId);
  if (!tour) return null;
  if (shotTitle === `Approaching ${tour.city}`) {
    return { kind: 'establish', city: tour.city, title: shotTitle, story: tour.establish.story };
  }
  const index = tour.stops.findIndex((entry) => entry.title === shotTitle);
  if (index >= 0) {
    const stop = tour.stops[index];
    return {
      kind: 'stop',
      city: tour.city,
      title: stop.title,
      story: stop.story,
      shot: shotFraming(stop, index).label,
      holdSec: Math.max(4, stop.holdSec || 14),
      callouts: (stop.callouts || []).map((callout) => ({
        label: callout.label,
        lat: callout.lat,
        lon: callout.lon,
        alt: (tour.groundEllipsoidM || 0) + (callout.heightM ?? 20),
        say: callout.say?.length ? [...callout.say] : [callout.label],
      })),
    };
  }
  const travelIndex = tour.stops.findIndex((entry) => travelShotTitle(entry) === shotTitle);
  if (travelIndex < 0) return null;
  const stop = tour.stops[travelIndex];
  const from = tour.stops[travelIndex - 1] || null;
  const modeId = from && TRAVEL_MODES[stop.travel?.mode] ? stop.travel.mode : 'air';
  const mode = TRAVEL_MODES[modeId];
  return {
    kind: 'travel',
    city: tour.city,
    title: shotTitle,
    mode: modeId,
    icon: mode.icon,
    story: stop.travel?.story || `${mode.verb === 'Fly' ? 'Dropping in on' : 'On to'} ${stop.title}.`,
    from: from ? { lat: from.lat, lon: from.lon } : null,
    to: { lat: stop.lat, lon: stop.lon },
    profile: from ? mode.profile : null,
  };
}

/** Every ground leg of a tour, for prefetching routes before they are drawn. */
export function cityTourLegs(sceneId) {
  const tour = TOUR_BY_ID.get(sceneId);
  if (!tour) return [];
  return tour.stops
    .map((stop) => cityTourStory(sceneId, travelShotTitle(stop)))
    .filter((leg) => leg.from);
}
