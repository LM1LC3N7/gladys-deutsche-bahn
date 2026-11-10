// -----------------------------------------------------------------------------
// The points of review r1: late trains of the hour before, the widget within
// the core's budget with its attribution, a window without any plan, a train
// without live data, /data unreadable at start, the time of the attempt saved
// before the first request, credentials sharing a refused tag, a stop while
// the config is read, an unparsable /data, the autumn hour, the minute tick,
// and the guards the mutants found without a test.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tagOf, validPause } from '../src/app.js';
import { clean, departuresOf, parseTimetable } from '../src/db/model.js';
import { FileStore, createMemoryStore } from '../src/store.js';
import { CLIENT_ID, EVA, NOW, changesXml, defaultChanges, planXml, xml } from './fixtures/db.js';
import {
  CONFIG,
  DEVICE,
  F,
  MINUTE,
  SECOND,
  createFakeClock,
  settle,
  setup,
} from './helpers/app.js';

const text = (m) => m?.en ?? '';
const fchg = (s) => s.db.count('/fchg/');
const LATE =
  '<s id="late-1"><tl c="RE" n="999"/><dp pt="2611101358" pp="2" l="1" ppth="Aachen Hbf"/></s>';

test('I1: a train of the hour before, late, is the next departure', async () => {
  const s = await setup();
  s.db.override = (path) =>
    path === '/plan/8000207/261110/13'
      ? xml(planXml(EVA, '261110', '13', { extra: LATE }))
      : undefined;
  s.db.changes[EVA] = [...defaultChanges(), '<s id="late-1"><dp ct="2611101407"/></s>'];
  await s.run();
  assert.equal(s.db.count('/plan/8000207/261110/13'), 1);
  assert.equal(s.last(F('next')), '13:58 RE 1 → Aachen Hbf, pl. 2, +9 min');
  assert.equal(s.last(F('next_in')), 4);
  assert.equal(s.last(F('delay')), 9);
  assert.equal(s.last(F('disrupted')), 2, 'the S 12 cancelled, the RE 1 9 min late');
  await s.app.stop();
});

/** The core keeps 8 components, 2 texts, 1 body, 1 status (WIDGET_CONTENT_BUDGET). */
function withinBudget(content) {
  const texts = content.components.filter((c) => c.type === 'text');
  assert.ok(content.components.length <= 8);
  assert.ok(texts.length <= 2, `${texts.length} texts`);
  assert.ok(texts.filter((c) => (c.variant ?? 'body') === 'body').length <= 1, 'one body');
  assert.ok(content.components.filter((c) => c.type === 'status').length <= 1);
  for (const c of texts) {
    const max = { heading: 40, caption: 80 }[c.variant] ?? 300;
    assert.ok(c.text.length <= max, c.text);
  }
}

test('I2: every variant of the widget fits the core budget; the data ones keep CC BY 4.0', async () => {
  const s = await setup();
  await s.run();
  const full = s.app.getWidget({ settings: { station: DEVICE() } });
  withinBudget(full);
  assert.match(JSON.stringify(full), /CC BY 4\.0/);
  assert.ok(full.components.find((c) => c.type === 'status').items.length <= 8);
  await s.gladys.fake.configUpdated({ ...CONFIG, lines_1: 'ICE 999' });
  await s.advance(SECOND);
  const empty = s.app.getWidget({ settings: { station: DEVICE() }, language: 'fr' });
  withinBudget(empty);
  assert.match(JSON.stringify(empty), /Aucun départ.*CC BY 4\.0/);
  withinBudget(s.app.getWidget({ settings: { station: 'ext:deutsche-bahn:station:3-1234567' } }));
  s.app.slots[0].plans.clear();
  withinBudget(s.app.getWidget({ settings: { station: DEVICE() } }));
  await s.app.stop();
});

