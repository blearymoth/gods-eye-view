import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  installCityTourPresenter,
  bufferingProgress,
  legGeometry,
  legRouteUrl,
  CITY_TOUR_CAPTION_ID,
  CITY_TOUR_ROUTE_ENTITY_ID,
} from './cityTourPresenter.js';
import { CITY_TOURS, travelShotTitle } from './cityTours.js';

function fakeElement() {
  const parts = {};
  for (const name of ['city', 'title', 'shot', 'story', 'loading', 'loading-fill']) {
    parts[`.city-tour-caption-${name}`] = { textContent: '', hidden: false, style: {} };
  }
  const el = {
    hidden: false,
    innerHTML: '',
    dataset: {},
    classes: new Set(),
    classList: {
      add: (name) => el.classes.add(name),
      remove: (name) => el.classes.delete(name),
    },
    setAttribute() {},
    querySelector: (selector) => parts[selector],
    remove: () => {
      el.removed = true;
    },
    parts,
  };
  return el;
}

const FakeCesium = {
  Color: {
    fromCssColorString: (css) => ({ css, withAlpha: (a) => ({ css, alpha: a }) }),
  },
  Cartesian3: { fromDegreesArray: (flat) => ({ flat }) },
  PolylineDashMaterialProperty: class {
    constructor(options) {
      this.options = options;
    }
  },
  ClassificationType: { BOTH: 'both' },
};

