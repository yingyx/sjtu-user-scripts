// ==UserScript==
// @name         Shuiyuan Privacy Mask
// @name:zh-CN   水源隐私遮罩
// @namespace    https://github.com/sjtu-user-scripts/shuiyuan-privacy-mask
// @version      0.2.1-rc.1
// @description  Mask the signed-in account identity in Shuiyuan's private account surfaces.
// @description:zh-CN  仅隐藏水源当前账户入口及本人主页头部中的身份信息，并保留帖子作者等公开语境。
// @license      UNLICENSED
// @supportURL   https://github.com/yingyx/sjtu-user-scripts/issues
// @match        https://shuiyuan.sjtu.edu.cn/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";

  const ENABLED_STORAGE_KEY = "shuiyuanPrivacyMask.enabled";
  const USERNAME_STORAGE_KEY = "shuiyuanPrivacyMask.username.v1";
  const ROOT_CLASS = "shuiyuan-privacy-mask-enabled";
  const OWN_PROFILE_CLASS = "shuiyuan-privacy-mask-own-profile";
  const STYLE_ID = "shuiyuan-privacy-mask-styles";
  const BUTTON_ID = "shuiyuan-privacy-mask-toggle";
  const FALLBACK_CLASS = "shuiyuan-privacy-mask-fallback";
  const AVATAR_PLACEHOLDER_URL =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'%3E%3Crect width='96' height='96' rx='48' fill='%23d8dde3'/%3E%3Ccircle cx='48' cy='35' r='15' fill='%238994a3'/%3E%3Cpath d='M22 80c2-18 12-28 26-28s24 10 26 28' fill='%238994a3'/%3E%3C/svg%3E";

  const state = {
    enabled: loadEnabled(),
    username: loadUsername(),
    button: null,
    fallbackButton: false,
    observer: null,
    scanScheduled: false,
  };

  injectStyles();
  applyRootState();
  syncOwnProfileRoute();
  observePage();
  scheduleScan();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  window.addEventListener("popstate", scheduleScan);

  function loadEnabled() {
    try {
      return Boolean(GM_getValue(ENABLED_STORAGE_KEY, true));
    } catch (_error) {
      return true;
    }
  }

  function loadUsername() {
    try {
      return cleanUsername(GM_getValue(USERNAME_STORAGE_KEY, ""));
    } catch (_error) {
      return "";
    }
  }

  function saveEnabled() {
    try {
      GM_setValue(ENABLED_STORAGE_KEY, state.enabled);
    } catch (_error) {
      // The current page still keeps the selected state if storage is unavailable.
    }
  }

  function saveUsername() {
    try {
      GM_setValue(USERNAME_STORAGE_KEY, state.username);
    } catch (_error) {
      // Identity discovery remains available for the current page.
    }
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      html.${ROOT_CLASS} .d-header .current-user img.avatar,
      html.${ROOT_CLASS}.${OWN_PROFILE_CLASS} .user-profile-avatar img.avatar {
        content: url("${AVATAR_PLACEHOLDER_URL}") !important;
        object-fit: cover !important;
        background: #d8dde3 !important;
      }

      html.${ROOT_CLASS}.${OWN_PROFILE_CLASS} .user-profile-names .username,
      html.${ROOT_CLASS}.${OWN_PROFILE_CLASS} .user-profile-names .name,
      html.${ROOT_CLASS}.${OWN_PROFILE_CLASS} .user-profile-names .full-name {
        color: transparent !important;
        text-shadow: none !important;
        background: var(--primary-low, #e6e9ec) !important;
        border-radius: 4px !important;
        box-decoration-break: clone;
        -webkit-box-decoration-break: clone;
        user-select: none !important;
      }

      #${BUTTON_ID} {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
      }

      #${BUTTON_ID} .dpm-mask-icon {
        box-sizing: border-box;
        display: inline-block;
        position: relative;
        width: 1em;
        height: 1em;
        border-radius: 50%;
        background:
          radial-gradient(circle at 50% 35%, currentColor 0 18%, transparent 19%),
          radial-gradient(circle at 50% 116%, currentColor 0 42%, transparent 43%);
        pointer-events: none;
        opacity: 0.86;
      }

      #${BUTTON_ID}[aria-pressed="true"] .dpm-mask-icon::after {
        content: "";
        position: absolute;
        left: 50%;
        top: 50%;
        width: 1.32em;
        height: 2px;
        background: currentColor;
        transform: translate(-50%, -50%) rotate(-45deg);
        border-radius: 999px;
      }

      #${BUTTON_ID}.${FALLBACK_CLASS} {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 1400;
        gap: 0.45em;
        padding: 0.5em 0.75em;
        border: 1px solid rgb(0 0 0 / 15%);
        border-radius: 4px;
        background: var(--secondary, #fff);
        color: var(--primary, #222);
        width: auto;
        max-width: min(260px, calc(100vw - 32px));
        box-shadow: 0 2px 12px rgb(0 0 0 / 18%);
      }
    `;

    const mount = document.head || document.documentElement;
    if (mount) {
      mount.appendChild(style);
    }
  }

  function applyRootState() {
    const root = document.documentElement;
    if (root) {
      root.classList.toggle(ROOT_CLASS, state.enabled);
    }
  }

  function boot() {
    scanPage();
    ensureToggleButton();
    window.setTimeout(scheduleScan, 500);
    window.setTimeout(scheduleScan, 1500);
  }

  function observePage() {
    const root = document.documentElement;
    if (!root || state.observer) {
      return;
    }

    state.observer = new MutationObserver(function (records) {
      for (let index = 0; index < records.length; index += 1) {
        const target = records[index].target;
        if (state.button && (target === state.button || state.button.contains(target))) {
          continue;
        }

        scheduleScan();
        return;
      }
    });
    state.observer.observe(root, {
      childList: true,
      subtree: true,
    });
  }

  function scheduleScan() {
    if (state.scanScheduled) {
      return;
    }

    state.scanScheduled = true;
    Promise.resolve().then(function () {
      state.scanScheduled = false;
      scanPage();
    });
  }

  function scanPage() {
    const discoveredUsername = discoverCurrentUsername();
    if (
      discoveredUsername &&
      normalizeUsername(discoveredUsername) !== normalizeUsername(state.username)
    ) {
      state.username = discoveredUsername;
      saveUsername();
    }

    syncOwnProfileRoute();

    if (document.readyState !== "loading") {
      ensureToggleButton();
    }
  }

  function discoverCurrentUsername() {
    return (
      usernameFromDiscourse() ||
      usernameFromCurrentUserAvatar() ||
      usernameFromMyPostsLink() ||
      usernameFromOwnProfilePreferences()
    );
  }

  function usernameFromDiscourse() {
    const discourse = window.Discourse;
    if (!discourse) {
      return "";
    }

    const candidates = [];
    if (discourse.currentUser) {
      candidates.push(discourse.currentUser);
    }
    if (discourse.User) {
      candidates.push(discourse.User.current);
      candidates.push(discourse.User.currentUser);
    }

    for (let index = 0; index < candidates.length; index += 1) {
      let candidate = candidates[index];
      if (typeof candidate === "function") {
        try {
          candidate = candidate.call(discourse.User || discourse);
        } catch (_error) {
          candidate = null;
        }
      }

      const username = cleanUsername(candidate && candidate.username);
      if (username) {
        return username;
      }
    }

    return "";
  }

  function usernameFromCurrentUserAvatar() {
    const avatar = document.querySelector(
      ".d-header .current-user img.avatar, #current-user img.avatar"
    );
    if (!avatar) {
      return "";
    }

    return usernameFromAvatarUrl(
      avatar.currentSrc || avatar.getAttribute("src") || ""
    );
  }

  function usernameFromAvatarUrl(value) {
    if (!value) {
      return "";
    }

    try {
      const pathname = new URL(value, window.location.origin).pathname;
      const match = pathname.match(/^\/user_avatar\/[^/]+\/([^/]+)\//i);
      return match ? cleanUsername(decodeURIComponent(match[1])) : "";
    } catch (_error) {
      return "";
    }
  }

  function usernameFromMyPostsLink() {
    const links = document.querySelectorAll(
      "[data-link-name='my-posts'][href*='/u/'], " +
        "[data-list-item-name='my-posts'] a[href*='/u/']"
    );

    for (let index = 0; index < links.length; index += 1) {
      const username = profileUsernameFromHref(links[index].getAttribute("href"));
      if (username) {
        return username;
      }
    }

    return "";
  }

  function usernameFromOwnProfilePreferences() {
    const profileUsername = profileUsernameFromHref(window.location.href);
    if (!profileUsername) {
      return "";
    }

    const preferenceLink = document.querySelector(
      ".user-navigation .user-nav__preferences a[href*='/preferences'], " +
        ".user-navigation a[href*='/preferences/account']"
    );
    if (!preferenceLink) {
      return "";
    }

    const preferenceUsername = profileUsernameFromHref(
      preferenceLink.getAttribute("href")
    );
    return usernamesEqual(profileUsername, preferenceUsername)
      ? profileUsername
      : "";
  }

  function profileUsernameFromHref(value) {
    if (!value) {
      return "";
    }

    try {
      const pathname = new URL(value, window.location.origin).pathname;
      const match = pathname.match(/^\/u\/([^/]+)(?:\/|$)/i);
      return match ? cleanUsername(decodeURIComponent(match[1])) : "";
    } catch (_error) {
      return "";
    }
  }

  function cleanUsername(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function normalizeUsername(value) {
    return cleanUsername(value).toLocaleLowerCase();
  }

  function usernamesEqual(left, right) {
    return Boolean(left) && normalizeUsername(left) === normalizeUsername(right);
  }

  function syncOwnProfileRoute() {
    const root = document.documentElement;
    if (!root) {
      return;
    }

    const profileUsername = profileUsernameFromHref(window.location.href);
    root.classList.toggle(
      OWN_PROFILE_CLASS,
      usernamesEqual(profileUsername, state.username)
    );
  }

  function ensureToggleButton() {
    if (!document.body) {
      return;
    }

    const sidebarActions = document.querySelector(".sidebar-footer-actions");
    const keyboardButton = sidebarActions
      ? sidebarActions.querySelector(
          ".sidebar-footer-actions-keyboard-shortcuts"
        )
      : null;

    if (state.button && state.button.isConnected) {
      if (sidebarActions && state.button.parentElement !== sidebarActions) {
        sidebarActions.insertBefore(state.button, keyboardButton || null);
        state.button.classList.remove(FALLBACK_CLASS);
        state.fallbackButton = false;
        syncButtonSize(keyboardButton);
      } else if (
        sidebarActions &&
        keyboardButton &&
        state.button.nextElementSibling !== keyboardButton
      ) {
        sidebarActions.insertBefore(state.button, keyboardButton);
      }
      updateButton();
      return;
    }

    const button = createToggleButton();
    state.button = button;
    if (sidebarActions) {
      sidebarActions.insertBefore(button, keyboardButton || null);
      state.fallbackButton = false;
      syncButtonSize(keyboardButton);
    } else {
      button.classList.add(FALLBACK_CLASS);
      document.body.appendChild(button);
      state.fallbackButton = true;
    }
    updateButton();
  }

  function createToggleButton() {
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.className = "btn-flat sidebar-footer-actions-button";
    button.addEventListener("click", function () {
      state.enabled = !state.enabled;
      saveEnabled();
      applyRootState();
      updateButton();
    });
    button.innerHTML =
      '<span class="dpm-mask-icon" aria-hidden="true"></span>' +
      '<span class="dpm-label"></span>';
    return button;
  }

  function syncButtonSize(referenceButton) {
    if (!state.button || !referenceButton) {
      return;
    }

    const rect = referenceButton.getBoundingClientRect();
    if (rect.width > 0) state.button.style.width = `${rect.width}px`;
    if (rect.height > 0) state.button.style.height = `${rect.height}px`;
  }

  function updateButton() {
    if (!state.button) {
      return;
    }

    const pressed = state.enabled ? "true" : "false";
    const actionLabel = state.enabled
      ? "显示我的身份信息"
      : "隐藏我的身份信息";
    setAttributeIfChanged(state.button, "aria-pressed", pressed);
    setAttributeIfChanged(state.button, "title", actionLabel);
    setAttributeIfChanged(state.button, "aria-label", actionLabel);

    const label = state.button.querySelector(".dpm-label");
    if (label) {
      const labelText = state.fallbackButton
        ? state.enabled
          ? "隐私遮罩：开"
          : "隐私遮罩：关"
        : "";
      if (label.textContent !== labelText) {
        label.textContent = labelText;
      }
    }
  }

  function setAttributeIfChanged(element, name, value) {
    if (element.getAttribute(name) !== value) {
      element.setAttribute(name, value);
    }
  }
})();
