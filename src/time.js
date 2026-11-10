// -----------------------------------------------------------------------------
// The times of the Timetables API: "YYMMddHHmm", local time of Germany
// (Europe/Berlin), without offset. Converted with the time zone database of
// Node (Intl), so the changes of time are DB's own. On the night of the
// autumn change, an hour between 02:00 and 03:00 exists twice: the first one
// (summer time) is taken. Pure functions.
// -----------------------------------------------------------------------------

export const TIME_ZONE = 'Europe/Berlin';

const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** The local date and time of Germany at `ms`: { y, mo, d, h, mi }. */
export function berlin(ms) {
  const out = {};
  for (const { type, value } of parts.formatToParts(new Date(ms))) {
    out[type] = Number(value);
  }
  return { y: out.year, mo: out.month, d: out.day, h: out.hour, mi: out.minute };
}

const same = (a, b) => a.y === b.y && a.mo === b.mo && a.d === b.d && a.h === b.h && a.mi === b.mi;

/** The instant of a local time of Germany; undefined when it is no valid date. */
export function fromBerlin(y, mo, d, h, mi) {
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(asUtc);
  if (
    !Number.isFinite(asUtc) ||
    check.getUTCMonth() !== mo - 1 ||
    check.getUTCDate() !== d ||
    h > 23 ||
    mi > 59
  ) {
    return undefined;
  }
  const want = { y, mo, d, h, mi };
  // Germany is UTC+2 (summer) or UTC+1 (winter): the earliest match wins.
  for (const offset of [2, 1]) {
    const candidate = asUtc - offset * 3600 * 1000;
    if (same(berlin(candidate), want)) {
      return candidate;
    }
  }
  // A local time skipped by the spring change (02:xx): read as winter time.
  return asUtc - 3600 * 1000;
}

/** "2311101203" -> the instant; undefined when malformed. */
export function parseDbTime(value) {
  if (typeof value !== 'string' || !/^\d{10}$/.test(value)) {
    return undefined;
  }
  const n = (i) => Number(value.slice(i, i + 2));
  return fromBerlin(2000 + n(0), n(2), n(4), n(6), n(8));
}

const pad = (v) => String(v).padStart(2, '0');

/** The plan slice of an instant: { date: "YYMMDD", hour: "HH", key: "YYMMDDHH" }. */
export function sliceOf(ms) {
  const t = berlin(ms);
  const date = `${pad(t.y % 100)}${pad(t.mo)}${pad(t.d)}`;
  const hour = pad(t.h);
  return { date, hour, key: `${date}${hour}` };
}

/** The distinct plan slices covering [from, to], in order. */
export function slicesBetween(from, to) {
  const out = [];
  const seen = new Set();
  // Every quarter of an hour plus the end: an hour is never skipped, even
  // around a change of time.
  for (let t = from; ; t += 15 * 60 * 1000) {
    const slice = sliceOf(Math.min(t, to));
    if (!seen.has(slice.key)) {
      seen.add(slice.key);
      out.push(slice);
    }
    if (t >= to) break;
  }
  return out;
}

/** "14:05", local time of Germany. */
export function clock(ms) {
  const t = berlin(ms);
  return `${pad(t.h)}:${pad(t.mi)}`;
}
