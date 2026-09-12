# Changelog

## 0.2.2

- Normalized numeric-string topic IDs, rejected invalid IDs explicitly, and preserved earlier relevant results across recovery rounds.
- Added independent core-term searches, bounded full-text probes when snippet screening rejects every hit, and accurate empty-search diagnostics.
- Reduced repeated prompts, combined relevance screening with recovery planning, and bounded screening snippets and follow-up context while preserving source evidence.
- Made noun searches default to useful information and community experience, reserving identity analysis for explicit questions or material ambiguity.
- Separated information goals and content angles from retrieval queries across planning, recovery, evidence review, reports, and follow-ups.
- Added relevance screening before reading; sparse-result recovery now counts relevant unread topics instead of raw hits.
- Kept likely name corrections brief and focused reports and suggested questions on substantive information, with source-backed facts and applicable dates.
- Moved the launcher to the left of native search and expanded the icon artwork to fill its view box.
- Kept button and icon dimensions synchronized through resize and header replacement, with explicit box sizing.
- Added hypothesis-aware name, alias, and category expansion to initial and follow-up planning.
- Added at most two recovery rounds for sparse searches using hit counts and candidate snippets, with query deduplication and existing-topic exclusion.
- Required source-backed name disambiguation and documented the additional search context sent to the configured LLM.

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
