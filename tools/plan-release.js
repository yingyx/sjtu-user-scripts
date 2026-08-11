#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  compareVersions,
  metadataValue,
  parseMetadata,
  parseVersion,
  readManifest,
  validateRepository,
} = require("./lib/userscripts");

function parseArguments(argv) {
  const result = { dryRun: false };
  const aliases = {
    "script-id": "scriptId",
    "source-ref": "sourceRef",
    "commit-sha": "commitSha",
  };
  const valued = new Set(["script-id", "version", "source-ref", "commit-sha"]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--dry-run") {
      result.dryRun = true;
      continue;
    }
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

function extractReleaseNotes(changelog, version) {
  const lines = String(changelog).split(/\r?\n/);
  let start = -1;
  let end = lines.length;
  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(/^##\s+\[?v?([^\]\s]+)\]?/);
    if (!heading) continue;
    if (start === -1 && heading[1] === version) {
      start = index + 1;
      continue;
    }
    if (start !== -1) {
      end = index;
      break;
    }
  }
  if (start === -1) throw new Error(`CHANGELOG has no section for version ${version}.`);
  const notes = lines.slice(start, end).join("\n").trim();
  if (!notes) throw new Error(`CHANGELOG section ${version} is empty.`);
  return notes;
}

function assertVersionAdvance(candidateVersion, releasedVersion) {
  if (!parseVersion(releasedVersion)) throw new Error(`Released version is not SemVer: ${releasedVersion}`);
  if (compareVersions(candidateVersion, releasedVersion) <= 0) {
    throw new Error(`Version ${candidateVersion} must be greater than released version ${releasedVersion}.`);
  }
}

function createReleasePlan(root, options) {
  const sourceRef = options.sourceRef || "refs/heads/main";
  if (sourceRef !== "refs/heads/main") {
    throw new Error(`Releases must run from refs/heads/main, not ${sourceRef}.`);
  }
  for (const key of ["scriptId", "expectedVersion"]) {
    if (!options[key]) throw new Error(`Missing required release option: ${key}`);
    if (/\r|\n/.test(options[key])) throw new Error(`${key} must be a single line.`);
  }
  if (!parseVersion(options.expectedVersion)) {
    throw new Error(`Expected version must use SemVer: ${options.expectedVersion}`);
  }

  const validation = validateRepository(root);
  if (validation.errors.length) {
    throw new Error(`Repository validation failed:\n- ${validation.errors.join("\n- ")}`);
  }
  const manifest = readManifest(root);
  const script = manifest.find((item) => item.id === options.scriptId);
  if (!script) throw new Error(`Unknown script_id: ${options.scriptId}`);

  const entryPath = path.join(root, script.entry);
  const source = fs.readFileSync(entryPath, "utf8");
  const actualVersion = metadataValue(parseMetadata(source), "version");
  if (actualVersion !== options.expectedVersion) {
    throw new Error(`Version mismatch for ${script.id}: expected ${options.expectedVersion}, found ${actualVersion}.`);
  }

  const changelog = fs.readFileSync(path.join(root, script.changelog), "utf8");
  const releaseNotes = extractReleaseNotes(changelog, actualVersion);
  const configPath = path.join(path.dirname(entryPath), "greasyfork.json");
  const greasyFork = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const commitSha = options.commitSha || "";
  if (commitSha && !/^[0-9a-f]{40}$/i.test(commitSha)) throw new Error(`Invalid commit SHA: ${commitSha}`);

  return {
    scriptId: script.id,
    version: actualVersion,
    entry: script.entry,
    changelog: script.changelog,
    releaseBranch: script.releaseBranch,
    tag: `${script.id}-v${actualVersion}`,
    releaseName: `${script.name || script.id} v${actualVersion}`,
    commitSha,
    sourceRef,
    dryRun: Boolean(options.dryRun),
    greasyForkId: greasyFork.greasyForkId,
    codeSyncUrl: greasyFork.codeSyncUrl,
    additionalInfoSyncUrl: greasyFork.additionalInfoSyncUrl,
    sha256: crypto.createHash("sha256").update(source, "utf8").digest("hex"),
    releaseNotes,
  };
}

function githubOutput(plan, releaseNotesPath = "") {
  const values = {
    script_id: plan.scriptId,
    version: plan.version,
    entry: plan.entry,
    changelog: plan.changelog,
    release_branch: plan.releaseBranch,
    tag: plan.tag,
    release_name: plan.releaseName,
    commit_sha: plan.commitSha,
    dry_run: String(plan.dryRun),
    greasy_fork_id: plan.greasyForkId == null ? "" : String(plan.greasyForkId),
    code_sync_url: plan.codeSyncUrl,
    additional_info_sync_url: plan.additionalInfoSyncUrl,
    sha256: plan.sha256,
    release_notes_path: releaseNotesPath,
  };
  for (const [key, value] of Object.entries(values)) {
    if (/\r|\n/.test(value)) throw new Error(`GitHub output ${key} must be a single line.`);
  }
  return `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n")}\n`;
}

function escapeTable(value) {
  return String(value == null ? "" : value).replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

function formatSummary(plan) {
  const mode = plan.dryRun ? "Dry run (no refs will be changed)" : "Promotion";
  const greasyFork = plan.greasyForkId == null ? "Not configured" : String(plan.greasyForkId);
  return [
    "## Userscript release plan",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Mode | ${escapeTable(mode)} |`,
    `| Script | ${escapeTable(plan.scriptId)} |`,
    `| Version | ${escapeTable(plan.version)} |`,
    `| Commit | ${escapeTable(plan.commitSha || "local checkout")} |`,
    `| Release branch | ${escapeTable(plan.releaseBranch)} |`,
    `| Tag | ${escapeTable(plan.tag)} |`,
    `| Artifact SHA-256 | \`${plan.sha256}\` |`,
    `| GreasyFork ID | ${escapeTable(greasyFork)} |`,
    `| GreasyFork source | ${escapeTable(plan.codeSyncUrl)} |`,
    "",
    plan.dryRun
      ? "Remote state will be checked, but the release branch, tag, GitHub Release, and GreasyFork source will not be changed."
      : "After the atomic ref update, GreasyFork may check the configured release-branch source through its webhook.",
    "",
  ].join("\n");
}

function run(argv, environment = process.env) {
  const args = parseArguments(argv);
  const plan = createReleasePlan(process.cwd(), {
    scriptId: args.scriptId,
    expectedVersion: args.version,
    sourceRef: args.sourceRef || environment.GITHUB_REF,
    commitSha: args.commitSha || environment.GITHUB_SHA,
    dryRun: args.dryRun,
  });
  const releaseNotesPath = environment.RELEASE_NOTES_PATH || "";
  if (releaseNotesPath) fs.writeFileSync(releaseNotesPath, `${plan.releaseNotes}\n`, "utf8");
  if (environment.GITHUB_OUTPUT) {
    fs.appendFileSync(environment.GITHUB_OUTPUT, githubOutput(plan, releaseNotesPath), "utf8");
  }
  if (environment.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(environment.GITHUB_STEP_SUMMARY, formatSummary(plan), "utf8");
  }
  return plan;
}

if (require.main === module) {
  try {
    const plan = run(process.argv.slice(2));
    console.log(JSON.stringify(plan, null, 2));
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  assertVersionAdvance,
  createReleasePlan,
  extractReleaseNotes,
  formatSummary,
  githubOutput,
  parseArguments,
  run,
};
