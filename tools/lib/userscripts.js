"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const METADATA_START = "// ==UserScript==";
const METADATA_END = "// ==/UserScript==";
const FORBIDDEN_ARRAY_PATTERNS = [
  { label: ".some(", pattern: /\.some\(/ },
  { label: ".filter(", pattern: /\.filter\(/ },
  { label: ".map(", pattern: /\.map\(/ },
  { label: "Array.from", pattern: /Array\.from/ },
  { label: ".find(", pattern: /\.find\(/ },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readManifest(root, options = {}) {
  const manifestPath = path.join(root, "scripts.json");
  if (!fs.existsSync(manifestPath)) throw new Error("Missing scripts.json");
  const scripts = readJson(manifestPath);
  if (!Array.isArray(scripts)) throw new Error("scripts.json must be an array.");
  if (scripts.length === 0 && !options.allowEmpty) throw new Error("scripts.json must contain at least one script entry.");
  return scripts;
}

function repositoryInfo(root) {
  const packageJson = readJson(path.join(root, "package.json"));
  const repository = typeof packageJson.repository === "string" ? packageJson.repository : packageJson.repository?.url;
  const match = String(repository || "").match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/i);
  if (!match) throw new Error("package.json repository must be a GitHub HTTPS or SSH URL.");
  return { owner: match[1], repo: match[2] };
}

function parseMetadata(source) {
  const start = source.indexOf(METADATA_START);
  const end = source.indexOf(METADATA_END);
  if (start === -1 || end === -1 || end < start) return null;

  const block = source.slice(start, end + METADATA_END.length);
  const metadata = new Map();
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^\/\/\s+@([^\s]+)\s*(.*)$/);
    if (!match) continue;
    if (!metadata.has(match[1])) metadata.set(match[1], []);
    metadata.get(match[1]).push(match[2].trim());
  }
  return metadata;
}

function metadataValue(metadata, key) {
  return metadata?.get(key)?.[0] || "";
}

function parseVersion(version) {
  const match = String(version).match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] || "" };
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error(`Cannot compare non-SemVer versions: ${left}, ${right}`);
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease, "en", { numeric: true });
}

