import { test } from 'node:test';
import assert from 'node:assert/strict';
import { berlin, clock, fromBerlin, parseDbTime, sliceOf, slicesBetween } from '../src/time.js';

const HOUR = 3600_000;

test('times of the API are local times of Germany, winter and summer', () => {
  assert.equal(parseDbTime('2611101203'), Date.UTC(2026, 10, 10, 11, 3));
  assert.equal(parseDbTime('2607011203'), Date.UTC(2026, 6, 1, 10, 3));
  for (const bad of [
    '',
    '261110120',
    '26111012034',
    '2613011200',
    '2602301200',
    '2611102500',
    '2611101260',
    'aaaaaaaaaa',
    undefined,
  ]) {
    assert.equal(parseDbTime(bad), undefined, String(bad));
  }
});

test('midnight, west and east of Germany: the date is the German one', () => {
  // 23:30 UTC on 10 November is 00:30 on 11 November in Germany.
  const t = Date.UTC(2026, 10, 10, 23, 30);
  assert.deepEqual(sliceOf(t), { date: '261111', hour: '00', key: '26111100' });
  assert.equal(clock(t), '00:30');
  // 22:59 UTC is still the 10th.
  assert.equal(sliceOf(Date.UTC(2026, 10, 10, 22, 59)).date, '261110');
});

test('spring change (29 March 2026): 02:00 jumps to 03:00', () => {
  assert.equal(fromBerlin(2026, 3, 29, 1, 59), Date.UTC(2026, 2, 29, 0, 59));
  assert.equal(fromBerlin(2026, 3, 29, 3, 0), Date.UTC(2026, 2, 29, 1, 0));
  // 02:30 does not exist: read as winter time (= 03:30 summer time).
  assert.equal(fromBerlin(2026, 3, 29, 2, 30), Date.UTC(2026, 2, 29, 1, 30));
  const slices = slicesBetween(Date.UTC(2026, 2, 29, 0, 30), Date.UTC(2026, 2, 29, 1, 30));
  assert.deepEqual(
    slices.map((s) => s.hour),
    ['01', '03'],
  );
});

test('autumn change (25 October 2026): 02:xx twice, the first one taken', () => {
  assert.equal(fromBerlin(2026, 10, 25, 2, 30), Date.UTC(2026, 9, 25, 0, 30));
  assert.equal(fromBerlin(2026, 10, 25, 3, 0), Date.UTC(2026, 9, 25, 2, 0));
  const from = Date.UTC(2026, 9, 24, 23, 30); // 01:30 summer time
  const slices = slicesBetween(from, from + 3 * HOUR);
  assert.deepEqual(
    slices.map((s) => s.hour),
    ['01', '02', '03'],
  );
  assert.deepEqual(berlin(Date.UTC(2026, 9, 25, 1, 30)), { y: 2026, mo: 10, d: 25, h: 2, mi: 30 });
});

test('slices cover the window, in order, without a gap', () => {
  const now = Date.UTC(2026, 10, 10, 13, 2);
  assert.deepEqual(
    slicesBetween(now, now + 60 * 60_000).map((s) => s.key),
    ['26111014', '26111015'],
  );
  assert.deepEqual(
    slicesBetween(now, now + 180 * 60_000).map((s) => s.hour),
    ['14', '15', '16', '17'],
  );
});