test('I2: the widget shows 8 departures at most', async () => {
  const s = await setup({ config: { ...CONFIG, lookahead_minutes: 180 } });
  await s.run();
  const content = s.app.getWidget({ settings: { station: DEVICE() } });
  assert.equal(content.components.find((c) => c.type === 'status').items.length, 8);
  await s.app.stop();
});

test('I3: no plan for the current hour nor the next ones: nothing published, not connected', async () => {
  const s = await setup();
  s.db.override = (path) =>
    path.startsWith('/plan/') ? new Response('', { status: 404 }) : undefined;
  await s.run();
  assert.equal(s.gladys.fake.states.length, 0);
  assert.equal(s.status().connected, false);
  assert.match(text(s.status().message), /Station 1: DB has no timetable for it/);
  await s.app.stop();
});

test('I3: a 404 for a later hour only is an empty hour', async () => {
  const s = await setup();
  s.db.override = (path) =>
    path.endsWith('/261110/15') ? new Response('', { status: 404 }) : undefined;
  await s.run();
  assert.equal(s.status().connected, true);
  assert.ok(s.last(F('next')));
  await s.app.stop();
});

test('I8: a train absent from a fresh /fchg is on time (delay 0); a stale /fchg tells nothing', async () => {
  const s = await setup({ config: { ...CONFIG, lines_1: 'ICE' } });
  await s.run();
  assert.equal(s.last(F('next')), '14:20 ICE 514 → München Hbf, pl. 5, on time');
  assert.equal(s.last(F('delay')), 0);
  assert.equal(s.last(F('disrupted')), 0);
  assert.equal(s.last(F('next_in')), 17);
  const widget = s.app.getWidget({ settings: { station: DEVICE() } });
  assert.equal(widget.components[1].items[0].value, 'on time · pl. 5');
  // The live data goes stale: "timetable only", no delay published any more.
  s.db.override = (path) => (path.startsWith('/fchg/') ? 'timeout' : undefined);
  const delays = s.states(F('delay')).length;
  await s.advance(20 * MINUTE);
  assert.match(s.last(F('next')), /timetable only$/);
  assert.equal(s.states(F('delay')).length, delays);
  await s.app.stop();
});

test('I6: /data unreadable at start: a whole interval first; read late, its pause wins', async () => {
  const store = createMemoryStore({
    lastRound: NOW - 10 * SECOND,
    pause: { until: NOW + 30 * MINUTE, count: 1, code: 'rate_limited', status: 429 },
  });
  store.unreadable = true;
  const s = await setup({ store });
  await s.run(SECOND);
  await s.advance(15 * SECOND);
  assert.equal(s.db.calls.length, 0, 'nothing before the interval');
  store.unreadable = false;
  await s.advance(10 * SECOND);
  assert.ok(s.app.pauseActive(), 'the pause of /data adopted');
  await s.advance(3 * MINUTE);
  assert.equal(s.db.calls.length, 0, 'and kept: the round placed again');
  await s.advance(28 * MINUTE);
  assert.ok(fchg(s) >= 1);
  await s.app.stop();
});

test('I7: the time of the attempt is in /data before the first request; a restart keeps the pace', async () => {
  const store = createMemoryStore();
  const db = (await import('./fixtures/db.js')).createDb();
  const seen = [];
  const save = store.save;
  store.save = async (data) => {
    seen.push({ calls: db.calls.length, lastRound: data.lastRound });
    return save(data);
  };
  const s = await setup({ store, db });
  await s.run();
  assert.equal(seen[0].calls, 0);
  assert.equal(seen[0].lastRound, NOW);
  // The process dies right after the first request: the next one waits.
  const again = await setup({ store, clock: createFakeClock(NOW + 20 * SECOND) });
  await again.run(SECOND);
  await again.advance(MINUTE);
  assert.equal(again.db.calls.length, 0);
  await again.advance(MINUTE);
  assert.equal(fchg(again), 1);
  await s.app.stop();
  await again.app.stop();
});

