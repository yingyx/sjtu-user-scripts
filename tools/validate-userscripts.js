const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = process.cwd();
const manifestPath = path.join(root, "scripts.json");
const metadataStart = "// ==UserScript==";
const metadataEnd = "// ==/UserScript==";
const forbiddenArrayPatterns = [
  { label: ".some(", pattern: /\.some\(/ },
  { label: ".filter(", pattern: /\.filter\(/ },
  { label: ".map(", pattern: /\.map\(/ },
  { label: "Array.from", pattern: /Array\.from/ },
  { label: ".find(", pattern: /\.find\(/ },
];

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseMetadata(source) {
  const start = source.indexOf(metadataStart);
  const end = source.indexOf(metadataEnd);
  if (start === -1 || end === -1 || end < start) {
    return null;
  }

  const block = source.slice(start, end + metadataEnd.length);
  const metadata = new Map();
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^\/\/\s+@([^\s]+)\s*(.*)$/);
    if (match) {
      const key = match[1];
      const value = match[2].trim();
      if (!metadata.has(key)) {
        metadata.set(key, []);
      }
      metadata.get(key).push(value);
    }
  }
  return metadata;
}

function hasMetadata(metadata, key) {
  return metadata.has(key) && metadata.get(key).some((value) => value.length > 0);
}

function validateSyntax(entry) {
  const result = spawnSync("node", ["--check", entry], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    fail(`Syntax check failed for ${entry}\n${result.stderr || result.stdout}`);
  }
}

function validateScript(script) {
  const entry = script.entry;
  const absoluteEntry = path.join(root, entry);
  if (!fs.existsSync(absoluteEntry)) {
    fail(`Missing entry file: ${entry}`);
    return;
  }

  const source = fs.readFileSync(absoluteEntry, "utf8");
  const metadata = parseMetadata(source);
  if (!metadata) {
    fail(`Missing userscript metadata block: ${entry}`);
    return;
  }

  for (const key of ["name", "namespace", "version", "description", "match"]) {
    if (!hasMetadata(metadata, key)) {
      fail(`Missing @${key} in ${entry}`);
    }
  }

  if (metadata.has("downloadURL") || metadata.has("updateURL")) {
    fail(`${entry} should not define @downloadURL or @updateURL when Greasy Fork is the distribution source.`);
  }

  if (script.readme && !fs.existsSync(path.join(root, script.readme))) {
    fail(`Missing README for ${script.id}: ${script.readme}`);
  }

  if (script.changelog && !fs.existsSync(path.join(root, script.changelog))) {
    fail(`Missing CHANGELOG for ${script.id}: ${script.changelog}`);
  }

  if (script.compatibility && script.compatibility.disallowPrototypeArrayMethods) {
    const lines = source.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const item of forbiddenArrayPatterns) {
        if (item.pattern.test(line)) {
          fail(`${entry}:${index + 1} uses forbidden ${item.label}`);
        }
      }
    });
  }

  validateSyntax(entry);
  console.log(`Validated ${script.id}`);
}

if (!fs.existsSync(manifestPath)) {
  fail("Missing scripts.json");
  process.exit();
}

const scripts = readJson(manifestPath);
if (!Array.isArray(scripts) || scripts.length === 0) {
  fail("scripts.json must contain at least one script entry.");
  process.exit();
}

const ids = new Set();
for (const script of scripts) {
  if (!script.id || !script.entry || !script.readme || !script.changelog || !script.releaseBranch) {
    fail("Every scripts.json entry must include id, entry, readme, changelog, and releaseBranch.");
    continue;
  }
  if (ids.has(script.id)) {
    fail(`Duplicate script id: ${script.id}`);
    continue;
  }
  ids.add(script.id);
  validateScript(script);
}
