# SJTU User Scripts

Browser userscripts for SJTU-specific workflows.

English | [简体中文](README.zh-CN.md)

## Scripts

<!-- BEGIN GENERATED SCRIPT LIST -->
| Script | Entry file | Purpose |
| --- | --- | --- |
| [Shuiyuan Deep Search](scripts/shuiyuan-deep-search/README.md) | `scripts/shuiyuan-deep-search/shuiyuan-deep-search.user.js` | Decompose questions, search and read Shuiyuan topics in parallel, produce cited research reports, and support follow-up questions. |
| [Shuiyuan Privacy Mask](scripts/shuiyuan-privacy-mask/README.md) | `scripts/shuiyuan-privacy-mask/shuiyuan-privacy-mask.user.js` | Mask the signed-in account identity in Shuiyuan's private account surfaces. |
| [SJTU Course Assistant Plus](scripts/sjtu-course-assistant-plus/README.md) | `scripts/sjtu-course-assistant-plus/sjtu-course-assistant-plus.user.js` | Enhance SJTU course selection with saved filter conditions, conflict filtering, jCourse reviews, and manageable LLM summary providers. |
<!-- END GENERATED SCRIPT LIST -->

## Repository Layout

```text
.
├── AGENTS.md
├── CLAUDE.md / GEMINI.md
├── scripts/
│   └── <script-id>/
│       ├── <script-id>.user.js
│       ├── README.md
│       ├── README.zh-CN.md
│       ├── CHANGELOG.md
│       └── greasyfork.json
├── templates/userscript/
├── tools/
├── tests/
├── shared/
└── docs/
```

Each script keeps a complete `.user.js` entry file under `scripts/<script-id>/`. That file is the GreasyFork-compatible publishing artifact and must include its own userscript metadata block.

Use `shared/` only for development notes or source snippets that will be copied or bundled into a final `.user.js`. GreasyFork users should not need files from `shared/` at runtime unless the script intentionally uses an external `@require`.

## Compatibility

- Keep final published files as standalone `.user.js` files.
- Avoid browser-extension-only APIs unless a script explicitly targets an extension build.
- Keep SJTU page-specific compatibility constraints documented in the script folder README.
- Use the repository-wide check below instead of maintaining per-script validation commands here.

## Development Checks

Run the repository validation and tooling tests locally:

```powershell
npm run check
```

The script table in both root README files is generated from `scripts.json` and userscript metadata. Run `npm run docs:sync` after changing registration or metadata; `npm run check` rejects stale generated lists.

Every registered script currently uses standards-version-1 validation, including metadata, documentation, security, compatibility, and GreasyFork configuration checks.

## One-Sentence Agent Development

Coding agents can start from a natural-language request such as:

> Build a userscript that shows only the original poster's replies on Shuiyuan, including tests, documentation, and release preparation.

`AGENTS.md` is the canonical workflow for Codex, GitHub Copilot, Cursor, and other compatible agents. The one-line `CLAUDE.md` and `GEMINI.md` adapters import that same file, so repository rules are not duplicated.

For deterministic scaffolding, agents use:

```powershell
npm run new -- --id <script-id> --name <Chinese-name> --name-en <English-name> --description <Chinese-description> --description-en <English-description> --match <URL-pattern>
```

New scripts receive English-primary metadata with Simplified Chinese localization, paired English and Chinese README files, and strict validation immediately. Existing scripts are migrated explicitly rather than during unrelated work. See `docs/agent-development.md` and `docs/standards.md`.

## Release Workflow

This repository supports multiple independent userscripts. Register each publishable script in `scripts.json`, keep per-script release notes in `scripts/<script-id>/CHANGELOG.md`, and publish through that script's `release/<script-id>` branch.

`Validate repository` checks every pull request and relevant push. After it succeeds on `main`, `Publish userscript updates` detects version advances, creates a dry-run plan for each affected published script, and calls `Promote userscript (internal)`, whose write-enabled jobs wait for `userscript-production` approval. `Bootstrap new userscript` is the only manual publishing entry and is restricted to first publication of scripts that do not yet have a GreasyFork ID.

See `docs/release.md` for the full CI/CD and GreasyFork synchronization workflow.
