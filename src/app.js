// -----------------------------------------------------------------------------
// The integration: up to three stations read from the Timetables API of the
// DB API Marketplace, one Gladys device per station (next departure, its
// delay, the disrupted departures), a departure board widget, the test and
// search buttons. Read-only: only GET requests, nothing is ever booked or
// changed. index.js wires the SDK handlers to it (src/handlers.js).
//
// One round = for each station (the one tried least recently first): its
// resolution once (`/station/<input>`, kept in /data), the planned hours of
// the window it does not hold yet (`/plan/<eva>/<YYMMDD>/<HH>`, kept an hour
// in memory), then the live changes (`/fchg/<eva>`). Rounds are an interval
// apart, start to start, whatever asks (a reconnection, a save of the form,
// the test button, a restart: the time of the last round is in /data); no new
// station is started after ROUND_BUDGET. One request in flight at a time, two
// requests at least REQUEST_GAP apart (40 a minute at most, the free plan
// allows 60).
//
// Credentials: a 401/403 on `/station` (the route that only needs the
// credentials) is a refusal, kept in /data as 8 bits of a salted hash and
// never retried automatically (lifted by other credentials or a success of
// the test button). A 401/403 on a timetable page is asked again on
// `/station`: accepted there, only that station waits (5 min doubling to
// 1 h). 429 and 5xx pause every request (1 min to 6 h, Retry-After read),
// kept in /data.
//
// Two clocks: `now` (wall clock) gives the local time of Germany of the
// departures and what /data keeps; `monotonic` paces the rounds, the
// requests, the pauses and the freshness of the live data.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { buildBoard, delayOf } from './board.js';
import { credentialProblem, normalizeConfig, readingKey, stationInput } from './config.js';
import {
  CONFIG_RETRY_MAX,
  CONFIG_RETRY_MIN,
  HOUR,
  LIVE_STALE,
  LOOKBACK_MINUTES,
  MAX_PLAN_HOURS,
  MAX_RESOLVED,
  MAX_SEARCH_RESULTS,
  MAX_STATUS,
  MINUTE,
  MIN_ROUND_GAP,
  PAUSE_MAX,
  PAUSE_MIN,
  PLAN_EMPTY_RETRY,
  PLAN_REFRESH,
  REQUEST_GAP,
  RETRY_MAX,
  ROUND_BUDGET,
  SEARCH_MIN_GAP,
  SECONDARY_MAX,
  SECONDARY_MIN,
  STATION_RETRY_MAX,
  STATION_RETRY_MIN,
  TICK,
  STORE_RETRY,
  STORE_WAIT,
  TEST_MIN_GAP,
  WIDGETS,
} from './constants.js';
import { DbError, TimetablesClient } from './db/client.js';
import { clean, departuresOf, parseStations, parseTimetable } from './db/model.js';
import { buildDevice, idsOf, parseDeviceId, statesOf } from './devices.js';
import { both, t } from './i18n.js';
import { FileStore } from './store.js';
import { berlin, clock, sliceOf, slicesBetween } from './time.js';

/** A planned hour older than this is not used any more (reads failing for long). */
const PLAN_MAX_AGE = 6 * HOUR;
/** Frankfurt (Main) Hbf: what the test button asks when no station is resolved yet. */
const TEST_STATION = '8000105';
const EVA = /^\d{6,9}$/;
const TIMED_OUT = Symbol('timed out');

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** 8 bits of a salted hash of both credentials: nothing to find them back from. */
export const tagOf = (salt, clientId, apiKey) =>
  createHash('sha256').update(`${salt}\u0000${clientId}\u0000${apiKey}`, 'utf8').digest()[0];

/** A pause read back from /data, its rest capped to PAUSE_MAX; undefined when invalid. */
export function validPause(pause, now, mono) {
  if (
    !pause ||
    !finite(pause.until) ||
    !Number.isInteger(pause.count) ||
    pause.count < 1 ||
    (pause.code !== 'rate_limited' && pause.code !== 'server')
  ) {
    return undefined;
  }
  const left = Math.min(Math.max(0, pause.until - now), PAUSE_MAX);
  return {
    until: now + left,
    due: mono + left,
    count: Math.min(pause.count, 16),
    code: pause.code,
    status: Number.isInteger(pause.status) ? pause.status : null,
  };
}

export function validRefused(refused) {
  return refused &&
    typeof refused.salt === 'string' &&
    /^[0-9a-f]{32}$/.test(refused.salt) &&
    Number.isInteger(refused.tag) &&
    refused.tag >= 0 &&
    refused.tag < 256
    ? {
        salt: refused.salt,
        tag: refused.tag,
        status: refused.status === 401 || refused.status === 403 ? refused.status : 401,
      }
    : undefined;
}

function validResolved(resolved) {
  const out = {};
  if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)) return out;
  for (const [input, value] of Object.entries(resolved).slice(0, MAX_RESOLVED)) {
    if (input !== stationInput(input) || !input || !value || typeof value !== 'object') continue;
    const name = clean(value.name, 80);
    if (!EVA.test(value.eva ?? '') || !name) continue;
    out[input] = { eva: value.eva, name, ds100: clean(value.ds100 ?? '', 10) };
  }
  return out;
}

