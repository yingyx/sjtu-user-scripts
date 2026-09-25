#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const ICAL = require("ical.js");

const MAX_OCCURRENCES = 10_000;
const DAY_MS = 24 * 60 * 60 * 1000;

function usage() {
  return [
    "Usage: npm run ics:check -- <file-or-https-url> [options]",
    "",
    "Options:",
    "  --from YYYY-MM-DD          First date to expand (inclusive)",
    "  --to YYYY-MM-DD            Last date to expand (inclusive)",
    "  --expect-category <text>   Require at least one occurrence in this category",
    "  --expect-summary <text>    Require an occurrence whose title contains this text",
    "  --require-timed            Fail when the range contains no timed occurrence",
    "  --json                     Print the report as JSON",
  ].join("\n");
}

function parseArgs(argv) {
  const options = { expectedCategories: [], expectedSummaries: [], json: false, requireTimed: false };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--require-timed") options.requireTimed = true;
    else if (["--from", "--to", "--expect-category", "--expect-summary"].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      index += 1;
      if (arg === "--from") options.from = value;
      else if (arg === "--to") options.to = value;
      else if (arg === "--expect-category") options.expectedCategories.push(value);
      else options.expectedSummaries.push(value);
    } else if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
    else positional.push(arg);
  }
  if (positional.length !== 1) throw new Error("Provide exactly one ICS file or HTTPS URL");
  options.source = positional[0];
  return options;
}

function parseDateBoundary(value, endOfDay = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid date: ${value}`);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid date: ${value}`);
  }
  return endOfDay ? new Date(date.getTime() + DAY_MS) : date;
}

