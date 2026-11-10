# Deutsche Bahn

Unofficial integration, not affiliated with Deutsche Bahn. It follows up to
three stations of Deutsche Bahn (Germany) and gives, for each one, the next
departure, its delay and the disrupted departures, plus a departure board
widget. Read-only: nothing is booked or changed.

The data comes from the official **Timetables** API of the DB API
Marketplace, with your own free key. The integration never uses the private
API of the DB Navigator app.

> This integration was built from the API documentation and tested with a fake
> Gladys and a fake API only: it was never tested with real DB credentials. The
> first users' feedback is welcome on the forum.

## 1. Get your free key

1. Create an account on the
   [DB API Marketplace](https://developers.deutschebahn.com/db-api-marketplace/apis/).
2. Under **Anwendungen** (applications), create an application (a name is
   enough). Note its **Client ID** and its **Client Secret** (the API key).
3. In the **Katalog**, open the **Timetables** API, click **Abonnieren**
   (subscribe), choose the **Free** plan and your application.

## 2. Configure

- **Client ID** and **API key (Client Secret)**: both are needed; with only
  one of them nothing is sent. Kept by Gladys in its database, never shown
  again, sent only to the DB API Marketplace (in the `DB-Client-Id` and
  `DB-Api-Key` headers).
- **Station 1 to 3**: a name (`Köln Hbf`), an EVA number (`8000207`) or a
  DS100 code (`KK`). The **Find a station** button lists the stations DB
  knows for a name, with their EVA number and DS100 code. When a name matches
  several stations, enter the EVA number.
- **Lines** (optional): lines or categories separated by commas
  (`RE 5, S 12, ICE`). **Direction** (optional): part of the name of a station
  the train goes through or to (`Koblenz`).
- **Read interval**: 2 minutes by default (1 to 15).
- **Departures shown**: the next 60 minutes by default (15 to 180).
- **Disrupted from**: 5 minutes of delay by default.
- **Language of the values**: English or French.

**Test the credentials** sends one request to DB (at most every 30 seconds)
and says whether the Client ID and the API key are accepted.

## 3. The devices

Each station appears in the **Discovery** tab once DB has found it (device
name `DB <station>`, with the filters in brackets). Features, all read-only:

| Feature                     | Value                                                                          |
| --------------------------- | ------------------------------------------------------------------------------ |
| Next departure              | text, e.g. `14:05 RE 5 → Koblenz Hbf, pl. 4 instead of 3, +4 min`              |
| Next departure in           | minutes until the next departure that runs (with its delay)                    |
| Delay of the next departure | minutes, 0 when on time (live data only)                                       |
| Disrupted departures        | departures of the window cancelled or late from the threshold (live data only) |

The time shown is the planned time, local time of Germany. A cancelled train
is not "the next departure": the next one that runs is.

When there is no departure in the window, the text says so and **Next
departure in** and **Delay** are not updated (their last value stays; no 0 is
published for "none"). When the live data of DB is older than 10 minutes (2.5
intervals when longer), the text ends with "timetable only" and the delay and
the disruption count are not updated.

## 4. Dashboard

The **Deutsche Bahn departures** widget shows the next 8 departures of a
station, with the delay, the platform and the cancellations, and the time of
the live data. It uses what the integration already read: opening it sends
no request to DB.

## 5. How it reads DB, and its limits

- Every interval, for each station: the live changes (`/fchg`), one request;
  the timetable of each hour of the window (`/plan`) once an hour; the station
  itself once (kept across restarts).
- At most one request at a time, 1.5 s apart (40 a minute at most, the free
  plan allows 60). A restart, a reconnection, a save of the form or the test
  button does not make the reads come sooner than the interval (a changed
  station waits 30 s after the last read).
- **HTTP 429 or 5xx**: every request waits (Retry-After when DB gives it,
  otherwise 1 minute doubling up to 6 hours), kept across restarts.
- **HTTP 401/403 on the station request**: the credentials are refused. The
  integration stops and does not try them again by itself, even after a
  restart; enter other credentials or press **Test the credentials** (a
  success lifts the stop). A 401/403 on a timetable page is checked on the
  station request first: if the credentials are accepted there, only that
  station waits (5 minutes, doubling up to 1 hour).
- No station is started after 90 s in a round; the station left goes first
  at the next round.
- DB gives the timetable a limited time ahead only (hours far ahead have no plan yet: asked again 15 minutes later).

## 6. What is kept in /data

`/data/deutsche-bahn.json`: the time of the last round, a pause, a refusal
(8 bits of a salted hash of the credentials, nothing more) and the stations
found (name, EVA number, DS100 code). No credential. When the file cannot be
read, it is not overwritten and is read again every 10 seconds.

## Data and license

Timetable data: Deutsche Bahn AG, through the DB API Marketplace, under the
Creative Commons Attribution 4.0 license (CC BY 4.0). The widget shows the
time of the data it displays.
