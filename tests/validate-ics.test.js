const test = require("node:test");
const assert = require("node:assert/strict");
const { validateCalendar } = require("../tools/validate-ics");

function calendar(eventLines) {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN", ...eventLines, "END:VCALENDAR", ""].join("\r\n");
}

test("ICS validator expands recurring timed courses and applies EXDATE", () => {
  const ics = calendar([
    "BEGIN:VEVENT", "UID:course@test", "DTSTAMP:20260901T000000Z",
    "DTSTART:20260914T100000Z", "DTEND:20260914T114000Z",
    "RRULE:FREQ=WEEKLY;COUNT=4", "EXDATE:20260928T100000Z",
    "SUMMARY:Compiler Design", "CATEGORIES:教务课表", "END:VEVENT",
  ]);
  const report = validateCalendar(ics, {
    from: "2026-09-01", to: "2026-10-31", requireTimed: true,
    expectedCategories: ["教务课表"], expectedSummaries: ["Compiler"],
  });
  assert.equal(report.valid, true, report.errors.join("\n"));
  assert.equal(report.statistics.timedOccurrences, 3);
  assert.equal(report.statistics.categories["教务课表"], 3);
});

test("ICS validator rejects Microsoft-incompatible DATE-TIME values without seconds", () => {
  const ics = calendar([
    "BEGIN:VEVENT", "UID:course@test", "DTSTAMP:20260901T000000Z",
    "DTSTART:20260914T1000", "DTEND:20260914T1140",
    "SUMMARY:Compiler Design", "CATEGORIES:教务课表", "END:VEVENT",
  ]);
  const report = validateCalendar(ics, { from: "2026-09-01", to: "2026-10-31" });
  assert.equal(report.valid, false);
  assert.match(report.errors.join("\n"), /invalid DATE-TIME value: 20260914T1000/);
});
