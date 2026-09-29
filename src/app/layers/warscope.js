import { createWarscopeEventsLayer } from '../../layers/warscope/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire WarScope conflict events to the application overlay host. */
export function createApplicationWarscope(options) {
  return createWarscopeEventsLayer({ overlayHost, ...options });
}
