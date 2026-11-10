// -----------------------------------------------------------------------------
// The departure board of a station (pure): the departures of the look-ahead
// window that match the filters, the next one that runs, its delay, and how
// many are disrupted. Without fresh live changes (`live` false) the board is
// the timetable only: no delay and no disruption count is told.
// -----------------------------------------------------------------------------

import { MAX_COUNT, MAX_DELAY_MINUTES, MINUTE } from './constants.js';

const squash = (value) => value.replace(/\s+/g, '').toUpperCase();

/** Whether a departure matches the line and direction filters of a station. */
export function matches(departure, { lines = [], via = '' } = {}) {
  if (lines.length) {
    const line = squash(departure.line);
    const category = squash(departure.category);
    if (!lines.some((l) => l === line || l === category)) {
      return false;
    }
  }
  if (via) {
    return departure.path.some((station) => station.toLowerCase().includes(via));
  }
  return true;
}

/** Whole minutes of delay, 0 when on time or early, bounded. */
export const delayOf = (d) =>
  Math.min(MAX_DELAY_MINUTES, Math.max(0, Math.round((d.time - d.planned) / MINUTE)));

/**
 * @param {object[]} departures - departuresOf(...)
 * @param {{ now: number, lookaheadMinutes: number, thresholdMinutes: number,
 *   live: boolean, filter: object }} options
 */
export function buildBoard(departures, { now, lookaheadMinutes, thresholdMinutes, live, filter }) {
  const end = now + lookaheadMinutes * MINUTE;
  const rows = departures.filter((d) => {
    // A departure gone this minute still shows; a delayed one stays until it leaves.
    const shown = live ? d.time : d.planned;
    return shown >= now - 30 * 1000 && d.planned <= end && matches(d, filter);
  });
  const running = rows.filter((d) => !d.cancelled);
  const next = running[0];
  // With a fresh /fchg, a train it does not list has no change reported: on
  // time (the convention of DB; the feed does not tell "on time" from "not
  // tracked"). Without one, nothing is told.
  const disrupted = rows.filter((d) => d.cancelled || delayOf(d) >= thresholdMinutes).length;
  return {
    live,
    rows,
    next,
    nextIn: next
      ? Math.max(0, Math.floor(((live ? next.time : next.planned) - now) / MINUTE))
      : undefined,
    delay: next && live ? delayOf(next) : undefined,
    disrupted: live ? Math.min(MAX_COUNT, disrupted) : undefined,
  };
}
