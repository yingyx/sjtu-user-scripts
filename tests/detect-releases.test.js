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

function metadataVersion(source) {
  return source.match(/^\s*\/\/\s+@version\s+(\S+)/m)?.[1] || "";
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
  const releasedVersions = {
    "shuiyuan-deep-search": "0.3.0",
    "shuiyuan-privacy-mask": "0.2.0",
    "sjtu-course-assistant-plus": "0.10.0",
  };
  for (const [scriptId, version] of Object.entries(releasedVersions)) {
    released.set(scriptId, sources.get(scriptId).replace(/^(\s*\/\/\s+@version\s+)\S+/m, `$1${version}`));
  }
  const result = detectReleases(root, {
    sourceRef: "refs/heads/main",
    commitSha: "a".repeat(40),
    git: fakeGit(released),
  });
  const expected = Object.keys(releasedVersions).map((scriptId) => ({
    script_id: scriptId,
    version: metadataVersion(sources.get(scriptId)),
  })).filter((candidate) => candidate.version && !candidate.version.includes("-"));
  assert.deepEqual(result.candidates, expected);
  assert.deepEqual(result.matrix, { include: result.candidates });
  assert.equal(result.hasReleases, expected.length > 0);
  if (expected.length) {
    assert.match(formatSummary(result), new RegExp(`${expected.length} release candidate\\(s\\) require approval`));
  } else {
    assert.match(formatSummary(result), /No stable userscript release requires approval/);
    assert.equal(result.scripts.filter((script) => script.status === "release-candidate").length, 3);
  }
});

test("detector refuses unsafe release history", () => {
  const sources = currentSources();
  const unsafeGit = fakeGit(sources);
  unsafeGit.isAncestor = () => false;
  assert.throws(() => detectReleases(root, {
    sourceRef: "refs/heads/main",
    commitSha: "c".repeat(40),
    git: unsafeGit,
  }), /cannot be fast-forwarded/);
});
