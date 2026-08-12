"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  classifyVersionState,
  detectReleases,
  formatSummary,
  parseArguments,
} = require("../tools/detect-releases");
const { readManifest } = require("../tools/lib/userscripts");

const root = path.join(__dirname, "..");

function currentSources() {
  const result = new Map();
  for (const script of readManifest(root)) {
    result.set(script.id, fs.readFileSync(path.join(root, script.entry), "utf8"));
  }
  return result;
}

function fakeGit(releasedSources) {
  return {
    refExists: () => true,
    isAncestor: () => true,
    show(ref) {
      const scriptId = ref.match(/release\/([^:]+)/)?.[1];
      return releasedSources.get(scriptId);
    },
  };
}

test("automatic release arguments require explicit values", () => {
  assert.deepEqual(parseArguments([
    "--remote", "upstream",
    "--source-ref", "refs/heads/main",
    "--commit-sha", "a".repeat(40),
  ]), {
    remote: "upstream",
    sourceRef: "refs/heads/main",
    commitSha: "a".repeat(40),
  });
  assert.throws(() => parseArguments(["--unknown", "value"]), /Unknown option/);
});

test("version-state classification detects releases and same-version drift", () => {
  assert.equal(classifyVersionState("1.2.0", "same\n", "1.2.0", "same\r\n"), "current");
  assert.equal(classifyVersionState("1.2.0", "candidate", "1.1.9", "released"), "release");
  assert.equal(classifyVersionState("1.0.0", "candidate", "", ""), "release");
  assert.throws(
    () => classifyVersionState("1.2.0", "changed", "1.2.0", "released"),
    /without advancing @version/,
  );
  assert.throws(
    () => classifyVersionState("1.1.9", "candidate", "1.2.0", "released"),
    /lower than released version/,
  );
});

test("detector creates an independent matrix only for advanced scripts", () => {
  const sources = currentSources();
  const released = new Map(sources);
  released.set(
    "sjtu-course-assistant-plus",
    sources.get("sjtu-course-assistant-plus").replace("@version      0.8.2", "@version      0.8.1"),
  );
  const result = detectReleases(root, {
    sourceRef: "refs/heads/main",
    commitSha: "a".repeat(40),
    git: fakeGit(released),
  });
  assert.deepEqual(result.candidates, [{ script_id: "sjtu-course-assistant-plus", version: "0.8.2" }]);
  assert.deepEqual(result.matrix, { include: result.candidates });
  assert.equal(result.hasReleases, true);
  assert.match(formatSummary(result), /1 release candidate\(s\) require approval/);
});

test("detector refuses same-version publication drift and unsafe history", () => {
  const sources = currentSources();
  const drifted = new Map(sources);
  drifted.set("shuiyuan-privacy-mask", sources.get("shuiyuan-privacy-mask").replace("Privacy Mask", "Privacy Guard"));
  assert.throws(() => detectReleases(root, {
    sourceRef: "refs/heads/main",
    commitSha: "b".repeat(40),
    git: fakeGit(drifted),
  }), /shuiyuan-privacy-mask: Published userscript content changed without advancing/);

  const unsafeGit = fakeGit(sources);
  unsafeGit.isAncestor = () => false;
  assert.throws(() => detectReleases(root, {
    sourceRef: "refs/heads/main",
    commitSha: "c".repeat(40),
    git: unsafeGit,
  }), /cannot be fast-forwarded/);
});
