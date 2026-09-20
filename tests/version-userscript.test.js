"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  parseReleaseCandidate,
  validateChangelogVersion,
} = require("../tools/lib/userscripts");
const {
  advanceReleaseCandidate,
  bumpedVersion,
  stabilizeReleaseCandidate,
} = require("../tools/version-userscript");

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "userscript-version-"));
  const directory = path.join(root, "scripts", "example");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(root, "scripts.json"), JSON.stringify([{
    id: "example",
    entry: "scripts/example/example.user.js",
    changelog: "scripts/example/CHANGELOG.md",
  }]), "utf8");
  fs.writeFileSync(path.join(directory, "example.user.js"), [
    "// ==UserScript==",
    "// @name Example",
    "// @version 1.2.3",
    "// ==/UserScript==",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(directory, "CHANGELOG.md"), "# Changelog\n\n## 1.2.3\n\n- Released.\n", "utf8");
  return root;
}

function readFixture(root, file) {
  return fs.readFileSync(path.join(root, "scripts", "example", file), "utf8");
}

test("release candidate parsing accepts only rc.N with a positive counter", () => {
  assert.deepEqual(parseReleaseCandidate("1.2.3-rc.4"), {
    major: 1,
    minor: 2,
    patch: 3,
    number: 4,
    stableVersion: "1.2.3",
  });
  assert.equal(parseReleaseCandidate("1.2.3-rc.0"), null);
  assert.equal(parseReleaseCandidate("1.2.3-beta.1"), null);
});

test("version bumps select the next stable release line", () => {
  assert.equal(bumpedVersion("1.2.3", "patch"), "1.2.4");
  assert.equal(bumpedVersion("1.2.3", "minor"), "1.3.0");
  assert.equal(bumpedVersion("1.2.3", "major"), "2.0.0");
  assert.throws(() => bumpedVersion("1.2.3", "build"), /requires --bump/);
});

test("RC changelogs use a non-empty Unreleased section", () => {
  assert.deepEqual(validateChangelogVersion("1.2.4-rc.1", "# Changelog\n\n## Unreleased\n\n- Change.\n\n## 1.2.3\n\n- Old.\n"), []);
  assert.match(validateChangelogVersion("1.2.4-rc.1", "# Changelog\n\n## Unreleased\n\n## 1.2.3\n")[0], /must not be empty/);
  assert.match(validateChangelogVersion("1.2.4-beta.1", "# Changelog\n\n## Unreleased\n\n- Change.\n")[0], /must use X.Y.Z-rc.N/);
  assert.match(validateChangelogVersion("1.2.4", "# Changelog\n\n## Unreleased\n\n- Change.\n\n## 1.2.4\n")[0], /must match stable/);
});

test("version helper advances an RC series and stabilizes the same target", () => {
  const root = createFixture();
  try {
    assert.equal(advanceReleaseCandidate(root, { scriptId: "example", bump: "patch" }), "1.2.4-rc.1");
    let changelog = readFixture(root, "CHANGELOG.md");
    assert.match(changelog, /^## Unreleased$/m);
    assert.throws(() => advanceReleaseCandidate(root, { scriptId: "example" }), /must not be empty/);

    changelog = changelog.replace("## Unreleased\n", "## Unreleased\n\n- Change under test.\n");
    fs.writeFileSync(path.join(root, "scripts", "example", "CHANGELOG.md"), changelog, "utf8");
    assert.equal(advanceReleaseCandidate(root, { scriptId: "example" }), "1.2.4-rc.2");
    assert.equal(stabilizeReleaseCandidate(root, { scriptId: "example" }), "1.2.4");
    assert.match(readFixture(root, "example.user.js"), /^\/\/ @version 1\.2\.4$/m);
    assert.match(readFixture(root, "CHANGELOG.md"), /^## 1\.2\.4$/m);
    assert.doesNotMatch(readFixture(root, "CHANGELOG.md"), /^## Unreleased$/m);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