function harness({ tileset = null, routePayload = null, dataManager = null } = {}) {
  const listeners = new Set();
  const caption = fakeElement();
  const documentRef = { createElement: () => caption, body: { appendChild() {} } };
  const sent = [];
  const responses = [];
  const fetched = [];
  let voiceActive = true;
  const voice = {
    session: { isActive: () => voiceActive, sendMapEvent: (event) => sent.push(event) },
    queueResponseCreate: (text) => responses.push(text),
  };
  const entities = [];
  const viewer = {
    entities: {
      add: (entity) => {
        entities.push(entity);
        return entity;
      },
      remove: (entity) => {
        const index = entities.indexOf(entity);
        if (index >= 0) entities.splice(index, 1);
      },
    },
  };
  const director = {
    subscribe(listener) {
      listener({ state: {}, change: null, revision: 0, initial: true });
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const dispose = installCityTourPresenter({
    director,
    viewer,
    tileset,
    dataManager,
    documentRef,
    Cesium: FakeCesium,
    getVoice: () => voice,
    fetchImpl: async (url) => {
      fetched.push(url);
      return { ok: true, json: async () => routePayload };
    },
  });
  const emit = (event, detail) => {
    for (const listener of listeners)
      listener({ state: {}, change: { type: 'run-event', event, detail }, revision: 1 });
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    caption, sent, responses, fetched, entities, emit, dispose, settle, listeners,
    setVoice: (v) => (voiceActive = v),
  };
}

function fakeTileset() {
  const listeners = new Set();
  return {
    cullRequestsWhileMoving: true,
    preloadFlightDestinations: true,
    dynamicScreenSpaceError: false,
    dynamicScreenSpaceErrorDensity: 0.00278,
    dynamicScreenSpaceErrorFactor: 4,
    tileLoadProgressEvent: {
      addEventListener(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    report: (pending) => listeners.forEach((listener) => listener(pending)),
    listeners,
  };
}

const rome = CITY_TOURS[0];
const colosseum = rome.stops[0];
const arch = rome.stops[1];

test('pure helpers: route url, geometry fallback and buffering ratio', () => {
  const leg = { profile: 'foot', from: { lat: 1, lon: 2 }, to: { lat: 3, lon: 4 } };
  assert.equal(legRouteUrl(leg), '/api/route?profile=foot&coords=2%2C1%3B4%2C3');
  assert.deepEqual(legGeometry(leg, null), [[2, 1], [4, 3]]);
  assert.deepEqual(legGeometry(leg, { geometry: [[9, 9], [8, 8], [7, 7]] }), [[9, 9], [8, 8], [7, 7]]);
  assert.equal(bufferingProgress(0, 0), 1);
  assert.equal(bufferingProgress(0, 40), 1);
  assert.equal(bufferingProgress(40, 40), 0);
  assert.equal(bufferingProgress(10, 40), 0.75);
});

test('a stop shows its story and move once, hands the beat to voice, and the flight in draws nothing', async () => {
  const h = harness();
  assert.equal(h.caption.id, CITY_TOUR_CAPTION_ID);
  assert.equal(h.caption.hidden, true);
  h.emit('shot_start', { sceneId: rome.id, title: travelShotTitle(colosseum), index: 1 });
  await h.settle();
  assert.equal(h.caption.hidden, false);
  assert.equal(h.caption.dataset.kind, 'travel');
  assert.equal(h.entities.length, 0, 'the first arrival is a flight, not a route');
  assert.equal(h.sent[0].type, 'tour_beat');
  assert.equal(h.sent[0].kind, 'travel');
  h.emit('shot_start', { sceneId: rome.id, title: colosseum.title, index: 2 });
  assert.equal(h.caption.dataset.kind, 'stop');
  assert.equal(h.caption.parts['.city-tour-caption-title'].textContent, colosseum.title);
  assert.equal(h.caption.parts['.city-tour-caption-shot'].textContent, 'Orbit');
  assert.equal(h.caption.parts['.city-tour-caption-story'].textContent, colosseum.story);
  assert.equal(h.sent.length, 2);
  assert.equal(h.responses.length, 2);
  // Re-announcing the same shot does not re-trigger the voice.
  h.emit('shot_start', { sceneId: rome.id, title: colosseum.title, index: 2 });
  assert.equal(h.sent.length, 2);
});

test('the tour start prefetches every ground leg and a walk draws a dashed clamped route', async () => {
  const h = harness({ routePayload: { ok: true, geometry: [[12.4922, 41.8902], [12.49, 41.8904], [12.4885, 41.8906]] } });
  h.emit('shot_start', { sceneId: rome.id, title: 'Approaching Rome', index: 0 });
  await h.settle();
  assert.equal(h.fetched.length, rome.stops.length - 1, 'all legs prefetched at tour start');
  assert.ok(h.fetched.every((url) => url.startsWith('/api/route?profile=foot')));
  h.emit('shot_start', { sceneId: rome.id, title: travelShotTitle(arch), index: 3 });
  await h.settle();
  await h.settle();
  assert.equal(h.fetched.length, rome.stops.length - 1, 'the drawn leg reuses the prefetched route');
  assert.equal(h.entities.length, 1);
  const { polyline, id } = h.entities[0];
  assert.equal(id, CITY_TOUR_ROUTE_ENTITY_ID);
  assert.equal(polyline.clampToGround, true);
  assert.equal(polyline.classificationType, 'both');
  assert.equal(polyline.positions.flat.length, 6, 'the fetched route geometry is drawn');
  assert.ok(polyline.material instanceof FakeCesium.PolylineDashMaterialProperty);
  assert.equal(h.caption.parts['.city-tour-caption-title'].textContent, `🚶 ${travelShotTitle(arch)}`);
  assert.equal(h.caption.parts['.city-tour-caption-story'].textContent, arch.travel.story);
  // The route stays through the stop's move and clears when the tour ends.
  h.emit('shot_start', { sceneId: rome.id, title: arch.title, index: 4 });
  assert.equal(h.entities.length, 1);
  h.emit('scene_run_complete', {});
  assert.equal(h.entities.length, 0);
  assert.equal(h.caption.hidden, true);
});

test('a failed route request still draws the straight leg', async () => {
  const h = harness({ routePayload: { ok: false, error: 'rate limited' } });
  h.emit('shot_start', { sceneId: rome.id, title: travelShotTitle(arch), index: 3 });
  await h.settle();
  await h.settle();
  assert.equal(h.entities.length, 1);
  assert.deepEqual(h.entities[0].polyline.positions.flat, [colosseum.lon, colosseum.lat, arch.lon, arch.lat]);
});

test('tile buffering shows a bar until 80% of the view is in, and tuning is restored after the tour', () => {
  const tileset = fakeTileset();
  const h = harness({ tileset });
  const loading = h.caption.parts['.city-tour-caption-loading'];
  const fill = h.caption.parts['.city-tour-caption-loading-fill'];
  tileset.report(50);
  assert.equal(loading.hidden, false, 'nothing reported outside a tour');
  h.emit('shot_start', { sceneId: rome.id, title: colosseum.title, index: 2 });
  assert.equal(tileset.cullRequestsWhileMoving, false);
  assert.equal(tileset.dynamicScreenSpaceError, true);
  assert.equal(loading.hidden, true);
  tileset.report(40);
  assert.equal(loading.hidden, false);
  assert.equal(fill.style.width, '0%');
  tileset.report(20);
  assert.equal(fill.style.width, '50%');
  tileset.report(8);
  assert.equal(loading.hidden, true, '80% in counts as ready');
  tileset.report(30);
  assert.equal(loading.hidden, false, 'a fresh burst of requests shows the bar again');
  h.emit('scene_stopped', { reason: 'user' });
  assert.equal(loading.hidden, true);
  assert.equal(tileset.cullRequestsWhileMoving, true);
  assert.equal(tileset.dynamicScreenSpaceError, false);
  assert.equal(tileset.dynamicScreenSpaceErrorDensity, 0.00278);
  h.dispose();
  assert.equal(tileset.listeners.size, 0);
  assert.equal(h.listeners.size, 0);
  assert.equal(h.caption.removed, true);
});

test('enabled layers are parked for the tour and restored when it ends', () => {
  const calls = [];
  const enabled = new Set(['flights', 'traffic']);
  const dataManager = {
    getEnabledLayerIds: () => new Set(enabled),
    setEnabled: (id, on, options) => {
      calls.push([id, on, options.origin]);
      if (on) enabled.add(id);
      else enabled.delete(id);
      return Promise.resolve(true);
    },
  };
  const h = harness({ dataManager });
  h.emit('shot_start', { sceneId: rome.id, title: 'Approaching Rome', index: 0 });
  assert.deepEqual(calls, [['flights', false, 'scene'], ['traffic', false, 'scene']]);
  h.emit('shot_start', { sceneId: rome.id, title: travelShotTitle(colosseum), index: 1 });
  assert.equal(calls.length, 2, 'later shots do not park again');
  h.emit('scene_stopped', { reason: 'user' });
  assert.deepEqual(calls.slice(2), [['flights', true, 'scene'], ['traffic', true, 'scene']]);
  assert.deepEqual([...enabled].sort(), ['flights', 'traffic']);
  h.emit('scene_run_complete', {});
  assert.equal(calls.length, 4, 'restoring twice is a no-op');
});

test('non-tour scenes and voice-off runs are quiet', () => {
  const h = harness();
  h.setVoice(false);
  h.emit('shot_start', { sceneId: rome.id, title: 'Approaching Rome', index: 0 });
  assert.equal(h.caption.hidden, false);
  assert.equal(h.sent.length, 0);
  h.emit('shot_start', { sceneId: 'flights-radar', title: 'Shot 1', index: 0 });
  assert.equal(h.caption.hidden, true);
});
