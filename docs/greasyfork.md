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
6. Run local validation before release.

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

To publish, run the GitHub Actions `Release userscript` workflow with the script ID and expected `@version`. The workflow validates all scripts, checks the target script's version, updates the target release branch, creates a per-script tag, and optionally creates a GitHub Release.
