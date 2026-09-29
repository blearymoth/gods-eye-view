const API_URL = '/api/warscope/events';

function normalizeEvent(raw) {
  const lat = Number(raw?.latitude);
  const lon = Number(raw?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const id = String(raw?.id || '');
  if (!id) return null;
  const fatalities = Number(raw?.fatalities);
  const quality = Number(raw?.quality?.overall);
  return {
    id,
    title: String(raw?.title || raw?.event_type || 'Conflict event').trim(),
    eventType: String(raw?.event_type || '').trim(),
    subEventType: String(raw?.sub_event_type || '').trim(),
    country: String(raw?.country || '').trim(),
    region: String(raw?.region || '').trim(),
    date: String(raw?.event_date || raw?.date || '').trim(),
    notes: String(raw?.notes || '').trim(),
    source: String(raw?.source || 'WarScope').trim(),
    sourceUrl: String(raw?.source_url || '').trim(),
    lat,
    lon,
    fatalities: Number.isFinite(fatalities) ? fatalities : 0,
    quality: Number.isFinite(quality) ? quality : 0,
  };
}

/** Request the same-origin WarScope proxy and validate a whole snapshot. */
export function createWarscopeSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  apiUrl = API_URL,
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl(apiUrl, { cache: 'no-store', signal });
      const payload = await response.json().catch(() => null);
      signal?.throwIfAborted();
      if (!response.ok || !payload) {
        throw new Error(payload?.error || `WarScope HTTP ${response.status}`);
      }
      return {
        stale: Boolean(payload.stale),
        theater: String(payload.theater || 'global'),
        fetchedAt: Number(payload.fetchedAt) || Date.now(),
        events: (Array.isArray(payload.events) ? payload.events : [])
          .map(normalizeEvent)
          .filter(Boolean),
      };
    },
  };
}
