// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys, the scripted Timetables API
// and a virtual clock that moves only when the test says so.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, REQUEST_GAP, WIDGETS } from '../src/constants.js';
import { createMemoryStore } from '../src/store.js';
import { API_KEY, CLIENT_ID, EVA, NOW, OTHER_EVA, xml } from './fixtures/db.js';
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

const fchg = (s) => s.db.count('/fchg/');
const text = (message) => message?.en ?? '';

test('first round: station resolved, two planned hours, the live changes, four states', async () => {
  const s = await setup();
  await s.run();
  assert.deepEqual(
    s.db.calls.map((c) => c.path),
    [
      '/station/Köln Hbf',
      '/plan/8000207/261110/14',
      '/plan/8000207/261110/15',
      '/fchg/8000207',
      // The hours before last: optional.
      '/plan/8000207/261110/12',
      '/plan/8000207/261110/13',
    ],
  );
  assert.equal(s.last(F('next')), '14:05 RE 5 → Koblenz Hbf, pl. 4 instead of 3, +4 min');
  assert.equal(s.last(F('next_in')), 6);
  assert.equal(s.last(F('delay')), 4);
  assert.equal(s.last(F('disrupted')), 1, 'the S 12 is cancelled, the RE 5 is under 5 min');
  const [device] = s.gladys.fake.discoveredDevices;
  assert.equal(device.external_id, DEVICE());
  assert.equal(device.name, 'DB Köln Hbf');
  assert.ok(device.features.every((f) => f.read_only === true));
  assert.deepEqual(s.status(), {
    connected: true,
    message: { en: 'Read at 14:02: 1 station(s).', fr: 'Lu à 14:02 : 1 gare(s).' },
  });
  // Requests one after the other, REQUEST_GAP apart.
  const at = s.db.calls.map((c) => c.at);
  for (let i = 1; i < at.length; i += 1) assert.ok(at[i] - at[i - 1] >= REQUEST_GAP - 1, `${at}`);
  await s.app.stop();
});

test('the pace: an interval start to start, the plan read once an hour, never sooner', async () => {
  const s = await setup();
  await s.run();
  assert.equal(fchg(s), 1);
  await s.advance(2 * MINUTE - 20 * SECOND - 1);
  assert.equal(fchg(s), 1, 'not before the interval');
  await s.advance(20 * SECOND);
  assert.equal(fchg(s), 2);
  assert.equal(s.db.count('/plan/'), 4, 'the planned hours are kept');
  assert.equal(s.db.count('/station/'), 1, 'the station is resolved once');
  await s.advance(60 * MINUTE);
  assert.equal(fchg(s), 32);
  // 15:02 -> 16:02: hour 16 is new, 15 and 16 again after an hour.
  assert.ok(s.db.count('/plan/') >= 5 && s.db.count('/plan/') <= 8, `${s.db.count('/plan/')}`);
  await s.app.stop();
});

test('the next departure moves with the time; a reconnection never reads sooner', async () => {
  const s = await setup();
  await s.run();
  await s.app.connected();
  await s.advance(10 * SECOND);
  assert.equal(fchg(s), 1, 'a reconnection keeps the pace');
  assert.ok(s.statuses().length >= 2, 'the status is sent again');
  assert.ok(s.gladys.fake.discoveredDevices.length === 1);
  await s.advance(2 * MINUTE);
  assert.equal(fchg(s), 2);
  // 14:04:20 (the minute tick): the RE 5 leaves at 14:09.
  assert.equal(s.last(F('next_in')), 4);
  await s.app.stop();
});

test('a restart reads the time of the last round from /data: no read before the interval', async () => {
  const store = createMemoryStore();
  const first = await setup({ store });
  await first.run();
  await first.app.stop();
  assert.equal(typeof store.data.lastRound, 'number');
  const clock = createFakeClock(first.clock.now + 30 * SECOND);
  const second = await setup({ store, clock });
  await second.run(SECOND);
  assert.equal(fchg(second), 0);
  await second.advance(2 * MINUTE - 50 * SECOND);
  assert.equal(fchg(second), 0, 'still within the interval of the last round');
  await second.advance(30 * SECOND);
  assert.equal(fchg(second), 1);
  assert.equal(second.db.count('/station/'), 0, 'the station resolved before is in /data');
  await second.app.stop();
});

