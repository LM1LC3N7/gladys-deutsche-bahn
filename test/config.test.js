import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bounded,
  credentialProblem,
  normalizeConfig,
  parseLines,
  stationInput,
} from '../src/config.js';

test('defaults and bounds of the numbers (an empty field is the default, never 0)', () => {
  const c = normalizeConfig({});
  assert.equal(c.pollMinutes, 2);
  assert.equal(c.lookaheadMinutes, 60);
  assert.equal(c.thresholdMinutes, 5);
  assert.equal(c.language, 'en');
  const range = { default: 2, min: 1, max: 15 };
  assert.equal(bounded('', range), 2);
  assert.equal(bounded(null, range), 2);
  assert.equal(bounded('0', range), 1);
  assert.equal(bounded(99, range), 15);
  assert.equal(bounded(2.5, range), 2);
  assert.equal(bounded('abc', range), 2);
});

test('credentials: both or nothing, never a control character nor a space', () => {
  assert.equal(credentialProblem(normalizeConfig({})), 'missing');
  assert.equal(credentialProblem(normalizeConfig({ api_key: 'k' })), 'half');
  assert.equal(credentialProblem(normalizeConfig({ client_id: 'c' })), 'half');
  assert.equal(
    credentialProblem(normalizeConfig({ client_id: 'c', api_key: 'a\r\nX-Evil: 1' })),
    'malformed',
  );
  assert.equal(credentialProblem(normalizeConfig({ client_id: 'c d', api_key: 'k' })), 'malformed');
  assert.equal(credentialProblem(normalizeConfig({ client_id: ' c ', api_key: 'k' })), undefined);
});

test('stations: up to three, inputs cleaned, filters parsed', () => {
  const c = normalizeConfig({
    station_1: '  Köln   Hbf ',
    lines_1: 'RE 5, s1; ICE,, bad line!',
    via_1: ' Koblenz ',
    station_2: '',
    station_3: '8000105',
    station_4: 'ignored',
  });
  assert.deepEqual(
    c.stations.map((s) => [s.slot, s.input]),
    [
      [1, 'Köln Hbf'],
      [3, '8000105'],
    ],
  );
  assert.deepEqual(c.stations[0].lines, ['RE5', 'S1', 'ICE']);
  assert.equal(c.stations[0].via, 'koblenz');
  assert.deepEqual(parseLines(''), []);
  for (const bad of ['a/b', '..', '.', 'x\ny', 'x'.repeat(81)])
    assert.equal(stationInput(bad), '', bad);
});
