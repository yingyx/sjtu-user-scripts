const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const assert = require("node:assert/strict");
const { TextEncoder } = require("node:util");

function loadSjtuIcs() {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "sjtu-ics", "sjtu-ics.user.js"),
    "utf8",
  );
  const api = {};
  const context = vm.createContext({
    __SJTU_ICS_TEST__: api,
    GM_getValue: () => null,
    GM_setValue: () => {},
    structuredClone,
    TextEncoder,
    URLSearchParams,
    Date,
    Map,
    Set,
    Math,
    Number,
    String,
    Boolean,
    Object,
    Array,
    RegExp,
    Promise,
    console,
  });
  vm.runInContext(source, context, { filename: "sjtu-ics.user.js" });
  return api;
}

function baseState(overrides = {}) {
  return {
    settings: {
      calendarName: "SJTU 测试日历",
      termStart: "2026-09-14",
      adjustments: "",
      ...overrides,
    },
    sources: {},
  };
}

function courseEvent(date, week, weekday = 1) {
  return {
    source: "courses",
    sourceId: `course-${week}-${weekday}`,
    seriesId: `course-${weekday}`,
    termKey: "2026:3",
    courseWeek: week,
    courseWeekday: weekday,
    scheduleLike: true,
    summary: "编译原理",
    start: `${date} 10:00:00`,
    end: `${date} 11:40:00`,
    location: "闵行 下院412",
    description: "教师：测试",
  };
}

test("sjtu-ics parses ordinary and odd/even teaching weeks", () => {
  const api = loadSjtuIcs();
  assert.deepEqual(Array.from(api.parseWeeks("1-16周")), Array.from({ length: 16 }, (_, index) => index + 1));
  assert.deepEqual(Array.from(api.parseWeeks("2-10周(双),14-16周(双)")), [2, 4, 6, 8, 10, 14, 16]);
});

test("sjtu-ics applies explicit days off and weekday makeup rules", () => {
  const api = loadSjtuIcs();
  api.setState(baseState({ adjustments: "2026-09-21=休\n2026-09-26=周一" }));
  const monday = courseEvent("2026-09-21", 2, 1);
  const rules = api.parseManualAdjustments("2026-09-21=休\n2026-09-26=周一");
  const adjusted = api.applyScheduleAdjustments([monday], rules);
  assert.equal(adjusted.length, 1);
  assert.equal(adjusted[0].start, "2026-09-26 10:00:00");
  assert.equal(adjusted[0].forceSingle, true);
  assert.match(adjusted[0].description, /按周一课表上课/);
  assert.equal(api.parseSchoolAdjustment({ summary: "国庆", start: "2026-10-01 00:00:00" }), null);
  assert.equal(api.parseSchoolAdjustment({ summary: "休", start: "2026-10-02 00:00:00" }).type, "off");
  assert.equal(
    api.parseSchoolAdjustment({ summary: "按周五课表上课", start: "2026-10-10 00:00:00" }).sourceWeekday,
    5,
  );
  const explicitWeek = api.parseManualAdjustments("2026-10-10=第4周周二").get("2026-10-10");
  assert.equal(explicitWeek.sourceWeek, 4);
  assert.equal(explicitWeek.sourceWeekday, 2);
});

test("sjtu-ics includes the university's published 2026 holiday and makeup schedule", () => {
  const api = loadSjtuIcs();
  api.setState(baseState({ officialAdjustments2026: true }));
  const rules = api.officialAdjustments2026();
  assert.equal(rules.size, 28);
  assert.equal(rules.get("2026-10-01").type, "off");
  assert.deepEqual(
    JSON.parse(JSON.stringify(rules.get("2026-09-20"))),
    {
      date: "2026-09-20",
      type: "makeup",
      termKey: "2026:3",
      sourceWeek: 3,
      sourceWeekday: 5,
      label: "秋季第3周周五课表",
      origin: "official",
    },
  );
  const sourceFriday = courseEvent("2026-10-02", 3, 5);
  const adjusted = api.applyScheduleAdjustments([sourceFriday], rules);
  assert.equal(adjusted.length, 1);
  assert.equal(adjusted[0].start, "2026-09-20 10:00:00");
});

