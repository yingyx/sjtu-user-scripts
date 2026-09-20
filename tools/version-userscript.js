#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  changelogHeadingVersion,
  changelogSections,
  metadataValue,
  parseMetadata,
  parseReleaseCandidate,
  parseVersion,
  readManifest,
  validateChangelogVersion,
} = require("./lib/userscripts");

function parseArguments(argv) {
  const result = {};
  const aliases = { "script-id": "scriptId" };
  const valued = new Set(["script-id", "bump"]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (!valued.has(key)) throw new Error(`Unknown option: --${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
    result[aliases[key] || key] = value;
    index += 1;
  }
  return result;
}

function scriptFiles(root, scriptId) {
  if (!scriptId) throw new Error("Missing required option: --script-id");
  const script = readManifest(root).find((item) => item.id === scriptId);
  if (!script) throw new Error(`Unknown script ID: ${scriptId}`);
  const entryPath = path.join(root, script.entry);
  const changelogPath = path.join(root, script.changelog);
  const source = fs.readFileSync(entryPath, "utf8");
  const changelog = fs.readFileSync(changelogPath, "utf8");
  const version = metadataValue(parseMetadata(source), "version");
  if (!parseVersion(version)) throw new Error(`${script.entry} has invalid @version ${version}.`);
  return { script, entryPath, changelogPath, source, changelog, version };
}

function replaceMetadataVersion(source, version) {
  let replacements = 0;
  const updated = source.replace(/^(\s*\/\/\s+@version\s+)\S+(\s*)$/m, (line, prefix, suffix) => {
    replacements += 1;
    return `${prefix}${version}${suffix}`;
  });
  if (replacements !== 1) throw new Error("Userscript must contain exactly one @version metadata line.");
  return updated;
}

function bumpedVersion(version, bump) {
  const parsed = parseVersion(version);
  if (!parsed || parsed.prerelease) throw new Error(`Cannot bump non-stable version ${version}.`);
  if (!new Set(["patch", "minor", "major"]).has(bump)) {
    throw new Error("A stable version requires --bump patch, --bump minor, or --bump major.");
  }
  if (bump === "major") return `${parsed.major + 1}.0.0`;
  if (bump === "minor") return `${parsed.major}.${parsed.minor + 1}.0`;
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

function addUnreleasedSection(changelog) {
  const sections = changelogSections(changelog);
  if (sections.some((section) => /^\[?Unreleased\]?$/i.test(section.title))) {
    throw new Error("CHANGELOG already contains an Unreleased section.");
  }
  if (!sections.length) throw new Error("CHANGELOG must contain a released version before starting an RC.");
  const lines = changelog.split(/\r?\n/);
  lines.splice(sections[0].line, 0, "## Unreleased", "");
  return lines.join(changelog.includes("\r\n") ? "\r\n" : "\n");
}

function replaceUnreleasedHeading(changelog, stableVersion) {
  const sections = changelogSections(changelog);
  const first = sections[0];
  if (!first || !/^\[?Unreleased\]?$/i.test(first.title)) {
    throw new Error("The first CHANGELOG section must be Unreleased before stabilization.");
  }
  if (!first.body) throw new Error("The Unreleased CHANGELOG section must not be empty.");
  if (sections.some((section) => changelogHeadingVersion(section.title) === stableVersion)) {
    throw new Error(`CHANGELOG already contains version ${stableVersion}.`);
  }
  const lines = changelog.split(/\r?\n/);
  lines[first.line] = `## ${stableVersion}`;
  return lines.join(changelog.includes("\r\n") ? "\r\n" : "\n");
}

function writeVersion(files, version, changelog) {
  const source = replaceMetadataVersion(files.source, version);
  fs.writeFileSync(files.entryPath, source, "utf8");
  try {
    fs.writeFileSync(files.changelogPath, changelog, "utf8");
  } catch (error) {
    fs.writeFileSync(files.entryPath, files.source, "utf8");
    throw error;
  }
  return version;
}

function advanceReleaseCandidate(root, options) {
  const files = scriptFiles(root, options.scriptId);
  const currentRc = parseReleaseCandidate(files.version);
  if (currentRc) {
    if (options.bump) throw new Error("Do not pass --bump when incrementing an existing release candidate.");
    const errors = validateChangelogVersion(files.version, files.changelog);
    if (errors.length) throw new Error(errors.join("\n"));
    return writeVersion(files, `${currentRc.stableVersion}-rc.${currentRc.number + 1}`, files.changelog);
  }
  const parsed = parseVersion(files.version);
  if (parsed.prerelease) throw new Error(`Unsupported prerelease version ${files.version}; expected X.Y.Z-rc.N.`);
  const stableVersion = bumpedVersion(files.version, options.bump);
  return writeVersion(files, `${stableVersion}-rc.1`, addUnreleasedSection(files.changelog));
}

function stabilizeReleaseCandidate(root, options) {
  if (options.bump) throw new Error("--bump is only valid when starting a release candidate series.");
  const files = scriptFiles(root, options.scriptId);
  const rc = parseReleaseCandidate(files.version);
  if (!rc) throw new Error(`Current version ${files.version} is not an X.Y.Z-rc.N release candidate.`);
  const errors = validateChangelogVersion(files.version, files.changelog);
  if (errors.length) throw new Error(errors.join("\n"));
  return writeVersion(files, rc.stableVersion, replaceUnreleasedHeading(files.changelog, rc.stableVersion));
}

function run(argv, root = process.cwd()) {
  const command = argv[0];
  if (!new Set(["rc", "stable"]).has(command)) throw new Error("Expected command: rc or stable");
  const options = parseArguments(argv.slice(1));
  const version = command === "rc"
    ? advanceReleaseCandidate(root, options)
    : stabilizeReleaseCandidate(root, options);
  console.log(`${options.scriptId}: ${version}`);
  return version;
}

if (require.main === module) {
  try {
    run(process.argv.slice(2));
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  advanceReleaseCandidate,
  bumpedVersion,
  parseArguments,
  replaceMetadataVersion,
  stabilizeReleaseCandidate,
  run,
};
