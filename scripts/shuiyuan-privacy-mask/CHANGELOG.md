# Changelog

## 0.2.0

- Start at `document-start` and install the privacy styles synchronously to prevent the signed-in identity from flashing during page startup.
- Restrict masking to the current-account header control and the signed-in user's own profile header; post authors, topic participants, mentions, and user cards remain visible.
- Cache only the last confirmed signed-in username locally so direct navigation to the user's own profile can be masked before Discourse finishes rendering.
- Keep observer-driven toggle updates idempotent and ignore mutations originating inside the toggle, preventing a feedback loop that could leave Shuiyuan stuck on its loading screen.

## 0.1.1

- Added neutral `UNLICENSED` metadata and the repository support URL.
- Adopted standards-version-1 validation, compatibility checks, and GreasyFork synchronization metadata.
- Replaced `Array.from(Set)` calls with equivalent iteration for page compatibility.

## 0.1.0

- Added Shuiyuan-only userscript metadata and URL matching.
- Added current-user identity detection from Discourse globals and header UI.
- Added masking for own avatars, profile links, mentions, usernames, and display names across posts, user cards, user menus, sidebars, and profile pages.
- Added a sidebar footer toggle next to the keyboard shortcuts button, with a floating fallback button.
