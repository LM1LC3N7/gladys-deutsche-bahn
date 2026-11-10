# Deutsche Bahn for Gladys Assistant

Unofficial [Gladys Assistant](https://gladysassistant.com) external integration:
the departures of up to three Deutsche Bahn stations (next departure, delay,
cancellations, a departure board widget), read from the official **Timetables**
API of the [DB API Marketplace](https://developers.deutschebahn.com/db-api-marketplace/apis/)
with the user's free key. Read-only. Not affiliated with Deutsche Bahn.

- User documentation: [English](docs/en.md), [français](docs/fr.md).
- Built with [`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js);
  rules for contributors in [CLAUDE.md](CLAUDE.md), open points in [TODO.md](TODO.md).
- Timetable data: Deutsche Bahn AG, CC BY 4.0 (see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).

```bash
npm install
npm test
npm run lint
npm run format:check
```

Licensed under the Apache License 2.0.
