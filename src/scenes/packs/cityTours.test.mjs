import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CITY_TOURS,
  CITY_TOUR_RECIPES,
  cityTourStory,
  cityTourLegs,
  cityTourToRecipe,
  isCityTourScene,
  lookAtPose,
  shotFraming,
  SHOT_TYPES,
  travelShotTitle,
} from './cityTours.js';
import { recipeToScene } from '../project.js';
import { parseSceneDocument } from '../../director/document.js';
import { SCENE_RECIPES } from '../recipes.js';

function haversineM(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

test('every tour has a unique id, an establishing story, and storied stops', () => {
  const ids = new Set();
  for (const tour of CITY_TOURS) {
    assert.ok(!ids.has(tour.id), `duplicate tour id ${tour.id}`);
    ids.add(tour.id);
    assert.ok(tour.establish.story.length > 20, `${tour.id} establish story`);
    assert.ok(tour.stops.length >= 3, `${tour.id} needs at least 3 stops`);
    const titles = new Set();
    for (const stop of tour.stops) {
      assert.ok(!titles.has(stop.title), `${tour.id}: repeated stop ${stop.title}`);
      titles.add(stop.title);
      assert.notEqual(stop.title, `Approaching ${tour.city}`);
      assert.ok(stop.story.length > 20, `${tour.id}/${stop.id} story`);
      assert.ok(stop.rangeM >= 150 && stop.rangeM <= 1500, `${stop.id} range`);
      assert.ok(stop.pitch <= -10 && stop.pitch >= -60, `${stop.id} pitch`);
    }
  }
});

test('lookAtPose stands the camera opposite its heading at the given range', () => {
  const target = { lat: 41.8902, lon: 12.4922 };
  const pose = lookAtPose({
    ...target,
    rangeM: 800,
    heading: 90,
    pitch: -30,
    heightM: 50,
    groundEllipsoidM: 70,
  });
  // Looking east means the camera sits west of the target.
  assert.ok(pose.lon < target.lon);
  assert.ok(Math.abs(pose.lat - target.lat) < 0.0001);
  const horizontal = haversineM(pose, target);
  assert.ok(Math.abs(horizontal - 800 * Math.cos(Math.PI / 6)) < 5);
  assert.equal(pose.alt, Math.round(70 + 25 + 800 * Math.sin(Math.PI / 6)));
  assert.equal(pose.heading, 90);
  assert.equal(lookAtPose({ ...target, rangeM: 1, heading: 370, pitch: -20 }).heading, 10);
});

test('recipes convert to valid Director scenes that keep the camera near each stop', () => {
  for (const tour of CITY_TOURS) {
    const recipe = cityTourToRecipe(tour);
    assert.equal(recipe.cameraPath.length, 1 + tour.stops.length * 2);
    assert.ok(recipe.durationSec > 60 && recipe.durationSec < 200, `${tour.id} runtime`);
    const scene = recipeToScene(recipe);
    parseSceneDocument(JSON.stringify({ version: 6, scenes: [scene] }));
    assert.equal(scene.shots[0].visual.hud.visible, false);
    tour.stops.forEach((stop, index) => {
      const [arrival, hold] = scene.shots.slice(1 + index * 2, 3 + index * 2);
      assert.equal(arrival.title, travelShotTitle(stop));
      assert.equal(hold.title, stop.title);
      for (const shot of [arrival, hold]) {
        const ground = haversineM(shot.camera, stop);
        assert.ok(ground < stop.rangeM * 1.8 + 5, `${stop.id} camera drifted ${ground} m`);
        assert.ok(shot.camera.alt > tour.groundEllipsoidM + 30, `${stop.id} too low`);
      }
    });
  }
});

test('stories resolve by scene and shot title, for both shots of a stop', () => {
  const rome = CITY_TOURS[0];
  assert.equal(isCityTourScene(rome.id), true);
  assert.equal(isCityTourScene('flights-radar'), false);
  assert.equal(cityTourStory('flights-radar', 'Shot 1'), null);
  assert.equal(cityTourStory(rome.id, 'Nowhere'), null);
  assert.deepEqual(cityTourStory(rome.id, 'Approaching Rome'), {
    kind: 'establish',
    city: 'Rome',
    title: 'Approaching Rome',
    story: rome.establish.story,
  });
  const scene = recipeToScene(cityTourToRecipe(rome));
  // The first arrival is a flight in: no ground leg to draw.
  const first = cityTourStory(rome.id, scene.shots[1].title);
  assert.equal(first.kind, 'travel');
  assert.equal(first.mode, 'air');
  assert.equal(first.from, null);
  assert.equal(first.profile, null);
  const hold = cityTourStory(rome.id, scene.shots[2].title);
  assert.equal(hold.kind, 'stop');
  assert.equal(hold.story, rome.stops[0].story);
  assert.equal(hold.shot, 'Orbit');
  const walk = cityTourStory(rome.id, scene.shots[3].title);
  assert.equal(walk.kind, 'travel');
  assert.equal(walk.mode, 'foot');
  assert.equal(walk.profile, 'foot');
  assert.deepEqual(walk.from, { lat: rome.stops[0].lat, lon: rome.stops[0].lon });
  assert.deepEqual(walk.to, { lat: rome.stops[1].lat, lon: rome.stops[1].lon });
  assert.equal(walk.story, rome.stops[1].travel.story);
  assert.equal(cityTourLegs(rome.id).length, rome.stops.length - 1);
  assert.equal(cityTourLegs('flights-radar').length, 0);
});

test('every stop names a known move and travel mode, and legs stay walkable-short', () => {
  for (const tour of CITY_TOURS) {
    tour.stops.forEach((stop, index) => {
      if (stop.shot) assert.ok(SHOT_TYPES[stop.shot], `${stop.id} shot ${stop.shot}`);
      if (index > 0) {
        assert.ok(stop.travel?.mode, `${stop.id} needs a travel mode`);
        assert.ok(stop.travel.story.length > 15, `${stop.id} travel story`);
        const legM = haversineM(tour.stops[index - 1], stop);
        assert.ok(legM < 12_000, `${stop.id} leg is ${legM} m`);
        if (stop.travel.mode === 'foot') assert.ok(legM < 3_500, `${stop.id} is a long walk`);
      }
    });
  }
});

test('callouts sit near their stop and are words the narrator will actually say', () => {
  let total = 0;
  for (const tour of CITY_TOURS) {
    for (const stop of tour.stops) {
      for (const callout of stop.callouts || []) {
        total += 1;
        assert.ok(haversineM(callout, stop) < 1500, `${stop.id}/${callout.label} is far from the stop`);
        const words = callout.say?.length ? callout.say : [callout.label];
        const story = stop.story.toLowerCase();
        assert.ok(
          words.some((word) => story.includes(word.toLowerCase())),
          `${stop.id}/${callout.label}: none of ${words.join('/')} appear in the story`,
        );
      }
    }
  }
  assert.ok(total >= 10);
  const pantheon = cityTourStory(CITY_TOURS[0].id, 'The Pantheon');
  assert.equal(pantheon.holdSec, 18);
  assert.deepEqual(pantheon.callouts[0], { label: 'Oculus', lat: 41.8986, lon: 12.4769, alt: 118, say: ['oculus'] });
});

test('shot framings realise their moves as distinct arrival and end poses', () => {
  const stop = { rangeM: 600, heading: 90, pitch: -24 };
  const orbit = shotFraming({ ...stop, shot: 'orbit' });
  assert.equal(orbit.label, 'Orbit');
  assert.equal(orbit.end.heading - orbit.start.heading, 40);
  assert.equal(orbit.start.rangeM, 600);
  const pushIn = shotFraming({ ...stop, shot: 'pushIn' });
  assert.equal(pushIn.start.rangeM, 600);
  assert.ok(pushIn.end.rangeM < 400 && pushIn.end.rangeM > 350);
  assert.equal(pushIn.start.heading, pushIn.end.heading);
  const pullOut = shotFraming({ ...stop, shot: 'pullOut' });
  assert.ok(pullOut.end.rangeM > 900);
  const crane = shotFraming({ ...stop, shot: 'crane' });
  assert.equal(crane.end.pitch, -34);
  const birds = shotFraming({ ...stop, shot: 'birdsEye' });
  assert.equal(birds.start.pitch, -56);
  assert.ok(birds.start.rangeM > 1000);
  const lock = shotFraming({ ...stop, shot: 'lockOff' });
  assert.deepEqual(lock.start, lock.end);
  // Unlabelled stops cycle so consecutive stops never repeat a move.
  const cycled = [0, 1, 2].map((i) => shotFraming(stop, i).type);
  assert.equal(new Set(cycled).size, 3);
  assert.equal(shotFraming({ ...stop, shot: 'nope' }, 0).type, 'orbit');
});

test('tours ship in the built-in recipe list after the public demos', () => {
  const ids = SCENE_RECIPES.map((recipe) => recipe.id);
  CITY_TOUR_RECIPES.forEach((recipe, index) => {
    assert.equal(
      recipe.installAlongsideSceneId,
      index === 0 ? 'omniscience-pullback' : CITY_TOUR_RECIPES[index - 1].id,
    );
    assert.equal(recipe.installAlongsideFallbackSceneId, undefined);
  });
  for (const recipe of CITY_TOUR_RECIPES) {
    assert.ok(ids.includes(recipe.id), `${recipe.id} is not registered`);
    assert.ok(
      ids.indexOf(recipe.id) > ids.indexOf('omniscience-pullback'),
      `${recipe.id} should follow the public demos`,
    );
  }
});
