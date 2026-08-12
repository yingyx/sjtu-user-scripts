#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  compareVersions,
  metadataValue,
  parseMetadata,
  readManifest,
  validateRepository,
} = require("./lib/userscripts");

function parseArguments(argv) {
  const result = { remote: "origin" };
  const aliases = { "source-ref": "sourceRef", "commit-sha": "commitSha" };
  const valued = new Set(["remote", "source-ref", "commit-sha"]);
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

function normalizeSource(source) {
  return String(source).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}

function classifyVersionState(currentVersion, currentSource, releasedVersion, releasedSource) {
  if (!releasedVersion) return "release";
  const comparison = compareVersions(currentVersion, releasedVersion);
  if (comparison < 0) {
    throw new Error(`Version ${currentVersion} is lower than released version ${releasedVersion}.`);
  }
  if (comparison > 0) return "release";
  if (normalizeSource(currentSource) !== normalizeSource(releasedSource)) {
    throw new Error(`Published userscript content changed without advancing @version ${currentVersion}.`);
  }
  return "current";
}

function runGit(root, args, options = {}) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (options.allowFailure) return result;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed:\n${result.stderr || result.stdout}`.trim());
  }
  return options.preserveOutput ? result.stdout : result.stdout.trim();
}

function defaultGitAdapter(root) {
  return {
    refExists(ref) {
      return runGit(root, ["show-ref", "--verify", "--quiet", ref], { allowFailure: true }).status === 0;
    },
    isAncestor(ancestor, descendant) {
      return runGit(root, ["merge-base", "--is-ancestor", ancestor, descendant], { allowFailure: true }).status === 0;
    },
    show(ref, file) {
      return runGit(root, ["show", `${ref}:${file}`], { preserveOutput: true });
    },
  };
}

function detectReleases(root, options = {}) {
  const sourceRef = options.sourceRef || "refs/heads/main";
  if (sourceRef !== "refs/heads/main") {
    throw new Error(`Automatic releases must run from refs/heads/main, not ${sourceRef}.`);
  }
  const validation = validateRepository(root);
  if (validation.errors.length) {
    throw new Error(`Repository validation failed:\n- ${validation.errors.join("\n- ")}`);
  }

  const remote = options.remote || "origin";
  const commitSha = options.commitSha || "HEAD";
  if (options.commitSha && !/^[0-9a-f]{40}$/i.test(options.commitSha)) {
    throw new Error(`Invalid commit SHA: ${options.commitSha}`);
  }
  const git = options.git || defaultGitAdapter(root);
  const candidates = [];
  const scripts = [];

  for (const script of readManifest(root)) {
    const source = fs.readFileSync(path.join(root, script.entry), "utf8");
    const version = metadataValue(parseMetadata(source), "version");
    const config = JSON.parse(fs.readFileSync(path.join(root, path.dirname(script.entry), "greasyfork.json"), "utf8"));
    if (!Number.isInteger(config.greasyForkId)) {
      scripts.push({ scriptId: script.id, version, status: "manual-setup-required", releasedVersion: "Not published" });
      continue;
    }

    const remoteRef = `refs/remotes/${remote}/${script.releaseBranch}`;
    let releasedVersion = "";
    let releasedSource = "";
    if (git.refExists(remoteRef)) {
      if (!git.isAncestor(remoteRef, commitSha)) {
        throw new Error(`${script.id}: ${script.releaseBranch} cannot be fast-forwarded to ${commitSha}.`);
      }
      releasedSource = git.show(remoteRef, script.entry);
      releasedVersion = metadataValue(parseMetadata(releasedSource), "version");
      if (!releasedVersion) throw new Error(`${script.id}: cannot read @version from ${script.releaseBranch}.`);
    }

    let status;
    try {
      status = classifyVersionState(version, source, releasedVersion, releasedSource);
    } catch (error) {
      throw new Error(`${script.id}: ${error.message}`);
    }
    scripts.push({ scriptId: script.id, version, status, releasedVersion: releasedVersion || "Not published" });
    if (status === "release") candidates.push({ script_id: script.id, version });
  }

  return {
    candidates,
    scripts,
    matrix: { include: candidates },
    hasReleases: candidates.length > 0,
  };
}

function formatSummary(result) {
  const lines = [
    "## Automatic userscript release detection",
    "",
    "| Script | Released | Candidate | Status |",
    "| --- | --- | --- | --- |",
  ];
  for (const script of result.scripts) {
    lines.push(`| ${script.scriptId} | ${script.releasedVersion} | ${script.version} | ${script.status} |`);
  }
  lines.push("", result.hasReleases
    ? `${result.candidates.length} release candidate(s) require approval through \`userscript-production\`.`
    : "No userscript release requires approval.", "");
  return lines.join("\n");
}

function run(argv, environment = process.env, options = {}) {
  const args = parseArguments(argv);
  const result = detectReleases(process.cwd(), {
    remote: args.remote,
    sourceRef: args.sourceRef || environment.GITHUB_REF,
    commitSha: args.commitSha || environment.GITHUB_SHA,
    ...options,
  });
  if (environment.GITHUB_OUTPUT) {
    fs.appendFileSync(environment.GITHUB_OUTPUT, [
      `has_releases=${result.hasReleases}`,
      `matrix=${JSON.stringify(result.matrix)}`,
      `release_count=${result.candidates.length}`,
      "",
    ].join("\n"), "utf8");
  }
  if (environment.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(environment.GITHUB_STEP_SUMMARY, formatSummary(result), "utf8");
  }
  return result;
}

if (require.main === module) {
  try {
    const result = run(process.argv.slice(2));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  classifyVersionState,
  detectReleases,
  formatSummary,
  normalizeSource,
  parseArguments,
  run,
};
