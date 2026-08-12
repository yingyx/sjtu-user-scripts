# Release Workflow

This repository treats each userscript as an independent product. Each script has its own metadata version, documentation, changelog, Greasy Fork page, and release branch.

## Repository Model

```text
main
  Development and integration branch.

release/<script-id>
  Stable branch used by Greasy Fork source synchronization for one script.

<script-id>-vX.Y.Z
  Immutable audit tag created by the release workflow.
```

Do not point Greasy Fork or Tampermonkey at `main`. A script is published only when its release branch is updated.

## Script Registration

Every publishable script must be listed in `scripts.json`:

```json
{
  "id": "example-script",
  "name": "Example Script",
  "entry": "scripts/example-script/example-script.user.js",
  "readme": "scripts/example-script/README.md",
  "changelog": "scripts/example-script/CHANGELOG.md",
  "standardsVersion": 1,
  "releaseBranch": "release/example-script"
}
```

Each script directory should contain:

```text
<script-id>.user.js
README.md
CHANGELOG.md
greasyfork.json
```

## CI

CI runs on pushes to `main`, release branches, and pull requests. It validates every script listed in `scripts.json` and runs the repository tooling tests.

Run locally:

```powershell
npm run check
```

Generate the same validated plan used by GitHub Actions without changing any refs:

```powershell
npm run release:plan -- --script-id sjtu-course-assistant-plus --version 0.8.2 --source-ref refs/heads/main --dry-run
```

The plan is derived from `scripts.json`, userscript metadata, the matching CHANGELOG section, and `greasyfork.json`. It includes the exact release branch, tag, GreasyFork source URL, and SHA-256 digest of the `.user.js` artifact.

## Semi-Automatic Publishing

After the production gate is enabled, each push to `main` follows this path:

```text
CI check
  -> detect published scripts whose @version advanced
  -> run an independent dry-run plan for every candidate
  -> wait once for userscript-production approval
  -> promote candidates in an independent fail-fast:false matrix
  -> let the repository GreasyFork webhook request synchronization
```

Detection compares each current `.user.js` with its release branch. It fails closed when published content changed without a version increment, a version decreased, or a release branch cannot be fast-forwarded. Scripts whose `greasyForkId` is still `null` remain manual because their public GreasyFork page must be created first.

The approval job cannot write repository contents. Only the post-approval promotion matrix receives `contents: write`, and every matrix entry reuses the same validation, remote preflight, atomic branch/tag push, and per-script concurrency guard as the manual workflow. `fail-fast: false` prevents one promotion failure from cancelling the other scripts.

### One-Time GitHub Configuration

Keep automatic publishing disabled until all protection rules are saved:

1. In repository **Settings -> Environments**, create `userscript-production`.
2. Add at least one required reviewer. If the repository owner will trigger pushes and approve them, leave **Prevent self-review** disabled; enabling it requires a different reviewer.
3. Restrict deployment branches to `main`.
4. Do not add GreasyFork credentials or secrets to the environment.
5. In **Settings -> Secrets and variables -> Actions -> Variables**, create `USERSCRIPT_AUTO_RELEASE` with value `enabled`.

The repository variable is an explicit rollout switch. Without the exact value `enabled`, normal CI runs but release detection, approval, and promotion remain skipped. Disable the system immediately by deleting the variable or changing its value.

Review the generated dry-run jobs before selecting **Review deployments -> Approve and deploy**. The gate appears only after every plan finishes, including when one plan failed. Reject the batch when a failure indicates a repository-wide problem; otherwise approval lets the independent promotion matrix retry each candidate, where an invalid script fails without cancelling valid scripts. One approval covers all candidates in that workflow run. Rejecting the environment stops the batch before any release ref changes.

## Greasy Fork Setup

Create one Greasy Fork script page per userscript.

For source code synchronization, use the release branch URL:

```text
https://raw.githubusercontent.com/<owner>/<repo>/release/<script-id>/scripts/<script-id>/<script-id>.user.js
```

For additional information synchronization, use:

```text
https://raw.githubusercontent.com/<owner>/<repo>/release/<script-id>/scripts/<script-id>/README.md
```

Configure the Greasy Fork webhook for the repository. The webhook only causes Greasy Fork to check its configured source; the release branch still controls what gets published.

Do not add GitHub Raw `@downloadURL` or `@updateURL` metadata when Greasy Fork is the official distribution source. Greasy Fork rewrites those fields for installed scripts.

## Manual Publishing And Recovery

Use the manual workflow for first publication, deliberate dry runs, recovery, or when the semi-automatic switch is disabled.

1. Update the target script's `.user.js` metadata `@version` and matching top CHANGELOG entry.
2. Run `npm run check`, merge the change to `main`, and wait for CI.
3. In GitHub Actions, open `Release userscript` from the `main` branch.
4. Enter the script ID and exact version. Keep `dry_run` enabled.
5. Inspect the release plan and remote preflight in the workflow summary.
6. Run the workflow again with the same inputs and `dry_run` disabled. Select `create_github_release` only when a GitHub Release is wanted.
7. Confirm the release branch and tag, then verify the resulting version on GreasyFork.

For normal updates after semi-automatic publishing is enabled, steps 3-6 are replaced by reviewing the automatically generated plans and approving `userscript-production` once.

The workflow refuses non-`main` refs, unknown script IDs, metadata/version mismatches, existing tags, non-fast-forward release branches, and versions that do not advance the version already present on the release branch. It runs the full repository check before reading remote state.

For a real promotion, the release branch and annotated tag are sent in one atomic push. Either both refs are accepted or neither is updated. The optional GitHub Release uses only the selected version's CHANGELOG section, not the entire history.

Per-script concurrency allows releases of different scripts to proceed independently while preventing two promotions of the same script from racing.

## Failure And Recovery

### Validation or remote preflight fails

No release refs have changed. Correct the version, code, documentation, or remote-branch issue on `main`, then run dry-run again. Do not bypass the plan checks.

If the release branch is not an ancestor of `main`, inspect it before acting:

```powershell
git fetch origin --prune --tags
git log --graph --oneline --decorate main origin/release/<script-id>
```

The workflow intentionally never force-pushes a release branch. Resolve unexpected history explicitly rather than deleting or rewriting a published ref.

### Atomic push fails

GitHub rejects both the release branch and tag update. Fetch the remote refs and rerun dry-run. Do not assume that a release occurred based only on an attempted workflow step.

### GitHub Release creation fails after promotion

The release branch and tag may already be valid because GitHub Release creation happens afterward. Do not move or recreate the tag. Create the GitHub Release from the existing tag, using the matching CHANGELOG section and `.user.js` artifact, or leave the optional GitHub Release absent.

### GreasyFork does not update

Do not move the tag or republish the same version. Confirm that the release-branch Raw URLs in `greasyfork.json` are reachable, verify the GreasyFork source-sync and webhook settings, and ask GreasyFork to check the configured source again. GitHub ref promotion and third-party synchronization are deliberately verified separately.

### Automatic detection fails

Do not bypass the failure with a direct release. A same-version content error means the published `.user.js` changed without the required version and CHANGELOG update. A non-fast-forward error means the release history needs explicit inspection. Correct the cause on `main`, keep the repository variable disabled if necessary, and rerun normal CI before approving another release.

### Published code must be reverted

Create a new patch version that reverts the behavior, add a matching CHANGELOG entry, and run the normal dry-run and promotion flow. Never decrement the userscript version, move a published tag, or force-push the release branch.
