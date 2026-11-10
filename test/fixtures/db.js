// -----------------------------------------------------------------------------
// A scripted Timetables API: stations, a plan generated per hour, the live
// changes, and per-path overrides. Answers are real Response objects with the
// XML DB sends (attribute names of the API).
// -----------------------------------------------------------------------------

export const EVA = '8000207';
export const OTHER_EVA = '8000105';
/** 2026-11-10 14:02 in Germany (winter time, UTC+1). */
export const NOW = Date.UTC(2026, 10, 10, 13, 2);
export const CLIENT_ID = 'c0ffee00c0ffee00c0ffee00c0ffee00';
export const API_KEY = 'S3cr3tK3yThatMustNeverLeak0123';

export const STATIONS = [
  { name: 'Köln Hbf', eva: EVA, ds100: 'KK' },
  { name: 'Köln Messe/Deutz', eva: '8003368', ds100: 'KKDZ' },
  { name: 'Frankfurt(Main)Hbf', eva: OTHER_EVA, ds100: 'FF' },
];

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function stationsXml(list) {
  return `<?xml version="1.0" encoding="UTF-8"?><stations>${list
    .map(
      (s) =>
        `<station name="${esc(s.name)}" eva="${s.eva}" ds100="${s.ds100}" db="true" creationts="25-01-01 00:00:00.000"/>`,
    )
    .join('')}</stations>`;
}

/** The planned stops of one hour: RE 5 at :05, ICE at :20, S 12 at :40. */
export function planXml(eva, date, hour, { extra = '' } = {}) {
  const at = (m) => `${date}${hour}${m}`;
  return `<?xml version="1.0" encoding="UTF-8"?><timetable station="Köln Hbf">
<s id="re5-${date}${hour}"><tl f="N" t="p" o="800337" c="RE" n="10${hour}"/><ar pt="${at('03')}" pp="3" l="5" ppth="Wesel|Düsseldorf Hbf"/><dp pt="${at('05')}" pp="3" l="5" ppth="Bonn Hbf|Remagen|Koblenz Hbf"/></s>
<s id="ice-${date}${hour}"><tl f="F" t="p" o="80" c="ICE" n="5${hour}"/><dp pt="${at('20')}" pp="5" ppth="Frankfurt(M) Flughafen Fernbf|M&#252;nchen Hbf"/></s>
<s id="s12-${date}${hour}"><tl f="S" t="p" o="800337" c="S" n="39${hour}"/><dp pt="${at('40')}" pp="10" l="12" ppth="Köln-Ehrenfeld|Horrem"/></s>
<s id="end-${date}${hour}"><tl f="N" t="p" o="800337" c="RB" n="77${hour}"/><ar pt="${at('50')}" pp="1" l="25" ppth="Gummersbach"/></s>
${extra}</timetable>`;
}

/** Live changes: RE 5 of 14:05 at 14:09 on platform 4, S 12 of 14:40 cancelled. */
export function changesXml(changes = defaultChanges()) {
  return `<?xml version="1.0" encoding="UTF-8"?><timetable station="Köln Hbf" eva="${EVA}">${changes.join('')}</timetable>`;
}

export const defaultChanges = () => [
  '<s id="re5-26111014" eva="8000207"><ar ct="2611101407"/><dp ct="2611101409" cp="4"/></s>',
  '<s id="s12-26111014" eva="8000207"><dp cs="c" clt="2611101300"/></s>',
];

export const xml = (body, status = 200, headers = {}) =>
  new Response(body, {
    status,
    headers: { 'content-type': 'application/xml; charset=utf-8', ...headers },
  });

/**
 * The fake API. `world.override(path, call)` may answer anything first
 * (a Response, 'timeout', 'network', a promise); `world.stations`,
 * `world.changes` (eva -> list of <s>) shape the normal answers.
 */
export function createDb() {
  const world = {
    calls: [],
    stations: STATIONS,
    changes: { [EVA]: defaultChanges(), [OTHER_EVA]: [] },
    override: undefined,
    hold: false,
    held: [],
    release() {
      const held = world.held;
      world.held = [];
      for (const r of held) r();
    },
    count: (prefix) => world.calls.filter((c) => c.path.startsWith(prefix)).length,
  };
  world.fetch = async (url, init = {}) => {
    const { pathname } = new URL(url);
    const path = decodeURIComponent(
      pathname.replace(/^\/db-api-marketplace\/apis\/timetables\/v1/, ''),
    );
    const call = { path, headers: init.headers, at: world.now?.() };
    world.calls.push(call);
    if (world.hold) await new Promise((r) => world.held.push(r));
    if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const special = await world.override?.(path, call);
    if (special === 'timeout') throw new DOMException('The operation timed out.', 'TimeoutError');
    if (special === 'network') throw new TypeError('fetch failed');
    if (special) return special;
    let m;
    if ((m = /^\/station\/(.+)$/.exec(path))) {
      const q = m[1].toLowerCase();
      return xml(
        stationsXml(
          world.stations.filter(
            (s) =>
              s.eva === m[1] || s.ds100.toLowerCase() === q || s.name.toLowerCase().includes(q),
          ),
        ),
      );
    }
    if ((m = /^\/plan\/(\d+)\/(\d{6})\/(\d{2})$/.exec(path))) return xml(planXml(m[1], m[2], m[3]));
    if ((m = /^\/fchg\/(\d+)$/.exec(path))) return xml(changesXml(world.changes[m[1]] ?? []));
    return new Response('{"error":"not found"}', {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  };
  return world;
}
