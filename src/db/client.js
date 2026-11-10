// -----------------------------------------------------------------------------
// The only network access: GET requests to the Timetables API of the DB API
// Marketplace, with the two credentials of the user's application in the
// `DB-Client-Id` and `DB-Api-Key` headers (private fields, never in a URL, a
// log, an error or /data), the module's own User-Agent and `Accept:
// application/xml`. Every answer is bounded in time and in size (the body is
// cut as soon as it passes its limit). Errors carry our own codes only, never
// a text of the server.
// -----------------------------------------------------------------------------

import { API_BASE, MAX_BYTES, REQUEST_TIMEOUT, USER_AGENT } from '../constants.js';

export class DbError extends Error {
  /**
   * @param {string} code - refused | rate_limited | server | not_found | http |
   *   timeout | network | too_large | bad_response | aborted | paused
   * @param {{ status?: number, retryAfter?: number }} [details]
   */
  constructor(code, { status, retryAfter } = {}) {
    super(status ? `DB ${code} (HTTP ${status})` : `DB ${code}`);
    this.name = 'DbError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/** The wait a 429/503 asks for, in ms: seconds, or a date read against the `Date` header. */
export function retryAfterOf(headers) {
  const value = headers.get('retry-after');
  if (!value) {
    return undefined;
  }
  if (/^\s*\d{1,7}\s*$/.test(value)) {
    return Number(value) * 1000;
  }
  const at = Date.parse(value);
  const date = Date.parse(headers.get('date') ?? '');
  // A date is only usable against the server's own clock.
  return Number.isFinite(at) && Number.isFinite(date) && at >= date ? at - date : undefined;
}

async function readBounded(response, max) {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > max) {
    await response.body?.cancel().catch(() => {});
    throw new DbError('too_large');
  }
  if (!response.body) {
    return '';
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new DbError('too_large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export class TimetablesClient {
  #clientId;
  #apiKey;

  constructor({
    clientId,
    apiKey,
    fetchImpl = globalThis.fetch,
    base = API_BASE,
    timeout = REQUEST_TIMEOUT,
  }) {
    this.#clientId = clientId;
    this.#apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.base = base;
    this.timeout = timeout;
  }

  /** GET `path` (already encoded), the body as text, at most `max` bytes. */
  async get(path, max, signal) {
    const timeout = AbortSignal.timeout(this.timeout);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    try {
      response = await this.fetchImpl(`${this.base}${path}`, {
        method: 'GET',
        headers: {
          'DB-Client-Id': this.#clientId,
          'DB-Api-Key': this.#apiKey,
          Accept: 'application/xml',
          'User-Agent': USER_AGENT,
        },
        redirect: 'error',
        signal: combined,
      });
    } catch (err) {
      throw this.#failure(err, signal, timeout);
    }
    const { status } = response;
    if (status !== 200) {
      await response.body?.cancel().catch(() => {});
      if (status === 401 || status === 403) throw new DbError('refused', { status });
      if (status === 429) {
        throw new DbError('rate_limited', { status, retryAfter: retryAfterOf(response.headers) });
      }
      if (status >= 500) {
        throw new DbError('server', { status, retryAfter: retryAfterOf(response.headers) });
      }
      if (status === 404) throw new DbError('not_found', { status });
      throw new DbError('http', { status });
    }
    const type = response.headers.get('content-type') ?? '';
    if (type && !/xml/i.test(type)) {
      // A gateway page (JSON, HTML) in place of the API's XML.
      await response.body?.cancel().catch(() => {});
      throw new DbError('bad_response', { status });
    }
    try {
      return await readBounded(response, max);
    } catch (err) {
      if (err instanceof DbError) throw err;
      throw this.#failure(err, signal, timeout);
    }
  }

  #failure(err, signal, timeout) {
    if (signal?.aborted) return new DbError('aborted');
    if (timeout.aborted || err?.name === 'TimeoutError') return new DbError('timeout');
    return new DbError('network');
  }

  /** `/station/{pattern}`: a name, an EVA number or a DS100 code. */
  station(pattern, signal) {
    return this.get(`/station/${encodeURIComponent(pattern)}`, MAX_BYTES.station, signal);
  }

  /** `/plan/{eva}/{YYMMDD}/{HH}`: the planned stops of one hour. */
  plan(eva, date, hour, signal) {
    return this.get(`/plan/${eva}/${date}/${hour}`, MAX_BYTES.plan, signal);
  }

  /** `/fchg/{eva}`: every known change (delays, platforms, cancellations). */
  changes(eva, signal) {
    return this.get(`/fchg/${eva}`, MAX_BYTES.fchg, signal);
  }
}
