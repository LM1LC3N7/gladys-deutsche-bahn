# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains no code taken from another project: the client of the Timetables API
(`src/db/`) is written from the public description of the API.

## Deutsche Bahn timetable data (CC BY 4.0)

The departures, delays, platforms and cancellations the integration publishes
come from the **Timetables** API of the DB API Marketplace
(<https://developers.deutschebahn.com/db-api-marketplace/apis/product/timetables>),
by **Deutsche Bahn AG**, under the Creative Commons Attribution 4.0
International license (<https://creativecommons.org/licenses/by/4.0/>).

Changes made to the data: the planned timetable and the live changes are
merged, filtered by line and direction, and summarised (next departure, delay
in whole minutes, count of disrupted departures). The widget shows the time of
the live data it displays. Each user reads the API with their own free key.

"Deutsche Bahn" and "DB" are names of Deutsche Bahn AG, used here only to
say which service the integration reads. This integration is not affiliated
with nor endorsed by Deutsche Bahn AG.

## References read, not copied

- The openHAB Deutsche Bahn binding (EPL-2.0) and its README: used only to
  confirm the names of the request headers (`DB-Client-Id`, `DB-Api-Key`)
  and the meaning of the XML attributes. No code taken.
- FaserF/ha-deutschebahn (Apache-2.0, archived since 2025-01, version 3.0.5):
  read only to check its license; it scrapes another service (the `schiene`
  library), nothing of it is used.
