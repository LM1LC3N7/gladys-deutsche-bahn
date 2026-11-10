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
- [ ] Whether `/fchg` gives a changed time `ct` for every train with live
      tracking, or only when it differs (today: no `ct` = no delay known =
      0 when the live data is fresh).
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
- [ ] `keywords` / `countries` (`DE`) and `gladys_version >= 5.3.0` once
      Gladys 5.3 is widespread.

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
  `gladys_version >= 5.1.0` (widgets).
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
  `disrupted` unpublished; an incomplete timetable publishes nothing.
- **Times**: local time of Germany (Europe/Berlin, Intl of Node); the text
  shows the planned time.
