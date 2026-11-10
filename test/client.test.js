import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DbError, TimetablesClient, retryAfterOf } from '../src/db/client.js';
import { USER_AGENT } from '../src/constants.js';
import { API_KEY, CLIENT_ID } from './fixtures/db.js';

const make = (handler, options = {}) => {
  const calls = [];
  const client = new TimetablesClient({
    clientId: CLIENT_ID,
    apiKey: API_KEY,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return handler(url, init);
    },
    ...options,
  });
  return { client, calls };
};

const xml = (body, init = {}) =>
  new Response(body, { status: 200, headers: { 'content-type': 'application/xml' }, ...init });

test('the request: credentials in headers only, our User-Agent, XML asked, no redirect', async () => {
  const { client, calls } = make(() => xml('<stations/>'));
  assert.equal(await client.station('Köln Hbf'), '<stations/>');
  const [{ url, init }] = calls;
  assert.equal(
    url,
    'https://apis.deutschebahn.com/db-api-marketplace/apis/timetables/v1/station/K%C3%B6ln%20Hbf',
  );
  assert.ok(!url.includes(API_KEY) && !url.includes(CLIENT_ID));
  assert.equal(init.headers['DB-Client-Id'], CLIENT_ID);
  assert.equal(init.headers['DB-Api-Key'], API_KEY);
  assert.equal(init.headers.Accept, 'application/xml');
  assert.equal(init.headers['User-Agent'], USER_AGENT);
  assert.match(
    USER_AGENT,
    /^gladys-deutsche-bahn\/\d+\.\d+\.\d+ \(\+https:\/\/github\.com\/LM1LC3N7\/gladys-deutsche-bahn\)$/,
  );
  assert.equal(init.redirect, 'error');
  await client.plan('8000207', '261110', '14');
  await client.changes('8000207');
  assert.ok(calls[1].url.endsWith('/plan/8000207/261110/14'));
  assert.ok(calls[2].url.endsWith('/fchg/8000207'));
});

test('status codes -> our codes, never a text of the server, never a credential', async () => {
  const cases = [
    [401, 'refused'],
    [403, 'refused'],
    [429, 'rate_limited'],
    [500, 'server'],
    [503, 'server'],
    [404, 'not_found'],
    [400, 'http'],
  ];
  for (const [status, code] of cases) {
    const { client } = make(() => new Response(`secret ${API_KEY}`, { status }));
    const err = await client.changes('1').catch((e) => e);
    assert.ok(err instanceof DbError);
    assert.equal(err.code, code, String(status));
    assert.equal(err.status, status);
    assert.ok(!err.message.includes(API_KEY) && !err.message.includes('secret'));
  }
});

test('Retry-After: seconds, or a date read against the Date header only', () => {
  const h = (o) => new Headers(o);
  assert.equal(retryAfterOf(h({ 'retry-after': '120' })), 120_000);
  assert.equal(
    retryAfterOf(
      h({ 'retry-after': 'Tue, 10 Nov 2026 13:10:00 GMT', date: 'Tue, 10 Nov 2026 13:05:00 GMT' }),
    ),
    300_000,
  );
  assert.equal(retryAfterOf(h({ 'retry-after': 'Tue, 10 Nov 2026 13:10:00 GMT' })), undefined);
  assert.equal(retryAfterOf(h({ 'retry-after': 'soon' })), undefined);
  assert.equal(retryAfterOf(h({})), undefined);
});

test('a 429 carries its Retry-After', async () => {
  const { client } = make(
    () => new Response('', { status: 429, headers: { 'retry-after': '90' } }),
  );
  const err = await client.changes('1').catch((e) => e);
  assert.equal(err.retryAfter, 90_000);
});

test('an answer too large is cut before it is read whole', async () => {
  const big = make(() =>
    xml('x', {
      headers: { 'content-type': 'application/xml', 'content-length': String(10 * 1024 * 1024) },
    }),
  );
  assert.equal((await big.client.changes('1').catch((e) => e)).code, 'too_large');
  let pulled = 0;
  const stream = new ReadableStream({
    // 4 MiB at most: a mutant without the bound reads it all and fails
    // quickly, never fills the RAM.
    pull(controller) {
      pulled += 1;
      if (pulled > 64) controller.close();
      else controller.enqueue(new Uint8Array(64 * 1024).fill(0x41));
    },
  });
  const endless = make(
    () => new Response(stream, { status: 200, headers: { 'content-type': 'application/xml' } }),
  );
  assert.equal((await endless.client.station('x').catch((e) => e)).code, 'too_large');
  assert.ok(pulled <= 6, `${pulled} chunks read for a 256 KiB limit`);
});

test('a gateway page in 200 is a bad answer, not a refusal', async () => {
  const { client } = make(
    () =>
      new Response('{"httpCode":"401"}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  assert.equal((await client.station('x').catch((e) => e)).code, 'bad_response');
});

test('timeout, network, abort', async (t) => {
  // AbortSignal.timeout does not hold the event loop (Node 22): this does.
  const hold = setInterval(() => {}, 1000);
  t.after(() => clearInterval(hold));
  const slow = make(
    (_, init) =>
      new Promise((_, reject) =>
        init.signal.addEventListener('abort', () => reject(init.signal.reason)),
      ),
    { timeout: 30 },
  );
  assert.equal((await slow.client.station('x').catch((e) => e)).code, 'timeout');
  const down = make(() => Promise.reject(new TypeError('fetch failed')));
  assert.equal((await down.client.station('x').catch((e) => e)).code, 'network');
  const controller = new AbortController();
  const aborted = make(
    (_, init) =>
      new Promise((_, reject) =>
        init.signal.addEventListener('abort', () => reject(init.signal.reason)),
      ),
  );
  const pending = aborted.client.station('x', controller.signal).catch((e) => e);
  controller.abort();
  assert.equal((await pending).code, 'aborted');
});