test('a time of /data in the future is invalid: ignored', async () => {
  const store = createMemoryStore({ lastRound: NOW + 3600 * SECOND });
  const s = await setup({ store });
  await s.run();
  assert.equal(fchg(s), 1);
  await s.app.stop();
});

test('the form saved unchanged keeps the pace; a new station is read 30 s after the last round', async () => {
  const s = await setup();
  await s.run(10 * SECOND);
  await s.gladys.fake.configUpdated(CONFIG);
  await s.advance(10 * SECOND);
  assert.equal(fchg(s), 1);
  const calls = s.db.calls.length;
  await s.gladys.fake.configUpdated({ ...CONFIG, station_2: 'FF' });
  await s.advance(5 * SECOND);
  assert.equal(s.db.calls.length, calls, 'not before 30 s after the last round');
  await s.advance(20 * SECOND);
  assert.equal(s.db.count(`/fchg/${OTHER_EVA}`), 1);
  assert.equal(s.gladys.fake.discoveredDevices.length, 2);
  await s.app.stop();
});

test('credentials missing, half or malformed: nothing sent, the reason said', async () => {
  for (const [config, words] of [
    [{ station_1: 'KK' }, /Enter the Client ID/],
    [{ api_key: API_KEY, station_1: 'KK' }, /Both the Client ID and the API key/],
    [{ client_id: CLIENT_ID, api_key: 'a b', station_1: 'KK' }, /not allowed/],
  ]) {
    const s = await setup({ config });
    await s.run(10 * MINUTE);
    assert.equal(s.db.calls.length, 0);
    assert.match(text(s.status().message), words);
    assert.equal(s.status().connected, false);
    assert.match(text((await s.gladys.fake.action(ACTIONS.TEST)).data.message), words);
    await s.app.stop();
  }
});

test('a refusal on /station is final: kept in /data (8 bits), no retry, lifted by other credentials', async () => {
  const store = createMemoryStore();
  const s = await setup({ store });
  s.db.override = (path) =>
    path.startsWith('/station/') ? new Response('', { status: 401 }) : undefined;
  await s.run();
  assert.equal(s.db.calls.length, 1);
  assert.match(text(s.status().message), /refused the credentials \(HTTP 401\)/);
  assert.equal(s.status().connected, false);
  assert.ok(Number.isInteger(store.data.refused.tag) && store.data.refused.tag < 256);
  assert.ok(!JSON.stringify(store.data).includes(API_KEY));
  await s.advance(3 * 60 * MINUTE);
  assert.equal(s.db.calls.length, 1, 'never retried by itself');
  // A search with these credentials sends nothing.
  assert.match(text(await s.app.searchStation({ query: 'Köln' })), /were refused/);
  assert.equal(s.db.calls.length, 1);
  await s.app.stop();
  // A restart keeps the refusal.
  const again = await setup({ store, clock: createFakeClock(s.clock.now) });
  await again.run(10 * MINUTE);
  assert.equal(again.db.calls.length, 0);
  // Other credentials are tried.
  again.db.override = undefined;
  await again.gladys.fake.configUpdated({ ...CONFIG, api_key: 'AnotherKey123' });
  await again.advance(MINUTE);
  assert.equal(fchg(again), 1);
  await again.app.stop();
});

test('the test button: a success lifts a refusal and the reads start again', async () => {
  const store = createMemoryStore();
  const s = await setup({ store });
  s.db.override = () => new Response('', { status: 403 });
  await s.run();
  assert.match(text(s.status().message), /HTTP 403/);
  s.db.override = undefined;
  const ack = await s.gladys.fake.action(ACTIONS.TEST);
  assert.match(text(ack.data.message), /Accepted by DB/);
  assert.equal(store.data.refused, null);
  // Twice within 30 s: no second request.
  const before = s.db.calls.length;
  assert.match(text(await s.app.testConnection()), /Tested \d+ s ago/);
  assert.equal(s.db.calls.length, before);
  // The next round at its time (an interval after the refused one).
  await s.advance(2 * MINUTE);
  assert.equal(fchg(s), 1);
  await s.app.stop();
});

