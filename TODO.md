# TODO

## Before announcing

- [ ] Test with real DB API Marketplace credentials (a Free plan subscribed
      to Timetables): test button, Find a station, a big station (Köln Hbf,
      Frankfurt (Main) Hbf: size of `/fchg`), a small one, a filter.
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).
- [ ] Add the `gladys-assistant-integration` topic to publish in the store
      (after the first release: the store validator needs the GHCR image).

## To confirm with the real API (built without it)

- [ ] Which status a wrong Client ID or API key gives (401 or 403) on
      `/station`, and whether a subscription missing gives the same.
- [ ] Whether the gateway answers 429 with a `Retry-After` header, and the
      real quota of the Free plan (60 requests a minute, as other clients
      say; the integration stays at 40).
- [ ] What `/plan` answers for an hour without trains or too far ahead (404
      or an empty `<timetable/>`; both are read as an empty hour).
- [x] Whether `/fchg` lists every tracked train or only the changed ones:
      not decidable from the feed (spec Timetables 1.0.213: "all known
      changes"; real dumps analysed in review r2). Decided by the
      coordinator (r2): a train absent from a fresh `/fchg` is on time
      (delay 0); "timetable only" only when `/fchg` is not fresh.
- [ ] An empty `/fchg` (no `<s>`) for a station with many planned departures
      may be a gateway failure served in 200. Decision for v1 (review r3):
      read as "nothing changed" (on time), no guard. A threshold would blank
      the delays of a quiet station at night, and nothing tells us yet that
      DB serves an empty 200 on failure. To revisit with the real API (the
      size of `/fchg` at Köln Hbf, 850+ stops by day, makes an empty answer
      for a big station easy to spot in the logs).
- [ ] How far back DB still serves `/plan` (the two hours before are read
      for the late trains; a 404 there is an empty hour).
- [ ] The size of `/fchg` for the biggest stations (limit: 4 MiB) and of a
      `/plan` hour (2 MiB).
- [ ] How `/station/<name>` matches (prefix, part of the name) and whether
      the DS100 code is always given.
- [ ] The hour asked on the night of the autumn change (02:00 to 03:00 twice):
      the first one is taken.

## Later

- [ ] Messages of DB (`<m>`: causes of delays, HIM messages) in the text or the
      widget.
- [ ] Arrivals (only departures today).
- [ ] Scene triggers (a train cancelled, a delay over a threshold): today a
      scene can use the device values.
- [ ] `keywords` once Gladys 5.3 is widespread (`countries: ["DE"]` and
      `gladys_version >= 5.3.0` are declared).

## Decisions

- **API**: the official Timetables API of the DB API Marketplace, the user's
  free key (`DB-Client-Id`, `DB-Api-Key`), never the private API of the DB
  Navigator app, and none of ha-db_infoscreen (AGPL, not read). Our own
  User-Agent `gladys-deutsche-bahn/<version> (+repository)`.
- **Reference**: FaserF/ha-deutschebahn (Apache-2.0) is archived since
  2025-01 (3.0.5) and scrapes bahn.de through `schiene`: not used. The client
  is written from the description of the API (headers and attributes
  confirmed in the openHAB binding's README); nothing ported, nothing to put
  in the notices but the CC BY 4.0 attribution of the data.
- **Read-only v1**: no command, no switch.
- **SDK `^0.16.0`** (latest on npm on 2026-11-10). Gladys 5.3.2 current;
  `gladys_version >= 5.3.0` (widgets need 5.1.0, `countries` 5.3.0).
- **Versions**: 0.1.0 set once by hand when leaving the template (package,
  lock file, manifest, image tag `ghcr.io/lm1lc3n7/gladys-deutsche-bahn:0.1.0`);
  the Release workflow owns them from now on.
- **Ids**: `station:<slot>-<eva>` (slot of the form, EVA number of DB): the
  same station in two slots with other filters gives two devices.
- **Refusal**: only a 401/403 on `/station` (the route that needs nothing but
  the credentials) is final; a 401/403 on `/plan` or `/fchg` is asked again on
  `/station` first. Kept as 8 bits of a salted hash of both credentials.
- **Unknown stays unknown**: no next departure leaves `next_in` and `delay`
  unpublished; no live data for 10 minutes (2.5 intervals) leaves `delay` and
  `disrupted` unpublished; an incomplete timetable publishes nothing. With a
  fresh `/fchg`, a train it does not list is on time (DB's convention).
- **Counter**: `disrupted` is `counter-sensor` / `integer` ("Counter
  (integer)" in the core: a count that goes up and down, as the bike
  counts of the transit siblings), the closest generic category.
- **5xx**: on the timetable of one station, that station waits (1 min doubling
  to 30 min); a global pause only for 429, a 5xx of `/station`, or every
  station in 5xx in a round (review r1).
- **Times**: local time of Germany (Europe/Berlin, Intl of Node); the text
  shows the planned time.
