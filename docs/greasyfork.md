# GreasyFork Publishing

## Recommended Workflow

1. Keep each published script as a complete `.user.js` file under `scripts/<script-id>/`.
2. Register every published script in `scripts.json`.
3. Point GreasyFork's source sync at that script's release branch, not `main`.
4. Point GreasyFork's additional information sync at that script's release-branch `README.md`.
5. Update the userscript metadata block in the entry file before publishing:
   - `@name`
   - `@namespace`
   - `@version`
   - `@description`
   - `@match`
   - `@grant`
   - `@connect`
6. Run local validation and the GitHub Actions dry run before release.

## GitHub Raw URL Pattern

Use this shape when configuring GreasyFork source sync:

```text
https://raw.githubusercontent.com/<owner>/<repo>/release/<script-id>/scripts/<script-id>/<script-id>.user.js
```

For the current script:

```text
https://raw.githubusercontent.com/<owner>/<repo>/release/sjtu-course-assistant-plus/scripts/sjtu-course-assistant-plus/sjtu-course-assistant-plus.user.js
```

Use this shape for additional information sync:

```text
https://raw.githubusercontent.com/<owner>/<repo>/release/<script-id>/scripts/<script-id>/README.md
```

## Structure Policy

- `scripts/<script-id>/<script-id>.user.js` is the release artifact.
- `scripts/<script-id>/README.md` documents behavior, SJTU page assumptions, and validation commands.
- `scripts/<script-id>/CHANGELOG.md` records that script's release history.
- `scripts/<script-id>/greasyfork.json` records the GreasyFork sync URLs and release branch for that script.
- `shared/` is source-only unless a script explicitly loads it.
- `outputs/` is for temporary generated artifacts and should not be the canonical publishing location.
- Add a build system only when there are enough shared modules or generated metadata to justify it.

## Distribution Metadata

When GreasyFork is the official distribution source, do not add GitHub Raw `@downloadURL` or `@updateURL` to the source script. GreasyFork rewrites installed scripts to use GreasyFork update URLs.

## Release Branches

Each script has a dedicated release branch:

```text
release/<script-id>
```

GreasyFork syncs from that branch. `main` can contain development changes without immediately publishing them to users.

For a script's first publication, run the GitHub Actions `Release userscript` workflow with the script ID and expected `@version`. Leave `dry_run` enabled first. The dry run validates all scripts and tooling tests, checks the remote release branch and tag, and does not change GitHub or GreasyFork state. After inspection, run it again with `dry_run` disabled, then create the GreasyFork page and record its numeric ID.

After the script has a GreasyFork ID and the protected semi-automatic gate is enabled, merging an advanced version to `main` generates the same dry-run plan automatically. Approving the `userscript-production` environment once promotes all detected scripts independently. The manual workflow remains the recovery path.

A successful release-branch push only makes the configured source available and prompts the webhook check. Confirm the resulting version on GreasyFork separately; the workflow does not treat third-party synchronization latency as a successful Git operation.