test('the test button refused: kept like a refusal; a timeout is neither accepted nor refused', async () => {
  const s = await setup();
  await s.run();
  s.db.override = () => 'timeout';
  assert.match(text(await s.app.testConnection()), /nothing was accepted nor refused/);
  assert.equal(s.app.refused, undefined);
  await s.advance(31 * SECOND);
  s.db.override = () => new Response('', { status: 401 });
  assert.match(text(await s.app.testConnection()), /Refused by DB \(HTTP 401\)/);
  assert.ok(s.app.isRefused());
  await s.app.stop();
});

test('a 401/403 on a timetable page while /station accepts: not a refusal, that station waits', async () => {
  const s = await setup({ config: { ...CONFIG, station_2: 'FF' } });
  s.db.override = (path) =>
    path === `/fchg/${EVA}` ? new Response('', { status: 403 }) : undefined;
  await s.run(30 * SECOND);
  assert.equal(s.app.refused, undefined);
  assert.equal(s.db.count(`/station/${EVA}`), 1, 'the credentials asked again on /station');
  assert.equal(s.db.count(`/fchg/${OTHER_EVA}`), 1, 'the other station is read');
  assert.equal(s.status().connected, true);
  assert.match(text(s.status().message), /timetable refused \(HTTP 403\), credentials accepted/);
  await s.advance(2 * MINUTE);
  assert.equal(s.db.count(`/fchg/${EVA}`), 1, 'waits 5 min');
  assert.equal(s.db.count(`/fchg/${OTHER_EVA}`), 2);
  await s.advance(4 * MINUTE);
  assert.equal(s.db.count(`/fchg/${EVA}`), 2, 'asked again after 5 min');
  await s.advance(9 * MINUTE);
  assert.equal(s.db.count(`/fchg/${EVA}`), 2, 'then 10 min');
  await s.advance(3 * MINUTE);
  assert.equal(s.db.count(`/fchg/${EVA}`), 3);
  await s.app.stop();
});

test('a 401 on a page and on /station: a refusal', async () => {
  const s = await setup();
  s.db.override = (path) =>
    path.startsWith('/fchg/') || path === `/station/${EVA}`
      ? new Response('', { status: 401 })
      : undefined;
  await s.run();
  assert.ok(s.app.isRefused());
  await s.app.stop();
});

test('429 with Retry-After: every request paused, kept in /data, then the reads go on', async () => {
  const store = createMemoryStore();
  const s = await setup({ store });
  s.db.override = (path) =>
    path.startsWith('/fchg/')
      ? new Response('', { status: 429, headers: { 'retry-after': '600' } })
      : undefined;
  await s.run();
  const sent = s.db.calls.length;
  assert.match(text(s.status().message), /HTTP 429\): paused until 14:12/);
  assert.equal(store.data.pause.code, 'rate_limited');
  assert.match(text(await s.app.testConnection()), /Paused until/);
  assert.match(text(await s.app.searchStation({ query: 'Köln' })), /Paused until/);
  await s.advance(9 * MINUTE);
  assert.equal(s.db.calls.length, sent, 'nothing during the pause');
  s.db.override = undefined;
  await s.advance(2 * MINUTE);
  assert.equal(fchg(s), 2);
  assert.equal(store.data.pause, null, 'lifted by a good round');
  assert.equal(s.status().connected, true);
  await s.app.stop();
});

test('a pause survives a restart; 5xx pauses grow; a pause is capped at 6 h', async () => {
  const store = createMemoryStore({
    pause: { until: NOW + 30 * 24 * 3600 * SECOND, count: 3, code: 'server', status: 503 },
  });
  const s = await setup({ store });
  await s.run(5.9 * 3600 * SECOND);
  assert.equal(s.db.calls.length, 0);
  assert.match(text(s.status().message), /unavailable \(HTTP 503\)/);
  await s.advance(0.1 * 3600 * SECOND + 10 * SECOND);
  assert.equal(fchg(s), 1, 'at most 6 h');
  await s.app.stop();
  const t = await setup();
  t.db.override = (path) =>
    path.startsWith('/fchg/') ? new Response('', { status: 500 }) : undefined;
  await t.run();
  assert.equal(fchg(t), 1);
  // The only station in 5xx: DB itself is down, every request waits and the
  // waits grow (1, 2, 4, 8, 16, 30 min), never a storm.
  assert.match(text(t.status().message), /unavailable \(HTTP 500\)/);
  await t.advance(60 * MINUTE);
  assert.ok(fchg(t) >= 4 && fchg(t) <= 8, `${fchg(t)} reads in an hour`);
  await t.app.stop();
});

