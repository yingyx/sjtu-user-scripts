# Userscript Engineering Standards

This document defines the target engineering standards for userscripts in this repository. The initial tooling rollout deliberately preserves compatibility with existing scripts; stricter checks will be enabled one script at a time in later migrations.

## Repository Structure

- Use a meaningful English kebab-case ID, such as `shuiyuan-privacy-mask`.
- Keep the distributable entry at `scripts/<id>/<id>.user.js`.
- Register every distributable script in `scripts.json`.
- Keep a README, CHANGELOG, and `greasyfork.json` beside each entry file.
- The published `.user.js` must remain standalone and readable.

## Metadata

Every script must declare `@name`, `@namespace`, `@version`, `@description`, at least one precise `@match`, and only the permissions and network domains it actually uses.

- Keep an existing script's primary `@name` and `@namespace` stable.
- Do not add `@downloadURL` or `@updateURL` when GreasyFork is the distribution source.
- Avoid global URL matches and wildcard network access.
- Use localized metadata keys when a script provides names or descriptions in multiple languages.

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
- A `.user.js` code or metadata change should increment `@version` and add a matching top CHANGELOG entry.
- Pure repository tooling, tests, or documentation changes do not require a userscript version increment.
- README behavior, permissions, network requests, and limitations must match the implementation.

## Validation

Run the compatibility-preserving baseline locally:

```powershell
npm run check
```

The baseline checks current metadata requirements, required files, syntax, and script-specific compatibility rules, then runs the tooling unit tests. Later rollout stages will add strict structure, security, and version-difference enforcement without changing all existing scripts at once.

## GreasyFork Constraints

Published code must remain inspectable, must not be minified or obfuscated, and must comply with GreasyFork's limits on external executable code. The release process and platform links remain documented in `docs/greasyfork.md`.
