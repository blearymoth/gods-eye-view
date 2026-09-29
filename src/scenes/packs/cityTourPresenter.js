/**
 * Captions, routes, buffering and voice narration for bundled city tours.
 *
 * Listens to Director run events. When a tour shot starts it:
 * - shows the beat's story in a caption (a travel leg names how you get
 *   there; a stop tells its history and the camera move in play),
 * - draws the leg's route on the map (a real foot/bike/car route from
 *   `/api/route`, or a straight dashed line for rail), prefetched when the
 *   tour starts so the line is there the moment the flight begins,
 * - reports 3D-tile buffering as a progress bar until the view is mostly in,
 *   and holds the arrival pose (a Director hold gate) until it is, so the
 *   move never starts over half-loaded tiles,
 * - marks the stop's callouts on the map and lights each one up as the
 *   narrator says it (from the voice transcript; timed when voice is off),
 * - hands the story to an open voice session as a `tour_beat` item.
 * While a tour runs the photoreal tileset is tuned to load the destination
 * during the flight and to spend less on distant tiles, and every data layer
 * the user had on is parked so their feeds and entities stop competing with
 * the tiles; the same layers come back when the tour ends. Nothing here
 * enters the scene document, so tours stay ordinary Director scenes.
 */

import * as CesiumModule from 'cesium';
import { cityTourLegs, cityTourStory, isCityTourScene } from './cityTours.js';

export const CITY_TOUR_CAPTION_ID = 'city-tour-caption';
export const CITY_TOUR_ROUTE_ENTITY_ID = 'city-tour:route';
/** A view counts as ready once this share of the tiles it asked for is in. */
export const CITY_TOUR_READY_RATIO = 0.8;
/** Tile requests for a new view take a moment to be issued; wait at least this long. */
export const CITY_TOUR_GATE_SETTLE_MS = 600;
/** Longest an arrival waits for its tiles before the move starts anyway. */
export const CITY_TOUR_GATE_MAX_WAIT_MS = 12_000;
/** Entity id prefix for a stop's callout markers. */
export const CITY_TOUR_CALLOUT_PREFIX = 'city-tour:callout:';

/** Route colour per travel mode (cyan family, matching the Directions layer). */
const ROUTE_COLORS = Object.freeze({
  foot: '#39d0ff',
  bike: '#7ef0c8',
  car: '#ffd166',
  rail: '#c9a7ff',
});

/** Tileset settings that favour the shot in play over the horizon. */
const TOUR_TILESET_TUNING = Object.freeze({
  // Keep requesting the destination's tiles during the flight instead of
  // waiting for the camera to stop, and preload where the flight ends.
  cullRequestsWhileMoving: false,
  preloadFlightDestinations: true,
  // Coarsen tiles with distance: a street-level stop otherwise refines the
  // whole horizon to full detail, which is what fills the request queue.
  dynamicScreenSpaceError: true,
  dynamicScreenSpaceErrorDensity: 0.0006,
  dynamicScreenSpaceErrorFactor: 6,
});

const NARRATION_INSTRUCTION =
  'A tour_beat system item was just added. Narrate that beat using its story field as your spoken guide, staying close to those words in one or two sentences. Do not mention tools, JSON, or that you are reading a script.';

function createCaption(documentRef) {
  const el = documentRef.createElement('div');
  el.id = CITY_TOUR_CAPTION_ID;
  el.hidden = true;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML =
    '<div class="city-tour-caption-head">' +
    '<span class="city-tour-caption-city"></span>' +
    '<span class="city-tour-caption-title"></span>' +
    '<span class="city-tour-caption-shot"></span>' +
    '</div>' +
    '<p class="city-tour-caption-story"></p>' +
    '<div class="city-tour-caption-loading" hidden>' +
    '<span class="city-tour-caption-loading-label">LOADING 3D</span>' +
    '<span class="city-tour-caption-loading-track"><span class="city-tour-caption-loading-fill"></span></span>' +
    '</div>';
  documentRef.body.appendChild(el);
  return el;
}

/** Build the same-origin route request for a leg (no turn-by-turn steps). */
export function legRouteUrl(leg) {
  const coords = `${leg.from.lon},${leg.from.lat};${leg.to.lon},${leg.to.lat}`;
  return `/api/route?profile=${encodeURIComponent(leg.profile)}&coords=${encodeURIComponent(coords)}`;
}

