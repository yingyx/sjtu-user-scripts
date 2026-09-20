# Shuiyuan Privacy Mask

Shuiyuan Privacy Mask hides the signed-in account identity only in Shuiyuan's private account surfaces while leaving public conversation context intact. It is meant for screenshots, screen sharing, and browsing in public places.

## What It Does

- Runs only on Shuiyuan:

```text
https://shuiyuan.sjtu.edu.cn/*
```

- Replaces the current-account avatar in the header with a neutral placeholder.
- Masks the avatar, username, and display name in the signed-in user's own profile header.
- Starts before Discourse renders the page, preventing the original header identity from flashing during startup.
- Deliberately leaves post authors, topic participants, mentions, user cards, and other public identity occurrences visible.
- Adds a privacy toggle next to the Shuiyuan sidebar keyboard shortcuts button.
- Falls back to a small floating button when the sidebar footer cannot be found.
- Stores the enabled/disabled state in userscript storage.

## Installation

1. Install a userscript manager, such as Tampermonkey.
2. [Install this script from Greasy Fork](https://greasyfork.org/scripts/591032-shuiyuan-privacy-mask).
3. Open Shuiyuan while logged in:

```text
https://shuiyuan.sjtu.edu.cn
```

## Basic Use

Click **隐私遮罩：开/关** next to the sidebar keyboard shortcuts button to toggle masking.

The script is enabled by default. The setting applies immediately and persists across page loads.

## Detection Boundary

The script accepts identity only from Discourse's current-user runtime state, the header account avatar, the **My posts** link, or the preferences link on the user's own profile. The own-profile mask activates only when the profile URL username matches the confirmed signed-in username.

Public occurrences of the same username are intentionally not masked. Hiding only one author in posts or topic lists would make the signed-in user's activity visually exceptional and undermine the purpose of the mask.

## Privacy And Network Requests

The script makes no network requests.

It stores the enabled state and the last confirmed signed-in username locally through userscript storage. The cached username allows direct visits to the user's own profile to be masked before Discourse renders it.

## Limitations

Shuiyuan may update its Discourse theme or current-account components. If those stable account surfaces change, the relevant mask may stop activating until the script is updated.

The script is a visual privacy aid, not a security boundary. Hidden text may still exist in the page DOM.
