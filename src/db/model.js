// -----------------------------------------------------------------------------
// The Timetables answers -> plain values (pure). Attribute names of the API:
//   <s id>      a stop of a trip at the station (the same id in plan and fchg)
//   <tl c n o>  trip label: category (ICE, RE, S), number, owner
//   <dp ...>    the departure: pt/ct planned/changed time, pp/cp platform,
//               ppth/cpth path ("A|B|C", the stations after this one),
//               ps/cs planned/changed status (p planned, a added, c cancelled),
//               l line, hi="1" hidden (not for travellers)
// A change of fchg replaces the planned value it names; a stop of fchg that
// the plan does not hold (an added train) counts only with its own trip label
// and planned time.
// -----------------------------------------------------------------------------

import { MAX_ELEMENTS } from '../constants.js';
import { parseDbTime } from '../time.js';
import { parseXml } from './xml.js';

export class ShapeError extends Error {
  constructor(reason) {
    super(`Unexpected answer (${reason})`);
    this.name = 'ShapeError';
  }
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/** A text of DB made safe to show: no control character, bounded. */
export function clean(value, max = 100) {
  if (typeof value !== 'string') {
    return '';
  }
  const text = value.replace(CONTROL, '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const EVA = /^\d{6,9}$/;
const STOP_ID = /^[-0-9A-Za-z_]{1,100}$/;

export function parseStations(text) {
  const root = parseXml(text, { maxElements: MAX_ELEMENTS });
  if (root.name !== 'stations') {
    throw new ShapeError('not a station list');
  }
  const out = [];
  for (const node of root.children) {
    if (node.name !== 'station' || !EVA.test(node.attrs.eva ?? '')) {
      continue;
    }
    const name = clean(node.attrs.name, 80);
    if (!name) continue;
    out.push({ eva: node.attrs.eva, name, ds100: clean(node.attrs.ds100, 10) });
    if (out.length >= 100) break;
  }
  return out;
}

const child = (node, name) => node.children.find((c) => c.name === name);

function event(node) {
  if (!node) return undefined;
  const a = node.attrs;
  return {
    pt: a.pt,
    ct: a.ct,
    pp: a.pp,
    cp: a.cp,
    ppth: a.ppth,
    cpth: a.cpth,
    ps: a.ps,
    cs: a.cs,
    l: a.l,
    hi: a.hi,
  };
}

/** A timetable (plan or fchg) -> Map(stop id -> { tl, dp }). */
export function parseTimetable(text) {
  const root = parseXml(text, { maxElements: MAX_ELEMENTS });
  if (root.name !== 'timetable') {
    throw new ShapeError('not a timetable');
  }
  const stops = new Map();
  for (const node of root.children) {
    if (node.name !== 's' || !STOP_ID.test(node.attrs.id ?? '') || stops.has(node.attrs.id)) {
      continue;
    }
    const tl = child(node, 'tl');
    stops.set(node.attrs.id, {
      tl: tl ? { c: tl.attrs.c, n: tl.attrs.n, o: tl.attrs.o } : undefined,
      dp: event(child(node, 'dp')),
    });
  }
  return stops;
}

const pick = (change, planned) => (change !== undefined && change !== '' ? change : planned);

/** The line label: "ICE 1234", "RE 5", "S 1". */
export function lineOf(tl, dp) {
  const category = clean(tl?.c ?? '', 8);
  const line = clean(dp?.l ?? '', 12);
  const number = clean(tl?.n ?? '', 12);
  if (line) {
    return line.toUpperCase().startsWith(category.toUpperCase()) || !category
      ? line
      : `${category} ${line}`;
  }
  return [category, number].filter(Boolean).join(' ');
}

const pathOf = (value) =>
  typeof value === 'string' && value
    ? value
        .split('|')
        .map((s) => clean(s, 60))
        .filter(Boolean)
    : [];

/**
 * The departures of the planned stops, with the changes applied. A stop
 * without departure (the train ends here), hidden or without a readable
 * planned time is left out.
 * @param {Map[]} plans - The planned slices (Maps of parseTimetable).
 * @param {Map|undefined} changes - fchg, when read.
 */
export function departuresOf(plans, changes) {
  const out = [];
  const seen = new Set();
  const add = (id, base, change) => {
    const dp = base.dp;
    const c = change?.dp;
    if (!dp && !c) return;
    const planned = parseDbTime(dp?.pt ?? c?.pt);
    if (planned === undefined) return;
    const changedTime = c?.ct !== undefined ? parseDbTime(c.ct) : parseDbTime(dp?.ct ?? '');
    const status = pick(c?.cs, pick(dp?.cs, pick(c?.ps, dp?.ps)));
    const hidden = pick(c?.hi, dp?.hi) === '1';
    if (hidden) return;
    const path = pathOf(pick(c?.cpth, pick(dp?.cpth, dp?.ppth ?? c?.ppth)));
    const plannedPlatform = clean(dp?.pp ?? c?.pp ?? '', 8);
    const platform = clean(pick(c?.cp, pick(dp?.cp, plannedPlatform)), 8);
    const tl = base.tl ?? change?.tl;
    seen.add(id);
    out.push({
      id,
      planned,
      // A changed time that is unreadable leaves the planned one.
      time: changedTime ?? planned,
      changed: changedTime !== undefined,
      cancelled: status === 'c',
      added: status === 'a',
      line: lineOf(tl, { l: pick(c?.l, dp?.l) }),
      category: clean(tl?.c ?? '', 8),
      destination: path.at(-1) ?? '',
      path,
      platform,
      plannedPlatform,
      platformChanged: Boolean(platform && plannedPlatform && platform !== plannedPlatform),
    });
  };
  for (const plan of plans) {
    for (const [id, stop] of plan) {
      if (!seen.has(id)) add(id, stop, changes?.get(id));
    }
  }
  if (changes) {
    for (const [id, change] of changes) {
      // An added train: only with its own label and planned departure.
      if (!seen.has(id) && change.tl?.c && change.dp?.pt) add(id, { tl: change.tl }, change);
    }
  }
  return out.sort((a, b) => a.time - b.time || a.planned - b.planned);
}
