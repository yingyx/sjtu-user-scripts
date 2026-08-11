# SJTU User Scripts

Browser userscripts for SJTU-specific workflows.

## Scripts

| Script | Entry file | Purpose |
| --- | --- | --- |
| SJTU Course Assistant Plus | `scripts/sjtu-course-assistant-plus/sjtu-course-assistant-plus.user.js` | Enhances SJTU course selection pages with time-conflict filtering and on-demand review summaries. |
| Shuiyuan Privacy Mask | `scripts/shuiyuan-privacy-mask/shuiyuan-privacy-mask.user.js` | Hides your own avatar, username, display name, and profile identity on Shuiyuan with a sidebar toggle. |

## Repository Layout

```text
.
├── AGENTS.md
├── CLAUDE.md / GEMINI.md
├── scripts/
│   └── <script-id>/
│       ├── <script-id>.user.js
│       ├── README.md
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
- Test syntax before publishing:

```powershell
node --check scripts\sjtu-course-assistant-plus\sjtu-course-assistant-plus.user.js
node --check scripts\shuiyuan-privacy-mask\shuiyuan-privacy-mask.user.js
```

## Development Checks

Run the repository validation and tooling tests locally:

```powershell
npm run check
```

The checks are intentionally compatible with the existing scripts. Stricter rules will be introduced per script as each one is migrated.

## One-Sentence Agent Development

Coding agents can start from a natural-language request such as:

> Build a userscript that shows only the original poster's replies on Shuiyuan, including tests, documentation, and release preparation.

`AGENTS.md` is the canonical workflow for Codex, GitHub Copilot, Cursor, and other compatible agents. The one-line `CLAUDE.md` and `GEMINI.md` adapters import that same file, so repository rules are not duplicated.

For deterministic scaffolding, agents use:

```powershell
npm run new -- --id <script-id> --name <localized-name> --name-en <English-name> --description <localized-description> --description-en <English-description> --match <URL-pattern>
```

New scripts receive strict validation immediately; existing scripts keep the compatibility baseline until migrated separately. See `docs/agent-development.md` and `docs/standards.md`.

## Release Workflow

This repository supports multiple independent userscripts. Register each publishable script in `scripts.json`, keep per-script release notes in `scripts/<script-id>/CHANGELOG.md`, and publish through that script's `release/<script-id>` branch.

See `docs/release.md` for the full CI/CD and GreasyFork synchronization workflow.
