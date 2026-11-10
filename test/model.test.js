import { test } from 'node:test';
import assert from 'node:assert/strict';
import { XmlError, decodeEntities, parseXml } from '../src/db/xml.js';
import {
  ShapeError,
  departuresOf,
  lineOf,
  parseStations,
  parseTimetable,
} from '../src/db/model.js';
import { buildBoard, matches } from '../src/board.js';
import { EVA, NOW, STATIONS, changesXml, planXml, stationsXml } from './fixtures/db.js';

const MINUTE = 60_000;
const plan14 = () => parseTimetable(planXml(EVA, '261110', '14'));
const plan15 = () => parseTimetable(planXml(EVA, '261110', '15'));

test('xml: elements, attributes, entities; nothing else', () => {
  const root = parseXml(
    '<?xml version="1.0"?><!-- c --><a x="1" y=\'&amp;&lt;&#252;&#x4e;\'><b/><c z="2"></c></a>',
  );
  assert.equal(root.name, 'a');
  assert.equal(root.attrs.y, '&<üN');
  assert.deepEqual(
    root.children.map((c) => c.name),
    ['b', 'c'],
  );
  assert.equal(decodeEntities('&unknown; &#0; &#xD800;'), '&unknown;  ');
  for (const bad of [
    '',
    '<a>',
    '<a></b>',
    '<a x=1/>',
    '<a x="1"y="2"/>',
    '<!DOCTYPE a><a/>',
    '<a/><b/>',
    '<a x="<"/>',
    'plain text',
  ]) {
    assert.throws(() => parseXml(bad), XmlError, bad);
  }
  assert.throws(() => parseXml(`<a>${'<b/>'.repeat(20)}</a>`, { maxElements: 10 }), /too many/);
});

test('xml: prototype keys stay plain attributes', () => {
  const root = parseXml('<a __proto__="x" constructor="y" hasOwnProperty="z"/>');
  assert.equal(Object.getPrototypeOf(root.attrs), null);
  assert.equal(root.attrs.__proto__, 'x');
  assert.equal({}.polluted, undefined);
});

test('xml: linear on a hostile answer (no backtracking)', () => {
  const big = `<a ${'x'.repeat(200000)}`;
  const started = performance.now();
  assert.throws(() => parseXml(big), XmlError);
  assert.ok(performance.now() - started < 1000);
});

test('stations: name, EVA, DS100; a list of something else is refused', () => {
  const list = parseStations(stationsXml(STATIONS));
  assert.deepEqual(list[0], { eva: EVA, name: 'Köln Hbf', ds100: 'KK' });
  assert.equal(parseStations('<stations><station name="x" eva="12"/></stations>').length, 0);
  assert.throws(() => parseStations('<timetable/>'), ShapeError);
  assert.deepEqual(parseStations('<stations/>'), []);
});

test('timetable: stops by id; departures merged with the live changes', () => {
  const plan = plan14();
  assert.equal(plan.size, 4);
  assert.throws(() => parseTimetable('<stations/>'), ShapeError);
  const changes = parseTimetable(changesXml());
  const deps = departuresOf([plan], changes);
  // The RB ends here: no departure.
  assert.deepEqual(
    deps.map((d) => d.line),
    ['RE 5', 'ICE 514', 'S 12'],
  );
  const [re5, ice, s12] = deps;
  assert.equal(re5.planned, Date.UTC(2026, 10, 10, 13, 5));
  assert.equal(re5.time, Date.UTC(2026, 10, 10, 13, 9));
  assert.equal(re5.platform, '4');
  assert.equal(re5.platformChanged, true);
  assert.equal(re5.destination, 'Koblenz Hbf');
  assert.equal(ice.destination, 'München Hbf');
  assert.equal(ice.changed, false);
  assert.equal(s12.cancelled, true);
  // Without changes: the plan only.
  assert.equal(departuresOf([plan], undefined)[0].time, re5.planned);
});

