# SJTU ICS Calendar Sync

English | [简体中文](README.zh-CN.md)

SJTU ICS Calendar Sync aggregates courses, examinations, and SJTU Calendar events into a standard ICS feed. You can download it directly or publish it to a GitHub Gist for URL-based subscription from iPhone, macOS, Google Calendar, and other calendar clients.

The script runs only on:

```text
https://i.sjtu.edu.cn/kbcx/xskbcx_cxXskbcxIndex.html*
https://i.sjtu.edu.cn/kwgl/kscx_cxXsksxxIndex.html*
https://calendar.sjtu.edu.cn/ui/calendar*
```

The calendar inside My SJTU is loaded through a `calendar.sjtu.edu.cn` iframe, so the entry is also available there.

## Features

- Reads structured course, instructor, location, teaching-week, and period data and emits weekly `RRULE` recurrences with `EXDATE` exceptions.
- Reads examination dates, times, locations, and formats from the examination query endpoint.
- Reads enabled personal, meeting, course, shared, and academic calendars for a configurable date range.
- Applies explicit days off and makeup schedules, including rules that identify a source teaching week such as `2026-10-10=第4周周二`.
- Includes the university's published 2026 holiday and makeup schedule by default, with an option to disable it for separately governed populations.
- Preserves collected data across supported pages and deduplicates close cross-source events, preferring SJTU Calendar records.
- Reports overlapping timed events and marks their ICS records with `X-SJTU-CONFLICT:TRUE` without deleting either event.
- Produces ICS with the `Asia/Shanghai` timezone, stable UIDs, and UTF-8 line folding.
- Qualifies known campus and teaching-building abbreviations with the university name and official street address so mapping clients do not resolve names such as `下院` to unrelated places. Minhang teaching-building names are emitted as a continuous searchable POI name, for example `上海交通大学闵行校区下院 412`, with the room number kept separate.
- Creates an unlisted GitHub Gist, updates it on later syncs, and exposes a stable subscription URL.
- Supports manual collection, download, and publication, plus interval-limited automatic sync while a supported page is open.

## Installation

1. Install a userscript manager such as Tampermonkey or Violentmonkey.
2. Install the script from GreasyFork.
3. Sign in through SJTU SSO and open any supported page.

## Usage

1. Select **📅 SJTU ICS** in the lower-right corner.
2. Open **Settings** and configure:
   - A classic GitHub personal access token with the `gist` scope. It remains in userscript storage.
   - The Monday of the first teaching week, required to convert week numbers into dates. SJTU Calendar collection may fill it when the returned range identifies week one.
   - The built-in 2026 university schedule, enabled by default. Disable it for Medical School campuses or other populations with separate arrangements.
   - Optional manual rules, one per line: `YYYY-MM-DD=休`, `YYYY-MM-DD=周一`, or `YYYY-MM-DD=第3周周五`. Manual rules override calendar-derived and built-in rules.
   - Optional file name, calendar name, SJTU Calendar range, and automatic-sync interval.
3. Open the course, examination, and SJTU Calendar pages in turn and select **Collect current page**. Collection replaces only the matching source or term cache.
4. Select **Download ICS** for a local file, or **Publish existing data only** to create or update the Gist.
5. **Collect and sync** performs both operations for the current page. The first successful publication displays the subscription URL.
6. On iPhone, open **Settings → Apps → Calendar → Calendar Accounts → Add Account → Other → Add Subscribed Calendar** and paste the URL.

Makeup generation requires collected course data because SJTU Calendar does not contain enough information to reconstruct another weekday's complete timetable.

Automatic sync is disabled by default. When enabled, it runs only while a supported page is open, a token is configured, and the minimum interval has elapsed. It cannot operate after the browser is closed.

## Built-in 2026 schedule

| Holiday | Days off | Makeup schedule |
| --- | --- | --- |
| New Year's Day | January 1–3 | January 4 follows Friday of teaching week 16 in the 2025–2026 autumn term |
| Qingming Festival | April 4–6 | None |
| Labour Day | May 1–5 | May 9 follows Monday of teaching week 10 in the 2025–2026 spring term |
| Dragon Boat Festival | June 19–21 | None |
| Mid-Autumn Festival | September 25–27 | None |
| National Day | October 1–7 | September 20 follows Friday of week 3, and October 10 follows Tuesday of week 4, in the 2026–2027 autumn term |

