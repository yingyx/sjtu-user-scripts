# Changelog

## 0.10.0

- Reorganized settings into clearly separated sections, moved conflict hiding out of the toolbar, and added controls for automatic pagination and the number of reviews sent for summaries.
- Automatically activates the native `点此查看更多` link when it reaches the viewport, loading the next batch of courses.
- Added compact conflict details showing the selected course codes and names for each conflicting class.
- Added reusable filter conditions with local management and a native-style quick selector that applies, resets, and queries in one step.
- Added general-education credit-gap checks and recommended conditions, with reliable handling of the school's grouped academic-progress data.
- Extended the sanitized offline fixture and tests for filter conditions and academic-progress recommendations.

## 0.9.1

- Changed the native course accordion so opening another course no longer closes panels that are already open, without adding a separate expand-all control.
- Added a sanitized offline page fixture derived from the live SJTU course-selection DOM for testing outside enrollment periods without retaining credentials or personal course data.

## 0.9.0

- Redesigned the toolbar, course actions, summary cards, settings dialog, status badges, and responsive layout to blend more naturally into the SJTU course selection page.
- Replaced persistent diagnostic error blocks with concise, auto-dismissed notices and kept background scan diagnostics out of the page UI.
- Added management for OpenAI-compatible LLM providers, including add, edit, remove, and active-provider selection; model IDs are entered directly without model-list requests.
- Kept DeepSeek as a built-in, non-removable provider and migrated existing DeepSeek keys and model selections automatically.
- Added independent, full-width summary cards for every teaching class so multiple results can remain visible and comparable.
- Unified single-class and multi-class summary cards, replaced the spinner with subtle loading dots, gave yes/no explanations more room, and aligned teaching-class action buttons.
- Removed the active LLM label from summary cards and shortened the matched-teacher label to `教师`.
- Shortened the summary action to `总结评价` and marked jCourse links with an external-link arrow.
- Allowed user-configured HTTPS LLM endpoints and documented their network and privacy implications.

## 0.8.2

- Added neutral `UNLICENSED` metadata and the repository support URL.
- Adopted standards-version-1 validation and GreasyFork synchronization metadata.

## 0.8.1

- Changed the default script language to Simplified Chinese while retaining localized English metadata.

## 0.8.0

- Added time-conflict filtering for SJTU course selection pages.
- Added on-demand jCourse review lookup and DeepSeek summary support.
- Added settings for API keys, model selection, cache behavior, and summary dimensions.
