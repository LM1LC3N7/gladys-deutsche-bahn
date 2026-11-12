# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Changed

- Declared for Germany only (`countries: ["DE"]`): the Gladys catalog of an
  instance located elsewhere no longer lists it in its browse views (the
  search still finds it). Requires Gladys 5.3.0 or later.

## [0.1.1] - 2026-11-11

### Added

- First version: up to three Deutsche Bahn stations read from the official
  Timetables API of the DB API Marketplace (the user's free Client ID and API
  key), one device per station (next departure, minutes until it, its delay,
  the disrupted departures), line and direction filters, a departure board
  widget, the "Test the credentials" and "Find a station" buttons. Read-only.
- At most one request at a time, 40 a minute; pauses after 429/5xx and the
  refused credentials kept across restarts.

[Unreleased]: https://github.com/LM1LC3N7/gladys-deutsche-bahn/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-deutsche-bahn/releases/tag/v0.1.1
