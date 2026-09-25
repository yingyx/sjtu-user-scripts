// ==UserScript==
// @name         SJTU ICS Calendar Sync
// @name:zh-CN   SJTU 日历同步
// @namespace    https://github.com/yingyx/sjtu-user-scripts
// @version      0.1.0
// @description  Aggregate SJTU courses, exams, and calendar events into ICS and sync to GitHub Gist
// @description:zh-CN  将 SJTU 课表、考试与交大日历聚合为 ICS，并同步到 GitHub Gist
// @author       yingyx
// @license      UNLICENSED
// @supportURL   https://github.com/yingyx/sjtu-user-scripts/issues
// @match        https://i.sjtu.edu.cn/kbcx/xskbcx_cxXskbcxIndex.html*
// @match        https://i.sjtu.edu.cn/kwgl/kscx_cxXsksxxIndex.html*
// @match        https://calendar.sjtu.edu.cn/ui/calendar*
// @connect      api.github.com
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const STORAGE_KEY = "sjtu-ics-state-v1";
  const SOURCE_LABELS = { courses: "教务课表", exams: "考试安排", calendar: "交大日历" };
  const CAMPUS_LOCATIONS = [
    { key: "闵行", name: "上海交通大学闵行校区", address: "上海市闵行区东川路800号" },
    { key: "徐汇", name: "上海交通大学徐汇校区", address: "上海市徐汇区华山路1954号" },
    { key: "七宝", name: "上海交通大学七宝校区", address: "上海市闵行区七莘路2678号" },
    { key: "黄浦", name: "上海交通大学黄浦校区", address: "上海市黄浦区重庆南路227号" },
    { key: "长宁", name: "上海交通大学长宁校区", address: "上海市长宁区法华镇路535号" },
  ];
  const OFFICIAL_2026_ADJUSTMENTS = [
    { start: "2026-01-01", end: "2026-01-03", type: "off", label: "元旦放假" },
    { date: "2026-01-04", type: "makeup", termKey: "2025:3", sourceWeek: 16, sourceWeekday: 5, label: "秋季第16周周五课表" },
    { start: "2026-04-04", end: "2026-04-06", type: "off", label: "清明节放假" },
    { start: "2026-05-01", end: "2026-05-05", type: "off", label: "劳动节放假" },
    { date: "2026-05-09", type: "makeup", termKey: "2025:12", sourceWeek: 10, sourceWeekday: 1, label: "春季第10周周一课表" },
    { start: "2026-06-19", end: "2026-06-21", type: "off", label: "端午节放假" },
    { start: "2026-09-25", end: "2026-09-27", type: "off", label: "中秋节放假" },
    { start: "2026-10-01", end: "2026-10-07", type: "off", label: "国庆节放假" },
    { date: "2026-09-20", type: "makeup", termKey: "2026:3", sourceWeek: 3, sourceWeekday: 5, label: "秋季第3周周五课表" },
    { date: "2026-10-10", type: "makeup", termKey: "2026:3", sourceWeek: 4, sourceWeekday: 2, label: "秋季第4周周二课表" },
  ];
  const DEFAULT_STATE = {
    settings: {
      token: "",
      gistId: "",
      gistOwner: "",
      filename: "sjtu-calendar.ics",
      calendarName: "SJTU 聚合日历",
      termStart: "",
      adjustments: "",
      officialAdjustments2026: true,
      daysBack: 30,
      daysForward: 365,
      autoSync: false,
      intervalHours: 6,
    },
    sources: {},
    lastSyncAt: 0,
    feedUrl: "",
  };

  let state = loadState();
  let statusElement = null;

  function loadState() {
    const saved = GM_getValue(STORAGE_KEY, null);
    if (!saved || typeof saved !== "object") return structuredClone(DEFAULT_STATE);
    return {
      ...structuredClone(DEFAULT_STATE),
      ...saved,
      settings: { ...DEFAULT_STATE.settings, ...(saved.settings || {}) },
      sources: saved.sources && typeof saved.sources === "object" ? saved.sources : {},
    };
  }

  function saveState() {
    GM_setValue(STORAGE_KEY, state);
  }

  function detectSource() {
    if (location.hostname === "calendar.sjtu.edu.cn") return "calendar";
    if (location.pathname.includes("/kbcx/xskbcx_")) return "courses";
    if (location.pathname.includes("/kwgl/kscx_")) return "exams";
    return null;
  }

  function setStatus(message, type = "info") {
    if (!statusElement) return;
    statusElement.textContent = message;
    statusElement.dataset.type = type;
  }

  function normalizeText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function formatLocalDate(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function addDays(dateText, amount) {
    const date = new Date(`${dateText}T00:00:00`);
    date.setDate(date.getDate() + amount);
    return formatLocalDate(date);
  }

  function toLocalDateTime(date, time) {
    return `${date} ${time}:00`;
  }

  function weekdayNumber(value) {
    const labels = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
    const match = String(value || "").match(/(?:周|星期)?([一二三四五六日天])/);
    return match ? labels[match[1]] : null;
  }

  function parseManualAdjustments(text) {
    const adjustments = new Map();
    for (const rawLine of String(text || "").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const match = line.match(/^(\d{4}-\d{2}-\d{2})\s*[=:：]\s*(休|停课|放假|(?:第\s*(\d+)\s*周\s*)?(?:周|星期)?[一二三四五六日天])$/);
      if (!match) continue;
      const sourceWeekday = weekdayNumber(match[2]);
      adjustments.set(match[1], {
        date: match[1],
        type: sourceWeekday ? "makeup" : "off",
        sourceWeekday,
        sourceWeek: match[3] ? Number(match[3]) : null,
        origin: "manual",
        label: match[2],
      });
    }
    return adjustments;
  }

  function parseSchoolAdjustment(event) {
    const title = normalizeText(event.summary || event.title);
    const date = eventDate(event.start);
    if (!date || !title) return null;
    if (title === "休" || /(?:停课|放假)/.test(title)) {
      return { date, type: "off", sourceWeekday: null, origin: "school", label: title };
    }
    const detailed = title.match(/按.*?(\d{4})-(\d{4})学年(秋季|春季|夏季)学期第\s*(\d+)\s*周(?:周|星期)([一二三四五六日天]).*?课表/);
    if (detailed) {
      const termCodes = { 秋季: 3, 春季: 12, 夏季: 16 };
      return {
        date,
        type: "makeup",
        termKey: `${detailed[1]}:${termCodes[detailed[3]]}`,
        sourceWeek: Number(detailed[4]),
        sourceWeekday: weekdayNumber(detailed[5]),
        origin: "school",
        label: title,
      };
    }
    const makeup = title.match(/(?:按|补)(?:第\s*(\d+)\s*周\s*)?(?:周|星期)([一二三四五六日天])(?:的)?(?:课表)?(?:执行|上课)?/);
    if (!makeup) return null;
    return {
      date,
      type: "makeup",
      sourceWeek: makeup[1] ? Number(makeup[1]) : null,
      sourceWeekday: weekdayNumber(makeup[2]),
      origin: "school",
      label: title,
    };
  }

  function officialAdjustments2026() {
    const adjustments = new Map();
    if (state.settings.officialAdjustments2026 === false) return adjustments;
    for (const rule of OFFICIAL_2026_ADJUSTMENTS) {
      if (rule.date) {
        adjustments.set(rule.date, { ...rule, origin: "official" });
        continue;
      }
      let date = rule.start;
      while (date <= rule.end) {
        adjustments.set(date, { ...rule, date, origin: "official" });
        date = addDays(date, 1);
      }
    }
    return adjustments;
  }

  async function postForm(url, values) {
    const response = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: new URLSearchParams(values),
    });
    if (!response.ok) throw new Error(`请求失败（HTTP ${response.status}）`);
    if (!(response.headers.get("content-type") || "").includes("json")) {
      throw new Error("登录可能已失效：服务器未返回 JSON");
    }
    return response.json();
  }

  function parseWeeks(text) {
    const weeks = new Set();
    const normalized = String(text || "").replace(/[，、]/g, ",");
    const pattern = /(\d+)(?:-(\d+))?周?(?:\((单|双)\))?/g;
    let match;
    while ((match = pattern.exec(normalized))) {
      const start = Number(match[1]);
      const end = Number(match[2] || match[1]);
      const parity = match[3];
      for (let week = start; week <= end && week <= 30; week += 1) {
        if (parity === "单" && week % 2 === 0) continue;
        if (parity === "双" && week % 2 === 1) continue;
        weeks.add(week);
      }
    }
    return [...weeks].sort((a, b) => a - b);
  }

  function periodRange(periods, text) {
    const numbers = String(text || "").match(/\d+/g)?.map(Number) || [];
    if (!numbers.length) return null;
    const first = periods.get(numbers[0]);
    const last = periods.get(numbers[numbers.length - 1]);
    return first && last ? { start: first.start, end: last.end } : null;
  }

  async function collectCourses() {
    const xnm = document.querySelector("#xnm")?.value;
    const xqm = document.querySelector("#xqm")?.value;
    if (!xnm || !xqm) throw new Error("请先在教务页面选择学年和学期");
    if (!state.settings.termStart) throw new Error("请先在插件设置中填写本学期第一周周一的日期");
    const base = { xnm, xqm };
    const data = await postForm("/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151", {
      ...base,
      kzlx: "ck",
      xsdm: "",
      kclbdm: "",
      kclxdm: "",
    });
    const campus = data.kbList?.find((item) => item.xqh_id)?.xqh_id || "02";
    const periodData = await postForm("/kbcx/xskbcx_cxRjc.html?gnmkdm=N2151", {
      ...base,
      xqh_id: campus,
    });
    const periods = new Map(
      periodData.map((item) => [Number(item.jcmc), { start: item.qssj, end: item.jssj }]),
    );
    const events = [];
    for (const course of data.kbList || []) {
      const range = periodRange(periods, course.jcs || course.jc);
      if (!range) continue;
      for (const week of parseWeeks(course.zcd)) {
        const date = addDays(state.settings.termStart, (week - 1) * 7 + Number(course.xqj || 1) - 1);
        events.push({
          source: "courses",
          sourceId: `${course.jxb_id || course.kch}-${course.xqj}-${course.jcs}-${week}`,
          seriesId: `${course.jxb_id || course.kch}-${course.xqj}-${course.jcs}-${course.cd_id || course.cdmc}`,
          termKey: `${xnm}:${xqm}`,
          courseWeek: week,
          courseWeekday: Number(course.xqj || 1),
          scheduleLike: true,
          summary: normalizeText(course.kcmc),
          start: toLocalDateTime(date, range.start),
          end: toLocalDateTime(date, range.end),
          location: normalizeText([course.xqmc, course.cdmc].filter(Boolean).join(" ")),
          description: [
            `教师：${normalizeText(course.xm)}`,
            `课程代码：${normalizeText(course.kch)}`,
            course.xkbz ? `备注：${normalizeText(course.xkbz)}` : "",
          ].filter(Boolean).join("\n"),
        });
      }
    }
    return {
      key: `courses:${xnm}:${xqm}`,
      label: `${data.xsxx?.XNMC || xnm} 第${data.xsxx?.XQMMC || xqm}学期课表`,
      events,
    };
  }

  async function collectExams() {
    const xnm = document.querySelector("#cx_xnm")?.value;
    const xqm = document.querySelector("#cx_xqm")?.value;
    if (!xnm || !xqm) throw new Error("请先在考试页面选择学年和学期");
    const data = await postForm("/kwgl/kscx_cxXsksxxIndex.html?doType=query&gnmkdm=N358105", {
      xnm,
      xqm,
      ksmcdmb_id: "",
      kch: "",
      kc: "",
      ksrq: "",
      kkbm_id: "",
      _search: "false",
      "queryModel.showCount": "5000",
      "queryModel.currentPage": "1",
      "queryModel.sortName": " ",
      "queryModel.sortOrder": "asc",
    });
    const events = [];
    for (const exam of data.items || []) {
      const match = String(exam.kssj || "").match(/(\d{4}-\d{2}-\d{2})\((\d{2}:\d{2})-(\d{2}:\d{2})\)/);
      if (!match) continue;
      events.push({
        source: "exams",
        sourceId: exam.sjbh || `${exam.kch}-${exam.kssj}`,
        summary: `考试：${normalizeText(exam.kcmc)}`,
        start: toLocalDateTime(match[1], match[2]),
        end: toLocalDateTime(match[1], match[3]),
        location: normalizeText([exam.cdxqmc || exam.xqmc, exam.cdmc].filter(Boolean).join(" ")),
        description: [
          `考试名称：${normalizeText(exam.ksmc)}`,
          `课程代码：${normalizeText(exam.kch)}`,
          `考试方式：${normalizeText(exam.ksfs)}`,
          exam.ksbz ? `备注：${normalizeText(exam.ksbz)}` : "",
        ].filter(Boolean).join("\n"),
      });
    }
    return { key: `exams:${xnm}:${xqm}`, label: `${xnm} 学年考试`, events };
  }

  async function getCalendarJson(path) {
    const response = await fetch(path, { credentials: "include" });
    if (!response.ok) throw new Error(`交大日历请求失败（HTTP ${response.status}）`);
    const body = await response.json();
    if (!body?.success) throw new Error(body?.msg || "交大日历返回错误");
    return body.data;
  }

  async function collectCalendar() {
    const now = new Date();
    const from = new Date(now);
    const to = new Date(now);
    from.setDate(from.getDate() - Number(state.settings.daysBack || 0));
    to.setDate(to.getDate() + Number(state.settings.daysForward || 0));
    const fromDate = formatLocalDate(from);
    const toDate = formatLocalDate(to);
    const calendars = await getCalendarJson("/api/calendar/list");
    const names = new Map(
      [...(calendars.my || []), ...(calendars.share || [])].map((item) => [item.id, item.name]),
    );
    const data = await getCalendarJson(
      `/api/event/list?startDate=${encodeURIComponent(`${fromDate} 00:00`)}&endDate=${encodeURIComponent(`${toDate} 23:59`)}&weekly=false&ids=`,
    );
    const events = [];
    for (const event of data.events || []) {
      const calendarName = normalizeText(names.get(event.calendarId));
      events.push({
        source: "calendar",
        sourceId: event.eventId,
        seriesId: event.recurrence
          ? `calendar-${event.calendarId}-${normalizeText(event.title || event.titleEn)}-${String(event.startTime).slice(11)}-${normalizeText(event.location || event.locationEn)}`
          : "",
        recurring: Boolean(event.recurrence),
        calendarName,
        scheduleLike: /课程|course/i.test(calendarName),
        summary: normalizeText(event.title || event.titleEn || "日程"),
        start: event.startTime,
        end: event.endTime,
        allDay: Boolean(event.allDay),
        location: normalizeText(event.location || event.locationEn || ""),
        description: [calendarName ? `日历：${calendarName}` : "", event.description || ""]
          .filter(Boolean).join("\n"),
      });
    }
    for (const event of data.schoolCalendar?.events || []) {
      events.push({
        source: "calendar",
        sourceId: `school-${event.title}-${event.startTime}`,
        schoolCalendar: true,
        summary: normalizeText(event.title || event.titleEn || "校历"),
        start: event.startTime,
        end: event.endTime,
        allDay: true,
        location: "",
        description: "日历：校历",
      });
    }
    const firstWeeks = (data.schoolCalendar?.weeks || []).filter((week) => week.week === "第一周");
    if (!state.settings.termStart && firstWeeks.length) {
      firstWeeks.sort(
        (a, b) => Math.abs(new Date(a.startTime) - now) - Math.abs(new Date(b.startTime) - now),
      );
      state.settings.termStart = firstWeeks[0].startTime.slice(0, 10);
    }
    return { key: "calendar", label: `交大日历 ${fromDate} 至 ${toDate}`, events };
  }

  async function collectCurrentSource() {
    const source = detectSource();
    if (!source) throw new Error("当前页面不是支持的数据源");
    const collectors = { courses: collectCourses, exams: collectExams, calendar: collectCalendar };
    setStatus(`正在读取${SOURCE_LABELS[source]}…`);
    const result = await collectors[source]();
    state.sources[result.key] = {
      type: source,
      label: result.label,
      capturedAt: Date.now(),
      events: result.events,
    };
    saveState();
    refreshSummary();
    refreshFormValues();
    setStatus(`已采集 ${result.events.length} 条${SOURCE_LABELS[source]}日程`, "success");
    return result.events;
  }

  function eventDate(value) {
    return String(value || "").slice(0, 10);
  }

  function dateTimeMinutes(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    if (!match) return Number.NaN;
    return Date.UTC(
      Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]),
    ) / 60000;
  }

  function canonicalLocation(value) {
    return normalizeText(value).replace(/^(?:闵行|徐汇|七宝|浦东|崇明)(?:校区)?\s*/u, "").replace(/\s+/g, "").toLowerCase();
  }

  function campusForLocation(value) {
    const location = normalizeText(value);
    const explicit = CAMPUS_LOCATIONS.find((campus) => new RegExp(
      `(?:上海交通大学)?${campus.key}(?:校区)?`, "u",
    ).test(location));
    if (explicit) return explicit;
    if (/^(?:(?:东)?(?:上|中|下)院)(?=$|[\s\-A-Za-z0-9（(])/u.test(location)) {
      return CAMPUS_LOCATIONS[0];
    }
    return null;
  }

  function exportedLocation(value) {
    const location = normalizeText(value);
    if (!location) return "";
    const campus = campusForLocation(location);
    if (!campus) return location;
    const venue = location
      .replace(new RegExp(`^(?:上海交通大学)?\\s*${campus.key}(?:校区)?\\s*`, "u"), "")
      .trim();
    const teachingBuilding = /^(东?[上中下]院)(?:\s*[-－]?\s*)?(.*)$/u.exec(venue);
    if (campus.key === "闵行" && teachingBuilding) {
      const [, building, room] = teachingBuilding;
      return `${campus.name}${building}${room ? ` ${room}` : ""}，${campus.address}`;
    }
    return `${campus.name}${venue ? ` ${venue}` : ""}，${campus.address}`;
  }

  function sameLogicalEvent(left, right) {
    if (normalizeText(left.summary).toLowerCase() !== normalizeText(right.summary).toLowerCase()) return false;
    if (eventDate(left.start) !== eventDate(right.start) || Boolean(left.allDay) !== Boolean(right.allDay)) return false;
    const leftLocation = canonicalLocation(left.location);
    const rightLocation = canonicalLocation(right.location);
    if (leftLocation && rightLocation && leftLocation !== rightLocation) return false;
    if (left.allDay) return true;
    const startDelta = Math.abs(dateTimeMinutes(left.start) - dateTimeMinutes(right.start));
    const endDelta = Math.abs(dateTimeMinutes(left.end) - dateTimeMinutes(right.end));
    const tolerance = left.source === right.source ? 0 : 15;
    return startDelta <= tolerance && endDelta <= tolerance;
  }

  function deriveScheduleAdjustments(events) {
    const adjustments = officialAdjustments2026();
    for (const event of events) {
      if (!event.schoolCalendar) continue;
      const adjustment = parseSchoolAdjustment(event);
      if (adjustment) adjustments.set(adjustment.date, adjustment);
    }
    for (const [date, adjustment] of parseManualAdjustments(state.settings.adjustments)) {
      adjustments.set(date, adjustment);
    }
    return adjustments;
  }

  function academicWeekForDate(date) {
    if (!state.settings.termStart) return null;
    const start = new Date(`${state.settings.termStart}T00:00:00`);
    const target = new Date(`${date}T00:00:00`);
    return Math.floor((target - start) / 604800000) + 1;
  }

  function applyScheduleAdjustments(events, adjustments) {
    let adjusted = events.filter((event) => {
      const rule = adjustments.get(eventDate(event.start));
      return !(rule && event.scheduleLike);
    });
    const courseEvents = events.filter((event) => event.source === "courses");
    for (const rule of adjustments.values()) {
      if (rule.type !== "makeup") continue;
      const targetWeek = rule.sourceWeek || academicWeekForDate(rule.date);
      if (!targetWeek) continue;
      let candidates = courseEvents.filter(
        (event) => event.courseWeek === targetWeek
          && event.courseWeekday === rule.sourceWeekday
          && (!rule.termKey || event.termKey === rule.termKey),
      );
      if (!rule.termKey) {
        const termKeys = [...new Set(candidates.map((event) => event.termKey || "legacy"))];
        if (termKeys.length > 1) {
          termKeys.sort((left, right) => {
            const distance = (termKey) => Math.min(...candidates
              .filter((event) => (event.termKey || "legacy") === termKey)
              .map((event) => Math.abs(dateDifference(eventDate(event.start), rule.date))));
            return distance(left) - distance(right);
          });
          candidates = candidates.filter((event) => (event.termKey || "legacy") === termKeys[0]);
        }
      }
      const replacements = candidates
        .map((event) => ({
          ...event,
          sourceId: `${event.sourceId}-makeup-${rule.date}`,
          start: `${rule.date}${String(event.start).slice(10)}`,
          end: `${rule.date}${String(event.end).slice(10)}`,
          forceSingle: true,
          description: `${event.description || ""}\n调休：${rule.date} 按周${"一二三四五六日"[rule.sourceWeekday - 1]}课表上课`.trim(),
        }));
      adjusted = adjusted.concat(replacements);
    }
    return adjusted;
  }

  function deduplicateEvents(events) {
    const priorities = { courses: 1, exams: 2, calendar: 3 };
    const ordered = [...events].sort((a, b) => (priorities[b.source] || 0) - (priorities[a.source] || 0));
    const deduplicated = [];
    for (const event of ordered) {
      if (!deduplicated.some((existing) => sameLogicalEvent(existing, event))) deduplicated.push(event);
    }
    return deduplicated.sort((a, b) => String(a.start).localeCompare(String(b.start)));
  }

  function detectConflicts(events) {
    const timed = events.filter((event) => !event.allDay && Number.isFinite(dateTimeMinutes(event.start)));
    const conflicts = [];
    for (let leftIndex = 0; leftIndex < timed.length; leftIndex += 1) {
      const left = timed[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < timed.length; rightIndex += 1) {
        const right = timed[rightIndex];
        if (eventDate(right.start) !== eventDate(left.start)) {
          if (eventDate(right.start) > eventDate(left.start)) break;
          continue;
        }
        if (dateTimeMinutes(left.start) < dateTimeMinutes(right.end)
          && dateTimeMinutes(right.start) < dateTimeMinutes(left.end)) {
          conflicts.push({ left, right });
        }
      }
    }
    return conflicts;
  }

  function buildCalendarModel() {
    const rawEvents = Object.values(state.sources).flatMap((source) => source.events || []);
    const adjustments = deriveScheduleAdjustments(rawEvents);
    const events = deduplicateEvents(applyScheduleAdjustments(rawEvents, adjustments));
    return { events, conflicts: detectConflicts(events), adjustments };
  }

  function aggregateEvents() {
    return buildCalendarModel().events;
  }

  function escapeIcs(value) {
    return String(value || "")
      .replace(/\\/g, "\\\\")
      .replace(/\r?\n/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;");
  }

  function hashText(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function icsDateTime(value) {
    const match = String(value || "").match(
      /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/,
    );
    if (!match) throw new Error(`无法生成 ICS 时间：${value}`);
    return `${match[1]}${match[2]}${match[3]}T${match[4]}${match[5]}${match[6] || "00"}`;
  }

  function icsDate(value) {
    return String(value).slice(0, 10).replace(/-/g, "");
  }

  function allDayEnd(event) {
    const startDate = eventDate(event.start);
    const endDate = eventDate(event.end || event.start);
    if (endDate > startDate && / 00:00(?::00)?$/.test(String(event.end))) return endDate;
    return addDays(endDate, 1);
  }

  function foldLine(line) {
    const chunks = [];
    let current = "";
    let bytes = 0;
    for (const character of line) {
      const size = new TextEncoder().encode(character).length;
      if (bytes + size > 73 && current) {
        chunks.push(current);
        current = ` ${character}`;
        bytes = size + 1;
      } else {
        current += character;
        bytes += size;
      }
    }
    chunks.push(current);
    return chunks.join("\r\n");
  }

  function dateDifference(left, right) {
    return Math.round((new Date(`${right}T00:00:00Z`) - new Date(`${left}T00:00:00Z`)) / 86400000);
  }

  function greatestCommonDivisor(left, right) {
    let a = Math.abs(left);
    let b = Math.abs(right);
    while (b) [a, b] = [b, a % b];
    return a;
  }

  function compressRecurringEvents(events) {
    const groups = new Map();
    const singles = [];
    for (const event of events) {
      if (!event.seriesId || event.forceSingle || event.allDay) {
        singles.push(event);
        continue;
      }
      const key = [event.seriesId, String(event.start).slice(11), String(event.end).slice(11), canonicalLocation(event.location)].join("|");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(event);
    }
    const compressed = [...singles];
    for (const group of groups.values()) {
      group.sort((a, b) => String(a.start).localeCompare(String(b.start)));
      if (group.length < 2) {
        compressed.push(...group);
        continue;
      }
      const firstDate = eventDate(group[0].start);
      const weekOffsets = group.slice(1).map((event) => dateDifference(firstDate, eventDate(event.start)) / 7);
      if (weekOffsets.some((offset) => !Number.isInteger(offset))) {
        compressed.push(...group);
        continue;
      }
      const interval = Math.max(1, weekOffsets.reduce(greatestCommonDivisor));
      const lastDate = eventDate(group[group.length - 1].start);
      const count = dateDifference(firstDate, lastDate) / (interval * 7) + 1;
      const actualDates = new Set(group.map((event) => eventDate(event.start)));
      const exdates = [];
      for (let index = 0; index < count; index += 1) {
        const expected = addDays(firstDate, index * interval * 7);
        if (!actualDates.has(expected)) exdates.push(`${expected}${String(group[0].start).slice(10)}`);
      }
      compressed.push({
        ...group[0],
        sourceId: group[0].seriesId,
        recurrenceRule: { interval, count, exdates },
        _members: group,
      });
    }
    return compressed.sort((a, b) => String(a.start).localeCompare(String(b.start)));
  }

  function buildIcs(events) {
    const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const conflicts = detectConflicts(events);
    const conflicted = new Set(conflicts.flatMap((conflict) => [conflict.left, conflict.right]));
    const outputEvents = compressRecurringEvents(events);
    const lines = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//sjtu-user-scripts//SJTU ICS//ZH-CN",
      "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${escapeIcs(state.settings.calendarName)}`,
      "X-WR-TIMEZONE:Asia/Shanghai", "BEGIN:VTIMEZONE", "TZID:Asia/Shanghai", "BEGIN:STANDARD",
      "DTSTART:19700101T000000", "TZOFFSETFROM:+0800", "TZOFFSETTO:+0800", "TZNAME:CST",
      "END:STANDARD", "END:VTIMEZONE",
    ];
    for (const event of outputEvents) {
      const identity = `${event.source}|${event.sourceId}|${event.summary}|${event.start}`;
      lines.push("BEGIN:VEVENT", `UID:${hashText(identity)}@sjtu-ics`, `DTSTAMP:${now}`);
      if (event.allDay) {
        lines.push(`DTSTART;VALUE=DATE:${icsDate(event.start)}`);
        lines.push(`DTEND;VALUE=DATE:${icsDate(allDayEnd(event))}`);
      } else {
        lines.push(`DTSTART;TZID=Asia/Shanghai:${icsDateTime(event.start)}`);
        lines.push(`DTEND;TZID=Asia/Shanghai:${icsDateTime(event.end)}`);
      }
      if (event.recurrenceRule) {
        lines.push(`RRULE:FREQ=WEEKLY;INTERVAL=${event.recurrenceRule.interval};COUNT=${event.recurrenceRule.count}`);
        if (event.recurrenceRule.exdates.length) {
          lines.push(`EXDATE;TZID=Asia/Shanghai:${event.recurrenceRule.exdates.map(icsDateTime).join(",")}`);
        }
      }
      lines.push(`SUMMARY:${escapeIcs(event.summary)}`);
      if (event.location) lines.push(`LOCATION:${escapeIcs(exportedLocation(event.location))}`);
      if (event.description) lines.push(`DESCRIPTION:${escapeIcs(event.description)}`);
      if ((event._members || [event]).some((member) => conflicted.has(member))) lines.push("X-SJTU-CONFLICT:TRUE");
      lines.push(`CATEGORIES:${escapeIcs(SOURCE_LABELS[event.source] || "SJTU")}`, "END:VEVENT");
    }
    lines.push("END:VCALENDAR");
    return `${lines.map(foldLine).join("\r\n")}\r\n`;
  }

  function downloadIcs() {
    const events = aggregateEvents();
    if (!events.length) throw new Error("尚未采集任何日程");
    const blob = new Blob([buildIcs(events)], { type: "text/calendar;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = state.settings.filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    setStatus(`已下载包含 ${events.length} 条日程的 ICS`, "success");
  }

  function gistRequest(method, path, body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url: `https://api.github.com${path}`,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${state.settings.token}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        data: JSON.stringify(body),
        timeout: 30000,
        onload(response) {
          let json;
          try { json = JSON.parse(response.responseText || "{}"); }
          catch { reject(new Error("GitHub 返回了无法解析的响应")); return; }
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(json.message || `GitHub 请求失败（HTTP ${response.status}）`));
            return;
          }
          resolve(json);
        },
        onerror: () => reject(new Error("无法连接 GitHub API")),
        ontimeout: () => reject(new Error("GitHub API 请求超时")),
      });
    });
  }

  async function publishGist() {
    const events = aggregateEvents();
    if (!events.length) throw new Error("尚未采集任何日程");
    if (!state.settings.token) throw new Error("请先填写具有 gist 权限的 GitHub Token");
    const filename = state.settings.filename || "sjtu-calendar.ics";
    const body = {
      description: "SJTU calendar feed generated by sjtu-ics",
      files: { [filename]: { content: buildIcs(events) } },
    };
    setStatus(state.settings.gistId ? "正在更新 GitHub Gist…" : "正在创建私密 GitHub Gist…");
    const result = state.settings.gistId
      ? await gistRequest("PATCH", `/gists/${encodeURIComponent(state.settings.gistId)}`, body)
      : await gistRequest("POST", "/gists", { ...body, public: false });
    state.settings.gistId = result.id;
    state.settings.gistOwner = result.owner?.login || state.settings.gistOwner;
    state.feedUrl = state.settings.gistOwner
      ? `https://gist.githubusercontent.com/${encodeURIComponent(state.settings.gistOwner)}/${encodeURIComponent(result.id)}/raw/${encodeURIComponent(filename)}`
      : result.files?.[filename]?.raw_url || "";
    state.lastSyncAt = Date.now();
    saveState();
    refreshFormValues();
    refreshSummary();
    setStatus(`已同步 ${events.length} 条日程到 GitHub Gist`, "success");
  }

  async function captureAndPublish() {
    await collectCurrentSource();
    await publishGist();
  }

  function saveSettings(form) {
    const data = new FormData(form);
    state.settings = {
      ...state.settings,
      token: normalizeText(data.get("token")),
      gistId: normalizeText(data.get("gistId")),
      filename: normalizeText(data.get("filename")) || "sjtu-calendar.ics",
      calendarName: normalizeText(data.get("calendarName")) || "SJTU 聚合日历",
      termStart: String(data.get("termStart") || ""),
      adjustments: String(data.get("adjustments") || ""),
      officialAdjustments2026: data.get("officialAdjustments2026") === "on",
      daysBack: Math.max(0, Number(data.get("daysBack") || 0)),
      daysForward: Math.max(1, Number(data.get("daysForward") || 365)),
      autoSync: data.get("autoSync") === "on",
      intervalHours: Math.max(1, Number(data.get("intervalHours") || 6)),
    };
    saveState();
    refreshSummary();
    setStatus("设置已保存", "success");
  }

  function clearCapturedData() {
    if (!window.confirm("清除本地缓存的全部日程？GitHub Gist 不会被删除。")) return;
    state.sources = {};
    saveState();
    refreshSummary();
    setStatus("已清除本地采集的日程；Gist 未受影响", "success");
  }

  function createUi() {
    const host = document.createElement("div");
    host.id = "sjtu-ics-root";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; } * { box-sizing: border-box; } button, input { font: inherit; }
        #toggle { position: fixed; right: 22px; bottom: 22px; z-index: 2147483646; border: 0; border-radius: 999px; padding: 11px 16px; color: white; background: #9e1b32; box-shadow: 0 5px 18px #0004; cursor: pointer; font: 600 14px/1.2 system-ui, sans-serif; }
        #panel { position: fixed; right: 22px; bottom: 72px; z-index: 2147483647; width: min(390px, calc(100vw - 30px)); max-height: calc(100vh - 100px); overflow: auto; display: none; color: #222; background: #fff; border: 1px solid #ddd; border-radius: 14px; box-shadow: 0 12px 35px #0004; font: 14px/1.45 system-ui, sans-serif; }
        #panel.open { display: block; } header { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid #eee; }
        h2 { margin: 0; font-size: 17px; } main { padding: 14px 16px 16px; } .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        button.action { border: 1px solid #9e1b32; border-radius: 8px; padding: 8px; color: #9e1b32; background: white; cursor: pointer; }
        button.primary { color: white; background: #9e1b32; } button.danger { border-color: #aaa; color: #555; }
        details { margin-top: 13px; border-top: 1px solid #eee; padding-top: 10px; } summary { cursor: pointer; font-weight: 600; }
        label { display: block; margin-top: 9px; color: #444; } input[type=text], input[type=password], input[type=date], input[type=number], textarea { width: 100%; margin-top: 3px; border: 1px solid #bbb; border-radius: 6px; padding: 7px 8px; color: #222; background: white; } textarea { min-height: 76px; resize: vertical; }
        .inline { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; } .check { display: flex; gap: 7px; align-items: center; }
        #summary { margin: 0 0 11px; padding: 9px; border-radius: 8px; background: #f6f6f6; white-space: pre-line; }
        #status { min-height: 20px; margin: 10px 0 0; color: #555; } #status[data-type=success] { color: #176b35; } #status[data-type=error] { color: #b42318; }
        #feed { overflow-wrap: anywhere; font-size: 12px; } #feed a { color: #075ea8; } .muted { color: #666; font-size: 12px; }
        #conflict-list { margin: 8px 0 0; padding-left: 20px; font-size: 12px; } #conflict-list li { margin: 4px 0; }
      </style>
      <button id="toggle" type="button">📅 SJTU ICS</button>
      <section id="panel" aria-label="SJTU ICS 设置">
        <header><h2>SJTU 日历同步</h2><button id="close" class="action" type="button">关闭</button></header>
        <main>
          <p id="summary"></p>
          <details id="conflict-box"><summary id="conflict-summary">时间冲突：0 组</summary><ul id="conflict-list"></ul></details>
          <div class="actions">
            <button id="capture" class="action" type="button">采集当前页面</button><button id="download" class="action" type="button">下载 ICS</button>
            <button id="sync" class="action primary" type="button">采集并同步</button><button id="publish" class="action" type="button">仅发布已有数据</button>
          </div>
          <p id="status" role="status"></p><p id="feed"></p>
          <details><summary>设置</summary><form id="settings">
            <label>GitHub Token（需 gist 权限）<input name="token" type="password" autocomplete="off"></label>
            <label>Gist ID（留空时首次同步自动创建）<input name="gistId" type="text"></label>
            <label>ICS 文件名<input name="filename" type="text"></label><label>日历显示名称<input name="calendarName" type="text"></label>
            <label>学期第一周周一（生成课表日期所需）<input name="termStart" type="date"></label>
            <label class="check"><input name="officialAdjustments2026" type="checkbox">启用学校通知中的 2026 年放假调课规则</label>
            <label>调休规则（每行“日期=休”“日期=周一”或“日期=第3周周五”）<textarea name="adjustments" placeholder="2026-10-02=休&#10;2026-10-10=第4周周二"></textarea></label>
            <div class="inline"><label>日历回溯天数<input name="daysBack" type="number" min="0" max="730"></label><label>日历前瞻天数<input name="daysForward" type="number" min="1" max="730"></label></div>
            <label class="check"><input name="autoSync" type="checkbox">打开支持页面时自动采集并同步</label>
            <label>最短自动同步间隔（小时）<input name="intervalHours" type="number" min="1" max="168"></label>
            <div class="actions" style="margin-top:12px"><button class="action primary" type="submit">保存设置</button><button id="clear" class="action danger" type="button">清除本地日程</button></div>
            <p class="muted">Token 与采集结果保存在 userscript 管理器中。创建的是不公开列出的 Gist，但获得订阅链接的人可读取日历内容。</p>
          </form></details>
        </main>
      </section>`;
    document.documentElement.append(host);
    statusElement = shadow.querySelector("#status");
    const panel = shadow.querySelector("#panel");
    shadow.querySelector("#toggle").addEventListener("click", () => panel.classList.toggle("open"));
    shadow.querySelector("#close").addEventListener("click", () => panel.classList.remove("open"));
    shadow.querySelector("#capture").addEventListener("click", () => runAction(collectCurrentSource));
    shadow.querySelector("#download").addEventListener("click", () => runAction(downloadIcs));
    shadow.querySelector("#sync").addEventListener("click", () => runAction(captureAndPublish));
    shadow.querySelector("#publish").addEventListener("click", () => runAction(publishGist));
    shadow.querySelector("#clear").addEventListener("click", clearCapturedData);
    shadow.querySelector("#settings").addEventListener("submit", (event) => {
      event.preventDefault();
      saveSettings(event.currentTarget);
    });
    host._shadow = shadow;
    refreshFormValues();
    refreshSummary();
  }

  function refreshFormValues() {
    const root = document.querySelector("#sjtu-ics-root")?._shadow;
    if (!root) return;
    const form = root.querySelector("#settings");
    for (const [name, value] of Object.entries(state.settings)) {
      const input = form.elements.namedItem(name);
      if (!input) continue;
      if (input.type === "checkbox") input.checked = Boolean(value);
      else input.value = value ?? "";
    }
  }

  function refreshSummary() {
    const root = document.querySelector("#sjtu-ics-root")?._shadow;
    if (!root) return;
    const model = buildCalendarModel();
    const sourceCount = Object.values(state.sources).reduce((total, source) => total + (source.events?.length || 0), 0);
    const sourceTypes = [...new Set(Object.values(state.sources).map((source) => SOURCE_LABELS[source.type]))];
    root.querySelector("#summary").textContent = `当前来源：${SOURCE_LABELS[detectSource()] || "未知"}\n已缓存：${sourceCount} 条（调休、去重后 ${model.events.length} 条）\n调休规则：${model.adjustments.size} 条${sourceTypes.length ? `\n数据源：${sourceTypes.join("、")}` : ""}`;
    root.querySelector("#conflict-summary").textContent = `时间冲突：${model.conflicts.length} 组`;
    const conflictList = root.querySelector("#conflict-list");
    conflictList.textContent = "";
    for (const conflict of model.conflicts.slice(0, 20)) {
      const item = document.createElement("li");
      item.textContent = `${conflict.left.start.slice(0, 16)} ${conflict.left.summary} ↔ ${conflict.right.summary}`;
      conflictList.append(item);
    }
    const feed = root.querySelector("#feed");
    feed.textContent = "";
    if (state.feedUrl) {
      const label = document.createElement("span");
      label.textContent = "订阅地址：";
      const link = document.createElement("a");
      link.href = state.feedUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = state.feedUrl;
      feed.append(label, link);
    }
  }

  async function runAction(action) {
    try { await action(); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error), "error"); }
  }

  async function maybeAutoSync() {
    if (!state.settings.autoSync || !state.settings.token) return;
    const interval = Number(state.settings.intervalHours || 6) * 60 * 60 * 1000;
    if (Date.now() - Number(state.lastSyncAt || 0) < interval) return;
    await runAction(captureAndPublish);
  }

  if (globalThis.__SJTU_ICS_TEST__) {
    Object.assign(globalThis.__SJTU_ICS_TEST__, {
      parseWeeks,
      parseManualAdjustments,
      parseSchoolAdjustment,
      officialAdjustments2026,
      applyScheduleAdjustments,
      deduplicateEvents,
      detectConflicts,
      compressRecurringEvents,
      exportedLocation,
      buildIcs,
      buildCalendarModel,
      setState(value) { state = value; },
    });
  } else {
    createUi();
    setTimeout(maybeAutoSync, 1500);
  }
})();
