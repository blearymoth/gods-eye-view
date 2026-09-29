# City tours

Bundled guided tours of Rome, Paris, Tokyo and London. They are ordinary
Director scenes (Scenes panel → pick a tour → START, or say "play the Rome
tour"), generated from a compact list of landmark stops in
`src/scenes/packs/cityTours.js`.

## What a tour is

```js
{
  id: 'city-tour-rome',
  title: 'Rome: Heart of the Empire',
  city: 'Rome',
  groundEllipsoidM: 70,          // ground height above the WGS84 ellipsoid
  establish: { lat, lon, alt: 9500, heading, pitch, story },
  stops: [
    { id: 'colosseum', title: 'The Colosseum', lat, lon,
      rangeM: 820, heading: 240, pitch: -18, heightM: 52, holdSec: 18,
      shot: 'orbit',                                   // see "Camera moves"
      story: 'One or two sentences the caption shows and voice narrates.' },
    { id: 'arch-of-titus', title: 'Arch of Titus', lat, lon, rangeM: 340,
      heading: 250, pitch: -20, heightM: 18, holdSec: 12, shot: 'pushIn',
      travel: { mode: 'foot', story: 'A few minutes on foot along the old axis.' },
      story: '…' },
  ],
}
```

`cityTourToRecipe` turns this into a Director recipe:

- one establishing shot over the city (8 s), then
- per stop, an **arrival** shot (6 s flight, brief rest) titled after the
  travel mode (`Walk → Arch of Titus`) and a **hold** shot that performs the
  stop's camera move over `holdSec`. The Director's own eased flight between
  the two poses is the move.

## Camera moves

`shot` picks how the camera behaves at a stop; stops without one cycle
through the list so neighbours never repeat.

| `shot`     | What happens |
|------------|--------------|
| `orbit`    | 40° sweep around the landmark at the authored range |
| `truck`    | short 18° lateral pan |
| `crane`    | tilts down 10° while easing back 8% |
| `pushIn`   | closes from the authored range to 62% of it |
| `pullOut`  | opens to 155% of the range, tilting down slightly |
| `lockOff`  | static hold |
| `birdsEye` | steep −56° view from 1.7× range, orbiting |
| `lowAngle` | −14° view from 0.78× range, orbiting |

`callouts` on a stop are the places its story points at: `{ label, lat,
lon, heightM?, say? }`. They are marked on the map for the whole stop and
each lights up when the narrator says one of its `say` words (the label by
default), read from the voice transcript. Without a voice session they light
in order, spread across the move. The test suite checks that every callout's
words appear in the stop's story, so the narrator will actually say them.

`travel` on a stop says how you got there from the previous one: `foot`,
`bike`, `car` (a real route from `/api/route`, drawn on the map during the
arrival flight) or `rail` (a straight dashed line). The first stop is always
a flight in, with no line.

The camera pose is derived from the landmark: it stands `rangeM` away on the
side opposite `heading`, at `groundEllipsoidM + heightM / 2 + rangeM·sin(pitch)`.
Heights are estimates; ±30 m is fine because the pitch keeps the camera clear.

## Captions, routes, buffering and narration

The scene document has no narration field, so `story` never enters the
document. `src/scenes/packs/cityTourPresenter.js` subscribes to Director run
events. When a tour shot starts it shows the beat's story in a caption
(`#city-tour-caption`), draws the leg's route for travel beats (all legs are
prefetched when the tour begins), reports 3D-tile buffering as a progress
bar until 80% of the view's requested tiles are in, marks the stop's
callouts, and, if a voice session is open, sends the story to the realtime
agent as a `tour_beat` item.

Buffering is enforced, not just shown: the presenter registers a Director
**shot hold gate** (`SceneDirector.registerShotHoldGate`) that keeps the
approach and every arrival shot holding until 80% of that view's tiles are
in, up to 12 s, so a stop's camera move starts over loaded tiles. Stops are
never gated. Cesium can only load tiles for the view it is rendering, so a
"two beats ahead" buffer is not possible without a second renderer; the gate
plus `preloadFlightDestinations` (tiles for the flight's end load during the
flight) is the practical equivalent.

When a tour starts, every data layer that is on is parked (turned off with
the `scene` origin, so the user's saved layer state is untouched) and turned
back on when the tour ends, so feeds and entities stop competing with the
tiles. The photoreal tileset is also tuned and restored afterwards:
`cullRequestsWhileMoving` off and `preloadFlightDestinations` on so the
destination loads during the flight, and `dynamicScreenSpaceError` on so
distant tiles stay coarse instead of competing with the stop in view.

## Adding a city

1. Append a definition to `CITY_TOURS`. Use a unique `id` starting with
   `city-tour-`, a distinctive `title` (voice matches on it), 3–6 stops.
2. Pick `groundEllipsoidM`: local ground elevation plus the geoid undulation
   (roughly +45 m in western Europe, +37 m in Tokyo, −30 m on the US east
   coast). Check a stop in the app with CAPTURE SHOT if unsure.
3. Frame each stop: `heading` is the direction the camera looks, `rangeM`
   300–900 for buildings, `pitch` −16 to −32. `heightM` is the landmark height.
4. Run `node --test src/scenes/packs/cityTours.test.mjs`. It validates the
   generated scene against the Director document schema and checks that every
   camera stays within range of its landmark.

Existing users get new tours on next load: the recipe sets
`installAlongsideSceneId`, so `SceneDirector._loadProject` inserts it after
the public demos in their saved project.
