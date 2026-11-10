// -----------------------------------------------------------------------------
// The configuration of the form, normalized: the two credentials of the DB
// API Marketplace application, the language, the pace, and up to three
// stations, each with its optional line and direction filters. Nothing here
// talks to the network.
// -----------------------------------------------------------------------------

import {
  LANGUAGES,
  LOOKAHEAD_MINUTES,
  MAX_STATIONS,
  POLL_MINUTES,
  THRESHOLD_MINUTES,
} from './constants.js';

/** Control characters (CR, LF, tab included): never in a header, an id or a path. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** A credential: printable ASCII without space, 1 to 128 characters. */
export const isCredential = (value) =>
  typeof value === 'string' && /^[\x21-\x7e]{1,128}$/.test(value);

function text(value, max) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  return trimmed.length <= max && !CONTROL.test(trimmed) ? trimmed : '';
}

/** A whole number in its bounds, the default when missing or not a whole number. */
export function bounded(value, { default: fallback, min, max }) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const number = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

/** Lines of a filter: "RE 5, S1, ICE" -> ["RE5", "S1", "ICE"] (spaces dropped, upper case). */
export function parseLines(value) {
  const raw = text(value, 200);
  if (!raw) {
    return [];
  }
  const lines = raw
    .split(/[,;]/)
    .map((part) => part.replace(/\s+/g, '').toUpperCase())
    .filter((part) => /^[A-Z0-9-]{1,12}$/.test(part));
  return [...new Set(lines)].slice(0, 20);
}

/**
 * The station input: an EVA number (6 to 9 digits), a DS100 code or a name.
 * Normalized for the cache key; the path segment is URL-encoded later.
 */
export function stationInput(value) {
  const raw = text(value, 80).replace(/\s+/g, ' ');
  return raw.includes('/') || raw === '.' || raw === '..' ? '' : raw;
}

export function normalizeConfig(config = {}) {
  const c = config && typeof config === 'object' ? config : {};
  const clientId = typeof c.client_id === 'string' ? c.client_id.trim() : '';
  const apiKey = typeof c.api_key === 'string' ? c.api_key.trim() : '';
  const stations = [];
  for (let slot = 1; slot <= MAX_STATIONS; slot += 1) {
    const input = stationInput(c[`station_${slot}`]);
    if (!input) {
      continue;
    }
    stations.push({
      slot,
      input,
      lines: parseLines(c[`lines_${slot}`]),
      via: text(c[`via_${slot}`], 60).toLowerCase(),
    });
  }
  return {
    clientId,
    apiKey,
    // Only well-formed values ever reach a header: anything else is "missing".
    credentialsValid: isCredential(clientId) && isCredential(apiKey),
    language: LANGUAGES.includes(c.language) ? c.language : 'en',
    pollMinutes: bounded(c.poll_minutes, POLL_MINUTES),
    lookaheadMinutes: bounded(c.lookahead_minutes, LOOKAHEAD_MINUTES),
    thresholdMinutes: bounded(c.delay_threshold, THRESHOLD_MINUTES),
    stations,
  };
}

/** What a credential problem is: undefined when both are there and well-formed. */
export function credentialProblem(config) {
  if (!config.clientId && !config.apiKey) {
    return 'missing';
  }
  if (!config.clientId || !config.apiKey) {
    // A key without its Client ID (or the reverse) is never sent.
    return 'half';
  }
  return config.credentialsValid ? undefined : 'malformed';
}

/** The part of the config that changes what is read (not the credentials). */
export const readingKey = (config) =>
  JSON.stringify([config.pollMinutes, config.lookaheadMinutes, config.stations]);
