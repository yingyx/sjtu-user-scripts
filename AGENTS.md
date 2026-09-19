# Userscript Development Contract

In this repository, “plugin” means a GreasyFork userscript by default. Do not create a browser extension, Codex plugin, or another product type unless the user explicitly requests it.

## Natural-language requests

The user only needs to describe the target page and desired behavior. Derive sensible requirements and complete scaffolding, implementation, documentation, validation, and handoff. Ask only when the target page is ambiguous or the feature involves credentials, tracking, advertising, payment, or another material choice.

## New-script workflow

1. Read `docs/standards.md` completely.
2. Run `npm run new -- --id <kebab-case-id> --name <localized-name> --name-en <English-name> --description <localized-description> --description-en <English-description> --match <URL-pattern>`. Repeat `--match` for multiple page patterns.
3. Implement and remove every `TODO(userscript)` in the entry file and README. Do not copy an existing script as a template.
4. Keep the README accurate about behavior, usage, limitations, privacy, and network requests.
5. Declare only the `@match`, `@grant`, and `@connect` values actually used. Never commit secrets, minify or obfuscate the release artifact, or download the primary logic at runtime.
6. Run `npm run docs:sync`, then `npm run check`, and report any target-page smoke tests that still require a human browser session.

New scripts use `standardsVersion: 1` in `scripts.json` and receive strict validation from creation.

## Existing-script workflow

- Before editing, read the target script's README, CHANGELOG, and complete `.user.js` entry.
- Do not migrate unrelated legacy conventions, and do not change a published script's primary `@name` or `@namespace` without explicit approval.
- Every `.user.js` code or metadata change must increment its SemVer `@version` and add a matching top CHANGELOG entry.
- Run `npm run check` before completion.

## Definition of done

Code, metadata, README, CHANGELOG, privacy disclosures, and tests must agree. A generated scaffold is not a finished plugin. Leaving `TODO(userscript)`, overstating verification, or delivering only a code fragment is incomplete.

The root `README.md` and `README.zh-CN.md` are maintained together. Their marked script-list blocks are generated; update them with `npm run docs:sync` instead of editing those blocks by hand. Repository-level usage or workflow changes must be reflected in both root README files.

When a published script's version is advanced and merged to `main`, a successful `Validate repository` run triggers `Publish userscript updates`, whose promotion jobs require approval through the `userscript-production` environment. `Bootstrap new userscript` is only for first publication. Do not bypass a failed automatic plan with a direct release; follow `docs/release.md`.

## Commit messages

- Use a Conventional Commit header no longer than 72 characters.
- Omit a script ID from the scope; keep the header concise and put details in the body.
- When a commit affects a userscript's code or documentation, add one `Script: <script-id>` footer per affected script after a blank line.
- Do not add a `Script:` footer for repository-only tooling, CI, or root documentation changes.

Example:

```text
fix: improve topic recall and report relevance

Script: shuiyuan-deep-search
```