function latestChangelogVersion(source) {
  const match = source.match(/^##\s+\[?v?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?)\]?/m);
  return match?.[1] || "";
}

function validateSyntax(root, entry) {
  const result = spawnSync(process.execPath, ["--check", entry], { cwd: root, encoding: "utf8" });
  return result.status === 0 ? "" : `Syntax check failed for ${entry}\n${result.stderr || result.stdout}`;
}

function validateStrictScript(root, script, source, metadata) {
  const errors = [];
  const folder = `scripts/${script.id}`;
  const expectedEntry = `${folder}/${script.id}.user.js`;
  const expectedReadme = `${folder}/README.md`;
  const expectedChangelog = `${folder}/CHANGELOG.md`;
  const expectedBranch = `release/${script.id}`;
  const configPath = path.join(root, folder, "greasyfork.json");

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(script.id)) errors.push(`Invalid kebab-case script id: ${script.id}`);
  if (script.entry !== expectedEntry) errors.push(`${script.id}: entry must be ${expectedEntry}.`);
  if (script.readme !== expectedReadme) errors.push(`${script.id}: readme must be ${expectedReadme}.`);
  if (script.changelog !== expectedChangelog) errors.push(`${script.id}: changelog must be ${expectedChangelog}.`);
  if (script.releaseBranch !== expectedBranch) errors.push(`${script.id}: releaseBranch must be ${expectedBranch}.`);
  if (!fs.existsSync(configPath)) errors.push(`Missing GreasyFork config: ${folder}/greasyfork.json`);

  for (const key of ["name", "namespace", "version", "description", "license", "run-at", "grant"]) {
    if (!metadataValue(metadata, key)) errors.push(`${expectedEntry} is missing @${key}.`);
  }
  if (!metadata.has("match") && !metadata.has("include")) errors.push(`${expectedEntry} needs at least one @match or @include.`);
  const version = metadataValue(metadata, "version");
  if (!parseVersion(version)) errors.push(`${expectedEntry} @version must use SemVer (X.Y.Z). Found: ${version}`);
  for (const key of ["downloadURL", "updateURL", "installURL"]) {
    if (metadata.has(key)) errors.push(`${expectedEntry} must not define @${key}; GreasyFork owns installed update URLs.`);
  }
  const grants = metadata.get("grant") || [];
  if (grants.includes("none") && grants.length !== 1) errors.push(`${expectedEntry}: @grant none cannot be combined with other grants.`);
  for (const connect of metadata.get("connect") || []) {
    if (connect === "*") errors.push(`${expectedEntry}: wildcard @connect is not allowed.`);
  }
  for (const pattern of [...(metadata.get("match") || []), ...(metadata.get("include") || [])]) {
    if (/^\*:\/\/\*\//.test(pattern)) errors.push(`${expectedEntry}: global URL pattern ${pattern} is not allowed.`);
  }
  for (const requirement of metadata.get("require") || []) {
    if (!requirement.startsWith("https://")) errors.push(`${expectedEntry}: @require must use HTTPS: ${requirement}`);
    const pinned = /(?:@|\/)(?:v?\d+\.\d+\.\d+)(?:[/?#]|$)|#(?:sha256|sha384|sha512)-/i.test(requirement);
    if (!pinned) errors.push(`${expectedEntry}: @require must pin a version or integrity hash: ${requirement}`);
  }
  if (Buffer.byteLength(source, "utf8") > 2 * 1024 * 1024) errors.push(`${expectedEntry} exceeds GreasyFork's 2 MB limit.`);
  if (source.charCodeAt(0) === 0xfeff || source.includes("\uFFFD")) errors.push(`${expectedEntry} is not clean UTF-8.`);
  if (!source.includes('"use strict"') && !source.includes("'use strict'")) errors.push(`${expectedEntry} must enable strict mode.`);
  if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(source)) errors.push(`${expectedEntry} must not use eval or new Function.`);
  if (/(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,})/.test(source)) errors.push(`${expectedEntry} appears to contain a hard-coded secret.`);
  if (source.includes("TODO(userscript)")) errors.push(`${expectedEntry} still contains the scaffold implementation marker.`);

  const readmePath = path.join(root, expectedReadme);
  if (fs.existsSync(readmePath)) {
    const readme = fs.readFileSync(readmePath, "utf8");
    if (readme.trim().length < 200) errors.push(`${expectedReadme} is too short.`);
    if (!/(Privacy|隐私)/i.test(readme)) errors.push(`${expectedReadme} must document privacy and network behavior.`);
    if (!/(Installation|安装)/i.test(readme)) errors.push(`${expectedReadme} must document installation.`);
    if (readme.includes("TODO(userscript)")) errors.push(`${expectedReadme} still contains the scaffold documentation marker.`);
  }
  const changelogPath = path.join(root, expectedChangelog);
  if (fs.existsSync(changelogPath)) {
    const changelogVersion = latestChangelogVersion(fs.readFileSync(changelogPath, "utf8"));
    if (changelogVersion !== version) errors.push(`${expectedChangelog} latest version must match @version ${version}.`);
  }
  if (fs.existsSync(configPath)) {
    try {
      const config = readJson(configPath);
      const { owner, repo } = repositoryInfo(root);
      const rawBase = `https://raw.githubusercontent.com/${owner}/${repo}/${expectedBranch}/${folder}`;
      const expected = {
        scriptId: script.id,
        entry: `${script.id}.user.js`,
        releaseBranch: expectedBranch,
        codeSyncUrl: `${rawBase}/${script.id}.user.js`,
        additionalInfoSyncUrl: `${rawBase}/README.md`,
        changelog: "CHANGELOG.md",
      };
      for (const [key, value] of Object.entries(expected)) {
        if (config[key] !== value) errors.push(`${folder}/greasyfork.json: ${key} must be ${value}.`);
      }
      if (config.greasyForkId !== null && !Number.isInteger(config.greasyForkId)) {
        errors.push(`${folder}/greasyfork.json: greasyForkId must be null or an integer.`);
      }
    } catch (error) {
      errors.push(`${folder}/greasyfork.json is invalid: ${error.message}`);
    }
  }
  return errors;
}

function validateScript(root, script) {
  const errors = [];
  const entry = script.entry;
  const absoluteEntry = path.join(root, entry);
  if (!fs.existsSync(absoluteEntry)) return { errors: [`Missing entry file: ${entry}`], version: "" };

  const source = fs.readFileSync(absoluteEntry, "utf8");
  const metadata = parseMetadata(source);
  if (!metadata) return { errors: [`Missing userscript metadata block: ${entry}`], version: "" };

  const baselineKeys = script.standardsVersion === 1
    ? ["name", "namespace", "version", "description"]
    : ["name", "namespace", "version", "description", "match"];
  for (const key of baselineKeys) {
    if (!metadataValue(metadata, key)) errors.push(`Missing @${key} in ${entry}`);
  }
  if (metadata.has("downloadURL") || metadata.has("updateURL")) {
    errors.push(`${entry} should not define @downloadURL or @updateURL when Greasy Fork is the distribution source.`);
  }
  if (script.readme && !fs.existsSync(path.join(root, script.readme))) errors.push(`Missing README for ${script.id}: ${script.readme}`);
  if (script.changelog && !fs.existsSync(path.join(root, script.changelog))) errors.push(`Missing CHANGELOG for ${script.id}: ${script.changelog}`);
  if (script.standardsVersion !== undefined && script.standardsVersion !== 1) {
    errors.push(`${script.id}: unsupported standardsVersion ${script.standardsVersion}.`);
  }
  if (script.standardsVersion === 1) errors.push(...validateStrictScript(root, script, source, metadata));

  if (script.compatibility?.disallowPrototypeArrayMethods) {
    source.split(/\r?\n/).forEach((line, index) => {
      for (const item of FORBIDDEN_ARRAY_PATTERNS) {
        if (item.pattern.test(line)) errors.push(`${entry}:${index + 1} uses forbidden ${item.label}`);
      }
    });
  }
  const syntaxError = validateSyntax(root, entry);
  if (syntaxError) errors.push(syntaxError);
  return { errors, version: metadataValue(metadata, "version") };
}

function validateRepository(root) {
  const errors = [];
  let scripts;
  try {
    scripts = readManifest(root);
  } catch (error) {
    return { errors: [error.message], scripts: [] };
  }

  const ids = new Set();
  const results = [];
  for (const script of scripts) {
    if (!script.id || !script.entry || !script.readme || !script.changelog || !script.releaseBranch) {
      errors.push("Every scripts.json entry must include id, entry, readme, changelog, and releaseBranch.");
      continue;
    }
    if (ids.has(script.id)) {
      errors.push(`Duplicate script id: ${script.id}`);
      continue;
    }
    ids.add(script.id);
    const result = validateScript(root, script);
    errors.push(...result.errors);
    results.push({ ...script, version: result.version });
  }
  return { errors, scripts: results };
}

module.exports = {
  compareVersions,
  latestChangelogVersion,
  metadataValue,
  parseMetadata,
  parseVersion,
  readManifest,
  repositoryInfo,
  validateRepository,
};
