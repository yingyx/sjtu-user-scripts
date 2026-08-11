#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { readManifest, repositoryInfo } = require("./lib/userscripts");

function parseArguments(argv) {
  const result = { matches: [] };
  const aliases = { "name-en": "nameEn", "description-en": "descriptionEn" };
  const allowed = new Set(["id", "name", "name-en", "description", "description-en", "match"]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (!allowed.has(key)) throw new Error(`Unknown option: --${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
    index += 1;
    if (key === "match") result.matches.push(value);
    else result[aliases[key] || key] = value;
  }
  return result;
}

function render(template, values) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (placeholder, key) => {
    if (!(key in values)) throw new Error(`Template placeholder has no value: ${placeholder}`);
    return values[key];
  });
}

function createUserscript(root, options) {
  for (const key of ["id", "name", "nameEn", "description", "descriptionEn"]) {
    if (!options[key]) throw new Error(`Missing required option: ${key}`);
    if (/[\r\n]/.test(options[key])) throw new Error(`${key} must be a single line.`);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.id)) throw new Error("--id must be kebab-case.");
  if (!Array.isArray(options.matches) || options.matches.length === 0) throw new Error("Provide at least one --match.");
  for (const match of options.matches) {
    if (/[\r\n]/.test(match)) throw new Error("--match must be a single line.");
    if (!/^(?:https?|\*):\/\//.test(match)) throw new Error(`Invalid userscript match pattern: ${match}`);
    if (/^\*:\/\/\*\//.test(match)) throw new Error("A global *://*/* match is not allowed.");
  }

  const scripts = readManifest(root, { allowEmpty: true });
  if (scripts.some((script) => script.id === options.id)) throw new Error(`Script already registered: ${options.id}`);
  const targetDirectory = path.join(root, "scripts", options.id);
  if (fs.existsSync(targetDirectory)) throw new Error(`Target directory already exists: scripts/${options.id}`);

  const { owner, repo } = repositoryInfo(root);
  const values = {
    ID: options.id,
    NAME: options.name,
    NAME_EN: options.nameEn,
    DESCRIPTION: options.description,
    DESCRIPTION_EN: options.descriptionEn,
    OWNER: owner,
    REPO: repo,
    MATCH_LINES: options.matches.map((match) => `// @match        ${match}`).join("\n"),
    MATCH_PATTERNS: options.matches.join("\n"),
  };
  const templateDirectory = path.join(root, "templates", "userscript");
  const files = [
    ["userscript.user.js.tmpl", `${options.id}.user.js`],
    ["README.md.tmpl", "README.md"],
    ["CHANGELOG.md.tmpl", "CHANGELOG.md"],
    ["greasyfork.json.tmpl", "greasyfork.json"],
  ];

  fs.mkdirSync(targetDirectory, { recursive: false });
  try {
    for (const [templateName, outputName] of files) {
      const template = fs.readFileSync(path.join(templateDirectory, templateName), "utf8");
      fs.writeFileSync(path.join(targetDirectory, outputName), render(template, values), "utf8");
    }
    scripts.push({
      id: options.id,
      name: options.nameEn,
      entry: `scripts/${options.id}/${options.id}.user.js`,
      readme: `scripts/${options.id}/README.md`,
      changelog: `scripts/${options.id}/CHANGELOG.md`,
      releaseBranch: `release/${options.id}`,
      standardsVersion: 1,
    });
    scripts.sort((left, right) => left.id.localeCompare(right.id, "en"));
    fs.writeFileSync(path.join(root, "scripts.json"), `${JSON.stringify(scripts, null, 2)}\n`, "utf8");
  } catch (error) {
    fs.rmSync(targetDirectory, { recursive: true, force: true });
    throw error;
  }
  return `Created scripts/${options.id} and registered standardsVersion 1.`;
}

if (require.main === module) {
  try {
    console.log(createUserscript(process.cwd(), parseArguments(process.argv.slice(2))));
    console.log("Next: replace TODO(userscript), update README.md, then run npm run check.");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { createUserscript, parseArguments, render };
