// -----------------------------------------------------------------------------
// Fixed values: the API, the manifest keys, the pace, the limits. Every time is
// in milliseconds unless the name says otherwise.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/** The official Timetables API of the DB API Marketplace (free plan). */
export const API_BASE = 'https://apis.deutschebahn.com/db-api-marketplace/apis/timetables/v1';
export const USER_AGENT = `gladys-deutsche-bahn/${pkg.version} (+https://github.com/LM1LC3N7/gladys-deutsche-bahn)`;

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

/** Manifest keys (forever: users store them). */
export const ACTIONS = Object.freeze({ TEST: 'test_connection', SEARCH: 'search_station' });
export const WIDGETS = Object.freeze({ DEPARTURES: 'departures' });
export const LANGUAGES = Object.freeze(['en', 'fr']);

/** Station slots of the configuration form. */
export const MAX_STATIONS = 3;

/** Bounds of the number fields: [default, min, max]. */
export const POLL_MINUTES = Object.freeze({ default: 2, min: 1, max: 15 });
export const LOOKAHEAD_MINUTES = Object.freeze({ default: 60, min: 15, max: 180 });
export const THRESHOLD_MINUTES = Object.freeze({ default: 5, min: 1, max: 60 });

/**
 * Two requests never closer than this, whatever asks (rounds, test, search):
 * at most 40 a minute, the free plan allows 60. One request in flight at a time.
 */
export const REQUEST_GAP = 1500;
export const REQUEST_TIMEOUT = 15 * SECOND;
/** No new station is started after this long in a round (the rest goes first next time). */
export const ROUND_BUDGET = 90 * SECOND;
/** A changed configuration still waits this long after the last round. */
export const MIN_ROUND_GAP = 30 * SECOND;
/** Network errors on every station: the next round waits up to this long. */
export const RETRY_MAX = 30 * MINUTE;

/** A planned hour is read again after this long (the plan hardly changes). */
export const PLAN_REFRESH = HOUR;
/** An hour DB has no plan for yet (404) is asked again after this long. */
export const PLAN_EMPTY_RETRY = 15 * MINUTE;
/** At most this many planned hours kept per station. */
export const MAX_PLAN_HOURS = 7;
/** The two hours before are read too: a train planned then and late still leaves. */
export const LOOKBACK_MINUTES = 120;
/** The boards are published again every minute from what is held (no request). */
export const TICK = MINUTE;

/** The live changes are not used any more past this age (or 2.5 intervals). */
export const LIVE_STALE = 10 * MINUTE;

/** 429 and 5xx: the pause of every request, kept in /data. */
export const PAUSE_MIN = MINUTE;
export const PAUSE_MAX = 6 * HOUR;
/** A 401/403 on a timetable page while the credentials are accepted: that page waits. */
export const SECONDARY_MIN = 5 * MINUTE;
export const SECONDARY_MAX = HOUR;
/** A 5xx on a timetable page of one station: that station waits 1 min doubling to 30 min. */
export const STATION_RETRY_MIN = MINUTE;
export const STATION_RETRY_MAX = 30 * MINUTE;

/** /data: a slow or unreadable file is read again on this timer, one read at a time. */
export const STORE_RETRY = 10 * SECOND;
/** How long a start waits for /data before going on without it (and without saving). */
export const STORE_WAIT = 5 * SECOND;
/** getConfig() failing: retried for ever, spaced from 5 s to 60 s. */
export const CONFIG_RETRY_MIN = 5 * SECOND;
export const CONFIG_RETRY_MAX = 60 * SECOND;

/** The test button and the search: each at most once in this time. */
export const TEST_MIN_GAP = 30 * SECOND;
export const SEARCH_MIN_GAP = 5 * SECOND;
export const MAX_SEARCH_RESULTS = 10;

/** Answer sizes (read bounded, cut beyond) and XML elements per answer. */
export const MAX_BYTES = Object.freeze({
  station: 256 * 1024,
  plan: 2 * 1024 * 1024,
  fchg: 4 * 1024 * 1024,
});
export const MAX_ELEMENTS = 60000;

/** Published values. */
export const MAX_DELAY_MINUTES = 1440;
export const MAX_COUNT = 99;
export const MAX_TEXT = 200;
export const MAX_STATUS = 200;
/** Station names kept in /data (resolved inputs). */
export const MAX_RESOLVED = 20;