test('m1: other credentials in the same process are tried even when their tag collides', async () => {
  const s = await setup();
  s.db.override = () => new Response('', { status: 401 });
  await s.run();
  assert.ok(s.app.isRefused());
  const { salt, tag } = s.app.refused;
  let key;
  for (let i = 0; !key; i += 1) {
    if (tagOf(salt, CLIENT_ID, `Other${i}`) === tag) key = `Other${i}`;
  }
  s.db.override = undefined;
  await s.gladys.fake.configUpdated({ ...CONFIG, api_key: key });
  await s.advance(MINUTE);
  assert.equal(fchg(s), 1);
  await s.app.stop();
});

test('m2: a stop while getConfig() waits: nothing starts after it', async () => {
  const s = await setup();
  let give;
  s.gladys.getConfig = () => new Promise((resolve) => (give = resolve));
  const started = s.app.connected();
  await s.app.stop();
  give(CONFIG);
  await started;
  await s.advance(10 * MINUTE);
  assert.equal(s.db.calls.length, 0);
  assert.equal(s.timers.pending.size, 0);
});

test('m3: an unparsable /data file is set aside as .bad, never overwritten in place', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dbahn-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new FileStore({ dir });
  await writeFile(join(dir, 'deutsche-bahn.json'), '{"refused": {"salt"');
  assert.deepEqual(await store.load(), {});
  assert.equal(await readFile(join(dir, 'deutsche-bahn.json.bad'), 'utf8'), '{"refused": {"salt"');
  await store.save({ a: 1 });
  assert.deepEqual(await store.load(), { a: 1 });
  await assert.rejects(access(join(dir, 'deutsche-bahn.json.tmp')));
});

test('m4: the hour repeated in autumn publishes nothing; the hour before and after are read', async () => {
  // 25 October 2026, 02:20 winter time (the second 02:20) = 01:20 UTC.
  const s = await setup({ start: Date.UTC(2026, 9, 25, 1, 20) });
  await s.run();
  assert.equal(s.gladys.fake.states.length, 0);
  assert.match(text(s.status().message), /hour repeated by the change of time/);
  await s.advance(45 * MINUTE);
  assert.ok(s.last(F('next')), 'published again from 03:00');
  await s.app.stop();
});

test('m4: at midnight, the hours of the next German day are asked', async () => {
  // 23:50 in Germany = 22:50 UTC.
  const s = await setup({ start: Date.UTC(2026, 10, 10, 22, 50) });
  await s.run();
  const plans = s.db.calls.filter((c) => c.path.startsWith('/plan/')).map((c) => c.path);
  assert.deepEqual(plans, [
    '/plan/8000207/261110/21',
    '/plan/8000207/261110/22',
    '/plan/8000207/261110/23',
    '/plan/8000207/261111/00',
  ]);
  assert.match(s.last(F('next')), /^00:05 RE 5/);
  await s.app.stop();
});

test('m5: next_in moves every minute between two rounds, without a request', async () => {
  const s = await setup({ config: { ...CONFIG, poll_minutes: 10 } });
  await s.run();
  const calls = s.db.calls.length;
  const before = s.last(F('next_in'));
  await s.advance(3 * MINUTE);
  assert.equal(s.db.calls.length, calls);
  assert.ok(
    [before - 2, before - 3].includes(s.last(F('next_in'))),
    `${before} -> ${s.last(F('next_in'))}`,
  );
  await s.app.stop();
});

test('m8: a planned hour older than 6 h is not used (reads failing for long)', async () => {
  const s = await setup();
  await s.run();
  for (const plan of s.app.slots[0].plans.values()) plan.at -= 7 * 3600 * SECOND;
  assert.equal(s.app.boardOf(s.app.slots[0]), undefined);
  await s.app.stop();
});

