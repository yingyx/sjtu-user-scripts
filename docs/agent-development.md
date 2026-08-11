# Agent Instructions and Scaffolding

The repository keeps one canonical instruction body in the root `AGENTS.md`.

## Instruction discovery

| Agent | Repository file used here | Reason |
| --- | --- | --- |
| Codex | `AGENTS.md` | Codex discovers `AGENTS.md` from the repository root toward the working directory. |
| GitHub Copilot | `AGENTS.md` | Copilot supports agent instructions in `AGENTS.md`; no duplicate `copilot-instructions.md` is needed. |
| Cursor | `AGENTS.md` | Cursor reads a root `AGENTS.md` directly. |
| Claude Code | `CLAUDE.md` → `@AGENTS.md` | Claude reads `CLAUDE.md`, and its documented import syntax avoids duplicated content. |
| Gemini CLI | `GEMINI.md` → `@AGENTS.md` | Gemini reads `GEMINI.md` by default and supports Markdown imports. |
| Other compatible agents | `AGENTS.md` | Tools implementing the agents.md convention can use the canonical file directly. |

The two adapter files intentionally contain one import line. Do not copy the instruction body into them.

Official references:

- [OpenAI: Custom instructions with AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [Anthropic: CLAUDE.md and AGENTS.md imports](https://code.claude.com/docs/en/memory#agents-md)
- [Gemini CLI: context files and imports](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/gemini-md.md)
- [GitHub Copilot: supported custom instruction types](https://docs.github.com/en/copilot/reference/custom-instructions-support)
- [Cursor: rules and AGENTS.md](https://docs.cursor.com/context/rules-for-ai)

## One-sentence development

A user can ask, for example:

> Build a userscript that shows only the original poster's replies on Shuiyuan, including tests, documentation, and release preparation.

The Agent derives the internal scaffold arguments, runs the generator, implements the behavior, and validates the result. The user does not need to describe repository paths or metadata conventions.

## Scaffold interface

```powershell
npm run new -- --id shuiyuan-op-only --name "Shuiyuan Original Poster Only" --name-en "Shuiyuan Original Poster Only" --description "Shows only posts by the topic author." --description-en "Shows only posts by the topic author." --match "https://shuiyuan.sjtu.edu.cn/t/*"
```

The generator refuses duplicate IDs, non-kebab-case IDs, global matches, incomplete arguments, and existing target directories. It creates the four required files and registers the new script with `standardsVersion: 1`. The implementation marker deliberately makes strict validation fail until real behavior replaces it.

The tooling test suite exercises this path end to end in a temporary repository: generation must produce neutral `UNLICENSED` metadata and valid GreasyFork URLs, incomplete code and documentation must fail, and a completed scaffold must pass strict repository validation.
