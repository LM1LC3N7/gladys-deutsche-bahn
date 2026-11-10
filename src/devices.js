// -----------------------------------------------------------------------------
// The device of a watched station (pure). Read-only features:
//   next       text: "14:05 RE 5 → Koblenz Hbf, pl. 3, +4 min"
//   next_in    minutes until the next departure that runs
//   delay      minutes of delay of that departure (live data only)
//   disrupted  departures of the window cancelled or late from the threshold
//              (live data only)
// External id: `ext:<selector>:station:<slot>-<eva>` (the slot of the form
// and the EVA number DB gives): the same station in two slots, with other
// filters, makes two devices; another station in a slot makes a new device.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { LOOKAHEAD_MINUTES, MAX_COUNT, MAX_DELAY_MINUTES, MAX_TEXT } from './constants.js';
import { clean } from './db/model.js';
import { t } from './i18n.js';
import { clock } from './time.js';
import { delayOf } from './board.js';

export const DEVICE_TYPE = 'station';
export const FEATURE = Object.freeze({
  NEXT: 'next',
  NEXT_IN: 'next_in',
  DELAY: 'delay',
  DISRUPTED: 'disrupted',
});

export const platformId = (station) => `${station.slot}-${station.eva}`;
export const idsOf = (gladys, station) => gladys.externalIds(DEVICE_TYPE, platformId(station));

/** The slot and EVA of a device external id; undefined when not one of ours. */
export function parseDeviceId(externalId) {
  const match = /:station:([1-9])-(\d{6,9})$/.exec(String(externalId ?? ''));
  return match ? { slot: Number(match[1]), eva: match[2] } : undefined;
}

const sensor = (feature) => ({
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...feature,
});

/** The name of the device: "DB Köln Hbf", with its filters when any. */
export function deviceName(station) {
  const filters = [station.lines.join(', '), station.via ? `→ ${station.via}` : '']
    .filter(Boolean)
    .join(' ');
  return clean(`DB ${station.name}${filters ? ` (${filters})` : ''}`, 60);
}

export function buildDevice(gladys, station, language = 'en') {
  const ids = idsOf(gladys, station);
  return {
    name: deviceName(station),
    external_id: ids.device,
    should_poll: false,
    params: [
      { name: 'DB_EVA', value: station.eva },
      { name: 'DB_SLOT', value: String(station.slot) },
    ],
    features: [
      sensor({
        name: t('featureNext', language),
        external_id: ids.feature(FEATURE.NEXT),
        category: DEVICE_FEATURE_CATEGORIES.TEXT,
        type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
        keep_history: false,
        min: 0,
        max: 0,
      }),
      sensor({
        name: t('featureNextIn', language),
        external_id: ids.feature(FEATURE.NEXT_IN),
        category: DEVICE_FEATURE_CATEGORIES.DURATION,
        type: DEVICE_FEATURE_TYPES.DURATION.INTEGER,
        unit: DEVICE_FEATURE_UNITS.MINUTES,
        keep_history: false,
        min: 0,
        max: LOOKAHEAD_MINUTES.max,
      }),
      sensor({
        name: t('featureDelay', language),
        external_id: ids.feature(FEATURE.DELAY),
        category: DEVICE_FEATURE_CATEGORIES.DURATION,
        type: DEVICE_FEATURE_TYPES.DURATION.INTEGER,
        unit: DEVICE_FEATURE_UNITS.MINUTES,
        min: 0,
        max: MAX_DELAY_MINUTES,
      }),
      sensor({
        name: t('featureDisrupted', language),
        external_id: ids.feature(FEATURE.DISRUPTED),
        category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
        type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
        min: 0,
        max: MAX_COUNT,
      }),
    ],
  };
}

const bound = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** "14:05 RE 5 → Koblenz Hbf, pl. 3, +4 min" (the shown time is the planned one). */
export function describe(departure, { live, language = 'en' }) {
  const head = `${clock(departure.planned)} ${departure.line}${departure.destination ? ` → ${departure.destination}` : ''}`;
  const parts = [head];
  if (departure.platform) {
    parts.push(
      `${t('platform', language)} ${departure.platform}${
        departure.platformChanged ? ` ${t('insteadOf', language)} ${departure.plannedPlatform}` : ''
      }`,
    );
  }
  if (!live) {
    parts.push(t('noLive', language));
  } else if (departure.cancelled) {
    parts.push(t('cancelled', language));
  } else if (!departure.liveKnown) {
    parts.push(t('noLiveTrain', language));
  } else {
    const delay = delayOf(departure);
    parts.push(delay > 0 ? `+${delay} min` : t('onTime', language));
  }
  return bound(parts.join(', '), MAX_TEXT);
}

/**
 * The states of a board. Only what is known: no next departure leaves
 * `next_in` and `delay` unpublished (never a 0 for "none"), no live data
 * leaves `delay` and `disrupted` unpublished.
 */
export function statesOf(gladys, station, board, { language, lookaheadMinutes }) {
  const ids = idsOf(gladys, station);
  const states = [];
  const text = board.next
    ? describe(board.next, { live: board.live, language })
    : t('none', language, { minutes: lookaheadMinutes });
  states.push({ device_feature_external_id: ids.feature(FEATURE.NEXT), text });
  if (board.nextIn !== undefined) {
    states.push({ device_feature_external_id: ids.feature(FEATURE.NEXT_IN), state: board.nextIn });
  }
  if (board.delay !== undefined) {
    states.push({ device_feature_external_id: ids.feature(FEATURE.DELAY), state: board.delay });
  }
  if (board.disrupted !== undefined) {
    states.push({
      device_feature_external_id: ids.feature(FEATURE.DISRUPTED),
      state: board.disrupted,
    });
  }
  return states;
}
