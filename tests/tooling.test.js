"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createUserscript, parseArguments } = require("../tools/create-userscript");
const {
  compareVersions,
  latestChangelogVersion,
  parseMetadata,
  validateRepository,
} = require("../tools/lib/userscripts");

test("metadata parser keeps repeated keys", () => {
  const metadata = parseMetadata(`// ==UserScript==\n// @name Demo\n// @match https://one.example/*\n// @match https://two.example/*\n// ==/UserScript==`);
  assert.deepEqual(metadata.get("match"), ["https://one.example/*", "https://two.example/*"]);
});

test("SemVer comparison and changelog parsing are available for later migrations", () => {
  assert.equal(compareVersions("1.2.0", "1.1.9"), 1);
  assert.equal(compareVersions("1.2.0", "1.2.0"), 0);
  assert.equal(compareVersions("1.2.0-beta.1", "1.2.0"), -1);
  assert.equal(latestChangelogVersion("# Changelog\n\n## [2.3.4]\n\n- Done\n"), "2.3.4");
});

test("the current repository remains valid after the tooling refactor", () => {
  const result = validateRepository(path.join(__dirname, ".."));
  assert.deepEqual(result.errors, []);
  assert.equal(result.scripts.length, 2);
});

test("Claude and Gemini adapters import the canonical instructions", () => {
  const root = path.join(__dirname, "..");
  assert.equal(fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8").trim(), "@AGENTS.md");
  assert.equal(fs.readFileSync(path.join(root, "GEMINI.md"), "utf8").trim(), "@AGENTS.md");
});

test("argument parser accepts repeated match options", () => {
  const options = parseArguments(["--id", "demo", "--match", "https://a.example/*", "--match", "https://b.example/*"]);
  assert.deepEqual(options.matches, ["https://a.example/*", "https://b.example/*"]);
});

test("argument parser rejects unknown options", () => {
  assert.throws(() => parseArguments(["--unexpected", "value"]), /Unknown option/);
});

test("new scripts are strict while legacy scripts remain compatible", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "userscript-stage2-"));
  try {
    fs.mkdirSync(path.join(temporaryRoot, "scripts"));
    fs.cpSync(path.join(__dirname, "..", "templates"), path.join(temporaryRoot, "templates"), { recursive: true });
    fs.writeFileSync(path.join(temporaryRoot, "scripts.json"), "[]\n", "utf8");
    fs.writeFileSync(path.join(temporaryRoot, "package.json"), JSON.stringify({ repository: "https://github.com/example/repo.git" }), "utf8");
    createUserscript(temporaryRoot, {
      id: "demo-helper",
      name: "示例助手",
      nameEn: "Demo Helper",
      description: "为示例页面提供一个安全且可读的辅助功能。",
      descriptionEn: "Adds a safe and readable helper to the example page.",
      matches: ["https://example.com/*"],
    });

    const generatedManifest = JSON.parse(fs.readFileSync(path.join(temporaryRoot, "scripts.json"), "utf8"));
    const generatedConfig = JSON.parse(fs.readFileSync(path.join(temporaryRoot, "scripts", "demo-helper", "greasyfork.json"), "utf8"));
    const generatedSource = fs.readFileSync(path.join(temporaryRoot, "scripts", "demo-helper", "demo-helper.user.js"), "utf8");
    assert.equal(generatedManifest[0].standardsVersion, 1);
    assert.equal(generatedConfig.greasyForkId, null);
    assert.equal(generatedConfig.codeSyncUrl, "https://raw.githubusercontent.com/example/repo/release/demo-helper/scripts/demo-helper/demo-helper.user.js");
    assert.match(generatedSource, /^\/\/ @license\s+UNLICENSED$/m);

    const incomplete = validateRepository(temporaryRoot);
    assert.ok(incomplete.errors.some((error) => error.includes("scaffold implementation marker")));
    const entryPath = path.join(temporaryRoot, "scripts", "demo-helper", "demo-helper.user.js");
    const implemented = fs.readFileSync(entryPath, "utf8").replace(
      "// TODO(userscript): Implement the behavior documented in README.md.",
      'document.documentElement.dataset.demoHelper = "enabled";',
    );
    fs.writeFileSync(entryPath, implemented, "utf8");
    const readmePath = path.join(temporaryRoot, "scripts", "demo-helper", "README.md");
    const codeOnly = validateRepository(temporaryRoot);
    assert.ok(codeOnly.errors.some((error) => error.includes("scaffold documentation marker")));
    fs.writeFileSync(
      readmePath,
      fs.readFileSync(readmePath, "utf8").replace(
        "TODO(userscript): Replace this paragraph with the exact entry point, interactions, and failure states.",
        "Refresh the example page after installation. The helper records its enabled state on the root element and leaves unmatched pages unchanged.",
      ),
      "utf8",
    );
    assert.deepEqual(validateRepository(temporaryRoot).errors, []);

    fs.writeFileSync(entryPath, implemented.replace("https://example.com/*", "*://*/*").replace(
      'document.documentElement.dataset.demoHelper = "enabled";',
      'eval("unsafe")',
    ), "utf8");
    const unsafe = validateRepository(temporaryRoot).errors.join("\n");
    assert.match(unsafe, /global URL pattern/);
    assert.match(unsafe, /must not use eval/);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
