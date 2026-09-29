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
      story: 'One or two sentences the caption shows and voice narrates.' },
  ],
}
```

`cityTourToRecipe` turns this into a Director recipe:

- one establishing shot over the city (8 s), then
- per stop, an **arrival** shot (6 s flight, brief rest) and an **orbit**
  shot that sweeps the heading 40° over `holdSec`. The Director's own eased
  flight between the two poses is the orbit.

The camera pose is derived from the landmark: it stands `rangeM` away on the
side opposite `heading`, at `groundEllipsoidM + heightM / 2 + rangeM·sin(pitch)`.
Heights are estimates; ±30 m is fine because the pitch keeps the camera clear.

## Captions and narration

The scene document has no narration field, so `story` never enters the
document. `src/scenes/packs/cityTourPresenter.js` subscribes to Director run
events and, when a tour shot starts, shows the stop's story in a caption
(`#city-tour-caption`) and, if a voice session is open, sends it to the
realtime agent as a `tour_beat` item to speak. Arrival and orbit shots share a
title, so each stop is captioned and narrated once.

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
