// ==UserScript==
// @name         Shuiyuan Privacy Mask
// @namespace    https://github.com/sjtu-user-scripts/shuiyuan-privacy-mask
// @version      0.1.0
// @description  Hide your own avatar, username, display name, and profile identity on Shuiyuan, with a native-looking sidebar toggle.
// @author       Codex
// @match        https://shuiyuan.sjtu.edu.cn/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const STORAGE_KEY = "shuiyuanPrivacyMask.enabled.v1";
  const ROOT_CLASS = "dpm-privacy-mask-on";
  const PRIVATE_ATTR = "data-dpm-private";
  const AVATAR_ATTR = "data-dpm-private-avatar";
  const LINK_ATTR = "data-dpm-private-link";
  const BUTTON_ID = "dpm-privacy-toggle";
  const SCAN_DELAY_MS = 250;
  const AVATAR_SIZES = [12, 24, 32, 45, 48, 64, 96, 120, 144, 180, 240];
  const AVATAR_PLACEHOLDER_URL = 'url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%20144%20144%22%3E%3Crect%20width%3D%22144%22%20height%3D%22144%22%20rx%3D%2272%22%20fill%3D%22%23e5e7eb%22/%3E%3Ccircle%20cx%3D%2272%22%20cy%3D%2252%22%20r%3D%2223%22%20fill%3D%22%23979da6%22/%3E%3Cpath%20d%3D%22M38%20118c5-23%2021-35%2034-35s29%2012%2034%2035c-9%207-21%2011-34%2011s-25-4-34-11z%22%20fill%3D%22%23979da6%22/%3E%3C/svg%3E")';

  const state = {
    enabled: loadEnabled(),
    observer: null,
    scanTimer: 0,
    button: null,
    fallbackButton: false,
    started: false,
    profile: {
      usernames: new Set(),
      displayNames: new Set(),
      avatarUrls: new Set(),
      avatarTemplates: new Set(),
      userPaths: new Set(),
    },
  };

  injectStyles();
  init();

  function init() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
      boot();
    }
  }

  function boot() {
    if (!looksLikeDiscourse()) return;

    refreshProfile();
    start();
  }

  function start() {
    if (state.started) return;
    state.started = true;
    applyRootState();
    ensureToggleButton();
    scanPage();
    observeDom();
    window.setTimeout(scheduleScan, 1000);
    window.setTimeout(scheduleScan, 3000);
  }

  function looksLikeDiscourse() {
    if (window.Discourse) return true;
    if (document.querySelector("meta[name='generator'][content*='Discourse' i]")) return true;
    if (document.querySelector("script[src*='/assets/discourse']")) return true;
    if (document.querySelector(".d-header, #site-logo, #main-outlet")) return true;
    return false;
  }

  function hasProfileSignal() {
    return state.profile.usernames.size > 0 || state.profile.avatarUrls.size > 0 || state.profile.avatarTemplates.size > 0 || state.profile.userPaths.size > 0;
  }

  function loadEnabled() {
    try {
      return GM_getValue(STORAGE_KEY, true) !== false;
    } catch (error) {
      return true;
    }
  }

  function saveEnabled() {
    try {
      GM_setValue(STORAGE_KEY, state.enabled);
    } catch (error) {
      // Userscript storage can be unavailable in strict managers; the in-page state still works.
    }
  }

  function refreshProfile() {
    collectFromDiscourseGlobals();
    collectFromCurrentUserButton();
    collectFromUserMenu();
    collectFromOwnProfilePage();
  }

  function collectFromDiscourseGlobals() {
    const discourse = window.Discourse;
    if (!discourse) return;

    const candidates = [];
    if (discourse.currentUser) candidates.push(discourse.currentUser);
    if (discourse.User) {
      if (typeof discourse.User.current === "function") {
        try {
          candidates.push(discourse.User.current());
        } catch (error) {
          // Ignore framework timing errors while Discourse is booting.
        }
      }
      if (typeof discourse.User.currentProp === "function") {
        addUsername(discourse.User.currentProp("username"));
        addDisplayName(discourse.User.currentProp("name"));
        addAvatarTemplate(discourse.User.currentProp("avatar_template"));
      }
    }

    for (let i = 0; i < candidates.length; i += 1) {
      collectFromUserObject(candidates[i]);
    }
  }

  function collectFromUserObject(user) {
    if (!user) return;
    const attrs = user.attrs || user;
    addUsername(readValue(attrs, "username"));
    addDisplayName(readValue(attrs, "name"));
    addDisplayName(readValue(attrs, "displayName"));
    addAvatarTemplate(readValue(attrs, "avatar_template"));
    addAvatarTemplate(readValue(attrs, "avatarTemplate"));
    addAvatarUrl(readValue(attrs, "avatar_url"));
    addAvatarUrl(readValue(attrs, "avatarUrl"));
  }

  function readValue(object, key) {
    if (!object) return "";
    if (typeof object.get === "function") {
      try {
        return object.get(key);
      } catch (error) {
        return "";
      }
    }
    return object[key];
  }

  function collectFromCurrentUserButton() {
    const currentUserAreas = document.querySelectorAll(".current-user, .d-header .header-dropdown-toggle.current-user");
    for (let i = 0; i < currentUserAreas.length; i += 1) {
      collectFromElement(currentUserAreas[i], true);
    }

    const headerAvatars = document.querySelectorAll(".d-header img.avatar, .d-header .avatar");
    for (let i = 0; i < headerAvatars.length; i += 1) {
      const avatar = headerAvatars[i];
      if (avatar.closest(".current-user") || avatar.closest("[aria-label*='profile' i]")) {
        collectFromElement(avatar, true);
      }
    }
  }

  function collectFromUserMenu() {
    const userMenu = document.querySelector(".user-menu, .menu-panel.user-menu, .user-menu-panel");
    if (userMenu) collectFromElement(userMenu, false);
  }

  function collectFromOwnProfilePage() {
    const path = profilePathFromHref(window.location.href);
    if (!path) return;

    const ownProfileLink = findOwnProfilePageLink(path);
    if (!ownProfileLink) return;

    state.profile.userPaths.add(path);
    const username = path.split("/")[2] || "";
    addUsername(decodeURIComponent(username));

    const profileNames = document.querySelector(".user-profile-names");
    if (profileNames) {
      const names = profileNames.querySelectorAll(".username, .name, .full-name");
      for (let i = 0; i < names.length; i += 1) {
        addDisplayName(names[i].textContent || "");
      }
    }
  }

  function findOwnProfilePageLink(path) {
    const links = document.querySelectorAll("a[href*='/preferences'], a[href*='/messages'], a[href*='/notifications']");
    for (let i = 0; i < links.length; i += 1) {
      if (profilePathFromHref(links[i].getAttribute("href") || "") === path) {
        return links[i];
      }
    }
    return null;
  }

  function collectFromElement(element, trustText) {
    if (!element) return;
    const avatars = element.matches("img, .avatar") ? [element] : element.querySelectorAll("img.avatar, .avatar img, img[src*='avatar']");
    for (let i = 0; i < avatars.length; i += 1) {
      const avatar = avatars[i];
      addAvatarUrl(avatar.currentSrc || avatar.src);
      addUsername(avatar.getAttribute("title"));
      addUsername(avatar.getAttribute("alt"));
      addDisplayName(avatar.getAttribute("aria-label"));
    }

    const links = element.matches("a") ? [element] : element.querySelectorAll("a[href*='/u/']");
    for (let i = 0; i < links.length; i += 1) {
      collectFromProfileLink(links[i]);
    }

    if (trustText) {
      addUsername(element.getAttribute("title"));
      addUsername(element.getAttribute("aria-label"));
    }
  }

  function collectFromProfileLink(link) {
    const href = link.getAttribute("href") || "";
    const path = profilePathFromHref(href);
    if (!path) return;
    state.profile.userPaths.add(path);
    const username = path.split("/")[2] || "";
    addUsername(decodeURIComponent(username));
  }

  function addUsername(value) {
    addCleanValue(state.profile.usernames, value);
    const clean = cleanValue(value);
    if (clean) state.profile.userPaths.add("/u/" + encodeURIComponent(clean).toLowerCase());
  }

  function addDisplayName(value) {
    addCleanValue(state.profile.displayNames, value);
  }

  function addCleanValue(target, value) {
    const clean = cleanValue(value);
    if (!clean) return;
    target.add(clean);
  }

  function cleanValue(value) {
    if (typeof value !== "string") return "";
    return value.replace(/^@/, "").replace(/\s+/g, " ").trim();
  }

  function addAvatarTemplate(value) {
    if (typeof value !== "string" || !value.trim()) return;
    const template = normalizeUrl(value);
    if (template) state.profile.avatarTemplates.add(template);
    for (let i = 0; i < AVATAR_SIZES.length; i += 1) {
      addAvatarUrl(value.replace(/\{size\}/g, String(AVATAR_SIZES[i])));
    }
  }

  function addAvatarUrl(value) {
    if (typeof value !== "string" || !value.trim()) return;
    const normalized = normalizeUrl(value);
    if (normalized) state.profile.avatarUrls.add(normalized);
  }

  function normalizeUrl(value) {
    try {
      const url = new URL(value, window.location.origin);
      url.search = "";
      url.hash = "";
      return url.href;
    } catch (error) {
      return "";
    }
  }

  function profilePathFromHref(href) {
    if (!href) return "";
    try {
      const url = new URL(href, window.location.origin);
      const match = url.pathname.match(/^\/u\/([^/]+)/i);
      if (!match) return "";
      return "/u/" + encodeURIComponent(decodeURIComponent(match[1])).toLowerCase();
    } catch (error) {
      return "";
    }
  }

  function ensureToggleButton() {
    const sidebarActions = document.querySelector(".sidebar-footer-actions");
    if (state.button && document.contains(state.button) && (!state.fallbackButton || !sidebarActions)) {
      const keyboardButton = sidebarActions ? sidebarActions.querySelector(".sidebar-footer-actions-keyboard-shortcuts") : null;
      if (sidebarActions && keyboardButton && state.button.parentElement === sidebarActions && state.button.nextElementSibling !== keyboardButton) {
        sidebarActions.insertBefore(state.button, keyboardButton);
      }
      updateButton();
      return;
    }

    const button = state.button && document.contains(state.button) ? state.button : buildButton();
    if (button.parentElement) button.parentElement.removeChild(button);
    if (sidebarActions) {
      button.classList.remove("dpm-floating-toggle");
      button.className = "btn-flat sidebar-footer-actions-button dpm-toggle";
      const keyboardButton = sidebarActions.querySelector(".sidebar-footer-actions-keyboard-shortcuts");
      sidebarActions.insertBefore(button, keyboardButton || null);
      syncButtonSize(keyboardButton);
      state.fallbackButton = false;
    } else {
      button.className = "btn-flat sidebar-footer-actions-button dpm-toggle";
      button.classList.add("dpm-floating-toggle");
      button.style.width = "";
      button.style.height = "";
      document.body.appendChild(button);
      state.fallbackButton = true;
    }

    state.button = button;
    updateButton();
  }

  function buildButton() {
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.className = "btn-flat sidebar-footer-actions-button dpm-toggle";
    button.addEventListener("click", function () {
      state.enabled = !state.enabled;
      saveEnabled();
      applyRootState();
      updateButton();
      scanPage();
    });
    button.innerHTML = '<span class="dpm-mask-icon" aria-hidden="true"></span><span class="dpm-label"></span>';
    return button;
  }

  function syncButtonSize(referenceButton) {
    if (!state.button || !referenceButton) return;
    const rect = referenceButton.getBoundingClientRect();
    if (rect.width > 0) state.button.style.width = rect.width + "px";
    if (rect.height > 0) state.button.style.height = rect.height + "px";
  }

  function updateButton() {
    if (!state.button) return;
    state.button.setAttribute("aria-pressed", state.enabled ? "true" : "false");
    state.button.setAttribute("aria-label", state.enabled ? "Turn privacy mask off" : "Turn privacy mask on");
    state.button.title = state.enabled ? "Turn privacy mask off" : "Turn privacy mask on";
    state.button.classList.toggle("dpm-active", state.enabled);
    const label = state.button.querySelector(".dpm-label");
    if (label) label.textContent = state.fallbackButton ? (state.enabled ? "Privacy mask: on" : "Privacy mask: off") : "";
  }

  function applyRootState() {
    document.documentElement.classList.toggle(ROOT_CLASS, state.enabled);
  }

  function observeDom() {
    if (state.observer) state.observer.disconnect();
    state.observer = new MutationObserver(function () {
      scheduleScan();
      ensureToggleButton();
    });
    state.observer.observe(document.body, { childList: true, subtree: true });
  }

  function scheduleScan() {
    window.clearTimeout(state.scanTimer);
    state.scanTimer = window.setTimeout(scanPage, SCAN_DELAY_MS);
  }

  function scanPage() {
    refreshProfile();
    clearMarkers();
    if (!hasProfileSignal()) return;
    markCurrentUserProfilePage();
    markAvatars();
    markProfileLinks();
    markTextNodes();
    ensureToggleButton();
  }

  function clearMarkers() {
    const marked = document.querySelectorAll("[" + PRIVATE_ATTR + "], [" + AVATAR_ATTR + "], [" + LINK_ATTR + "]");
    for (let i = 0; i < marked.length; i += 1) {
      marked[i].removeAttribute(PRIVATE_ATTR);
      marked[i].removeAttribute(AVATAR_ATTR);
      marked[i].removeAttribute(LINK_ATTR);
    }
  }

  function markAvatars() {
    const avatars = document.querySelectorAll("img.avatar, .avatar img, img[src*='avatar'], img[srcset*='avatar'], .avatar-flair");
    for (let i = 0; i < avatars.length; i += 1) {
      const avatar = avatars[i];
      if (isOwnAvatar(avatar)) {
        avatar.setAttribute(AVATAR_ATTR, "true");
        const wrapper = avatar.closest(".user-profile-avatar, .user-card-avatar, .topic-avatar, .post-avatar, .avatar-wrapper, .user-image");
        if (wrapper && !wrapper.closest(".d-header .current-user, .d-header .header-dropdown-toggle.current-user")) {
          wrapper.setAttribute(AVATAR_ATTR, "true");
        }
      }
    }
  }

  function markCurrentUserProfilePage() {
    if (!isOwnProfileHref(window.location.href)) return;

    const avatar = document.querySelector(".user-profile-avatar");
    if (avatar) avatar.setAttribute(AVATAR_ATTR, "true");

    const avatarImage = document.querySelector(".user-profile-avatar img.avatar");
    if (avatarImage) avatarImage.setAttribute(AVATAR_ATTR, "true");

    const profileNames = document.querySelector(".user-profile-names");
    if (!profileNames) return;

    const nameElements = profileNames.querySelectorAll(".username, .name, .full-name, a[href*='/u/']");
    for (let i = 0; i < nameElements.length; i += 1) {
      markElementIfOwnIdentity(nameElements[i]);
    }
  }

  function isOwnAvatar(element) {
    const urls = avatarCandidateUrls(element);
    for (let i = 0; i < urls.length; i += 1) {
      if (isOwnAvatarUrl(urls[i])) return true;
    }

    const title = cleanValue(element.getAttribute("title"));
    const alt = cleanValue(element.getAttribute("alt"));
    if (title && state.profile.usernames.has(title)) return true;
    if (alt && state.profile.usernames.has(alt)) return true;
    return false;
  }

  function avatarCandidateUrls(element) {
    const values = [];
    const src = element.currentSrc || element.src || element.getAttribute("src") || "";
    if (src) values.push(src);
    const srcset = element.getAttribute("srcset") || "";
    if (srcset) {
      const parts = srcset.split(",");
      for (let i = 0; i < parts.length; i += 1) {
        const url = parts[i].trim().split(/\s+/)[0];
        if (url) values.push(url);
      }
    }
    return values;
  }

  function isOwnAvatarUrl(value) {
    const url = normalizeUrl(value);
    if (!url) return false;
    if (state.profile.avatarUrls.has(url)) return true;
    if (matchesAvatarTemplate(url)) return true;

    try {
      const parsed = new URL(url);
      const pathname = decodeURIComponent(parsed.pathname).toLowerCase();
      if (pathname.indexOf("/user_avatar/") === -1) return false;
      const usernames = Array.from(state.profile.usernames);
      for (let i = 0; i < usernames.length; i += 1) {
        const username = usernames[i].toLowerCase();
        if (username && pathname.indexOf("/" + username + "/") !== -1) return true;
      }
    } catch (error) {
      return false;
    }

    return false;
  }

  function matchesAvatarTemplate(url) {
    const templates = Array.from(state.profile.avatarTemplates);
    for (let i = 0; i < templates.length; i += 1) {
      const template = templates[i];
      if (template.indexOf("%7Bsize%7D") === -1 && template.indexOf("{size}") === -1) continue;
      const pattern = escapeRegExp(template).replace(/%7Bsize%7D|\\\{size\\\}/g, "\\d+");
      if (new RegExp("^" + pattern + "$").test(url)) return true;
    }
    return false;
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function markProfileLinks() {
    const links = document.querySelectorAll("a[href*='/u/'], [data-user-card], a.mention");
    for (let i = 0; i < links.length; i += 1) {
      const element = links[i];
      const href = element.getAttribute("href") || "";
      const cardUser = cleanValue(element.getAttribute("data-user-card"));
      if (shouldMaskIdentityLink(element, href, cardUser)) {
        element.setAttribute(LINK_ATTR, "true");
        if (containsExactOwnIdentity(element)) {
          element.setAttribute(PRIVATE_ATTR, "text");
        }
      }
    }
  }

  function shouldMaskIdentityLink(element, href, cardUser) {
    if (cardUser && state.profile.usernames.has(cardUser)) return true;
    if (containsExactOwnIdentity(element)) return true;
    if (isOwnProfileHref(href) && element.classList.contains("mention")) return true;
    if (isOwnProfileHref(href) && element.querySelector("img.avatar")) return true;
    return false;
  }

  function markTextNodes() {
    const selectors = [
      ".username",
      ".name",
      ".full-name",
      ".first.username",
      ".poster-name",
      ".names__primary",
      ".names__secondary",
      ".name-username-wrapper",
      ".topic-meta-data .names span",
      ".user-card .names span",
      ".user-card .names div",
      ".user-card .metadata h1",
      ".user-profile-names",
      ".user-profile-names span",
      ".user-profile-names .username",
      ".user-profile-names .name",
      ".user-profile-names .full-name",
      ".topic-avatar .post-avatar-user-info",
      ".user-menu .username",
    ];
    const elements = document.querySelectorAll(selectors.join(","));
    for (let i = 0; i < elements.length; i += 1) {
      if (containsOwnIdentity(elements[i])) {
        elements[i].setAttribute(PRIVATE_ATTR, "text");
      }
    }
  }

  function markElementIfOwnIdentity(element) {
    if (containsExactOwnIdentity(element)) {
      element.setAttribute(PRIVATE_ATTR, "text");
    }
  }

  function containsOwnIdentity(element) {
    const text = cleanValue(element.textContent || "");
    if (!text) return false;
    if (state.profile.usernames.has(text) || state.profile.displayNames.has(text)) return true;
    const cardUser = cleanValue(element.getAttribute("data-user-card"));
    if (cardUser && state.profile.usernames.has(cardUser)) return true;
    return false;
  }

  function containsExactOwnIdentity(element) {
    const text = cleanValue(element.textContent || "");
    return Boolean(text && (state.profile.usernames.has(text) || state.profile.displayNames.has(text)));
  }

  function isOwnProfileHref(href) {
    const path = profilePathFromHref(href);
    return Boolean(path && state.profile.userPaths.has(path));
  }

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      html.${ROOT_CLASS} [${AVATAR_ATTR}] {
        filter: none !important;
        opacity: 1 !important;
        position: relative !important;
      }

      html.${ROOT_CLASS} img[${AVATAR_ATTR}] {
        content: ${AVATAR_PLACEHOLDER_URL} !important;
        border-radius: 50% !important;
      }

      html.${ROOT_CLASS} [${AVATAR_ATTR}]:not(img) img.avatar {
        opacity: 0 !important;
      }

      html.${ROOT_CLASS} [${AVATAR_ATTR}]:not(img)::after {
        content: "";
        position: absolute;
        inset: 0;
        margin: auto;
        width: min(100%, 144px);
        height: min(100%, 144px);
        border-radius: 50%;
        background-image: ${AVATAR_PLACEHOLDER_URL};
        background-size: cover;
        background-position: center;
        pointer-events: none;
      }

      html.${ROOT_CLASS} .d-header .current-user[${AVATAR_ATTR}]::after,
      html.${ROOT_CLASS} .d-header .header-dropdown-toggle.current-user[${AVATAR_ATTR}]::after {
        content: none !important;
      }

      html.${ROOT_CLASS} [${PRIVATE_ATTR}] {
        border-radius: 0.35em !important;
        color: transparent !important;
        text-shadow: none !important;
        background: var(--primary-low, rgba(0, 0, 0, 0.08)) !important;
        box-decoration-break: clone !important;
        -webkit-box-decoration-break: clone !important;
      }

      html.${ROOT_CLASS} [${LINK_ATTR}] {
        pointer-events: none !important;
      }

      .dpm-toggle {
        position: relative !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        box-sizing: border-box !important;
      }

      .dpm-mask-icon {
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

      .dpm-toggle.dpm-active .dpm-mask-icon::after {
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

      .dpm-floating-toggle {
        position: fixed !important;
        right: 16px !important;
        bottom: 16px !important;
        z-index: 9999 !important;
        gap: 0.45em !important;
        padding: 0.5em 0.75em !important;
        border-radius: 4px !important;
        border: 1px solid rgba(0, 0, 0, 0.15) !important;
        background: var(--secondary, #fff) !important;
        color: var(--primary, #222) !important;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18) !important;
      }
    `;
    document.head.appendChild(style);
  }
})();
