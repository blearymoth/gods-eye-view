import * as Cesium from 'cesium';
import { governorRequestRender } from '../../renderGovernor.js';
import {
  WARSCOPE_OVERLAY_COLLISION_CAPACITY,
  WARSCOPE_OVERLAY_COHORT_LIMIT,
  WARSCOPE_OVERLAY_SOURCE_ID,
  createWarscopeOverlayEntry,
  eventAccentColor,
  selectWarscopeOverlayCohort,
} from './model.js';
export * from './model.js';
export { createWarscopeSource } from './source.js';

const UPDATE_MS = 600000;

const EVENT_COLORS = Object.freeze({
  battles: '#ff3344',
  'explosions/remote violence': '#ff7722',
  protests: '#ffcc33',
  riots: '#ff9933',
  'strategic developments': '#66aaff',
});

function eventColor(eventType) {
  return Cesium.Color.fromCssColorString(eventAccentColor(eventType));
}

/** Own the WarScope conflict-event display and its refresh lifecycle. */
export function createWarscopeEventsLayer({
  source,
  overlayHost,
  screenSpaceEventHandlerFactory = (viewer) => (
    new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
  ),
} = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('WarScope requires a snapshot source');
  if (!overlayHost) throw new TypeError('WarScope requires an overlay host');
  let _request = null;
  let _viewer = null;
  let _dataSource = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _stale = false;
  let _enabled = false;
  let _theater = 'global';
  /** @type {Map<string, object>} */
  let _eventsById = new Map();
  /** @type {Map<string, Cesium.Cartesian3>} */
  let _positionsById = new Map();
  /** @type {Set<string>} */
  let _expandedIds = new Set();
  let _clickHandler = null;

  function syncOverlayEntries() {
    if (!_enabled) return;
    const entries = [];
    for (const [id, event] of _eventsById) {
      const position = _positionsById.get(id);
      if (!position) continue;
      const entry = createWarscopeOverlayEntry({
        event,
        position,
        expanded: _expandedIds.has(id),
      });
      if (entry) entries.push(entry);
    }
    overlayHost.setEntries(
      WARSCOPE_OVERLAY_SOURCE_ID,
      selectWarscopeOverlayCohort(entries, _expandedIds),
      {
        cohortLimit: WARSCOPE_OVERLAY_COHORT_LIMIT,
        collisionCapacity: WARSCOPE_OVERLAY_COLLISION_CAPACITY,
        moving: false,
      },
    );
  }

  function toggleExpanded(eventId) {
    if (!eventId || !_eventsById.has(eventId)) return false;
    if (_expandedIds.has(eventId)) _expandedIds.delete(eventId);
    else _expandedIds.add(eventId);
    syncOverlayEntries();
    if (_enabled) governorRequestRender('warscope-expand');
    return true;
  }

  function installClickHandler() {
    if (_clickHandler || !_viewer) return;
    _clickHandler = screenSpaceEventHandlerFactory(_viewer);
    _clickHandler.setInputAction((click) => {
      const hit = overlayHost.hitTest?.(
        click.position?.x,
        click.position?.y,
        { sourceId: WARSCOPE_OVERLAY_SOURCE_ID },
      );
      if (!hit?.entryId) return;
      toggleExpanded(hit.entryId);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  function removeClickHandler() {
    if (_clickHandler) {
      _clickHandler.destroy();
      _clickHandler = null;
    }
  }

  const layer = {
    id: 'warscope-events',
    name: 'Global Conflict Events',
    icon: '⚔️',
    source: 'WarScope / GDELT',
    updateInterval: UPDATE_MS,

    init(viewer) {
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('warscope-events');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _enabled = false;
      _theater = 'global';
      _eventsById = new Map();
      _positionsById = new Map();
      _expandedIds = new Set();
      overlayHost.setVisible(WARSCOPE_OVERLAY_SOURCE_ID, false);
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(WARSCOPE_OVERLAY_SOURCE_ID, true);
      syncOverlayEntries();
      installClickHandler();
    },

    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(WARSCOPE_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(WARSCOPE_OVERLAY_SOURCE_ID, false);
      removeClickHandler();
    },

    async update() {
      if (!_enabled || !_dataSource) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const payload = await source.getSnapshot({ signal: request.signal });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        _stale = Boolean(payload.stale);
        _theater = payload.theater;
        const events = payload.events;

        _dataSource.entities.removeAll();
        _eventsById = new Map();
        _positionsById = new Map();
        const liveIds = new Set();
        let rendered = 0;

        for (const raw of events) {
          const event = raw;

          liveIds.add(event.id);
          _eventsById.set(event.id, event);
          const position = Cesium.Cartesian3.fromDegrees(event.lon, event.lat);
          _positionsById.set(event.id, position);

          const color = eventColor(event.eventType);
          const magScale = Math.min(14, 6 + Math.sqrt(Math.max(0, event.fatalities)) * 2);

          _dataSource.entities.add({
            id: `warscope:${event.id}`,
            position,
            point: {
              pixelSize: magScale,
              color: color.withAlpha(0.88),
              outlineColor: Cesium.Color.BLACK.withAlpha(0.45),
              outlineWidth: 1,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            properties: {
              title: event.title,
              eventType: event.eventType,
              subEventType: event.subEventType,
              country: event.country,
              region: event.region,
              date: event.date,
              notes: event.notes,
              source: event.source,
              sourceUrl: event.sourceUrl,
              fatalities: event.fatalities,
            },
          });
          rendered += 1;
        }

        for (const id of [..._expandedIds]) {
          if (!liveIds.has(id)) _expandedIds.delete(id);
        }

        _count = rendered;
        _lastUpdate = payload.fetchedAt;
        _lastError = null;
        syncOverlayEntries();
        if (_enabled) governorRequestRender('warscope-events-update');
        return true;
      } catch (error) {
        if (request.signal.aborted || _request !== request) return false;
        _lastError = error?.message || 'WarScope network error';
        console.warn('[Data:WarScope]', error);
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },

    destroy(viewer) {
      _request?.abort();
      _request = null;
      _enabled = false;
      removeClickHandler();
      overlayHost.clearSource(WARSCOPE_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(WARSCOPE_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _viewer = null;
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _theater = 'global';
      _eventsById = new Map();
      _positionsById = new Map();
      _expandedIds = new Set();
    },

    getRowControls() {
      return {
        legend: [
          { color: EVENT_COLORS.battles, label: 'Battles' },
          { color: EVENT_COLORS['explosions/remote violence'], label: 'Explosions / remote violence' },
          { color: EVENT_COLORS.protests, label: 'Protests' },
          { color: '#c8d0dc', label: 'Other reported events' },
          { color: '#9eb6d4', label: 'Zoom in for cards · click to expand' },
        ],
      };
    },

    getStats() {
      return {
        count: _count,
        lastUpdate: _lastUpdate,
        error: _lastError,
        stale: _stale,
        loadingLabel: _theater !== 'global' ? _theater : '7d global',
      };
    },
  };

  return layer;
}
