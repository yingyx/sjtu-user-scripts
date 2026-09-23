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
const { stabilizeReleaseCandidate } = require("../tools/version-userscript");

const root = path.join(__dirname, "..");
let releaseRoot;

function currentVersion(repositoryRoot, scriptId) {
  const script = readManifest(repositoryRoot).find((item) => item.id === scriptId);
  return metadataValue(parseMetadata(fs.readFileSync(path.join(repositoryRoot, script.entry), "utf8")), "version");
}

test.before(() => {
  releaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), "userscript-stable-release-"));
  for (const fileName of ["package.json", "scripts.json", "README.md", "README.zh-CN.md"]) {
    fs.copyFileSync(path.join(root, fileName), path.join(releaseRoot, fileName));
  }
  fs.cpSync(path.join(root, "scripts"), path.join(releaseRoot, "scripts"), { recursive: true });
  stabilizeReleaseCandidate(releaseRoot, { scriptId: "shuiyuan-privacy-mask" });
});

test.after(() => {
  fs.rmSync(releaseRoot, { recursive: true, force: true });
});

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
  const version = currentVersion(releaseRoot, "shuiyuan-privacy-mask");
  const plan = createReleasePlan(releaseRoot, {
    scriptId: "shuiyuan-privacy-mask",
    expectedVersion: version,
    sourceRef: "refs/heads/main",
    commitSha: "a".repeat(40),
    dryRun: true,
  });
  assert.equal(plan.releaseBranch, "release/shuiyuan-privacy-mask");
  assert.equal(plan.tag, `shuiyuan-privacy-mask-v${version}`);
  assert.equal(plan.greasyForkId, 591032);
  assert.ok(plan.releaseNotes.length > 0);
  assert.doesNotMatch(plan.releaseNotes, /^##\s+/m);
  assert.match(plan.sha256, /^[0-9a-f]{64}$/);
  assert.match(githubOutput(plan, "release-notes.md"), /^release_branch=release\/shuiyuan-privacy-mask$/m);
  assert.match(formatSummary(plan), /Dry run \(no refs will be changed\)/);
});

test("release plan rejects unsafe refs, unknown scripts, and version mismatches", () => {
  const version = currentVersion(releaseRoot, "shuiyuan-privacy-mask");
  const parsed = parseVersion(version);
  const mismatchedVersion = `${parsed.major + 1}.0.0`;
  assert.throws(() => createReleasePlan(releaseRoot, {
    scriptId: "shuiyuan-privacy-mask",
    expectedVersion: version,
    sourceRef: "refs/heads/feature",
  }), /must run from refs\/heads\/main/);
  assert.throws(() => createReleasePlan(releaseRoot, {
    scriptId: "missing-script",
    expectedVersion: version,
  }), /Unknown script_id/);
  assert.throws(() => createReleasePlan(releaseRoot, {
    scriptId: "shuiyuan-privacy-mask",
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
    const plan = createReleasePlan(releaseRoot, {
      scriptId: "shuiyuan-privacy-mask",
      expectedVersion: currentVersion(releaseRoot, "shuiyuan-privacy-mask"),
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

test("GitHub output and internal promotion preserve the release safety gates", () => {
  const plan = createReleasePlan(releaseRoot, {
    scriptId: "shuiyuan-privacy-mask",
    expectedVersion: currentVersion(releaseRoot, "shuiyuan-privacy-mask"),
    dryRun: true,
  });
  assert.throws(() => githubOutput({ ...plan, releaseName: "unsafe\noutput" }), /must be a single line/);

  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "release.yml"), "utf8");
  assert.match(workflow, /^name: Promote userscript \(internal\)$/m);
  assert.match(workflow, /workflow_call:/);
  assert.doesNotMatch(workflow, /workflow_dispatch:/);
  assert.match(workflow, /source_sha:/);
  assert.match(workflow, /ref: \$\{\{ inputs\.source_sha \}\}/);
  assert.match(workflow, /git merge-base --is-ancestor "\$SOURCE_SHA" refs\/remotes\/origin\/main/);
  assert.match(workflow, /environment:\s+name: userscript-production/);
  assert.match(workflow, /run: npm run check/);
  assert.match(workflow, /git push --atomic origin/);
  assert.match(workflow, /group: promote-userscript-\$\{\{ inputs\.script_id \}\}/);
  assert.equal((workflow.match(/git push /g) || []).length, 1);
});

test("validation, publishing, and bootstrap workflows have distinct roles", () => {
  const validationWorkflow = fs.readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "publish.yml"), "utf8");
  const bootstrapWorkflow = fs.readFileSync(path.join(root, ".github", "workflows", "bootstrap.yml"), "utf8");
  const releaseWorkflow = fs.readFileSync(path.join(root, ".github", "workflows", "release.yml"), "utf8");

  assert.match(validationWorkflow, /^name: Validate repository$/m);
  assert.doesNotMatch(validationWorkflow, /detect-releases|contents: write|release\.yml/);

  assert.match(workflow, /^name: Publish userscript updates$/m);
  assert.match(workflow, /workflow_run:[\s\S]*?- Validate repository/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /github\.event\.workflow_run\.event == 'push'/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  assert.match(workflow, /vars\.USERSCRIPT_AUTO_RELEASE == 'enabled'/);
  assert.equal((workflow.match(/strategy:\s+fail-fast: false\s+matrix:/g) || []).length, 2);
  assert.equal((workflow.match(/uses: \.\/\.github\/workflows\/release\.yml/g) || []).length, 1);
  assert.match(workflow, /plan-releases:[\s\S]*?permissions:\s+contents: read[\s\S]*?--dry-run/);
  assert.match(workflow, /needs\.plan-releases\.result == 'success'/);
  assert.match(workflow, /permissions:\s+contents: write/);

  assert.match(bootstrapWorkflow, /^name: Bootstrap new userscript$/m);
  assert.match(bootstrapWorkflow, /workflow_dispatch:/);
  assert.match(bootstrapWorkflow, /GREASY_FORK_ID/);
  assert.match(bootstrapWorkflow, /already has GreasyFork ID/);
  assert.equal((bootstrapWorkflow.match(/uses: \.\/\.github\/workflows\/release\.yml/g) || []).length, 1);

  assert.match(releaseWorkflow, /workflow_call:/);
  assert.doesNotMatch(releaseWorkflow, /workflow_dispatch:/);
});
