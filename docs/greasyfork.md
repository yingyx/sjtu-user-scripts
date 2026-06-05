# GreasyFork Publishing

## Recommended Workflow

1. Keep each published script as a complete `.user.js` file under `scripts/<script-id>/`.
2. Point GreasyFork's GitHub sync or manual upload at that specific entry file.
3. Update the userscript metadata block in the entry file before publishing:
   - `@name`
   - `@namespace`
   - `@version`
   - `@description`
   - `@match`
   - `@grant`
   - `@connect`
4. Run local validation before release.

## GitHub Raw URL Pattern

Use this shape when configuring GreasyFork sync:

```text
https://raw.githubusercontent.com/<owner>/<repo>/<branch>/scripts/<script-id>/<script-id>.user.js
```

For the current script:

```text
scripts/sjtu-course-assistant-plus/sjtu-course-assistant-plus.user.js
```

## Structure Policy

- `scripts/<script-id>/<script-id>.user.js` is the release artifact.
- `scripts/<script-id>/README.md` documents behavior, SJTU page assumptions, and validation commands.
- `shared/` is source-only unless a script explicitly loads it.
- `outputs/` is for temporary generated artifacts and should not be the canonical publishing location.
- Add a build system only when there are enough shared modules or generated metadata to justify it.
