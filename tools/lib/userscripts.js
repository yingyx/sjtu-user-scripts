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

function readManifest(root) {
  const manifestPath = path.join(root, "scripts.json");
  if (!fs.existsSync(manifestPath)) throw new Error("Missing scripts.json");
  const scripts = readJson(manifestPath);
  if (!Array.isArray(scripts) || scripts.length === 0) {
    throw new Error("scripts.json must contain at least one script entry.");
  }
  return scripts;
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

function validateScript(root, script) {
  const errors = [];
  const entry = script.entry;
  const absoluteEntry = path.join(root, entry);
  if (!fs.existsSync(absoluteEntry)) return { errors: [`Missing entry file: ${entry}`], version: "" };

  const source = fs.readFileSync(absoluteEntry, "utf8");
  const metadata = parseMetadata(source);
  if (!metadata) return { errors: [`Missing userscript metadata block: ${entry}`], version: "" };

  for (const key of ["name", "namespace", "version", "description", "match"]) {
    if (!metadataValue(metadata, key)) errors.push(`Missing @${key} in ${entry}`);
  }
  if (metadata.has("downloadURL") || metadata.has("updateURL")) {
    errors.push(`${entry} should not define @downloadURL or @updateURL when Greasy Fork is the distribution source.`);
  }
  if (script.readme && !fs.existsSync(path.join(root, script.readme))) errors.push(`Missing README for ${script.id}: ${script.readme}`);
  if (script.changelog && !fs.existsSync(path.join(root, script.changelog))) errors.push(`Missing CHANGELOG for ${script.id}: ${script.changelog}`);

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
  validateRepository,
};