/** The station meant by an input among the answers of `/station`. */
export function choose(list, input) {
  const q = input.toLowerCase();
  const unique = [...new Map(list.map((s) => [s.eva, s])).values()];
  const exact = unique.filter(
    (s) =>
      s.eva === input || (s.ds100 && s.ds100.toLowerCase() === q) || s.name.toLowerCase() === q,
  );
  if (exact.length === 1) return exact[0];
  if (EVA.test(input)) return { code: 'unknown_station' };
  if (exact.length === 0 && unique.length === 1) return unique[0];
  return { code: unique.length === 0 ? 'unknown_station' : 'ambiguous' };
}

const parse = (fn, text) => {
  try {
    return fn(text);
  } catch {
    throw new DbError('bad_response');
  }
};

const bound = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function newSlot(station) {
  return {
    ...station,
    eva: undefined,
    name: undefined,
    ds100: '',
    plans: new Map(),
    live: undefined,
    problem: undefined,
    lastTried: -Infinity,
    okRound: 0,
    wait: undefined,
  };
}

export class DbApp {
  constructor({
    gladys,
    logger = console,
    now = () => Date.now(),
    monotonic = () => performance.now(),
    timers = { setTimeout, clearTimeout },
    store = new FileStore(),
    fetchImpl = globalThis.fetch,
    random = (n) => randomBytes(n),
    requestTimeout,
    apiBase,
  }) {
    this.gladys = gladys;
    this.log = logger;
    this.now = now;
    this.monotonic = monotonic;
    this.timers = timers;
    this.store = store;
    this.fetchImpl = fetchImpl;
    this.random = random;
    this.requestTimeout = requestTimeout;
    this.apiBase = apiBase;

    this.gen = 0;
    this.stopped = false;
    this.config = normalizeConfig({});
    this.readingKey = undefined;
    this.client = undefined;
    this.slots = [];

    this.data = { lastRound: null, pause: null, refused: null, resolved: {} };
    this.storeState = 'pending';
    this.loading = null;
    this.storeTimer = null;

    this.pause = undefined;
    this.refused = undefined;
    this.lastRoundMono = undefined;
    this.round_ = 0;
    this.failures = 0;
    this.stopEpoch = 0;
    this.tickTimer = null;

    this.lane = Promise.resolve();
    this.lastRequestMono = -Infinity;
    this.sleeps = new Set();
    this.abort = new AbortController();
    this.roundTimer = null;
    this.configTimer = null;
    this.configDelay = 0;
    this.running = Promise.resolve();
    this.lastStatus = undefined;
    this.lastTest = undefined;
    this.lastSearch = -Infinity;
  }

  gone(gen) {
    return this.stopped || gen !== this.gen;
  }

  // --- Lifecycle -------------------------------------------------------------------

  /** Every (re)connection to Gladys: read the config (retried for ever), then start. */
  async connected() {
    // A stop while getConfig() waits wins: nothing starts again after it.
    const epoch = this.stopEpoch;
    this.stopped = false;
    this.lastStatus = undefined;
    // What Gladys holds may be older than this process knows: everything is
    // published again by the next round (never now: nothing stale as new).
    this.gladys.forgetPublishedStates?.();
    if (this.configTimer) {
      this.timers.clearTimeout(this.configTimer);
      this.configTimer = null;
    }
    let config;
    try {
      config = await this.gladys.getConfig();
    } catch (err) {
      if (this.stopped || epoch !== this.stopEpoch) return;
      this.configDelay = Math.min(
        CONFIG_RETRY_MAX,
        Math.max(CONFIG_RETRY_MIN, this.configDelay * 2),
      );
      this.log.warn(
        `Configuration not read (${err?.name ?? 'Error'}): again in ${this.configDelay / 1000} s`,
      );
      await this.setStatus(false, both('configUnread'));
      this.configTimer = this.timers.setTimeout(() => {
        this.configTimer = null;
        this.connected().catch((e) => this.log.error(`Start failed (${e?.name ?? 'Error'})`));
      }, this.configDelay);
      return;
    }
    if (epoch !== this.stopEpoch) return;
    this.configDelay = 0;
    await this.start(config);
  }

  async start(rawConfig) {
    this.stopped = false;
    const gen = ++this.gen;
    const config = normalizeConfig(rawConfig);
    const credsChanged =
      config.clientId !== this.config.clientId || config.apiKey !== this.config.apiKey;
    const key = readingKey(config);
    const changed = credsChanged || key !== this.readingKey;
    // Credentials changed in this process: always tried, even when their
    // 8-bit tag matches the refused one (a restart keeps the tag only).
    if (credsChanged && (this.config.clientId || this.config.apiKey) && this.refused) {
      this.refused = undefined;
      this.data.refused = null;
    }
    this.config = config;
    this.readingKey = key;
    // After a stop, the requests of the new start need a live signal.
    if (this.abort.signal.aborted) this.abort = new AbortController();
    if (credsChanged || !this.client) {
      this.abort.abort();
      this.abort = new AbortController();
      this.client = config.credentialsValid
        ? new TimetablesClient({
            clientId: config.clientId,
            apiKey: config.apiKey,
            fetchImpl: this.fetchImpl,
            ...(this.requestTimeout ? { timeout: this.requestTimeout } : {}),
            ...(this.apiBase ? { base: this.apiBase } : {}),
          })
        : undefined;
      for (const slot of this.slots) slot.wait = undefined;
      this.failures = 0;
    }
    this.slots = config.stations.map((station) => {
      const old = this.slots.find((s) => s.slot === station.slot && s.input === station.input);
      return old
        ? Object.assign(old, { lines: station.lines, via: station.via })
        : newSlot(station);
    });
    this.clearRound();
    await this.ready();
    if (this.gone(gen)) return;
    this.applyResolved();
    await this.publishDiscovery(gen);
    if (this.gone(gen)) return;
    this.schedule(gen, changed);
    this.armTick(gen);
    await this.report(gen);
  }