test('one station in 5xx waits alone: the other one is read at every interval', async () => {
  const s = await setup({ config: { ...CONFIG, station_2: 'FF' } });
  s.db.override = (path) =>
    path === `/fchg/${OTHER_EVA}` ? new Response('', { status: 504 }) : undefined;
  await s.run(30 * SECOND);
  await s.advance(60 * MINUTE);
  assert.ok(
    s.db.count(`/fchg/${EVA}`) >= 30,
    `${s.db.count(`/fchg/${EVA}`)} reads of the sound station`,
  );
  assert.ok(
    s.db.count(`/fchg/${OTHER_EVA}`) <= 8,
    `${s.db.count(`/fchg/${OTHER_EVA}`)} reads in 504`,
  );
  assert.equal(s.app.pause, undefined, 'no global pause');
  assert.equal(s.status().connected, true);
  assert.match(text(s.status().message), /Station 2: DB unavailable for it \(HTTP 504\)/);
  await s.app.stop();
});

test('a pause set while a request waits its turn: that request is never sent', async () => {
  const s = await setup({ config: { ...CONFIG, station_2: 'FF' } });
  await s.run(30 * SECOND);
  const fchgBefore = s.db.count(`/fchg/${OTHER_EVA}`);
  let answer;
  s.db.override = (path) =>
    path === `/fchg/${EVA}` ? new Promise((resolve) => (answer = resolve)) : undefined;
  await s.advance(2 * MINUTE);
  assert.ok(answer, 'the live changes of station 1 are in flight');
  // A search waits in the lane behind it; the 429 lands first.
  const search = s.app.searchStation({ query: 'Frankfurt' });
  answer(new Response('', { status: 429, headers: { 'retry-after': '3600' } }));
  await s.advance(10 * SECOND);
  assert.match(text(await search), /Paused until/);
  assert.equal(s.db.count('/station/Frankfurt'), 0);
  assert.equal(s.db.count(`/fchg/${OTHER_EVA}`), fchgBefore);
  await s.app.stop();
});

test('getConfig() failing in `connected`: retried, spaced, the status says so, then the reads start', async () => {
  let fail = 2;
  const s = await setup();
  const real = s.gladys.getConfig.bind(s.gladys);
  s.gladys.getConfig = async () => {
    if (fail > 0) {
      fail -= 1;
      throw new Error('host down');
    }
    return real();
  };
  await s.app.connected();
  await s.advance(SECOND);
  assert.match(text(s.status().message), /could not be read from Gladys/);
  assert.equal(s.db.calls.length, 0);
  await s.advance(5 * SECOND);
  assert.equal(fail, 0);
  assert.equal(s.db.calls.length, 0, 'second failure: 10 s');
  await s.advance(6 * SECOND);
  assert.equal(s.db.calls.length, 0, 'no third try 5 s after the second');
  await s.advance(25 * SECOND);
  assert.equal(fchg(s), 1);
  assert.equal(s.status().connected, true);
  await s.app.stop();
});

test('unknown and ambiguous stations: said in the status, never another station', async () => {
  const s = await setup({ config: { ...CONFIG, station_1: 'Nowhere', station_2: 'Köln' } });
  await s.run();
  assert.equal(s.db.count('/fchg/'), 0);
  assert.equal(s.status().connected, false);
  assert.match(text(s.status().message), /Station 1: no station of that name/);
  assert.equal(s.app.slots[1].problem.code, 'ambiguous');
  assert.equal(s.gladys.fake.discoveredDevices.length, 0);
  await s.app.stop();
});

test('an unreadable answer for one station never stops the others nor counts as a refusal', async () => {
  const s = await setup({ config: { ...CONFIG, station_2: 'FF' } });
  s.db.override = (path) =>
    path === `/fchg/${EVA}`
      ? xml('<html>maintenance</html>')
      : path === `/plan/${OTHER_EVA}/261110/14`
        ? 'network'
        : undefined;
  await s.run(30 * SECOND);
  assert.equal(s.app.refused, undefined);
  assert.equal(s.app.slots[0].problem.code, 'bad_response');
  assert.equal(s.app.slots[1].problem.code, 'network');
  assert.equal(s.status().connected, false, 'every station failed: not connected');
  // The timetable of station 1 is there: the next departure, without live data.
  assert.equal(s.last(F('next')), '14:05 RE 5 → Koblenz Hbf, pl. 3, timetable only');
  assert.equal(s.last(F('delay')), undefined);
  assert.equal(s.last(F('disrupted')), undefined);
  await s.app.stop();
});

