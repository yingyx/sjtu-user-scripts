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
const { isStableVersion, parseVersion, readManifest } = require("../tools/lib/userscripts");

const root = path.join(__dirname, "..");

function currentSources() {
  const result = new Map();
  for (const script of readManifest(root)) {
    result.set(script.id, fs.readFileSync(path.join(root, script.entry), "utf8"));
  }
  return result;
}

function fakeGit(releasedSources) {
  function scriptIdFromRef(ref) {
    return ref.match(/release\/([^:]+)/)?.[1];
  }

  return {
    refExists: (ref) => releasedSources.has(scriptIdFromRef(ref)),
    isAncestor: () => true,
    show(ref) {
      return releasedSources.get(scriptIdFromRef(ref));
    },
  };
}

function metadataVersion(source) {
  return source.match(/^\s*\/\/\s+@version\s+(\S+)/m)?.[1] || "";
}

function earlierStableVersion(version) {
  const parsed = parseVersion(version);
  if (parsed.patch > 0) return `${parsed.major}.${parsed.minor}.${parsed.patch - 1}`;
  if (parsed.minor > 0) return `${parsed.major}.${parsed.minor - 1}.0`;
  if (parsed.major > 0) return `${parsed.major - 1}.0.0`;
  return "";
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
  const publishedScripts = readManifest(root).filter((script) => {
    const configPath = path.join(root, path.dirname(script.entry), "greasyfork.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return Number.isInteger(config.greasyForkId);
  });
  const released = new Map();
  for (const script of publishedScripts) {
    const source = sources.get(script.id);
    const releasedVersion = earlierStableVersion(metadataVersion(source));
    if (releasedVersion) {
      released.set(script.id, source.replace(/^(\s*\/\/\s+@version\s+)\S+/m, `$1${releasedVersion}`));
    }
  }
  const result = detectReleases(root, {
    sourceRef: "refs/heads/main",
    commitSha: "a".repeat(40),
    git: fakeGit(released),
  });
  const expected = publishedScripts.map((script) => ({
    script_id: script.id,
    version: metadataVersion(sources.get(script.id)),
  })).filter((candidate) => isStableVersion(candidate.version));
  assert.deepEqual(result.candidates, expected);
  assert.deepEqual(result.matrix, { include: result.candidates });
  assert.equal(result.hasReleases, expected.length > 0);
  for (const script of publishedScripts) {
    const version = metadataVersion(sources.get(script.id));
    const detected = result.scripts.find((item) => item.scriptId === script.id);
    assert.equal(detected.status, isStableVersion(version) ? "release" : "release-candidate");
  }
  if (expected.length) {
    assert.match(formatSummary(result), new RegExp(`${expected.length} release candidate\\(s\\) require approval`));
  } else {
    assert.match(formatSummary(result), /No stable userscript release requires approval/);
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