test("sjtu-ics deduplicates close cross-source times without merging separate sessions", () => {
  const api = loadSjtuIcs();
  const course = courseEvent("2026-09-14", 1);
  const calendarCopy = {
    ...course,
    source: "calendar",
    sourceId: "calendar-copy",
    start: "2026-09-14 10:09:00",
    end: "2026-09-14 11:50:00",
    location: "下院412",
  };
  const later = { ...course, sourceId: "later", start: "2026-09-14 14:00:00", end: "2026-09-14 15:40:00" };
  const result = api.deduplicateEvents([course, calendarCopy, later]);
  assert.equal(result.length, 2);
  assert.equal(result[0].source, "calendar");
  assert.equal(result[1].sourceId, "later");
});

test("sjtu-ics reports overlaps but not back-to-back events", () => {
  const api = loadSjtuIcs();
  const first = courseEvent("2026-09-14", 1);
  const overlap = { ...first, source: "exams", sourceId: "exam", summary: "考试：编译原理", start: "2026-09-14 11:00:00", end: "2026-09-14 12:00:00" };
  const adjacent = { ...first, sourceId: "adjacent", summary: "下一节", start: "2026-09-14 11:40:00", end: "2026-09-14 12:40:00" };
  const conflicts = api.detectConflicts([first, overlap, adjacent]);
  assert.equal(conflicts.length, 2);
  assert.equal(
    conflicts.some((conflict) => [conflict.left, conflict.right].includes(first)
      && [conflict.left, conflict.right].includes(adjacent)),
    false,
  );
});

test("sjtu-ics emits weekly RRULE and EXDATE for recurring courses", () => {
  const api = loadSjtuIcs();
  api.setState(baseState());
  const events = [
    courseEvent("2026-09-14", 1),
    courseEvent("2026-09-21", 2),
    courseEvent("2026-10-05", 4),
  ];
  const compressed = api.compressRecurringEvents(events);
  assert.equal(compressed.length, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(compressed[0].recurrenceRule)),
    { interval: 1, count: 4, exdates: ["2026-09-28 10:00:00"] },
  );
  const ics = api.buildIcs(events);
  assert.match(ics, /RRULE:FREQ=WEEKLY;INTERVAL=1;COUNT=4/);
  assert.match(ics, /EXDATE;TZID=Asia\/Shanghai:20260928T100000/);
});

test("sjtu-ics pads missing seconds for Microsoft Calendar-compatible DATE-TIME values", () => {
  const api = loadSjtuIcs();
  api.setState(baseState());
  const event = {
    ...courseEvent("2026-09-14", 1),
    seriesId: "",
    start: "2026-09-14 10:00",
    end: "2026-09-14 11:40",
  };
  const ics = api.buildIcs([event]);
  assert.match(ics, /DTSTART;TZID=Asia\/Shanghai:20260914T100000\r\n/);
  assert.match(ics, /DTEND;TZID=Asia\/Shanghai:20260914T114000\r\n/);
  assert.doesNotMatch(ics, /:20260914T(?:1000|1140)\r\n/);
});

test("sjtu-ics qualifies SJTU campus locations without matching unrelated villages", () => {
  const api = loadSjtuIcs();
  assert.equal(
    api.exportedLocation("下院412"),
    "上海交通大学闵行校区下院 412，上海市闵行区东川路800号",
  );
  assert.equal(
    api.exportedLocation("闵行校区 东下院2-304"),
    "上海交通大学闵行校区东下院 2-304，上海市闵行区东川路800号",
  );
  assert.equal(
    api.exportedLocation("上海交通大学闵行校区 下院 213"),
    "上海交通大学闵行校区下院 213，上海市闵行区东川路800号",
  );
  assert.equal(api.exportedLocation("下院村"), "下院村");

  api.setState(baseState());
  const event = { ...courseEvent("2026-09-14", 1), seriesId: "", location: "下院412" };
  const ics = api.buildIcs([event]).replace(/\r\n[ \t]/g, "");
  assert.match(ics, /LOCATION:上海交通大学闵行校区下院 412，上海市闵行区东川路800号\r\n/);
});