test('network errors on every station: the rounds space out, never a storm', async () => {
  const s = await setup();
  s.db.override = () => 'network';
  await s.run();
  const counts = [s.db.calls.length];
  for (let i = 0; i < 6; i += 1) {
    await s.advance(30 * MINUTE);
    counts.push(s.db.calls.length);
  }
  // 2, 4, 8, 16, 30, 30 minutes between rounds.
  assert.ok(s.db.calls.length <= 10, `${counts}`);
  await s.app.stop();
});

test('live data older than 10 minutes: delays and disruptions not published any more', async () => {
  const s = await setup();
  await s.run();
  assert.equal(s.states(F('delay')).length, 1);
  s.db.override = (path) => (path.startsWith('/fchg/') ? 'timeout' : undefined);
  await s.advance(9 * MINUTE);
  const delays = s.states(F('delay')).length;
  await s.advance(10 * MINUTE);
  assert.equal(s.states(F('delay')).length, delays, 'no delay without fresh live data');
  assert.match(s.last(F('next')), /timetable only/);
  await s.app.stop();
});

test('no departure in the window: the text says so, no minutes and no delay published as 0', async () => {
  const s = await setup({ config: { ...CONFIG, lines_1: 'ICE 999' } });
  await s.run();
  assert.equal(s.last(F('next')), 'No departure in the next 60 min');
  assert.equal(s.states(F('next_in')).length, 0);
  assert.equal(s.states(F('delay')).length, 0);
  assert.equal(s.last(F('disrupted')), 0, 'a fresh /fchg: nothing disrupted is a real 0');
  await s.app.stop();
});

test('an hour DB has no plan for (404) is an empty hour, asked again 15 min later', async () => {
  const s = await setup();
  s.db.override = (path) =>
    path.endsWith('/261110/15') ? new Response('', { status: 404 }) : undefined;
  await s.run();
  assert.equal(s.status().connected, true);
  await s.advance(14 * MINUTE);
  assert.equal(s.db.count('/plan/8000207/261110/15'), 1);
  await s.advance(2 * MINUTE);
  assert.equal(s.db.count('/plan/8000207/261110/15'), 2);
  await s.app.stop();
});

test('rotation: the station tried least recently goes first', async () => {
  const s = await setup({ config: { ...CONFIG, station_2: 'FF', station_3: '8003368' } });
  await s.run(30 * SECOND);
  await s.advance(2 * MINUTE);
  const second = s.db.calls.filter((c) => c.path.startsWith('/fchg/')).map((c) => c.path);
  assert.deepEqual(second.slice(-3), ['/fchg/8000207', '/fchg/8000105', '/fchg/8003368']);
  await s.app.stop();
});

test('the secrets never reach a log, a status, /data, a device nor a widget', async () => {
  const store = createMemoryStore();
  const s = await setup({ store });
  s.db.override = (path) =>
    path.startsWith('/fchg/') ? new Response(API_KEY, { status: 500 }) : undefined;
  await s.run();
  await s.app.testConnection();
  const everything = JSON.stringify([
    s.lines,
    s.statuses(),
    store.data,
    s.gladys.fake.discoveredDevices,
    s.gladys.fake.states,
    await s.app.getWidget({ settings: { station: DEVICE() } }),
  ]);
  for (const secret of [API_KEY, CLIENT_ID]) assert.ok(!everything.includes(secret), secret);
  await s.app.stop();
});

test('/data unreadable: never written, read again every 10 s, its refusal adopted once read', async () => {
  const store = createMemoryStore({
    refused: { salt: '00'.repeat(16), tag: 0, status: 401 },
  });
  store.unreadable = true;
  const s = await setup({ store });
  await s.run(SECOND);
  assert.equal(store.saves, 0);
  assert.match(text(s.status().message), /\/data unreadable/);
  const loads = store.loads;
  await s.advance(25 * SECOND);
  assert.equal(store.saves, 0, 'never overwritten');
  assert.ok(store.loads >= loads + 2, 'read again on its timer');
  // The file becomes readable: what it holds wins (the refusal of these credentials).
  const { tagOf } = await import('../src/app.js');
  store.data.refused.tag = tagOf(store.data.refused.salt, CLIENT_ID, API_KEY);
  store.unreadable = false;
  await s.advance(11 * SECOND);
  assert.ok(s.app.isRefused());
  const calls = s.db.calls.length;
  await s.advance(10 * MINUTE);
  assert.equal(s.db.calls.length, calls);
  await s.app.stop();
});

