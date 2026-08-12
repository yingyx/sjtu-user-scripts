"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { metadataValue, parseMetadata, parseVersion, readManifest } = require("../tools/lib/userscripts");
const {
  assertVersionAdvance,
  createReleasePlan,
  extractReleaseNotes,
  formatSummary,
  githubOutput,
  parseArguments,
} = require("../tools/plan-release");

const root = path.join(__dirname, "..");

function currentVersion(scriptId) {
  const script = readManifest(root).find((item) => item.id === scriptId);
  return metadataValue(parseMetadata(fs.readFileSync(path.join(root, script.entry), "utf8")), "version");
}

test("release argument parser supports an explicit dry run", () => {
  assert.deepEqual(
    parseArguments([
      "--script-id", "sjtu-course-assistant-plus",
      "--version", "0.8.2",
      "--source-ref", "refs/heads/main",
      "--dry-run",
    ]),
    {
      scriptId: "sjtu-course-assistant-plus",
      version: "0.8.2",
      sourceRef: "refs/heads/main",
      dryRun: true,
    },
  );
});

test("release plan is derived from validated repository metadata", () => {
  const version = currentVersion("sjtu-course-assistant-plus");
  const plan = createReleasePlan(root, {
    scriptId: "sjtu-course-assistant-plus",
    expectedVersion: version,
    sourceRef: "refs/heads/main",
    commitSha: "a".repeat(40),
    dryRun: true,
  });
  assert.equal(plan.releaseBranch, "release/sjtu-course-assistant-plus");
  assert.equal(plan.tag, `sjtu-course-assistant-plus-v${version}`);
  assert.equal(plan.greasyForkId, 581299);
  assert.ok(plan.releaseNotes.length > 0);
  assert.doesNotMatch(plan.releaseNotes, /^##\s+/m);
  assert.match(plan.sha256, /^[0-9a-f]{64}$/);
  assert.match(githubOutput(plan, "release-notes.md"), /^release_branch=release\/sjtu-course-assistant-plus$/m);
  assert.match(formatSummary(plan), /Dry run \(no refs will be changed\)/);
});

test("release plan rejects unsafe refs, unknown scripts, and version mismatches", () => {
  const version = currentVersion("sjtu-course-assistant-plus");
  const parsed = parseVersion(version);
  const mismatchedVersion = `${parsed.major + 1}.0.0`;
  assert.throws(() => createReleasePlan(root, {
    scriptId: "sjtu-course-assistant-plus",
    expectedVersion: version,
    sourceRef: "refs/heads/feature",
  }), /must run from refs\/heads\/main/);
  assert.throws(() => createReleasePlan(root, {
    scriptId: "missing-script",
    expectedVersion: version,
  }), /Unknown script_id/);
  assert.throws(() => createReleasePlan(root, {
    scriptId: "sjtu-course-assistant-plus",
    expectedVersion: mismatchedVersion,
  }), /Version mismatch/);
});

test("release notes and released-version checks prevent ambiguous promotion", () => {
  assert.equal(
    extractReleaseNotes("# Changelog\n\n## 1.2.0\n\n- Current\n\n## 1.1.0\n\n- Old\n", "1.2.0"),
    "- Current",
  );
  assert.throws(() => extractReleaseNotes("# Changelog\n", "1.2.0"), /no section/);
  assert.doesNotThrow(() => assertVersionAdvance("1.2.0", "1.1.9"));
  assert.throws(() => assertVersionAdvance("1.1.9", "1.2.0"), /must be greater/);
  assert.throws(() => assertVersionAdvance("1.2.0", "not-a-version"), /not SemVer/);
});

test("release output files contain only the selected version notes", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "userscript-release-output-"));
  try {
    const outputPath = path.join(temporaryRoot, "output.txt");
    const summaryPath = path.join(temporaryRoot, "summary.md");
    const notesPath = path.join(temporaryRoot, "notes.md");
    const plan = createReleasePlan(root, {
      scriptId: "shuiyuan-privacy-mask",
      expectedVersion: currentVersion("shuiyuan-privacy-mask"),
      dryRun: true,
    });
    fs.writeFileSync(outputPath, githubOutput(plan, notesPath), "utf8");
    fs.writeFileSync(summaryPath, formatSummary(plan), "utf8");
    fs.writeFileSync(notesPath, `${plan.releaseNotes}\n`, "utf8");
    assert.match(fs.readFileSync(outputPath, "utf8"), /^dry_run=true$/m);
    assert.match(fs.readFileSync(summaryPath, "utf8"), /GreasyFork ID \| 591032/);
    assert.match(formatSummary({ ...plan, greasyForkId: null }), /Not configured/);
    assert.doesNotMatch(fs.readFileSync(notesPath, "utf8"), /^##\s+/m);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("GitHub output and workflow preserve the release safety gates", () => {
  const plan = createReleasePlan(root, {
    scriptId: "sjtu-course-assistant-plus",
    expectedVersion: currentVersion("sjtu-course-assistant-plus"),
    dryRun: true,
  });
  assert.throws(() => githubOutput({ ...plan, releaseName: "unsafe\noutput" }), /must be a single line/);

  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "release.yml"), "utf8");
  assert.match(workflow, /dry_run:[\s\S]*?default: true/);
  assert.match(workflow, /github\.ref != 'refs\/heads\/main'/);
  assert.match(workflow, /run: npm run check/);
  assert.match(workflow, /git push --atomic origin/);
  assert.match(workflow, /group: release-\$\{\{ inputs\.script_id \}\}/);
  assert.equal((workflow.match(/git push /g) || []).length, 1);
});

test("CI gates independent automatic promotions behind one protected approval", () => {
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
  const releaseWorkflow = fs.readFileSync(path.join(root, ".github", "workflows", "release.yml"), "utf8");
  assert.match(workflow, /vars\.USERSCRIPT_AUTO_RELEASE == 'enabled'/);
  assert.match(workflow, /environment:\s+name: userscript-production/);
  assert.equal((workflow.match(/strategy:\s+fail-fast: false\s+matrix:/g) || []).length, 2);
  assert.equal((workflow.match(/uses: \.\/\.github\/workflows\/release\.yml/g) || []).length, 1);
  assert.match(workflow, /plan-releases:[\s\S]*?permissions:\s+contents: read[\s\S]*?--dry-run/);
  assert.match(workflow, /approve-releases:[\s\S]*?- plan-releases/);
  assert.match(workflow, /always\(\) && needs\.detect-releases\.outputs\.has_releases == 'true'/);
  assert.match(workflow, /dry_run: false/);
  assert.match(workflow, /permissions:\s+contents: write/);
  assert.match(releaseWorkflow, /workflow_call:/);
});
