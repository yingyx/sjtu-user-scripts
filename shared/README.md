# Shared Code

This directory is reserved for helpers, snippets, or source modules shared by multiple SJTU userscripts.

GreasyFork installs one userscript entry file at a time. Anything placed here must be copied, bundled, or intentionally loaded through a userscript metadata directive such as `@require` before it can affect an installed script.

Prefer keeping scripts standalone until duplication becomes painful enough to justify a build step.
