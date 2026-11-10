// -----------------------------------------------------------------------------
// The SDK handlers, wired to the app. Shared by index.js and the tests, so the
// tests run the exact wiring of the container. Every handler is registered
// before connect(). Read-only: no command handler, nothing is ever commanded.
// -----------------------------------------------------------------------------

import { ACTIONS, WIDGETS } from './constants.js';

export function registerHandlers(gladys, app, logger) {
  // Discovery: the resolved stations, never a request.
  gladys.onScanRequest(() => app.scan());

  // Configuration screen buttons.
  gladys.onAction(ACTIONS.TEST, () => app.testConnection());
  gladys.onAction(ACTIONS.SEARCH, (fields) => app.searchStation(fields));

  // Dashboard widget: from what is held, never a request.
  gladys.onWidgetGet(WIDGETS.DEPARTURES, (request) => app.getWidget(request));

  // Configuration saved by the user.
  gladys.onConfigUpdated((config) => app.start(config));

  // Every connection (the first one and each reconnection): the config is
  // read again (retried for ever), the status and the Discovery list sent
  // again, the values at the next round (never sooner than the interval).
  gladys.on('connected', async () => {
    try {
      await app.connected();
    } catch (err) {
      logger?.error(`Start failed (${err?.name ?? 'Error'})`);
    }
  });
}