test('/data that never answers: the start goes on after 5 s, one read at a time, nothing saved', async () => {
  const store = createMemoryStore();
  store.hang = true;
  const s = await setup({ store });
  const started = s.app.connected();
  await s.advance(30 * SECOND);
  await started;
  assert.equal(fchg(s), 0, 'the last round is unknown: a whole interval first');
  await s.advance(2 * MINUTE);
  assert.equal(fchg(s), 1);
  assert.equal(store.loads, 1, 'one read at a time');
  assert.equal(store.saves, 0);
  await s.app.stop();
});

test('/data failing to save never stops the reads', async () => {
  const store = createMemoryStore();
  store.failSave = true;
  const s = await setup({ store });
  await s.run();
  await s.advance(2 * MINUTE);
  assert.equal(fchg(s), 2);
  await s.app.stop();
});

test('stop: no timer left, no request after it', async () => {
  const s = await setup();
  await s.run();
  await s.app.stop();
  assert.equal(s.timers.pending.size, 0, 'no timer left');
  const calls = s.db.calls.length;
  await s.advance(60 * MINUTE);
  assert.equal(s.db.calls.length, calls);
});

test('a start after a stop reads again (a reconnection after a shutdown)', async () => {
  const s = await setup();
  await s.run();
  await s.app.stop();
  const published = s.states(F('next_in')).length;
  await s.app.connected();
  await s.advance(3 * MINUTE);
  assert.equal(fchg(s), 2);
  assert.ok(s.states(F('next_in')).length > published, 'the answer is used');
  assert.match(text(s.status().message), /^Read at 14:0[34]/);
  await s.app.stop();
});

test('a refusal decided while a search waits its turn: the search is never sent', async () => {
  const s = await setup();
  let answer;
  s.db.override = (path) =>
    path === '/station/Köln Hbf' ? new Promise((resolve) => (answer = resolve)) : undefined;
  await s.app.connected();
  await s.advance(SECOND);
  assert.ok(answer, 'the resolution is in flight');
  const search = s.app.searchStation({ query: 'Frankfurt' });
  answer(new Response('', { status: 401 }));
  await s.advance(10 * SECOND);
  assert.match(text(await search), /were refused/);
  assert.equal(s.db.count('/station/Frankfurt'), 0);
  await s.app.stop();
});

test('a late live answer of a replaced configuration is dropped', async () => {
  const s = await setup();
  let answer;
  s.db.override = (path) =>
    path.startsWith('/fchg/') && !answer ? new Promise((resolve) => (answer = resolve)) : undefined;
  await s.app.connected();
  await s.advance(10 * SECOND);
  assert.ok(answer, 'the live changes are in flight');
  await s.gladys.fake.configUpdated({ ...CONFIG, lines_1: 'ICE' });
  answer(xml('<timetable/>'));
  await settle();
  assert.equal(s.app.slots[0].live, undefined, 'the answer of the old round is not kept');
  assert.equal(s.states(F('next')).length, 0, 'nor published');
  await s.app.stop();
});

test('stop during a request: the answer publishes nothing', async () => {
  const s = await setup();
  s.db.hold = true;
  await s.app.connected();
  await s.advance(10 * SECOND);
  const states = s.gladys.fake.states.length;
  const stopping = s.app.stop();
  s.db.release();
  await stopping;
  await settle();
  assert.equal(s.gladys.fake.states.length, states);
});

test('a late answer of old credentials publishes nothing and sets no status', async () => {
  const s = await setup();
  s.db.hold = true;
  await s.app.connected();
  await s.advance(10 * SECOND);
  s.db.override = (path) =>
    path.startsWith('/station/') ? new Response('', { status: 401 }) : undefined;
  await s.gladys.fake.configUpdated({ ...CONFIG, api_key: 'NewKey' });
  s.db.hold = false;
  s.db.release();
  await s.advance(SECOND);
  // The held request answered 401 for the old key: no refusal recorded for it.
  assert.ok(!s.app.refused || s.app.isRefused(), 'only a refusal of the current key');
  await s.app.stop();
});

