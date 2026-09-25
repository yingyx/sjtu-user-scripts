# Changelog

## 0.1.0

- Initial release for aggregating SJTU courses, examinations, and calendar events into ICS and GitHub Gist feeds.
- Generate weekly recurrence rules with exception dates and apply the university's published 2026 holiday and term-specific makeup schedules.
- Deduplicate close cross-source events, report time conflicts, and preserve makeup sessions as independent events.
- Normalize timed events to RFC 5545 `YYYYMMDDTHHMMSS` values for Microsoft Calendar compatibility.
- Add a repeatable ICAL.js-based validator that parses and expands generated feeds before calendar-client testing.
- Qualify known SJTU campus locations with official addresses and contiguous teaching-building POI names to improve Apple Calendar map matching.
