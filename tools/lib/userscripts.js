"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const METADATA_START = "// ==UserScript==";
const METADATA_END = "// ==/UserScript==";
const CATALOG_START = "<!-- BEGIN GENERATED SCRIPT LIST -->";
const CATALOG_END = "<!-- END GENERATED SCRIPT LIST -->";
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

function escapeMarkdownTableCell(value) {
  return String(value || "").replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

function scriptCatalog(root, locale, scripts = readManifest(root)) {
  const useChinese = locale === "zh-CN";
  return scripts.map((script) => {
    const source = fs.readFileSync(path.join(root, script.entry), "utf8");
    const metadata = parseMetadata(source);
    const localizedCatalog = script.catalog?.[locale] || {};
    const name = localizedCatalog.name || (useChinese
      ? metadataValue(metadata, "name:zh-CN") || metadataValue(metadata, "name") || script.name || script.id
      : metadataValue(metadata, "name:en") || script.name || metadataValue(metadata, "name") || script.id);
    const description = localizedCatalog.description || (useChinese
      ? metadataValue(metadata, "description:zh-CN") || metadataValue(metadata, "description") || metadataValue(metadata, "description:en")
      : metadataValue(metadata, "description:en") || metadataValue(metadata, "description"));
    return { ...script, name, description };
  });
}

function renderScriptCatalog(root, locale, scripts = readManifest(root)) {
  const useChinese = locale === "zh-CN";
  const lines = useChinese
    ? ["| 脚本 | 入口文件 | 用途 |", "| --- | --- | --- |"]
    : ["| Script | Entry file | Purpose |", "| --- | --- | --- |"];
  for (const script of scriptCatalog(root, locale, scripts)) {
    const name = escapeMarkdownTableCell(script.name);
    const description = escapeMarkdownTableCell(script.description);
    lines.push(`| [${name}](${script.readme}) | \`${script.entry}\` | ${description} |`);
  }
  return [CATALOG_START, ...lines, CATALOG_END].join("\n");
}

function replaceScriptCatalog(source, catalog, fileName) {
  const startCount = source.split(CATALOG_START).length - 1;
  const endCount = source.split(CATALOG_END).length - 1;
  if (startCount !== 1 || endCount !== 1) {
    throw new Error(`${fileName} must contain exactly one generated script list marker pair.`);
  }
  const pattern = new RegExp(`${CATALOG_START}[\\s\\S]*?${CATALOG_END}`);
  return source.replace(pattern, catalog);
}

function rootReadmeDefinitions() {
  return [
    { fileName: "README.md", locale: "en" },
    { fileName: "README.zh-CN.md", locale: "zh-CN" },
  ];
}

function validateRootReadmes(root, scripts) {
  const errors = [];
  for (const definition of rootReadmeDefinitions()) {
    const filePath = path.join(root, definition.fileName);
    if (!fs.existsSync(filePath)) {
      errors.push(`Missing root documentation: ${definition.fileName}`);
      continue;
    }
    try {
      const source = fs.readFileSync(filePath, "utf8");
      const expected = renderScriptCatalog(root, definition.locale, scripts);
      const synchronized = replaceScriptCatalog(source, expected, definition.fileName);
      if (synchronized !== source) {
        errors.push(`${definition.fileName} generated script list is stale; run npm run docs:sync.`);
      }
    } catch (error) {
      errors.push(error.message);
    }
  }
  return errors;
}

function syncRootReadmes(root) {
  const scripts = readManifest(root);
  const changed = [];
  for (const definition of rootReadmeDefinitions()) {
    const filePath = path.join(root, definition.fileName);
    if (!fs.existsSync(filePath)) throw new Error(`Missing root documentation: ${definition.fileName}`);
    const source = fs.readFileSync(filePath, "utf8");
    const catalog = renderScriptCatalog(root, definition.locale, scripts);
    const synchronized = replaceScriptCatalog(source, catalog, definition.fileName);
    if (synchronized !== source) {
      fs.writeFileSync(filePath, synchronized, "utf8");
      changed.push(definition.fileName);
    }
  }
  return changed;
}

function parseVersion(version) {
  const match = String(version).match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] || "" };
}

function parseReleaseCandidate(version) {
  const match = String(version).match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-rc\.([1-9]\d*)$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    number: Number(match[4]),
    stableVersion: `${match[1]}.${match[2]}.${match[3]}`,
  };
}

