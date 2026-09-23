# Userscript Engineering Standards

This document defines the engineering standards for userscripts in this repository. Scripts registered with `standardsVersion: 1` receive strict checks. Existing entries without that field remain on the compatibility baseline until they are migrated in separate changes.

## Repository Structure

- Use a meaningful English kebab-case ID, such as `shuiyuan-privacy-mask`.
- Keep the distributable entry at `scripts/<id>/<id>.user.js`.
- Register every distributable script in `scripts.json`.
- New entries include `"standardsVersion": 1`; do not add it to an existing entry as part of unrelated work.
- Keep an English `README.md`, a Simplified Chinese `README.zh-CN.md`, a CHANGELOG, and `greasyfork.json` beside each entry file.
- The published `.user.js` must remain standalone and readable.
- Keep the generated script lists in `README.md` and `README.zh-CN.md` synchronized with `npm run docs:sync`.

## Metadata

Every standards-version-1 script must declare `@name`, `@namespace`, `@version`, `@description`, `@license`, `@run-at`, `@grant`, at least one precise `@match`/`@include`, and only the permissions and network domains it actually uses.

- Keep an existing script's primary `@name` and `@namespace` stable.
- English is the primary metadata language: unqualified `@name` and `@description` contain English text.
- Every script also declares Simplified Chinese through `@name:zh-CN` and `@description:zh-CN`. Do not duplicate the primary English values in `@name:en` or `@description:en`.
- Use an explicit SPDX license identifier, or `UNLICENSED` when the repository grants no license. Do not infer or generate a copyright owner.
- Do not add `@downloadURL` or `@updateURL` when GreasyFork is the distribution source.
- Avoid global URL matches and wildcard network access. A script that must contact user-configured hosts may use `@connect *` only with explicit user approval and a `scripts.json` `permissions.allowWildcardConnect` exception containing a concrete reason; keep known/common `@connect` domains alongside it.

## Code and Security

- Use strict mode and keep release code unminified and unobfuscated.
- Never commit API keys, tokens, captured user data, or site credentials.
- Do not use `eval`, `new Function`, or download the script's primary logic at runtime.
- Treat page content, API responses, and local storage as untrusted input.
- Prefer `textContent` for page text; sanitize any HTML that must be inserted.
- Bound observers, timers, retries, caches, and network timeouts.
- Document every network request and privacy impact in the script README.

## Versions and Documentation

- Use SemVer for new scripts and for existing scripts after they are migrated.
- Published-script development uses only `X.Y.Z-rc.N` prereleases, with positive, sequential `N` values. Other prerelease labels are not supported.
- The first code or metadata change after a stable release starts the intended patch, minor, or major line at `rc.1`; each later commit that changes the `.user.js` increments `N`.
- Keep accumulated release notes in a non-empty top `Unreleased` CHANGELOG section while the metadata version is an RC.
- Stabilization removes `-rc.N` and renames `Unreleased` to the matching stable version. A stabilization commit must not contain behavior changes.
- Use `npm run version:rc -- --script-id <id> --bump patch|minor|major` to start an RC line, `npm run version:rc -- --script-id <id>` to advance it, and `npm run version:stable -- --script-id <id>` to stabilize it.
- Initial unpublished scripts may be developed at their intended first stable version before Bootstrap. After publication, use the RC lifecycle above.
- Pure repository tooling, tests, or documentation changes do not require a userscript version increment.
- README behavior, permissions, network requests, and limitations must match the implementation.
- `README.md` is the canonical English public document and `README.zh-CN.md` is its complete Simplified Chinese counterpart. Keep their claims and section coverage equivalent and link them to each other.
- Keep engineering documentation, code identifiers, technical comments, tests, and CHANGELOG entries in English. A script's user-facing interface may remain in the target site's primary language.

## Validation

Run the compatibility-preserving baseline locally:

```powershell
npm run check
```

Run `npm run docs:sync` first after adding a script or changing catalog metadata. Validation rejects stale generated root README lists.
When a legacy script lacks localized metadata, an optional `catalog.<locale>` name or description in `scripts.json` may supply root-documentation text without changing the published userscript.

The baseline checks current metadata requirements, required files, syntax, and script-specific compatibility rules, then runs the tooling unit tests. For `standardsVersion: 1`, it additionally enforces exact paths, SemVer/changelog alignment, metadata and URL scope, readable code, a 2 MB limit, GreasyFork configuration, privacy/install documentation, secret scanning, and removal of the scaffold marker.

New scripts always start at `standardsVersion: 1`. Existing scripts are not silently upgraded by unrelated work.

## GreasyFork Constraints

Published code must remain inspectable, must not be minified or obfuscated, and must comply with GreasyFork's limits on external executable code. The release process and platform links remain documented in `docs/greasyfork.md`.