  /** Every minute, the boards again from what is held (no request): `next_in` moves. */
  armTick(gen) {
    if (this.tickTimer) this.timers.clearTimeout(this.tickTimer);
    this.tickTimer = this.timers.setTimeout(() => {
      this.tickTimer = null;
      if (this.gone(gen)) return;
      this.publishBoards(gen, { tick: true })
        .catch(() => {})
        .then(() => {
          if (!this.gone(gen)) this.armTick(gen);
        });
    }, TICK);
  }

  async stop() {
    this.stopped = true;
    this.stopEpoch += 1;
    this.gen += 1;
    this.clearRound();
    if (this.tickTimer) this.timers.clearTimeout(this.tickTimer);
    this.tickTimer = null;
    for (const timer of [this.configTimer, this.storeTimer]) {
      if (timer) this.timers.clearTimeout(timer);
    }
    this.configTimer = null;
    this.storeTimer = null;
    this.abort.abort();
    for (const wake of this.sleeps) wake();
    this.sleeps.clear();
    await this.running.catch(() => {});
    await this.bounded(Promise.resolve(this.store.flush?.()), STORE_WAIT).catch(() => {});
  }

  /** `promise`, or TIMED_OUT after `ms` (the timer is cleared either way). */
  bounded(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = this.timers.setTimeout(() => resolve(TIMED_OUT), ms);
      promise.then(
        (value) => {
          this.timers.clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          this.timers.clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  /** Resolves after `ms` (injected timers), or at once when the app stops. */
  sleep(ms) {
    if (this.stopped) return Promise.resolve();
    return new Promise((resolve) => {
      let timer;
      const wake = () => {
        this.timers.clearTimeout(timer);
        this.sleeps.delete(wake);
        resolve();
      };
      timer = this.timers.setTimeout(wake, Math.max(0, ms));
      this.sleeps.add(wake);
    });
  }

  // --- /data ----------------------------------------------------------------------

  /** Waits for /data at most STORE_WAIT; without it, nothing is ever saved. */
  async ready() {
    if (this.storeState === 'ok') return;
    const result = await this.bounded(this.loadStore(), STORE_WAIT);
    // A read that hangs is "unreadable" until it answers (one read at a time).
    if (result === TIMED_OUT && this.storeState === 'pending') this.storeState = 'unreadable';
  }

  /** One read of /data at a time; an unreadable one is read again every STORE_RETRY. */
  loadStore() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const raw = await this.store.load();
        const late = this.storeState === 'unreadable';
        this.merge(raw);
        this.storeState = 'ok';
        if (late) await this.afterLateLoad();
      } catch (err) {
        this.storeState = 'unreadable';
        this.log.warn(
          `/data unreadable (${err?.name ?? 'Error'}): read again in ${STORE_RETRY / 1000} s`,
        );
      } finally {
        this.loading = null;
      }
      if (this.storeState !== 'ok' && !this.stopped && !this.storeTimer) {
        this.storeTimer = this.timers.setTimeout(() => {
          this.storeTimer = null;
          this.loadStore();
        }, STORE_RETRY);
      }
    })();
    return this.loading;
  }

  async afterLateLoad() {
    if (this.storeState !== 'ok' || this.stopped) return;
    const gen = this.gen;
    this.applyResolved();
    // What happened while /data was unreadable is saved now.
    await this.save();
    if (this.isRefused()) this.clearRound();
    // The round waiting for /data is placed again from what it holds (its
    // last round, its pause).
    else if (this.roundTimer) this.schedule(gen);
    await this.report(gen);
  }

  /** /data read back, merged with what this process learnt meanwhile (the stricter wins). */
  merge(raw) {
    const data = raw && typeof raw === 'object' ? raw : {};
    const now = this.now();
    const mono = this.monotonic();
    if (
      finite(data.lastRound) &&
      !(finite(this.data.lastRound) && this.data.lastRound > data.lastRound)
    ) {
      this.data.lastRound = data.lastRound;
    }
    const pause = validPause(data.pause, now, mono);
    if (pause && !(this.pause && this.pause.until >= pause.until)) {
      this.pause = pause;
      this.data.pause = {
        until: pause.until,
        count: pause.count,
        code: pause.code,
        status: pause.status,
      };
    }
    const refused = validRefused(data.refused);
    if (refused && !this.refused) {
      this.refused = refused;
      this.data.refused = refused;
    }
    this.data.resolved = { ...validResolved(data.resolved), ...this.data.resolved };
  }

  async save() {
    if (this.storeState !== 'ok') return false;
    const snapshot = {
      version: 1,
      lastRound: this.data.lastRound,
      pause: this.data.pause,
      refused: this.data.refused,
      resolved: this.data.resolved,
    };
    try {
      // A slow volume never holds a round: the write goes on in the background.
      const done = this.store.save(snapshot);
      done.catch((err) => this.log.warn(`/data not saved (${err?.name ?? 'Error'})`));
      return (
        (await this.bounded(
          done.then(() => true),
          STORE_WAIT,
        )) === true
      );
    } catch (err) {
      this.log.warn(`/data not saved (${err?.name ?? 'Error'})`);
      return false;
    }
  }

  applyResolved() {
    for (const slot of this.slots) {
      const known = this.data.resolved[slot.input];
      if (!slot.eva && known) Object.assign(slot, known);
    }
  }

  // --- Pace ------------------------------------------------------------------------

  intervalMs() {
    return this.config.pollMinutes * MINUTE;
  }

  clearRound() {
    if (this.roundTimer) {
      this.timers.clearTimeout(this.roundTimer);
      this.roundTimer = null;
    }
  }

  /** The next round: an interval after the last one (whatever asks), never during a pause. */
  schedule(gen, changed = false) {
    if (this.gone(gen)) return;
    const mono = this.monotonic();
    const interval = this.intervalMs();
    let due;
    if (this.lastRoundMono !== undefined) {
      const wait = changed
        ? MIN_ROUND_GAP
        : Math.min(Math.max(RETRY_MAX, interval), interval * 2 ** Math.min(this.failures, 5));
      due = this.lastRoundMono + wait;
    } else {
      const last = this.data.lastRound;
      const now = this.now();
      if (this.storeState !== 'ok') {
        // /data not read: its last round is unknown, a whole interval is waited.
        due = mono + interval;
      } else {
        // A time of /data in the future is invalid: ignored.
        due = finite(last) && last <= now ? mono + Math.max(0, interval - (now - last)) : mono;
      }
    }
    if (this.pause) due = Math.max(due, this.pause.due);
    this.clearRound();
    this.dueMono = Math.max(due, mono);
    this.roundTimer = this.timers.setTimeout(() => {
      this.roundTimer = null;
      this.running = this.round(gen).catch((err) =>
        this.log.error(`Round failed (${err?.name ?? 'Error'})`),
      );
    }, this.dueMono - mono);
  }

  pauseActive(mono = this.monotonic()) {
    return Boolean(this.pause && this.pause.due > mono);
  }

  isRefused() {
    return Boolean(
      this.refused &&
      this.refused.tag === tagOf(this.refused.salt, this.config.clientId, this.config.apiKey),
    );
  }

  liveStale() {
    return Math.max(LIVE_STALE, 2.5 * this.intervalMs());
  }

  // --- Requests --------------------------------------------------------------------

  /**
   * One request at a time, REQUEST_GAP apart. A pause or a refusal set while
   * waiting stops it before it is sent; so does a new configuration.
   */
  request(gen, call, { ignoreRefusal = false, principal = false } = {}) {
    const run = async () => {
      const wait = this.lastRequestMono + REQUEST_GAP - this.monotonic();
      if (wait > 0) await this.sleep(wait);
      if (this.gone(gen) || !this.client) throw new DbError('aborted');
      if (this.pauseActive()) throw new DbError('paused');
      if (!ignoreRefusal && this.isRefused()) throw new DbError('final_refused');
      this.lastRequestMono = this.monotonic();
      try {
        return await call(this.client, this.abort.signal);
      } catch (err) {
        // Decided before the next request of the lane may go: a 429/5xx pauses
        // it, a refusal of `/station` stops it (saved by the caller).
        if (!this.gone(gen)) {
          // A 5xx of one station's page only holds that station (see readSlot).
          if (err?.code === 'rate_limited' || (err?.code === 'server' && principal)) {
            this.notePause(err);
          }
          if (err?.code === 'refused' && principal) this.noteRefused(err.status);
        }
        throw err;
      }
    };
    const job = this.lane.then(run, run);
    this.lane = job.catch(() => {});
    return job;
  }

  /** The pause of a 429/5xx, in memory at once (setPause saves it). */
  notePause(err) {
    if (err.pauseNoted) return;
    err.pauseNoted = true;
    const count = (this.pause?.count ?? 0) + 1;
    const asked = finite(err.retryAfter) ? err.retryAfter : PAUSE_MIN * 2 ** (count - 1);
    const wait = Math.min(PAUSE_MAX, Math.max(PAUSE_MIN, asked));
    const until = this.now() + wait;
    this.pause = {
      until,
      due: this.monotonic() + wait,
      count,
      code: err.code,
      status: err.status ?? null,
    };
    this.data.pause = { until, count, code: err.code, status: err.status ?? null };
    this.log.warn(
      `DB asked to wait (${err.code}, HTTP ${err.status}): paused ${Math.round(wait / 1000)} s`,
    );
  }

  async setPause(err) {
    this.notePause(err);
    await this.save();
  }

  /** A refusal of the current credentials, in memory at once (refuse saves it). */
  noteRefused(status) {
    if (this.isRefused()) return;
    const salt = this.random(16).toString('hex');
    this.refused = { salt, tag: tagOf(salt, this.config.clientId, this.config.apiKey), status };
    this.data.refused = this.refused;
    this.clearRound();
    this.log.warn(`DB refused the credentials (HTTP ${status}): no automatic retry`);
  }

  async refuse(status) {
    this.noteRefused(status);
    await this.save();
  }

  // --- Rounds ----------------------------------------------------------------------

  async round(gen) {
    if (this.gone(gen)) return;
    const mono = this.monotonic();
    if (credentialProblem(this.config) || !this.slots.length || this.isRefused()) {
      await this.report(gen);
      return;
    }
    if (this.pauseActive(mono)) {
      this.schedule(gen);
      return;
    }
    this.lastRoundMono = mono;
    this.round_ += 1;
    const round = this.round_;
    // The time of the attempt is kept before the first request.
    this.data.lastRound = this.now();
    await this.save();
    if (this.gone(gen)) return;
    const deadline = mono + ROUND_BUDGET;
    let stop;
    let tried = 0;
    let serverFailed = 0;
    let lastServer;
    const order = [...this.slots].sort((a, b) => a.lastTried - b.lastTried);
    for (const slot of order) {
      if (this.monotonic() > deadline) {
        slot.problem = { code: 'budget' };
        continue;
      }
      if (slot.wait && slot.wait.due > this.monotonic()) continue;
      slot.lastTried = this.monotonic();
      tried += 1;
      try {
        await this.readSlot(gen, slot, round);
        if (slot.problem?.code === 'server_station') {
          serverFailed += 1;
          lastServer = slot.lastServer;
        }
      } catch (err) {
        if (this.gone(gen) || err?.code === 'aborted') return;
        const code = err instanceof DbError ? err.code : 'bad_response';
        if (code === 'rate_limited' || code === 'server') {
          await this.setPause(err);
          stop = 'pause';
          break;
        }
        if (code === 'paused') {
          stop = 'pause';
          break;
        }
        if (code === 'final_refused') {
          stop = 'refused';
          break;
        }
        slot.problem = { code, status: err.status };
      }
      if (this.gone(gen)) return;
    }
    if (this.gone(gen)) return;
    const ok = this.slots.some((s) => s.okRound === round);
    if (!stop) {
      this.failures = ok ? 0 : this.failures + 1;
      if (!ok && tried > 0 && serverFailed === tried && lastServer) {
        // Every station tried answered 5xx: DB itself is down, all wait.
        await this.setPause(lastServer);
      }
    }
    if (ok && this.pause && !this.pauseActive()) {
      // A station read: the pause count starts again from 1 min.
      this.pause = undefined;
      this.data.pause = null;
      await this.save();
    }
    await this.publishBoards(gen);
    if (this.gone(gen)) return;
    if (stop !== 'refused') this.schedule(gen);
    await this.report(gen);
  }

  async readSlot(gen, slot, round) {
    if (!slot.eva) {
      await this.resolve(gen, slot);
      if (this.gone(gen) || !slot.eva) return;
    }
    const now = this.now();
    const needed = this.windowOf(now);
    const keys = new Set(needed.map((s) => s.key));
    for (const key of slot.plans.keys()) {
      if (!keys.has(key)) slot.plans.delete(key);
    }
    const { before, required } = this.splitWindow(needed, now);
    for (const slice of required) {
      const kept = slot.plans.get(slice.key);
      if (kept && this.monotonic() < kept.expires) continue;
      let text;
      try {
        text = await this.request(gen, (c, signal) =>
          c.plan(slot.eva, slice.date, slice.hour, signal),
        );
      } catch (err) {
        if (err?.code === 'not_found') {
          // No plan for that hour (yet): an empty hour, asked again later.
          const mono = this.monotonic();
          slot.plans.set(slice.key, {
            stops: new Map(),
            missing: true,
            at: mono,
            expires: mono + PLAN_EMPTY_RETRY,
          });
          continue;
        }
        if (err?.code === 'refused') return this.secondary(gen, slot, err);
        if (err?.code === 'server' && !this.gone(gen)) return this.holdStation(slot, err);
        throw err;
      }
      if (this.gone(gen)) return;
      const stops = parse(parseTimetable, text);
      const mono = this.monotonic();
      slot.plans.set(slice.key, { stops, at: mono, expires: mono + PLAN_REFRESH });
    }
    let text;
    try {
      text = await this.request(gen, (c, signal) => c.changes(slot.eva, signal));
    } catch (err) {
      if (err?.code === 'refused') return this.secondary(gen, slot, err);
      if (err?.code === 'server' && !this.gone(gen)) return this.holdStation(slot, err);
      throw err;
    }
    if (this.gone(gen)) return;
    slot.live = { changes: parse(parseTimetable, text), at: this.now(), mono: this.monotonic() };
    slot.wait = undefined;
    slot.problem = undefined;
    slot.okRound = round;
    await this.readBefore(gen, slot, before);
  }

  /**
   * The hours before the current one, read last and optional: they only add
   * the rare train still late from then. Any answer but a 429 (a pause of all)
   * leaves the hour empty, asked again 15 min later; the station is read all
   * the same. A past plan does not change: once held, it is kept until it
   * leaves the window.
   */
  async readBefore(gen, slot, before) {
    for (const slice of before) {
      const kept = slot.plans.get(slice.key);
      if (kept && (!kept.missing || this.monotonic() < kept.expires)) continue;
      try {
        const text = await this.request(gen, (c, signal) =>
          c.plan(slot.eva, slice.date, slice.hour, signal),
        );
        if (this.gone(gen)) return;
        const mono = this.monotonic();
        slot.plans.set(slice.key, {
          stops: parse(parseTimetable, text),
          at: mono,
          expires: Infinity,
        });
        slot.beforeWarned = false;
      } catch (err) {
        const code = err?.code;
        if (this.gone(gen) || code === 'aborted') return;
        if (code === 'rate_limited' || code === 'paused' || code === 'final_refused') throw err;
        const mono = this.monotonic();
        slot.plans.set(slice.key, {
          stops: new Map(),
          missing: true,
          at: mono,
          expires: mono + PLAN_EMPTY_RETRY,
        });
        if (code !== 'not_found') {
          // One warning per outage; the rest in debug.
          const line = `Station ${slot.slot}: an hour before not read (${code ?? 'error'}), ignored`;
          if (slot.beforeWarned) this.log.debug?.(line);
          else this.log.warn(line);
          slot.beforeWarned = true;
        }
      }
    }
  }

  /** The hours before the current one (optional) and the current one and later (required). */
  splitWindow(needed, now) {
    const index = needed.findIndex((s) => s.key === sliceOf(now).key);
    const cut = Math.max(0, index);
    return { before: needed.slice(0, cut), required: needed.slice(cut) };
  }

  async resolve(gen, slot) {
    let text;
    try {
      text = await this.request(gen, (c, signal) => c.station(slot.input, signal), {
        principal: true,
      });
    } catch (err) {
      if (err?.code === 'refused' && !this.gone(gen)) {
        await this.refuse(err.status);
        throw new DbError('final_refused');
      }
      throw err;
    }
    if (this.gone(gen)) return;
    const found = choose(parse(parseStations, text), slot.input);
    if (found.code) {
      slot.problem = { code: found.code };
      return;
    }
    Object.assign(slot, { eva: found.eva, name: found.name, ds100: found.ds100 });
    const resolved = {
      ...this.data.resolved,
      [slot.input]: { eva: found.eva, name: found.name, ds100: found.ds100 },
    };
    const inputs = Object.keys(resolved);
    for (const input of inputs.slice(0, Math.max(0, inputs.length - MAX_RESOLVED)))
      delete resolved[input];
    this.data.resolved = resolved;
    await this.save();
    if (this.gone(gen)) return;
    await this.publishDiscovery(gen);
  }

  /** A 401/403 on a timetable page: the credentials are asked again on `/station`. */
  async secondary(gen, slot, err) {
    try {
      await this.request(gen, (c, signal) => c.station(slot.eva, signal), { principal: true });
    } catch (check) {
      if (check?.code === 'refused' && !this.gone(gen)) {
        await this.refuse(check.status);
        throw new DbError('final_refused');
      }
      throw check;
    }
    if (this.gone(gen)) return;
    const delay =
      slot.wait?.kind === 'secondary'
        ? Math.min(SECONDARY_MAX, slot.wait.delay * 2)
        : SECONDARY_MIN;
    slot.wait = { kind: 'secondary', due: this.monotonic() + delay, delay };
    slot.problem = { code: 'secondary', status: err.status, until: this.now() + delay };
  }

  /** A 5xx on a timetable page of one station: that station waits, the others go on. */
  holdStation(slot, err) {
    const doubled =
      slot.wait?.kind === 'server'
        ? Math.min(STATION_RETRY_MAX, slot.wait.delay * 2)
        : STATION_RETRY_MIN;
    // What DB asks for is honoured, up to the longest pause (6 h).
    const delay = Math.min(
      PAUSE_MAX,
      Math.max(doubled, finite(err.retryAfter) ? err.retryAfter : 0),
    );
    slot.wait = { kind: 'server', due: this.monotonic() + delay, delay };
    slot.lastServer = err;
    slot.problem = { code: 'server_station', status: err.status, until: this.now() + delay };
  }

  /** The planned hours a board needs: the hour before (late trains) to the end of the window. */
  windowOf(now) {
    return slicesBetween(
      now - LOOKBACK_MINUTES * MINUTE,
      now + this.config.lookaheadMinutes * MINUTE,
    ).slice(0, MAX_PLAN_HOURS);
  }

  // --- Boards and Gladys --------------------------------------------------------------

  /** The board of a station now, from what is held; undefined when the timetable is incomplete. */
  boardOf(slot, now = this.now(), mono = this.monotonic()) {
    return this.boardState(slot, now, mono).board;
  }

  /**
   * { board } or { problem }: 'partial' (an hour not held), 'not_found' (DB
   * has no plan for the current hour nor any later one of the window), 'dst'
   * (the hour repeated by the autumn change: the times are ambiguous).
   */
  boardState(slot, now = this.now(), mono = this.monotonic()) {
    if (!slot.eva) return {};
    if (berlin(now).h === berlin(now - HOUR).h) return { problem: 'dst' };
    const { before, required } = this.splitWindow(this.windowOf(now), now);
    const plans = required.map((s) => slot.plans.get(s.key));
    if (plans.some((p) => !p || mono - p.at > PLAN_MAX_AGE)) return { problem: 'partial' };
    if (plans.every((p) => p.missing)) return { problem: 'not_found' };
    // The hours before only add what they hold (a late train); never required.
    for (const slice of before) {
      const held = slot.plans.get(slice.key);
      if (held && !held.missing) plans.push(held);
    }
    const live = Boolean(slot.live && mono - slot.live.mono <= this.liveStale());
    const departures = departuresOf(
      plans.map((p) => p.stops),
      live ? slot.live.changes : undefined,
    );
    return {
      board: buildBoard(departures, {
        now,
        lookaheadMinutes: this.config.lookaheadMinutes,
        thresholdMinutes: this.config.thresholdMinutes,
        live,
        filter: { lines: slot.lines, via: slot.via },
      }),
    };
  }

  async publishBoards(gen, { tick = false } = {}) {
    const states = [];
    const now = this.now();
    const mono = this.monotonic();
    for (const slot of this.slots) {
      const { board, problem } = this.boardState(slot, now, mono);
      if (!board) {
        // Nothing usable: the station does not count as read (the minute
        // tick publishes only, it never changes the status).
        if (problem && !tick) {
          // The cause of a failed read stays the one shown.
          if (!slot.problem) slot.problem = { code: problem };
          slot.okRound = 0;
        }
        continue;
      }
      if (!board.live && !slot.problem && !tick) slot.problem = { code: 'stale' };
      states.push(
        ...statesOf(this.gladys, slot, board, {
          language: this.config.language,
          lookaheadMinutes: this.config.lookaheadMinutes,
        }),
      );
    }
    if (this.gone(gen) || !states.length) return;
    try {
      await this.gladys.publishChangedStates(states);
      this.gladys.requestWidgetRefresh?.(WIDGETS.DEPARTURES);
    } catch (err) {
      this.log.warn(`States not published (${err?.name ?? 'Error'}): sent again next round`);
    }
  }

  async publishDiscovery(gen) {
    const devices = this.slots
      .filter((s) => s.eva)
      .map((s) => buildDevice(this.gladys, s, this.config.language));
    if (this.gone(gen)) return;
    try {
      await this.gladys.publishDiscoveredDevices(devices);
    } catch (err) {
      this.log.warn(`Discovery not published (${err?.name ?? 'Error'})`);
    }
  }

  scan() {
    return this.publishDiscovery(this.gen);
  }

  /** The status of the configuration screen, sent only when it changes. */
  async report(gen = this.gen) {
    if (this.gone(gen)) return;
    const [connected, message] = this.statusNow();
    if (this.storeState !== 'ok' && this.storeState !== 'pending') {
      for (const lang of ['en', 'fr']) message[lang] += t('storage', lang);
    }
    for (const lang of ['en', 'fr']) message[lang] = bound(message[lang].trim(), MAX_STATUS);
    const key = JSON.stringify([connected, message]);
    if (key === this.lastStatus) return;
    await this.setStatus(connected, message, key);
  }

  async setStatus(connected, message, key = JSON.stringify([connected, message])) {
    try {
      await this.gladys.setConnectionStatus(connected, message);
      this.lastStatus = key;
    } catch (err) {
      this.log.warn(`Status not sent (${err?.name ?? 'Error'})`);
    }
  }

  statusNow() {
    const problem = credentialProblem(this.config);
    if (problem) return [false, both(problem)];
    if (this.isRefused()) return [false, both('refused', { status: this.refused.status })];
    if (!this.slots.length) return [false, both('noStation')];
    if (this.pauseActive()) {
      const key = this.pause.code === 'rate_limited' ? 'rateLimited' : 'server';
      return [false, both(key, { time: clock(this.pause.until), status: this.pause.status })];
    }
    if (!this.round_) {
      const wait = Math.max(0, (this.dueMono ?? this.monotonic()) - this.monotonic());
      return [false, both('starting', { time: clock(this.now() + wait) })];
    }
    const count = this.slots.length;
    const ok = this.slots.filter((s) => s.okRound === this.round_ && !s.problem).length;
    const read = this.slots.filter((s) => s.okRound === this.round_).length;
    const first = this.slots.find((s) => s.problem);
    const problemText = (lang) =>
      first
        ? t(`problem_${first.problem.code}`, lang, {
            slot: first.slot,
            status: first.problem.status ?? '',
            time: first.problem.until ? clock(first.problem.until) : '',
          })
        : '';
    const time = clock(this.data.lastRound ?? this.now());
    if (ok === count) return [true, both('readAll', { time, count })];
    const message = {};
    for (const lang of ['en', 'fr']) {
      message[lang] =
        read > 0
          ? t('readSome', lang, { time, ok: read, count, problem: problemText(lang) })
          : t('readNone', lang, { problem: problemText(lang) });
    }
    return [read > 0, message];
  }

  // --- Buttons -----------------------------------------------------------------------

  /** Test: one `/station` request (at most every TEST_MIN_GAP); a success lifts a refusal. */
  async testConnection() {
    const problem = credentialProblem(this.config);
    if (problem) return both(problem);
    const mono = this.monotonic();
    if (this.lastTest && mono - this.lastTest.mono < TEST_MIN_GAP) {
      const seconds = Math.max(1, Math.round((mono - this.lastTest.mono) / 1000));
      const last = this.lastTest.message ?? { en: '…', fr: '…' };
      return {
        en: t('testAgain', 'en', { seconds, result: last.en }),
        fr: t('testAgain', 'fr', { seconds, result: last.fr }),
      };
    }
    if (this.pauseActive(mono)) return both('paused', { time: clock(this.pause.until) });
    const gen = this.gen;
    this.lastTest = { mono };
    const eva = this.slots.find((s) => s.eva)?.eva ?? TEST_STATION;
    let message;
    try {
      const text = await this.request(gen, (c, signal) => c.station(eva, signal), {
        ignoreRefusal: true,
        principal: true,
      });
      parse(parseStations, text);
      if (this.gone(gen)) return both('testFailed', { code: 'restarted' });
      message = both('testOk');
      if (this.refused) {
        this.refused = undefined;
        this.data.refused = null;
        await this.save();
        this.schedule(gen);
      }
    } catch (err) {
      if (this.gone(gen)) return both('testFailed', { code: 'restarted' });
      const code = err instanceof DbError ? err.code : 'bad_response';
      if (code === 'refused') {
        await this.refuse(err.status);
        message = both('testRefused', { status: err.status });
      } else if (code === 'rate_limited' || code === 'server') {
        await this.setPause(err);
        message = both('paused', { time: clock(this.pause.until) });
      } else if (code === 'paused') {
        message = both('paused', { time: clock(this.pause.until) });
      } else {
        message = both('testFailed', { code });
      }
    }
    this.lastTest.message = message;
    await this.report(gen);
    return message;
  }

  /** Find a station: the answers of `/station/<query>` (name, EVA, DS100). */
  async searchStation(fields) {
    const query = stationInput(fields?.query);
    if (!query || query.length < 2) return both('searchInvalid');
    const problem = credentialProblem(this.config);
    if (problem) return both(problem);
    if (this.isRefused()) return both('refusedKept');
    const mono = this.monotonic();
    if (this.pauseActive(mono)) return both('paused', { time: clock(this.pause.until) });
    if (mono - this.lastSearch < SEARCH_MIN_GAP) return both('searchWait');
    this.lastSearch = mono;
    const gen = this.gen;
    let list;
    try {
      list = parse(
        parseStations,
        await this.request(gen, (c, signal) => c.station(query, signal), { principal: true }),
      );
    } catch (err) {
      const code = err instanceof DbError ? err.code : 'bad_response';
      if (this.gone(gen)) return both('testFailed', { code: 'restarted' });
      if (code === 'refused') {
        await this.refuse(err.status);
        await this.report(gen);
        return both('testRefused', { status: err.status });
      }
      if (code === 'rate_limited' || code === 'server') {
        await this.setPause(err);
        await this.report(gen);
        return both('paused', { time: clock(this.pause.until) });
      }
      if (code === 'paused') return both('paused', { time: clock(this.pause.until) });
      if (code === 'final_refused') return both('refusedKept');
      return both('testFailed', { code });
    }
    if (!list.length) return both('searchNone');
    const lines = list
      .slice(0, MAX_SEARCH_RESULTS)
      .map((s) => `${s.name} — EVA ${s.eva}${s.ds100 ? ` — DS100 ${s.ds100}` : ''}`)
      .join('\n');
    if (list.length <= MAX_SEARCH_RESULTS) return { en: lines, fr: lines };
    return {
      en: `${lines}\n${t('searchMore', 'en', { count: MAX_SEARCH_RESULTS })}`,
      fr: `${lines}\n${t('searchMore', 'fr', { count: MAX_SEARCH_RESULTS })}`,
    };
  }

  // --- Widget ------------------------------------------------------------------------

  /** The departure board of a station, from what is held (never a request). */
  getWidget({ settings, language } = {}) {
    const lang = language === 'fr' ? 'fr' : 'en';
    const id = parseDeviceId(settings?.station);
    const slot = id && this.slots.find((s) => s.slot === id.slot && s.eva === id.eva);
    if (!slot) {
      return { ttl_seconds: 300, components: [{ type: 'text', text: t('widgetUnknown', lang) }] };
    }
    const heading = { type: 'text', variant: 'heading', text: bound(slot.name ?? slot.input, 40) };
    const board = this.boardOf(slot);
    if (!board) {
      return {
        ttl_seconds: 60,
        components: [heading, { type: 'text', text: t('widgetNoData', lang) }],
      };
    }
    // The core keeps 2 texts per widget (the heading and one more): the data
    // attribution rides in that second text, whatever the board holds.
    const components = [heading];
    const rows = board.rows.slice(0, 8);
    if (rows.length) {
      components.push({
        type: 'status',
        items: rows.map((d) => {
          const delay = delayOf(d);
          let value;
          let color;
          if (!board.live) {
            value = '';
            color = WIDGET_COLORS.NEUTRAL;
          } else if (d.cancelled) {
            value = t('cancelled', lang);
            color = WIDGET_COLORS.DANGER;
          } else if (delay > 0) {
            value = `+${delay} min`;
            color =
              delay >= this.config.thresholdMinutes ? WIDGET_COLORS.WARNING : WIDGET_COLORS.INFO;
          } else {
            value = t('onTime', lang);
            color = WIDGET_COLORS.SUCCESS;
          }
          if (d.platform)
            value = `${value ? `${value} · ` : ''}${t('platform', lang)} ${d.platform}`;
          return {
            label: bound(
              `${clock(d.planned)} ${d.line}${d.destination ? ` → ${d.destination}` : ''}`,
              40,
            ),
            value: bound(value || '–', 40),
            color,
          };
        }),
      });
    } else {
      components.push({
        type: 'text',
        text: `${t('none', lang, { minutes: this.config.lookaheadMinutes })} · ${t('attribution', lang)}`,
      });
      return { ttl_seconds: 60, components };
    }
    components.push({
      type: 'text',
      variant: 'caption',
      text: bound(
        board.live ? t('widgetLive', lang, { time: clock(slot.live.at) }) : t('widgetPlan', lang),
        80,
      ),
    });
    return { ttl_seconds: 60, components };
  }

  /** The ids of a station device (tests, widget settings). */
  idsOf(slot) {
    return idsOf(this.gladys, slot);
  }
}