/** Positions to draw for a leg: the fetched route, or the straight line. */
export function legGeometry(leg, route) {
  const geometry = route?.geometry;
  if (Array.isArray(geometry) && geometry.length >= 2) return geometry;
  return [
    [leg.from.lon, leg.from.lat],
    [leg.to.lon, leg.to.lat],
  ];
}

/** Index of the first unspoken callout whose words the transcript now contains. */
export function spokenCalloutIndex(callouts, transcript, spoken = new Set()) {
  const heard = String(transcript || '').toLowerCase();
  if (!heard) return -1;
  return callouts.findIndex(
    (callout, index) =>
      !spoken.has(index) &&
      callout.say.some((word) => heard.includes(String(word).toLowerCase())),
  );
}

/** Share of requested tiles that have arrived since a view began loading. */
export function bufferingProgress(pending, peak) {
  if (!peak || pending <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - pending / peak));
}

/**
 * @param {object} input
 * @param {{ subscribe: (listener: (notification: { change: object | null }) => void) => () => void }} input.director
 * @param {object} [input.viewer] Cesium viewer; routes draw into its entities.
 * @param {object|null} [input.tileset] The photoreal tileset, for tuning and
 *   buffering progress. Optional: keyless globes have none.
 * @param {object|null} [input.dataManager] Layer manager; enabled layers are
 *   parked for the tour and restored afterwards.
 * @param {typeof fetch} [input.fetchImpl]
 * @param {() => object | null | undefined} [input.getVoice] Returns the voice
 *   controls (window.__gevVoiceCommands) or nothing when voice is off.
 * @param {Document} [input.documentRef]
 * @param {object} [input.Cesium] Cesium module, injectable for tests.
 * @returns {() => void} dispose
 */
