"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { classifyVersionState, formatSummary } = require("../tools/detect-releases");
const { assertVersionAdvance, createReleasePlan } = require("../tools/plan-release");

const root = path.join(__dirname, "..");

test("release candidates remain on main and never become publish candidates", () => {
  assert.equal(classifyVersionState("1.3.0-rc.1", "candidate", "1.2.0", "released"), "release-candidate");
  assert.equal(classifyVersionState("1.3.0-rc.2", "candidate", "", ""), "release-candidate");
  assert.equal(classifyVersionState("1.3.0", "candidate", "1.2.0", "released"), "release");
  assert.throws(() => classifyVersionState("1.3.0-beta.1", "candidate", "1.2.0", "released"), /must use X.Y.Z-rc.N/);
  assert.throws(() => classifyVersionState("1.3.0-rc.1", "candidate", "1.3.0", "released"), /lower than released/);
  assert.throws(() => classifyVersionState("1.3.0", "candidate", "1.2.0-rc.1", "released"), /non-stable version/);
});

test("release summaries distinguish RC validation from stable publication", () => {
  const summary = formatSummary({
    candidates: [],
    hasReleases: false,
    scripts: [{ scriptId: "example", releasedVersion: "1.2.0", version: "1.3.0-rc.2", status: "release-candidate" }],
  });
  assert.match(summary, /release-candidate/);
  assert.match(summary, /No stable userscript release requires approval/);
});

test("every release entry point rejects prerelease versions", () => {
  assert.throws(() => assertVersionAdvance("1.3.0-rc.2", "1.2.0"), /must be stable SemVer/);
  assert.throws(() => assertVersionAdvance("1.3.0", "1.2.0-rc.2"), /must be stable SemVer/);
  assert.throws(() => createReleasePlan(root, {
    scriptId: "shuiyuan-privacy-mask",
    expectedVersion: "1.0.0-rc.1",
    sourceRef: "refs/heads/main",
  }), /Expected version must be stable SemVer/);
});

test("workflow inputs and detection steps explicitly require stable versions", () => {
  const bootstrap = fs.readFileSync(path.join(root, ".github", "workflows", "bootstrap.yml"), "utf8");
  const publish = fs.readFileSync(path.join(root, ".github", "workflows", "publish.yml"), "utf8");
  const promote = fs.readFileSync(path.join(root, ".github", "workflows", "release.yml"), "utf8");
  assert.match(bootstrap, /Stable version expected in the userscript @version field/);
  assert.match(bootstrap, /Create stable first-publication plan/);
  assert.match(publish, /Detect stable publishable version changes/);
  assert.match(promote, /Stable version expected in the userscript @version field/);
});
