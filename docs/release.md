# Userscript Publishing

Each userscript in this repository is an independent product with its own version, changelog, GreasyFork page, release branch, and immutable audit tags. Validation and publication are deliberately separate operations.

## Repository Model

```text
main
  Development and integration branch.

release/<script-id>
  Stable source branch used by one GreasyFork script.

<script-id>-vX.Y.Z
  Immutable tag created when that version is promoted.
```

Never point GreasyFork or a userscript manager at `main`. Code is published only after the matching release branch advances.

`main` may contain `X.Y.Z-rc.N` versions. They are validated like any other repository state but are never added to the publication matrix. A stable `X.Y.Z` version is therefore a single immutable userscript artifact, while each intervening code state has its own increasing RC number.

Every publishable script must be registered in `scripts.json` and contain:

```text
scripts/<script-id>/
├── <script-id>.user.js
├── README.md
├── CHANGELOG.md
└── greasyfork.json
```

## Workflow Responsibilities

The Actions page exposes workflows with intentionally narrow names and responsibilities:

| Workflow | Trigger | Responsibility |
| --- | --- | --- |
| `Validate repository` | Pull requests and pushes | Read-only repository validation and tests. |
| `Publish userscript updates` | Successful `Validate repository` run on a `main` push | Detect, plan, approve, and promote normal updates of published scripts. |
| `Bootstrap new userscript` | Manual dispatch from `main` | Create the first release branch and tag for one script that has no GreasyFork ID. |
| `Promote userscript (internal)` | Reusable workflow call only | Internal, write-enabled implementation that atomically advances one release branch and tag. |

`Promote userscript (internal)` has no `workflow_dispatch` trigger. It is not an alternative manual release path. Its promotion job references `userscript-production` directly, so every caller is subject to the same Environment protection before any write-enabled step starts.

## Local Validation

Run the same repository checks used by Actions:

```powershell
npm run docs:sync
npm run check
```

To inspect one release plan without changing refs:

```powershell
npm run release:plan -- --script-id sjtu-course-assistant-plus --version 0.9.0 --source-ref refs/heads/main --dry-run
```

The plan is derived from `scripts.json`, userscript metadata, the matching CHANGELOG section, and `greasyfork.json`. It records the release branch, tag, source URLs, commit, and SHA-256 digest of the `.user.js` artifact.

For a published script, start and advance development with:

```powershell
npm run version:rc -- --script-id <script-id> --bump patch
# After another commit changes the same .user.js:
npm run version:rc -- --script-id <script-id>
```

Choose `minor` or `major` instead of `patch` when appropriate. Add the accumulated notes under the generated top `Unreleased` heading. When that exact artifact is ready to publish, create a separate stabilization commit:

```powershell
npm run version:stable -- --script-id <script-id>
npm run check
```

The stabilization helper keeps the target `X.Y.Z`, removes `-rc.N`, and converts `Unreleased` to `X.Y.Z`. Do not add behavior changes to this commit.

## Normal Update Flow

Normal updates of scripts with an integer `greasyForkId` have one production path:

```text
push or merge to main
  -> Validate repository succeeds
  -> Publish userscript updates checks the exact validated commit
  -> classify RC versions as validation-only
  -> detect published scripts whose stable @version advanced
  -> create an independent dry-run plan for every candidate
  -> require every plan to succeed
  -> start one Promote userscript (internal) deployment per candidate
  -> wait for userscript-production approval on the write-enabled jobs
  -> let the repository webhook ask GreasyFork to check its source
```

`Publish userscript updates` is triggered with `workflow_run`. Because that event's default `GITHUB_SHA` points at the current default branch rather than necessarily at the validated commit, every checkout, plan, and promotion explicitly uses `github.event.workflow_run.head_sha`.

Detection compares each candidate `.user.js` with its release branch and fails closed when:

- published code changed without a version increment;
- a prerelease uses anything other than `X.Y.Z-rc.N`;
- a release branch contains a prerelease version;
- a version decreased;
- the release branch cannot be fast-forwarded to the validated commit; or
- repository validation fails.

Planning uses a `fail-fast: false` matrix so all candidate errors are visible in one run. Promotion jobs are created only when every candidate plan succeeds. The reusable promotion job itself references `userscript-production`, binding the approval to the job that receives write access instead of to a separate placeholder job. Reviewers can approve the pending deployments together. Promotions also use `fail-fast: false`; a transient failure for one script does not cancel an unrelated script, and each promotion repeats validation and remote preflight after approval.

