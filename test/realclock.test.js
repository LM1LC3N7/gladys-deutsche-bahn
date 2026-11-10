// -----------------------------------------------------------------------------
// The app on a REAL moving clock (performance.now, setTimeout) and a real
// local HTTP server playing the Timetables API: the rounds really start at 0,
// the interval and twice the interval, with a bounded number of timers. The
// time is sped up 20 times (the 60 s interval lasts 3 s) but it is the real
// clock: it moves between any two reads of it. Cleaned up in t.after, so a
// failure never leaves the process alive.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { DbApp } from '../src/app.js';
import { createMemoryStore } from '../src/store.js';
import {
  API_KEY,
  CLIENT_ID,
  NOW,
  changesXml,
  planXml,
  stationsXml,
  STATIONS,
} from './fixtures/db.js';

const SPEED = 20;
const INTERVAL = 60_000;

test('real clock: rounds at 0, the interval and twice the interval; timers bounded', async (t) => {
  const reads = [];
  const server = createServer((req, res) => {
    const path = decodeURIComponent(req.url);
    let body;
    if (path.startsWith('/station/')) body = stationsXml(STATIONS.slice(0, 1));
    else if (path.startsWith('/plan/')) {
      const [, , eva, date, hour] = path.split('/');
      body = planXml(eva, date, hour);
    } else if (path.startsWith('/fchg/')) {
      reads.push(performance.now() * SPEED);
      body = changesXml();
    }
    res.writeHead(body ? 200 : 404, { 'content-type': 'application/xml' });
    res.end(body ?? '');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  let timersSet = 0;
  const live = new Set();
  const timers = {
    setTimeout(fn, ms) {
      timersSet += 1;
      const id = setTimeout(
        () => {
          live.delete(id);
          fn();
        },
        Math.max(0, ms) / SPEED,
      );
      live.add(id);
      return id;
    },
    clearTimeout(id) {
      live.delete(id);
      clearTimeout(id);
    },
  };
  const gladys = createFakeGladys({ selector: 'deutsche-bahn', config: {} });
  await gladys.connect();
  const quiet = () => {};
  const t0 = performance.now();
  const app = new DbApp({
    gladys,
    logger: { info: quiet, warn: quiet, error: quiet, debug: quiet },
    now: () => NOW + (performance.now() - t0) * SPEED,
    monotonic: () => performance.now() * SPEED,
    timers,
    store: createMemoryStore(),
    apiBase: `http://127.0.0.1:${port}`,
  });
  t.after(async () => {
    await app.stop();
    for (const id of live) clearTimeout(id);
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  });
  const started = performance.now() * SPEED;
  await app.start({ client_id: CLIENT_ID, api_key: API_KEY, station_1: 'KK', poll_minutes: 1 });
  const deadline = performance.now() + 20_000;
  while (reads.length === 0 && performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  const until = (reads[0] ?? started) + 2.5 * INTERVAL;
  while (performance.now() * SPEED < until && performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await app.stop();
  const at = reads.map((r) => Math.round(r - started));
  assert.equal(reads.length, 3, `reads at ${at}`);
  for (let i = 1; i < reads.length; i += 1) {
    const gap = reads[i] - reads[i - 1];
    assert.ok(gap >= 0.9 * INTERVAL, `never sooner than the interval: ${at}`);
    assert.ok(gap < 1.5 * INTERVAL, `on time: ${at}`);
  }
  assert.ok(timersSet <= 40, `${timersSet} timers`);
  assert.equal(live.size, 0, 'no timer left after stop');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.ok(gladys.fake.lastState(`ext:deutsche-bahn:station:1-8000207:next`));
});
