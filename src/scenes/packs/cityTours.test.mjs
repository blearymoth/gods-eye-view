import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CITY_TOURS,
  CITY_TOUR_RECIPES,
  cityTourStory,
  cityTourToRecipe,
  isCityTourScene,
  lookAtPose,
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
      for (const shot of scene.shots.slice(1 + index * 2, 3 + index * 2)) {
        assert.equal(shot.title, stop.title);
        const ground = haversineM(shot.camera, stop);
        assert.ok(ground < stop.rangeM + 5, `${stop.id} camera drifted ${ground} m`);
        assert.ok(shot.camera.alt > tour.groundEllipsoidM + 40, `${stop.id} too low`);
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
    city: 'Rome',
    title: 'Approaching Rome',
    story: rome.establish.story,
  });
  const scene = recipeToScene(cityTourToRecipe(rome));
  assert.equal(cityTourStory(rome.id, scene.shots[1].title).story, rome.stops[0].story);
  assert.equal(cityTourStory(rome.id, scene.shots[2].title).story, rome.stops[0].story);
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