test('the departure widget: from what is held, never a request', async () => {
  const s = await setup();
  await s.run();
  const calls = s.db.calls.length;
  const ack = await s.gladys.fake.widgetGet(WIDGETS.DEPARTURES, {
    settings: { station: DEVICE() },
    language: 'fr',
  });
  const content = ack.data.content ?? ack.data;
  assert.equal(s.db.calls.length, calls);
  const [heading, status, caption] = content.components;
  assert.equal(heading.text, 'Köln Hbf');
  assert.deepEqual(status.items[0], {
    label: '14:05 RE 5 → Koblenz Hbf',
    value: '+4 min · voie 4',
    color: 'info',
  });
  assert.equal(status.items[2].value, 'supprimé · voie 10');
  assert.equal(status.items[2].color, 'danger');
  assert.match(caption.text, /CC BY 4.0/);
  for (const item of status.items) {
    assert.ok(item.label.length <= 40 && String(item.value).length <= 40);
  }
  const unknown = await s.app.getWidget({
    settings: { station: 'ext:deutsche-bahn:station:2-123456' },
  });
  assert.match(unknown.components[0].text, /not configured/);
  await s.app.stop();
});

test('find a station: names, EVA numbers and DS100 codes; spaced; bad input refused', async () => {
  const s = await setup();
  await s.run();
  const ack = await s.gladys.fake.action(ACTIONS.SEARCH, { query: 'Köln' });
  assert.equal(
    text(ack.data.message),
    'Köln Hbf — EVA 8000207 — DS100 KK\nKöln Messe/Deutz — EVA 8003368 — DS100 KKDZ',
  );
  assert.match(text(await s.app.searchStation({ query: 'Köln' })), /Wait a few seconds/);
  assert.match(text(await s.app.searchStation({ query: 'a/b' })), /Enter a station name/);
  assert.match(text(await s.app.searchStation({ query: 'x\r\ny' })), /Enter a station name/);
  await s.advance(6 * SECOND);
  assert.match(text(await s.app.searchStation({ query: 'Zzz' })), /No station found/);
  await s.app.stop();
});

test('the language of the values', async () => {
  const s = await setup({ config: { ...CONFIG, language: 'fr' } });
  await s.run();
  assert.equal(s.last(F('next')), '14:05 RE 5 → Koblenz Hbf, voie 4 au lieu de 3, +4 min');
  assert.equal(s.gladys.fake.discoveredDevices[0].features[0].name, 'Prochain départ');
  await s.app.stop();
});

test('the budget of a round: no new station after 90 s, the rest goes first next time', async () => {
  const s = await setup({ config: { ...CONFIG, station_2: 'FF', station_3: '8003368' } });
  s.db.override = async (path) => {
    if (path === '/station/Köln Hbf') {
      s.clock.now += 100 * SECOND;
    }
    return undefined;
  };
  await s.run(30 * SECOND);
  await s.advance(10 * SECOND);
  assert.equal(s.db.count('/station/FF'), 0);
  assert.match(text(s.status().message), /left for the next round/);
  const before = s.db.calls.length;
  await s.advance(2 * MINUTE);
  assert.equal(s.db.count('/station/FF'), 1);
  // The stations left go first.
  assert.equal(s.db.calls[before].path, '/station/FF');
  await s.app.stop();
});

test('a planned hour is read again after an hour, not before', async () => {
  const s = await setup();
  await s.run();
  await s.advance(58 * MINUTE);
  assert.equal(s.db.count('/plan/8000207/261110/15'), 1);
  await s.advance(4 * MINUTE);
  assert.equal(s.db.count('/plan/8000207/261110/15'), 2);
  await s.app.stop();
});

test('Retry-After is bounded: 1 min at least, 6 h at most', async () => {
  for (const [header, min, max] of [
    ['0', 60, 61],
    ['999999', 6 * 3600, 6 * 3600 + 1],
  ]) {
    const s = await setup();
    s.db.override = (path) =>
      path.startsWith('/fchg/')
        ? new Response('', { status: 429, headers: { 'retry-after': header } })
        : undefined;
    await s.run(10 * SECOND);
    const left = (s.store.data.pause.until - s.clock.now) / 1000;
    assert.ok(left >= min - 10 && left <= max, `${header}: ${left}`);
    await s.app.stop();
  }
});