export function installCityTourPresenter({
  director,
  viewer = null,
  tileset = null,
  dataManager = null,
  fetchImpl = (...args) => globalThis.fetch(...args),
  getVoice = () => globalThis.window?.__gevVoiceCommands,
  documentRef = globalThis.document,
  Cesium = CesiumModule,
}) {
  const caption = createCaption(documentRef);
  const part = (name) => caption.querySelector(`.city-tour-caption-${name}`);
  const city = part('city');
  const title = part('title');
  const shot = part('shot');
  const story = part('story');
  const loading = part('loading');
  const loadingFill = part('loading-fill');
  let shown = null;
  let activeTour = null;
  let routeEntity = null;
  let tuningRestore = null;
  let pendingPeak = 0;
  let lastPending = 0;
  let shotStartedAt = 0;
  /** @type {{ entity: object, callout: object }[]} */
  let calloutMarks = [];
  const spokenCallouts = new Set();
  let transcript = '';
  let voiceUnsubscribe = null;
  let calloutTimers = [];
  /** Layer ids that were on when the tour began. @type {string[]|null} */
  let parkedLayers = null;
  /** @type {Map<string, Promise<object|null>>} */
  const routes = new Map();

  const hideLoading = () => {
    loading.hidden = true;
    pendingPeak = 0;
  };

  const onTileProgress = (pending) => {
    if (!activeTour) return;
    lastPending = Math.max(0, Number(pending) || 0);
    pendingPeak = Math.max(pendingPeak, lastPending);
    const progress = bufferingProgress(lastPending, pendingPeak);
    if (progress >= CITY_TOUR_READY_RATIO) {
      hideLoading();
      return;
    }
    loading.hidden = false;
    loadingFill.style.width = `${Math.round(progress * 100)}%`;
  };
  const removeTileProgress =
    tileset?.tileLoadProgressEvent?.addEventListener?.(onTileProgress) || null;

  // Arrival and approach shots hold until the view is mostly buffered, so the
  // stop's move plays over loaded tiles. Stops themselves are never gated.
  const gate = (scene, shot) => {
    if (!tileset || scene?.id !== activeTour) return null;
    const beat = cityTourStory(scene.id, shot?.title);
    if (!beat || beat.kind === 'stop') return null;
    const settling = Date.now() - shotStartedAt < CITY_TOUR_GATE_SETTLE_MS;
    return {
      pending: settling || bufferingProgress(lastPending, pendingPeak) < CITY_TOUR_READY_RATIO,
      maxWaitMs: CITY_TOUR_GATE_MAX_WAIT_MS,
    };
  };
  const removeGate = director.registerShotHoldGate?.(gate) || null;

  const applyTuning = () => {
    if (!tileset || tuningRestore) return;
    tuningRestore = {};
    for (const [key, value] of Object.entries(TOUR_TILESET_TUNING)) {
      if (!(key in tileset)) continue;
      tuningRestore[key] = tileset[key];
      tileset[key] = value;
    }
  };

  const restoreTuning = () => {
    if (!tileset || !tuningRestore) return;
    for (const [key, value] of Object.entries(tuningRestore)) tileset[key] = value;
    tuningRestore = null;
  };

  // Layers off for the run: their polling, entities and overlays are what
  // the tiles would otherwise share the frame budget with. The scene origin
  // keeps the switch out of the user's saved layer state.
  const parkLayers = () => {
    if (!dataManager?.getEnabledLayerIds || parkedLayers) return;
    parkedLayers = [...dataManager.getEnabledLayerIds()];
    for (const id of parkedLayers) {
      void Promise.resolve(dataManager.setEnabled(id, false, { origin: 'scene' })).catch(() => {});
    }
  };

  const restoreLayers = () => {
    if (!parkedLayers) return;
    const ids = parkedLayers;
    parkedLayers = null;
    for (const id of ids) {
      void Promise.resolve(dataManager.setEnabled(id, true, { origin: 'scene' })).catch(() => {});
    }
  };

  const styleCallout = (mark, lit) => {
    const { entity } = mark;
    if (!entity?.point) return;
    entity.point.pixelSize = lit ? 13 : 8;
    entity.point.color = Cesium.Color.fromCssColorString(lit ? '#ffffff' : '#39d0ff').withAlpha(lit ? 1 : 0.6);
    if (entity.label) {
      entity.label.scale = lit ? 1.15 : 0.9;
      entity.label.fillColor = Cesium.Color.fromCssColorString(lit ? '#ffffff' : '#bff4ff');
    }
  };

  const lightCallout = (index) => {
    if (index < 0 || index >= calloutMarks.length || spokenCallouts.has(index)) return;
    spokenCallouts.add(index);
    calloutMarks.forEach((mark, i) => styleCallout(mark, i === index));
  };

  const clearCallouts = () => {
    for (const timer of calloutTimers) clearTimeout(timer);
    calloutTimers = [];
    if (viewer?.entities) for (const { entity } of calloutMarks) viewer.entities.remove(entity);
    calloutMarks = [];
    spokenCallouts.clear();
    transcript = '';
  };

  const drawCallouts = (beat) => {
    clearCallouts();
    if (!viewer?.entities || !Cesium || !beat.callouts?.length) return;
    calloutMarks = beat.callouts.map((callout, index) => ({
      callout,
      entity: viewer.entities.add({
        id: `${CITY_TOUR_CALLOUT_PREFIX}${index}`,
        position: Cesium.Cartesian3.fromDegrees(callout.lon, callout.lat, callout.alt),
        point: {
          pixelSize: 8,
          color: Cesium.Color.fromCssColorString('#39d0ff').withAlpha(0.6),
          outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
          outlineWidth: 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: callout.label,
          font: '12px "JetBrains Mono", monospace',
          fillColor: Cesium.Color.fromCssColorString('#bff4ff'),
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString('#060a10').withAlpha(0.7),
          pixelOffset: new Cesium.Cartesian2(0, -18),
          scale: 0.9,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      }),
    }));
    // Without a narrator, walk the callouts on a timer spread over the move.
    if (!getVoice()?.session?.isActive?.()) {
      const step = (beat.holdSec * 1000) / (calloutMarks.length + 1);
      calloutMarks.forEach((_, index) => {
        calloutTimers.push(setTimeout(() => lightCallout(index), Math.round(step * (index + 1))));
      });
    }
  };

  // The narrator's transcript arrives as deltas; a callout lights when its
  // words have been said. A finished response resets the running text.
  const onVoiceEvent = (event) => {
    if (event?.type !== 'transcript' || event.role !== 'assistant') return;
    if (event.final) {
      transcript = '';
      return;
    }
    transcript += event.text || '';
    if (!calloutMarks.length) return;
    let index = spokenCalloutIndex(calloutMarks.map((mark) => mark.callout), transcript, spokenCallouts);
    while (index >= 0) {
      lightCallout(index);
      index = spokenCalloutIndex(calloutMarks.map((mark) => mark.callout), transcript, spokenCallouts);
    }
  };

  const listenToVoice = () => {
    if (voiceUnsubscribe) return;
    const session = getVoice()?.session;
    if (typeof session?.subscribe !== 'function') return;
    voiceUnsubscribe = session.subscribe(onVoiceEvent);
  };

  const stopListeningToVoice = () => {
    voiceUnsubscribe?.();
    voiceUnsubscribe = null;
  };

  const clearRoute = () => {
    if (routeEntity && viewer?.entities) viewer.entities.remove(routeEntity);
    routeEntity = null;
  };

  const legKey = (leg) => `${leg.profile}|${leg.from.lon},${leg.from.lat}|${leg.to.lon},${leg.to.lat}`;

  const fetchLeg = (leg) => {
    if (!leg.profile) return Promise.resolve(null);
    const key = legKey(leg);
    if (!routes.has(key)) {
      routes.set(
        key,
        Promise.resolve()
          .then(() => fetchImpl(legRouteUrl(leg), { cache: 'force-cache' }))
          .then((response) => (response?.ok ? response.json() : null))
          .then((payload) => (payload?.ok === true ? payload : null))
          .catch(() => null),
      );
    }
    return routes.get(key);
  };

  const prefetchLegs = (sceneId) => {
    for (const leg of cityTourLegs(sceneId)) void fetchLeg(leg);
  };

  const drawLeg = async (leg, key) => {
    clearRoute();
    if (!viewer?.entities || !leg.from || !Cesium) return;
    const route = await fetchLeg(leg);
    // The tour moved on (or stopped) while the route was in flight.
    if (shown !== key) return;
    clearRoute();
    const geometry = legGeometry(leg, route);
    const color = Cesium.Color.fromCssColorString(ROUTE_COLORS[leg.mode] || ROUTE_COLORS.foot);
    const dashed = leg.mode === 'rail' || leg.mode === 'foot';
    routeEntity = viewer.entities.add({
      id: CITY_TOUR_ROUTE_ENTITY_ID,
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(geometry.flat()),
        width: 7,
        material: dashed
          ? new Cesium.PolylineDashMaterialProperty({
              color,
              dashLength: leg.mode === 'rail' ? 48 : 20,
            })
          : color.withAlpha(0.9),
        clampToGround: true,
        // Drape on 3D tiles when they are up and on terrain when they are not.
        classificationType: Cesium.ClassificationType.BOTH,
      },
    });
  };

  const narrate = (beat) => {
    const voice = getVoice();
    if (!voice?.session?.isActive?.()) return;
    voice.session.sendMapEvent?.({
      type: 'tour_beat',
      kind: beat.kind,
      city: beat.city,
      title: beat.title,
      story: beat.story,
    });
    voice.queueResponseCreate?.(NARRATION_INSTRUCTION);
  };

  const endTour = () => {
    shown = null;
    activeTour = null;
    caption.hidden = true;
    caption.classList.remove('visible');
    clearRoute();
    clearCallouts();
    stopListeningToVoice();
    hideLoading();
    restoreTuning();
    restoreLayers();
  };

  const show = (sceneId, shotTitle) => {
    const beat = cityTourStory(sceneId, shotTitle);
    if (!beat) return endTour();
    if (activeTour !== sceneId) {
      activeTour = sceneId;
      applyTuning();
      parkLayers();
      listenToVoice();
      prefetchLegs(sceneId);
    }
    const key = `${sceneId}\n${beat.title}`;
    if (shown === key) return;
    shown = key;
    shotStartedAt = Date.now();
    // Every new view starts its own buffering measure.
    pendingPeak = lastPending;
    hideLoading();
    caption.dataset.kind = beat.kind;
    city.textContent = beat.city;
    title.textContent = beat.kind === 'travel' ? `${beat.icon} ${beat.title}` : beat.title;
    shot.textContent = beat.kind === 'stop' ? beat.shot : '';
    story.textContent = beat.story;
    caption.hidden = false;
    caption.classList.add('visible');
    if (beat.kind === 'travel' && beat.from) void drawLeg(beat, key);
    else if (beat.kind !== 'stop') clearRoute();
    if (beat.kind === 'stop') drawCallouts(beat);
    else clearCallouts();
    narrate(beat);
  };

  // The Director's state channel delivers `{ state, change, revision }`.
  const unsubscribe = director.subscribe((notification) => {
    const change = notification?.change;
    if (change?.type !== 'run-event') return;
    const detail = change.detail || {};
    switch (change.event) {
      case 'shot_start':
        if (isCityTourScene(detail.sceneId)) show(detail.sceneId, detail.title);
        else endTour();
        break;
      case 'scene_stopped':
      case 'scene_run_complete':
      case 'scene_run_error':
        endTour();
        break;
      default:
        break;
    }
  });

  return () => {
    unsubscribe?.();
    removeGate?.();
    removeTileProgress?.();
    endTour();
    caption.remove();
  };
}
