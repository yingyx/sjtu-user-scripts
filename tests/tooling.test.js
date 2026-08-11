"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  compareVersions,
  latestChangelogVersion,
  parseMetadata,
  validateRepository,
} = require("../tools/lib/userscripts");

test("metadata parser keeps repeated keys", () => {
  const metadata = parseMetadata(`// ==UserScript==\n// @name Demo\n// @match https://one.example/*\n// @match https://two.example/*\n// ==/UserScript==`);
  assert.deepEqual(metadata.get("match"), ["https://one.example/*", "https://two.example/*"]);
});

test("SemVer comparison and changelog parsing are available for later migrations", () => {
  assert.equal(compareVersions("1.2.0", "1.1.9"), 1);
  assert.equal(compareVersions("1.2.0", "1.2.0"), 0);
  assert.equal(compareVersions("1.2.0-beta.1", "1.2.0"), -1);
  assert.equal(latestChangelogVersion("# Changelog\n\n## [2.3.4]\n\n- Done\n"), "2.3.4");
});

test("the current repository remains valid after the tooling refactor", () => {
  const result = validateRepository(path.join(__dirname, ".."));
  assert.deepEqual(result.errors, []);
  assert.equal(result.scripts.length, 2);
});
