# SJTU User Scripts

Browser userscripts for SJTU-specific workflows.

## Scripts

| Script | Entry file | Purpose |
| --- | --- | --- |
| SJTU Course Assistant Plus | `scripts/sjtu-course-assistant-plus/sjtu-course-assistant-plus.user.js` | Enhances SJTU course selection pages with time-conflict filtering and on-demand review summaries. |

## Repository Layout

```text
.
├── scripts/
│   └── <script-id>/
│       ├── <script-id>.user.js
│       └── README.md
├── shared/
│   └── README.md
├── docs/
│   └── greasyfork.md
├── outputs/
└── HANDOFF.md
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
```
