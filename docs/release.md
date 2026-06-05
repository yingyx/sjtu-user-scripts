# Release Workflow

This repository treats each userscript as an independent product. Each script has its own metadata version, documentation, changelog, Greasy Fork page, and release branch.

## Repository Model

```text
main
  Development and integration branch.

release/<script-id>
  Stable branch used by Greasy Fork source synchronization for one script.

<script-id>-vX.Y.Z
  Optional audit tag created by the release workflow.
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

CI runs on pushes to `main`, release branches, and pull requests. It validates every script listed in `scripts.json`:

- `node --check` syntax validation.
- Required userscript metadata.
- No `@downloadURL` or `@updateURL` when Greasy Fork is the distribution source.
- Optional compatibility rules, such as forbidding array prototype helpers on polluted SJTU pages.

Run locally:

```powershell
node tools/validate-userscripts.js
```

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

## Publishing A Script

1. Update only the target script's `.user.js` metadata `@version`.
2. Update that script's `CHANGELOG.md`.
3. Merge the change to `main`.
4. In GitHub Actions, run `Release userscript`.
5. Input the script ID, version, and whether to create a GitHub Release.

The release workflow validates the repository, verifies that the requested version matches the target script metadata, updates `release/<script-id>` to the selected commit, creates `<script-id>-vX.Y.Z`, and optionally creates a GitHub Release containing the `.user.js` artifact.