test('timetable: an added train, a hidden stop, an unreadable changed time', () => {
  const plan = parseTimetable(
    planXml(EVA, '261110', '14', {
      extra: '<s id="hid-1"><tl c="RE" n="1"/><dp pt="2611101430" hi="1" l="9" ppth="X"/></s>',
    }),
  );
  const changes = parseTimetable(
    changesXml([
      '<s id="add-1"><tl c="IC" n="2020"/><dp pt="2611101415" ps="a" pp="7" ppth="Mainz Hbf"/></s>',
      '<s id="orphan"><dp ct="2611101416"/></s>',
      '<s id="ice-26111014"><dp ct="garbage"/></s>',
    ]),
  );
  const deps = departuresOf([plan], changes);
  assert.ok(!deps.some((d) => d.id === 'hid-1'), 'hidden');
  assert.ok(!deps.some((d) => d.id === 'orphan'), 'a change without its train');
  const added = deps.find((d) => d.id === 'add-1');
  assert.equal(added.line, 'IC 2020');
  assert.equal(added.added, true);
  const ice = deps.find((d) => d.id === 'ice-26111014');
  assert.equal(ice.time, ice.planned, 'an unreadable changed time leaves the planned one');
});

test('line labels', () => {
  assert.equal(lineOf({ c: 'ICE', n: '123' }, {}), 'ICE 123');
  assert.equal(lineOf({ c: 'RE', n: '10' }, { l: '5' }), 'RE 5');
  assert.equal(lineOf({ c: 'S', n: '1' }, { l: 'S1' }), 'S1');
  assert.equal(lineOf(undefined, { l: '7' }), '7');
});

test('board: window, filters, next that runs, delay, disrupted from the threshold', () => {
  const changes = parseTimetable(changesXml());
  const deps = departuresOf([plan14(), plan15()], changes);
  const base = { now: NOW, lookaheadMinutes: 60, thresholdMinutes: 4, live: true, filter: {} };
  const board = buildBoard(deps, base);
  assert.equal(board.next.line, 'RE 5');
  assert.equal(board.nextIn, 7);
  assert.equal(board.delay, 4);
  assert.equal(board.disrupted, 2, 'the cancelled S 12 and the RE 5 4 min late');
  assert.equal(buildBoard(deps, { ...base, thresholdMinutes: 5 }).disrupted, 1);
  // 15:05 is past the window of 60 minutes from 14:02.
  assert.ok(board.rows.every((d) => d.planned <= NOW + 60 * MINUTE));
  const ice = buildBoard(deps, { ...base, filter: { lines: ['ICE'] } });
  assert.equal(ice.next.line, 'ICE 514');
  assert.equal(ice.delay, undefined, 'the ICE is not in /fchg: its delay is unknown');
  assert.equal(
    buildBoard(deps, { ...base, filter: { lines: ['S12'] } }).next,
    undefined,
    'only a cancelled train',
  );
  assert.equal(buildBoard(deps, { ...base, filter: { via: 'remagen' } }).next.line, 'RE 5');
  // Without live data: no delay, no count.
  const plan = buildBoard(departuresOf([plan14(), plan15()]), { ...base, live: false });
  assert.equal(plan.delay, undefined);
  assert.equal(plan.disrupted, undefined);
  assert.equal(plan.nextIn, 3);
  // A delayed train stays until it leaves.
  const later = buildBoard(deps, { ...base, now: NOW + 5 * MINUTE });
  assert.equal(later.next.line, 'RE 5');
  assert.equal(later.nextIn, 2);
  // Nothing in the window.
  const empty = buildBoard([], base);
  assert.equal(empty.next, undefined);
  assert.equal(empty.nextIn, undefined);
  assert.equal(empty.delay, undefined);
  assert.equal(empty.disrupted, undefined, 'nothing live in the window: no count');
});

test('board: filters on categories and lines without spaces', () => {
  const d = { line: 'RE 5', category: 'RE', path: ['Bonn Hbf', 'Koblenz Hbf'] };
  assert.ok(matches(d, { lines: ['RE5'] }));
  assert.ok(matches(d, { lines: ['RE'] }));
  assert.ok(!matches(d, { lines: ['RE50'] }));
  assert.ok(matches(d, { via: 'kob' }));
  assert.ok(!matches(d, { via: 'mainz' }));
});

test('board: no delay nor count when the live data is stale, whatever the departures hold', () => {
  const deps = departuresOf([plan14(), plan15()], parseTimetable(changesXml()));
  const board = buildBoard(deps, {
    now: NOW,
    lookaheadMinutes: 60,
    thresholdMinutes: 5,
    live: false,
    filter: {},
  });
  assert.equal(board.delay, undefined);
  assert.equal(board.disrupted, undefined);
});
