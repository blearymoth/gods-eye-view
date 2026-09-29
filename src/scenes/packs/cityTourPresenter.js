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
      prefetchLegs(sceneId);
    }
    const key = `${sceneId}\n${beat.title}`;
    if (shown === key) return;
    shown = key;
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
    removeTileProgress?.();
    endTour();
    caption.remove();
  };
}
