# Shuiyuan Privacy Mask

Shuiyuan Privacy Mask hides your own avatar, username, display name, and profile identity on Shuiyuan. It is meant for screenshots, screen sharing, and browsing in public places.

## What It Does

- Runs only on Shuiyuan:

```text
https://shuiyuan.sjtu.edu.cn/*
```

- Reads the current logged-in user from Discourse globals and the header user button.
- Masks matching avatars, usernames, display names, mentions, and profile links across the page.
- Covers common Shuiyuan surfaces, including posts, user cards, the user menu, and user profile pages.
- Adds a privacy toggle next to the Shuiyuan sidebar keyboard shortcuts button.
- Falls back to a small floating button when the sidebar footer cannot be found.
- Stores the enabled/disabled state in userscript storage.

## Installation

1. Install a userscript manager, such as Tampermonkey.
2. Install this script from Greasy Fork.
3. Open Shuiyuan while logged in:

```text
https://shuiyuan.sjtu.edu.cn
```

## Basic Use

After Shuiyuan loads, click the privacy icon next to the sidebar keyboard shortcuts button to toggle masking.

The script is enabled by default. When enabled, it replaces your own avatar with a placeholder and hides text for your own username or display name. It does not hide other users.

## Privacy And Network Requests

The script makes no network requests.

It stores only one local setting: whether the privacy mask is enabled.

## Limitations

Shuiyuan may update its Discourse theme or plugins. If a new component renders your identity in a non-standard way, that specific element may need an additional selector.

The script is a visual privacy aid, not a security boundary. Hidden text may still exist in the page DOM.