Makeup rules match the academic year, term, teaching week, and weekday stored with collected courses rather than inferring the source week from the makeup date.

Common failure states:

- **Login may have expired**: sign in to the corresponding SJTU page again.
- **Enter the Monday of the first teaching week**: correct the date before collecting courses.
- GitHub `401`/`403`: verify the token and its `gist` scope.
- A subscription does not update immediately: calendar clients cache feeds on their own schedules.
- Microsoft Calendar shows only all-day academic-calendar entries: install the latest `0.1.0` development build, republish the Gist, then remove and re-add the subscribed calendar so Microsoft discards the cached invalid feed.

## Validate a generated ICS

From the repository root, run the validator against either a downloaded file or the raw Gist URL:

```powershell
npm run ics:check -- "sjtu-calendar.ics" --require-timed
npm run ics:check -- "https://gist.githubusercontent.com/<owner>/<gist-id>/raw/sjtu-calendar.ics" --require-timed --expect-summary "A known course title"
```

The command uses ICAL.js to parse RFC 5545 data, expands `RRULE` while applying `EXDATE`, and reports the actual timed and all-day occurrences by category. A successful SJTU course feed must report `PASS` and a non-zero `timed` count. `--expect-summary` can verify a known course, while `--from YYYY-MM-DD --to YYYY-MM-DD` limits the check to a semester. Categories identify the source that survives cross-source deduplication, so a course collected from SJTU Calendar can legitimately appear under `交大日历`. This catches syntactically valid files whose recurrence rules produce no visible lessons, as well as malformed date-times that permissive calendar clients may silently ignore.

## Privacy and network requests

Userscript storage contains selected course, examination, and calendar titles, times, locations, instructors, course codes, examination formats, necessary notes, source markers, adjustment rules, the GitHub token, Gist ID, settings, and last-sync time. The script does not cache or export names, student numbers, majors, classes, or other response fields unnecessary for calendar generation.

Network requests include:

- Same-origin POST requests to the signed-in `i.sjtu.edu.cn` session for courses, period times, and examinations.
- Same-origin GET requests to the signed-in `calendar.sjtu.edu.cn` session for calendar lists and events in the configured range.
- `GM_xmlhttpRequest` calls to `https://api.github.com` only after manual publication or explicitly enabled automatic sync. The uploaded ICS contains selected event titles, times, locations, and descriptions.

New Gists use `public: false`, so they are absent from public listings, but anyone with the raw subscription URL can read the calendar. Treat it as a private link. If it leaks, delete the old Gist, clear the stored Gist ID, and publish again. The token is stored in plaintext by the userscript manager and is never written to this repository or the ICS file.

## Compatibility and limitations

- Course dates depend on the correct Monday for teaching week one; update it for every term.
- Period times come from the current campus timetable returned by the academic system.
- Known campus abbreviations are expanded only when the campus can be inferred confidently. Unknown locations remain unchanged; the script does not invent building coordinates.
- Timed ICS values always include seconds (`YYYYMMDDTHHMMSS`), including when SJTU Calendar returns only hour and minute, for compatibility with strict Microsoft Calendar importers.
- Automatic holiday recognition is deliberately conservative. Outside the built-in schedule, only explicit day-off or makeup markers become rules.
- The published university notice excludes populations governed by separate Medical School or continuing-education arrangements; those users must disable the built-in rules.
- Recurrences merge only when time, location, and series identity match. Makeup occurrences remain independent.
- SJTU Calendar collection is limited to the configured date range.
- Cross-source deduplication allows at most a 15-minute start/end difference; same-source events merge only on exact times.
- Conflict detection uses half-open intervals, so back-to-back events do not conflict. Conflicts are reported but never resolved automatically.
- Automatic sync requires an open supported page and is not an independent background task.
- Endpoint or DOM changes may require a script update.
- Before publication, manually smoke-test all three sources and the iPhone subscription flow.
