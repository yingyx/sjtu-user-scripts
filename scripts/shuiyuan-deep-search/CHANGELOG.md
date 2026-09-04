# Changelog

## 0.2.0

- Added evidence-aware supplemental searches during follow-up conversations.
- Replaced the fixed provider switch with a configurable OpenAI-compatible API endpoint while keeping DeepSeek defaults.
- Moved the launcher beside Discourse's native search entry and simplified the panel, settings, copy, and icon treatment.
- Matched the launcher's rendered color and dimensions to Discourse's native search control.
- Stopped panel keyboard events from leaking to Discourse's global shortcuts.
- Declared common service domains plus `@connect *` for user-configured endpoints, following explicit approval.
- Migrated existing DeepSeek and OpenAI configuration values into the new endpoint-based format.

## 0.1.0

- Added model-assisted question decomposition and parallel Discourse search.
- Added paginated reading, evidence-gap review, and one iterative search round.
- Added cited reports, evidence-scoped follow-up conversations, progress, and cancellation.
- Isolated the interface in a Shadow DOM so it cannot alter Discourse loading and page controls.
- Added separate DeepSeek and OpenAI settings, with DeepSeek as the default provider.
- Added reliable header, inline, menu, and automatic first-run entries for LLM configuration.