function isStableVersion(version) {
  const parsed = parseVersion(version);
  return Boolean(parsed && !parsed.prerelease);
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

function changelogSections(source) {
  const lines = String(source).split(/\r?\n/);
  const sections = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^##\s+(.+?)\s*$/);
    if (!match) continue;
    if (sections.length) sections[sections.length - 1].body = lines.slice(sections[sections.length - 1].start, index).join("\n").trim();
    sections.push({ title: match[1], line: index, start: index + 1, body: "" });
  }
  if (sections.length) sections[sections.length - 1].body = lines.slice(sections[sections.length - 1].start).join("\n").trim();
  return sections;
}

function changelogHeadingVersion(title) {
  const match = String(title).match(/^\[?v?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?)\]?(?:\s+-\s+.+)?$/);
  return match?.[1] || "";
}

function validateChangelogVersion(version, source) {
  const parsed = parseVersion(version);
  if (!parsed) return [`@version must use SemVer. Found: ${version}`];

  const sections = changelogSections(source);
  const first = sections[0];
  if (!first) return ["CHANGELOG must contain at least one level-two version section."];

  if (parsed.prerelease) {
    if (!parseReleaseCandidate(version)) {
      return [`Prerelease @version must use X.Y.Z-rc.N with N starting at 1. Found: ${version}`];
    }
    if (!/^\[?Unreleased\]?$/i.test(first.title)) {
      return [`Release candidate ${version} requires Unreleased as the first CHANGELOG section.`];
    }
    if (!first.body) return [`Unreleased CHANGELOG section for ${version} must not be empty.`];
    return [];
  }

  const changelogVersion = changelogHeadingVersion(first.title);
  return changelogVersion === version
    ? []
    : [`Latest CHANGELOG version must match stable @version ${version}.`];
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
  const wildcardConnectApproved = script.permissions?.allowWildcardConnect === true
    && typeof script.permissions.reason === "string"
    && script.permissions.reason.trim().length >= 20;
  for (const connect of metadata.get("connect") || []) {
    if (connect === "*" && !wildcardConnectApproved) {
      errors.push(`${expectedEntry}: wildcard @connect requires permissions.allowWildcardConnect and a documented reason.`);
    }
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

  const readmePaths = [expectedReadme, `${folder}/README.zh-CN.md`];
  for (const relativeReadme of readmePaths) {
    const readmePath = path.join(root, relativeReadme);
    if (!fs.existsSync(readmePath)) continue;
    const readme = fs.readFileSync(readmePath, "utf8");
    if (readme.trim().length < 200) errors.push(`${relativeReadme} is too short.`);
    if (!/(Privacy|隐私)/i.test(readme)) errors.push(`${relativeReadme} must document privacy and network behavior.`);
    if (!/(Installation|安装)/i.test(readme)) errors.push(`${relativeReadme} must document installation.`);
    if (readme.includes("TODO(userscript)")) errors.push(`${relativeReadme} still contains the scaffold documentation marker.`);
  }
  const changelogPath = path.join(root, expectedChangelog);
  if (fs.existsSync(changelogPath)) {
    const changelog = fs.readFileSync(changelogPath, "utf8");
    for (const error of validateChangelogVersion(version, changelog)) {
      errors.push(`${expectedChangelog}: ${error}`);
    }
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
    if (script.catalog !== undefined) {
      if (!script.catalog || typeof script.catalog !== "object" || Array.isArray(script.catalog)) {
        errors.push(`${script.id}: catalog must be an object keyed by locale.`);
      } else {
        for (const [locale, entry] of Object.entries(script.catalog)) {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            errors.push(`${script.id}: catalog.${locale} must be an object.`);
            continue;
          }
          for (const key of ["name", "description"]) {
            if (entry[key] !== undefined && (typeof entry[key] !== "string" || !entry[key].trim() || /[\r\n]/.test(entry[key]))) {
              errors.push(`${script.id}: catalog.${locale}.${key} must be a non-empty single line.`);
            }
          }
        }
      }
    }
    const result = validateScript(root, script);
    errors.push(...result.errors);
    results.push({ ...script, version: result.version });
  }
  errors.push(...validateRootReadmes(root, scripts));
  return { errors, scripts: results };
}

module.exports = {
  changelogHeadingVersion,
  changelogSections,
  compareVersions,
  isStableVersion,
  latestChangelogVersion,
  metadataValue,
  parseMetadata,
  parseReleaseCandidate,
  parseVersion,
  readManifest,
  renderScriptCatalog,
  repositoryInfo,
  scriptCatalog,
  syncRootReadmes,
  validateRepository,
  validateRootReadmes,
  validateChangelogVersion,
};
