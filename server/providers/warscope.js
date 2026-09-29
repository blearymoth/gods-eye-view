import { makeRateLimiter, clientKey } from './common/rate-limit.js';
import {
  coalesceProxyRequest,
  readResponseTextCapped,
} from './common/http.js';

/** WarScope events feed memory-cache TTL (stay well under the 60 req/min free tier). */
export const WARSCOPE_CACHE_TTL_MS = 10 * 60_000;

/**
 * Same-origin WarScope conflict-events proxy.
 *
 * Fixed upstream host only (`https://warscope.net/api/events`). Query params are
 * clamped server-side; the client never supplies an arbitrary fetch URL (no
 * preview/image scrape endpoints). Memory cache + coalesce + per-IP rate limit
 * keep us under WarScope's 60 req/min free tier.
 *
 * @returns {import('vite').Plugin}
 */
export function warscopeEventsProxy() {
  const ttlMs = WARSCOPE_CACHE_TTL_MS;
  const maxResponseBytes = 8 * 1024 * 1024;
  const rateLimiter = makeRateLimiter({ windowMs: 60_000, max: 30, globalMax: 60 });
  /** @type {{ at: number, body: string, key: string } | null} */
  let warscopeCache = null;
  const warscopeInflight = new Map();

  function sendJson(res, status, body, cacheState) {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': status === 200 ? 'public, max-age=60' : 'no-store',
      'X-GEV-Cache': cacheState,
    });
    res.end(body);
  }

  /**
   * @param {URLSearchParams} searchParams
   * @returns {Promise<{ at: number, body: string, key: string }>}
   */
  async function fetchWarscopeEvents(searchParams) {
    const days = Math.max(1, Math.min(90, Number.parseInt(searchParams.get('days') || '7', 10) || 7));
    const limit = Math.max(1, Math.min(500, Number.parseInt(searchParams.get('limit') || '400', 10) || 400));
    const theater = String(searchParams.get('theater') || '').trim();
    const url = new URL('https://warscope.net/api/events');
    url.searchParams.set('days', String(days));
    url.searchParams.set('limit', String(limit));
    if (theater) url.searchParams.set('theater', theater);

    const upstream = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      headers: { Accept: 'application/json' },
    });
    const text = await readResponseTextCapped(upstream, maxResponseBytes);
    if (!upstream.ok) {
      const error = new Error(`upstream HTTP ${upstream.status}`);
      error.upstreamStatus = upstream.status;
      error.upstreamBody = text;
      throw error;
    }
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') throw new Error('malformed WarScope response');
    const normalized = {
      fetchedAt: Date.now(),
      stale: false,
      theater: parsed.theater || theater || 'global',
      days,
      count: parsed.count ?? parsed.events?.length ?? 0,
      source: parsed.source || 'live',
      meta: parsed.meta || null,
      events: Array.isArray(parsed.events) ? parsed.events : [],
    };
    const body = JSON.stringify(normalized);
    const key = `${days}:${limit}:${theater || 'global'}`;
    warscopeCache = { at: Date.now(), body, key };
    return warscopeCache;
  }

  function install(middlewares) {
    middlewares.use('/api/warscope/events', async (req, res) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, JSON.stringify({ error: 'Method Not Allowed' }), 'NONE');
        return;
      }
      if (!rateLimiter(clientKey(req))) {
        sendJson(res, 429, JSON.stringify({ error: 'Rate limit exceeded' }), 'NONE');
        return;
      }
      const url = new URL(req.url, 'http://localhost');
      const key = `${url.searchParams.get('days') || '7'}:${url.searchParams.get('limit') || '400'}:${url.searchParams.get('theater') || 'global'}`;
      const now = Date.now();
      if (warscopeCache && warscopeCache.key === key && now - warscopeCache.at < ttlMs) {
        sendJson(res, 200, warscopeCache.body, 'HIT');
        return;
      }
      const stale = warscopeCache?.key === key ? warscopeCache : null;
      const request = coalesceProxyRequest(warscopeInflight, key, () => fetchWarscopeEvents(url.searchParams));
      try {
        const fresh = await request.promise;
        sendJson(res, 200, fresh.body, request.shared ? 'INFLIGHT' : 'MISS');
      } catch (error) {
        if (stale) {
          if (!request.shared) {
            console.warn(`[/api/warscope/events] refresh failed (${error?.message || error}) — serving stale cache`);
          }
          try {
            const parsed = JSON.parse(stale.body);
            parsed.stale = true;
            sendJson(res, 200, JSON.stringify(parsed), 'STALE-ERROR');
          } catch {
            sendJson(res, 200, stale.body, 'STALE-ERROR');
          }
          return;
        }
        sendJson(
          res,
          Number.isInteger(error?.upstreamStatus) ? error.upstreamStatus : 502,
          error?.upstreamBody || JSON.stringify({ error: 'WarScope unavailable' }),
          'NONE',
        );
      }
    });
  }

  return {
    name: 'warscope-events-proxy',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}