If no published stable script version advanced, detection succeeds and all later publication jobs are skipped. RC and ordinary repository commits therefore do not publish anything. Planning independently rejects prerelease versions, so Bootstrap and the reusable promotion workflow cannot bypass this rule.

## Production Gate

The existing GitHub configuration is shared by automatic updates and first publication:

1. The `userscript-production` Environment has at least one required reviewer.
2. **Prevent self-review** remains disabled when the repository owner is the reviewer.
3. Deployment branches are restricted to `main`.
4. The Environment contains no GreasyFork credentials or other release secrets.
5. Repository variable `USERSCRIPT_AUTO_RELEASE` is exactly `enabled` when automatic publication should run.

The repository variable is a kill switch for `Publish userscript updates`. Removing it or changing its value leaves validation active but skips automatic detection and publication. It does not create a direct manual release path.

## First Publication

A new script cannot be synchronized by GreasyFork until a stable Raw source exists, while automatic publishing intentionally ignores scripts whose `greasyForkId` is `null`. Use `Bootstrap new userscript` once to resolve that bootstrap dependency:

1. Complete the script at a stable version, along with its README, CHANGELOG, and `greasyfork.json` with `greasyForkId: null`.
2. Merge the script to `main` and wait for `Validate repository` to pass.
3. Open `Bootstrap new userscript`, select the `main` branch, and enter the exact script ID and version.
4. Review its first-publication plan and approve `userscript-production`.
5. Confirm that the release branch and immutable tag were created.
6. Create the GreasyFork page using the release-branch Raw URLs.
7. Record the numeric GreasyFork ID in `greasyfork.json` and merge that repository-only update.

Bootstrap refuses prerelease versions, scripts that already have a GreasyFork ID, existing release branches, existing version tags, non-`main` refs, unknown IDs, and version mismatches. It cannot be used to update a published script.

## GreasyFork Synchronization

Use these URL shapes when creating the GreasyFork page:

```text
https://raw.githubusercontent.com/<owner>/<repo>/release/<script-id>/scripts/<script-id>/<script-id>.user.js
https://raw.githubusercontent.com/<owner>/<repo>/release/<script-id>/scripts/<script-id>/README.md
```

The first URL is the code-sync source; the second is the additional-information source. A successful GitHub promotion only advances those sources and prompts the configured repository webhook. GreasyFork synchronization is asynchronous, so verify the public version separately.

Do not add GitHub Raw `@downloadURL` or `@updateURL` metadata when GreasyFork is the official distribution source. GreasyFork supplies installed update URLs.

## Failure and Recovery

There is no general-purpose manual update workflow. A failed automatic plan must not be bypassed by calling the promotion engine directly.

### Validation or planning fails

No production refs changed and no approval is requested. Correct the code, version, CHANGELOG, generated documentation, or release-history problem on `main`, then let the new successful validation trigger another publication run.

For unexpected release history, inspect it before making changes:

```powershell
git fetch origin --prune --tags
git log --graph --oneline --decorate main origin/release/<script-id>
```

Never force-push a release branch or move a published tag.

### Approval is rejected

No production refs changed. Review the plans, correct any concern on `main`, and use the publication run triggered by the corrected commit. Do not substitute Bootstrap; it rejects published scripts.

### Promotion fails before the atomic push

No production refs changed. When the failure is transient, rerun the failed jobs in the same `Publish userscript updates` run. The reusable workflow uses the original validated source SHA and repeats all checks.

### Atomic push fails

GitHub rejects both the release branch and tag update. Fetch the remote state and rerun the failed promotion after resolving the cause. Do not assume either ref changed based on an attempted step.

### GreasyFork does not update

Do not move the tag or republish the same version. Confirm that the release-branch Raw URLs in `greasyfork.json` are reachable, verify the GreasyFork sync and webhook settings, and ask GreasyFork to check its configured source again.

### Published behavior must be reverted

Start a new patch RC line that reverts the behavior, update `Unreleased`, validate it, and then stabilize it in a separate commit. Let the normal automatic update path publish the resulting stable version. Never decrement the userscript version or rewrite published history.