test('m8: the boards of an old generation are not published', async () => {
  const s = await setup();
  await s.run();
  const states = s.gladys.fake.states.length;
  s.app.gladys.forgetPublishedStates();
  await s.app.publishBoards(s.app.gen - 1);
  assert.equal(s.gladys.fake.states.length, states);
  await s.app.stop();
});

test('m8: texts of DB without control characters; an added train needs its own label', async () => {
  assert.equal(clean('a\u0000b\u001bc\u007fd\r\ne'), 'abcde');
  const changes = parseTimetable(
    changesXml(['<s id="add-2"><dp pt="2611101415" ps="a" ppth="Mainz Hbf"/></s>']),
  );
  assert.equal(departuresOf([new Map()], changes).length, 0);
});

test('m8: a pause count read back is capped at 16', () => {
  const pause = validPause({ until: NOW + MINUTE, count: 99, code: 'server', status: 503 }, NOW, 0);
  assert.equal(pause.count, 16);
});

test('a round settles in the background without leaving timers after stop', async () => {
  const s = await setup();
  await s.run();
  await settle();
  await s.app.stop();
  assert.equal(s.timers.pending.size, 0);
});

test('m1: a refusal kept in /data covers those credentials only: other ones are read after a restart', async () => {
  const store = createMemoryStore();
  const s = await setup({ store });
  s.db.override = () => new Response('', { status: 401 });
  await s.run();
  await s.app.stop();
  assert.ok(store.data.refused);
  const again = await setup({
    store,
    clock: createFakeClock(NOW + 10 * MINUTE),
    config: { ...CONFIG, api_key: 'AnotherKey' },
  });
  await again.run(MINUTE);
  assert.equal(fchg(again), 1);
  await again.app.stop();
});

test('I6: /data read late and its last round long ago: the round comes at once, not an interval later', async () => {
  const store = createMemoryStore({ lastRound: NOW - 3600 * SECOND });
  store.unreadable = true;
  const s = await setup({ store });
  await s.run(SECOND);
  store.unreadable = false;
  await s.advance(20 * SECOND);
  assert.equal(fchg(s), 1);
  await s.app.stop();
});

test('n1: the Retry-After of a 5xx on one station is honoured beyond 30 min (6 h at most)', async () => {
  const s = await setup({ config: { ...CONFIG, station_2: 'FF' } });
  s.db.override = (path) =>
    path === '/fchg/8000105'
      ? new Response('', { status: 503, headers: { 'retry-after': '3600' } })
      : undefined;
  await s.run(30 * SECOND);
  await s.advance(59 * MINUTE);
  assert.equal(s.db.count('/fchg/8000105'), 1, 'one try in the hour asked');
  await s.advance(3 * MINUTE);
  assert.equal(s.db.count('/fchg/8000105'), 2);
  await s.app.stop();
});

test('n3: valid JSON that is not an object is set aside as .bad too', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dbahn-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new FileStore({ dir });
  await writeFile(join(dir, 'deutsche-bahn.json'), '[1, 2]');
  assert.deepEqual(await store.load(), {});
  assert.equal(await readFile(join(dir, 'deutsche-bahn.json.bad'), 'utf8'), '[1, 2]');
});

test('n2: a train planned two hours before and late still shows', async () => {
  const s = await setup({ config: { ...CONFIG, lines_1: 'RE 7' } });
  const extra =
    '<s id="very-late"><tl c="RE" n="7777"/><dp pt="2611101250" pp="6" l="7" ppth="Krefeld Hbf"/></s>';
  s.db.override = (path) =>
    path === '/plan/8000207/261110/12' ? xml(planXml(EVA, '261110', '12', { extra })) : undefined;
  s.db.changes[EVA] = [...defaultChanges(), '<s id="very-late"><dp ct="2611101410"/></s>'];
  await s.run();
  assert.equal(s.last(F('next')), '12:50 RE 7 → Krefeld Hbf, pl. 6, +80 min');
  await s.app.stop();
});