async function readSource(source) {
  if (/^https:\/\//i.test(source)) {
    const response = await fetch(source, {
      redirect: "follow",
      headers: { Accept: "text/calendar,text/plain;q=0.9,*/*;q=0.1", "Cache-Control": "no-cache" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    return { text: await response.text(), resolvedSource: response.url };
  }
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(source)) throw new Error("Only HTTPS URLs are supported");
  const resolvedSource = path.resolve(source);
  return { text: await fs.readFile(resolvedSource, "utf8"), resolvedSource };
}

function inspectRawDateTimes(text, errors, warnings) {
  if (!text.includes("\r\n")) warnings.push("The file does not use RFC 5545 CRLF line endings");
  const unfolded = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  for (const line of unfolded) {
    const match = /^(DTSTART|DTEND|EXDATE)(;[^:]*)?:(.*)$/i.exec(line);
    if (!match) continue;
    const [, property, parameters = "", rawValue] = match;
    const isDate = /(?:^|;)VALUE=DATE(?:;|$)/i.test(parameters);
    for (const value of rawValue.split(",")) {
      const valid = isDate ? /^\d{8}$/.test(value) : /^\d{8}T\d{6}Z?$/.test(value);
      if (!valid) errors.push(`${property} has an invalid ${isDate ? "DATE" : "DATE-TIME"} value: ${value}`);
    }
  }
}

function propertyValues(component, name) {
  return component.getAllProperties(name).flatMap((property) => property.getValues());
}

function categoriesFor(component) {
  return propertyValues(component, "categories")
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function occurrenceRecord(event, startDate, endDate, categories) {
  return {
    summary: event.summary || "(untitled)",
    start: startDate.toString(),
    end: endDate.toString(),
    allDay: startDate.isDate,
    categories,
  };
}

function validateCalendar(text, options = {}) {
  const errors = [];
  const warnings = [];
  const normalized = text.replace(/^\uFEFF/, "");
  inspectRawDateTimes(normalized, errors, warnings);

  let root;
  try {
    root = new ICAL.Component(ICAL.parse(normalized));
  } catch (error) {
    errors.push(`RFC 5545 parser rejected the file: ${error.message}`);
    return { valid: false, errors, warnings, statistics: null, occurrences: [] };
  }
  if (root.name !== "vcalendar") errors.push(`Root component is ${root.name}, not VCALENDAR`);
  if (root.getFirstPropertyValue("version") !== "2.0") errors.push("VERSION:2.0 is missing");

  const components = root.getAllSubcomponents("vevent");
  if (!components.length) errors.push("No VEVENT components were found");
  const masters = components.filter((component) => !component.hasProperty("recurrence-id"));
  const events = masters.map((component) => ({ component, event: new ICAL.Event(component) }));
  const uids = new Set();
  const initialStarts = [];

  for (const { component, event } of events) {
    const uid = component.getFirstPropertyValue("uid");
    if (!uid) errors.push(`VEVENT ${event.summary || "(untitled)"} has no UID`);
    else if (uids.has(uid)) errors.push(`Duplicate master UID: ${uid}`);
    else uids.add(uid);
    if (!component.hasProperty("dtstart")) {
      errors.push(`VEVENT ${event.summary || uid || "(untitled)"} has no DTSTART`);
      continue;
    }
    try {
      initialStarts.push(event.startDate.toJSDate());
      if (event.endDate.compare(event.startDate) <= 0) {
        errors.push(`VEVENT ${event.summary || uid || "(untitled)"} does not end after it starts`);
      }
    } catch (error) {
      errors.push(`VEVENT ${event.summary || uid || "(untitled)"} has invalid dates: ${error.message}`);
    }
  }

  const validStarts = initialStarts.filter((date) => !Number.isNaN(date.getTime()));
  const inferredStart = validStarts.length
    ? new Date(Math.min(...validStarts.map((date) => date.getTime())) - DAY_MS)
    : new Date();
  const rangeStart = options.from ? parseDateBoundary(options.from) : inferredStart;
  const rangeEnd = options.to
    ? parseDateBoundary(options.to, true)
    : new Date(rangeStart.getTime() + 370 * DAY_MS);
  if (rangeEnd <= rangeStart) errors.push("The expansion end must be after the start");

  const occurrences = [];
  let examined = 0;
  for (const { component, event } of events) {
    if (!component.hasProperty("dtstart")) continue;
    const categories = categoriesFor(component);
    try {
      if (event.isRecurring()) {
        const iterator = event.iterator();
        let next;
        while ((next = iterator.next())) {
          examined += 1;
          if (examined > MAX_OCCURRENCES) throw new Error(`more than ${MAX_OCCURRENCES} occurrences`);
          const details = event.getOccurrenceDetails(next);
          const start = details.startDate.toJSDate();
          if (start >= rangeEnd) break;
          if (start >= rangeStart) {
            occurrences.push(occurrenceRecord(details.item, details.startDate, details.endDate, categories));
          }
        }
      } else {
        const start = event.startDate.toJSDate();
        if (start >= rangeStart && start < rangeEnd) {
          occurrences.push(occurrenceRecord(event, event.startDate, event.endDate, categories));
        }
      }
    } catch (error) {
      errors.push(`Could not expand ${event.summary || event.uid || "(untitled)"}: ${error.message}`);
    }
  }

  occurrences.sort((left, right) => left.start.localeCompare(right.start));
  const categoryCounts = {};
  for (const occurrence of occurrences) {
    for (const category of occurrence.categories) categoryCounts[category] = (categoryCounts[category] || 0) + 1;
  }
  const timedOccurrences = occurrences.filter((occurrence) => !occurrence.allDay);
  if (options.requireTimed && !timedOccurrences.length) errors.push("No timed occurrences exist in the selected range");
  for (const category of options.expectedCategories || []) {
    if (!categoryCounts[category]) errors.push(`No occurrences found for category: ${category}`);
  }
  for (const summary of options.expectedSummaries || []) {
    const needle = summary.toLocaleLowerCase();
    if (!occurrences.some((occurrence) => occurrence.summary.toLocaleLowerCase().includes(needle))) {
      errors.push(`No occurrence title contains: ${summary}`);
    }
  }

  const statistics = {
    components: components.length,
    masterEvents: masters.length,
    recurringMasters: events.filter(({ event }) => event.isRecurring()).length,
    occurrences: occurrences.length,
    timedOccurrences: timedOccurrences.length,
    allDayOccurrences: occurrences.length - timedOccurrences.length,
    categories: categoryCounts,
    range: { from: rangeStart.toISOString(), toExclusive: rangeEnd.toISOString() },
  };
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    statistics,
    occurrences,
    sampleTimedOccurrences: timedOccurrences.slice(0, 8),
  };
}

function printHuman(report, source) {
  console.log(`${report.valid ? "PASS" : "FAIL"}: ${source}`);
  if (report.statistics) {
    const stats = report.statistics;
    console.log(`VEVENT: ${stats.components} (${stats.recurringMasters} recurring masters)`);
    console.log(`Expanded: ${stats.occurrences} occurrences (${stats.timedOccurrences} timed, ${stats.allDayOccurrences} all-day)`);
    const categories = Object.entries(stats.categories).map(([name, count]) => `${name}=${count}`).join(", ");
    console.log(`Categories: ${categories || "(none)"}`);
    console.log(`Range: ${stats.range.from.slice(0, 10)} through ${new Date(Date.parse(stats.range.toExclusive) - DAY_MS).toISOString().slice(0, 10)}`);
  }
  for (const error of report.errors) console.error(`ERROR: ${error}`);
  for (const warning of report.warnings) console.warn(`WARN: ${warning}`);
  if (report.sampleTimedOccurrences?.length) {
    console.log("Sample timed occurrences:");
    for (const occurrence of report.sampleTimedOccurrences) console.log(`  ${occurrence.start}  ${occurrence.summary}`);
  }
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  try {
    const { text, resolvedSource } = await readSource(options.source);
    const report = validateCalendar(text, options);
    if (options.json) console.log(JSON.stringify({ source: resolvedSource, ...report }, null, 2));
    else printHuman(report, resolvedSource);
    if (!report.valid) process.exitCode = 1;
  } catch (error) {
    console.error(`FAIL: ${options.source}`);
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { parseArgs, validateCalendar };
