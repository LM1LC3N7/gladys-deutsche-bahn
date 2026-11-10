# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

It reads the departures of up to three **Deutsche Bahn** stations from the
official **Timetables** API of the DB API Marketplace (`/station`, `/plan`,
`/fchg`, XML), with the user's free Client ID and API key in the
`DB-Client-Id` / `DB-Api-Key` headers. Unofficial: not affiliated with
Deutsche Bahn. **Read-only**: never `onSetValue`, only GET. Never the API of
the DB Navigator app; never code of ha-db_infoscreen (AGPL).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run audit                             # npm audit --omit=dev
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run cover                             # cover.png, 800 x 534, plain Node
memcap node scripts/mutants.mjs           # mutation check of the guards (not in CI)
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only (src/handlers.js registers every handler)
src/app.js                        DbApp: rounds, pace, request lane, pauses, refusal, buttons, widget
src/db/client.js                  the only HTTP access (GET, bounded, credentials in headers, our error codes)
src/db/xml.js                     a bounded, linear XML reader (elements and attributes only)
src/db/model.js                   the answers -> stations, stops, departures (pure)
src/board.js                      the departure board of a station (pure)
src/devices.js                    the device of a station, feature keys, states (pure)
src/time.js                       local time of Germany, plan hours (pure)
src/config.js                     the form, normalized
src/store.js                      what /data keeps
src/constants.js                  API, pace, limits, manifest keys
src/i18n.js                       runtime texts (en/fr)
scripts/cover.mjs                 the cover image
scripts/mutants.mjs, mutants.json mutation check of the guards
test/                             node --test, the SDK's fake Gladys, a scripted API, a virtual clock
```

## Rules

- **The pace**: rounds an interval apart, start to start, whatever asks; the
  time of the last round is in `/data` before the first request. A changed
  station waits 30 s after the last round. Never add a request outside
  `DbApp.request()`: one in flight, REQUEST_GAP apart, pause and refusal
  checked just before sending (and decided before the next request of the
  lane goes).
- **Credentials**: only in the private fields of `TimetablesClient` and its
  headers; never in a URL, a log, a status, an error or `/data`. A 401/403 on
  `/station` is final (8 bits of a salted hash in `/data`); lifted by other
  credentials or a success of the test button. A 401/403 on `/plan`/`/fchg` is
  checked on `/station` first; accepted there, only that station waits (5 min
  doubling to 1 h). A timeout or an unreadable answer is never a refusal.
- **Pauses**: 429, a 5xx of `/station` or every station in 5xx in a round
  pause every request (Retry-After, else 1 min doubling, 6 h at most), kept
  in `/data`, on the monotonic clock. A 5xx on the page of one station holds
  that station only (1 min doubling to 30 min): never a famine of the others.
- **Unknown stays unknown**: no 0 for "no departure"; no delay for a train
  absent from `/fchg`; no delay nor count without live data of the last
  LIVE_STALE; an incomplete timetable, a window without any plan (404) or the
  repeated autumn hour publishes nothing. The hour before the window is read
  (late trains). The widget keeps 2 texts (core budget), the attribution in
  the second one.
- **Late answers**: every await of a round is followed by `gone(gen)`.
- **/data**: unreadable is not empty: never written until read, read again
  every 10 s, one read at a time; a start waits for it 5 s at most.
- **External ids are forever**: `station:<slot>-<eva>`, the `FEATURE` keys of
  `src/devices.js`, the manifest keys and actions.
- **The container rootfs is read-only.** Write only under `/data`.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md`. Never write a version heading.
- **Manifest.** Texts are `{ "en": ..., "fr": ... }`; the catalog
  `description` holds 10 to 100 characters per language; never a `default`
  on a secret, never a key starting with `gladys_`.
- **User-facing text** is bilingual (English and French): runtime messages,
  manifest texts, and `docs/en.md` / `docs/fr.md`, kept in sync. Data
  attribution (Deutsche Bahn AG, CC BY 4.0) stays in the docs, the widget
  and `THIRD_PARTY_NOTICES.md`.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network (the real-clock test uses a local
  server).
