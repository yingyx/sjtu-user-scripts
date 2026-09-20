// ==UserScript==
// @name         交大选课助手+
// @name:en      SJTU Course Assistant Plus
// @namespace    https://course.sjtu.plus/
// @version      0.10.0-rc.3
// @description  增强交大选课页面，支持筛选条件、冲突筛选、选课社区评价和可管理的 LLM 总结来源。
// @description:en  Enhance SJTU course selection with saved filter conditions, conflict filtering, jCourse reviews, and manageable LLM summary providers.
// @author       Codex
// @license      UNLICENSED
// @supportURL   https://github.com/yingyx/sjtu-user-scripts/issues
// @match        https://i.sjtu.edu.cn/xsxk/zzxkyzb_cxZzxkYzbIndex.html?*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// @connect      course.sjtu.plus
// @connect      api.deepseek.com
// @connect      *
// ==/UserScript==

(function () {
  "use strict";

  const COURSE_API_BASE = "https://course.sjtu.plus/api";
  const SETTINGS_KEY = "sjtuCoursePlus.settings.v2";
  const JCACHE_KEY = "sjtuCoursePlus.jcourseCache.v2";
  const LCACHE_KEY = "sjtuCoursePlus.llmCache.v2";
  const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 14;
  const CACHE_MAX_ENTRIES = 250;
  const SCAN_DEBOUNCE_MS = 350;
  const LOAD_MORE_WAIT_TIMEOUT_MS = 8000;
  const EXPAND_WAIT_TIMEOUT_MS = 4000;
  const EXPAND_WAIT_INTERVAL_MS = 150;
  const ACADEMIC_PROGRESS_PAGE = "/xjyj/xsxyqk_ckXsXyxxHtmlView.html?gnmkdm=N551225&layout=default";
  const ACADEMIC_PROGRESS_API = "/xjyj/xsxyqk_ckXsXyxxHtmlView.html?doType=query&xh_id=";
  const GENERAL_EDUCATION_SECTION = "通识核心类模块";
  const DEFAULT_DIMENSIONS = [
    { type: "yesno", label: "是否点名", note: "若能判断线上/线下，必须说明线上或线下" },
    { type: "yesno", label: "是否有互动", note: "" },
    { type: "yesno", label: "是否有考试", note: "如果没有人提到评分标准中包含考试，则认为没有" },
  ];
  const BUILT_IN_PROVIDER = {
    id: "deepseek",
    label: "DeepSeek",
    endpoint: "https://api.deepseek.com/chat/completions",
    key: "",
    model: "deepseek-v4-flash",
    builtIn: true,
  };

  const state = {
    scanTimer: 0,
    observer: null,
    selectedSlots: [],
    selectedCourses: [],
    settings: loadSettings(),
    jcourseCache: loadJson(JCACHE_KEY, {}),
    llmCache: loadJson(LCACHE_KEY, {}),
    activeRequests: new Map(),
    errorCount: 0,
    zeroDomReported: false,
    noticeTimer: 0,
    loadMoreObserver: null,
    loadMoreControl: null,
    loadMorePending: false,
    loadMoreFailedControl: null,
    loadMoreFallbackBound: false,
    loadMoreFallbackTimer: 0,
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
    ensureToolbar();
    document.addEventListener("click", preserveOtherExpandedCourses, true);
    observeDom();
    ensureAutoLoadMore();
    scheduleScan();
    const delayedScans = [1000, 2500, 5000];
    for (let i = 0; i < delayedScans.length; i += 1) {
      window.setTimeout(scheduleScan, delayedScans[i]);
    }
    window.__sjtuCoursePlusDebug = {
      parseScheduleText,
      schedulesConflict,
      collectSelectedSlots,
      collectCandidatePanels,
      scanNow,
      settings: state.settings,
    };
  }

  function loadSettings() {
    const saved = loadJson(SETTINGS_KEY, {});
    const providers = normalizeProviderSettings(saved);
    const requestedActive = normalizeProviderId(saved.activeProviderId || (Array.isArray(saved.enabledProviders) ? saved.enabledProviders[0] : ""));
    let activeProviderId = providers[0].id;
    for (let i = 0; i < providers.length; i += 1) {
      if (providers[i].id === requestedActive) activeProviderId = requestedActive;
    }
    return {
      hideConflicts: Boolean(saved.hideConflicts),
      activeProviderId,
      providers,
      jcourseApiKey: typeof saved.jcourseApiKey === "string" ? saved.jcourseApiKey : "",
      dimensions: normalizeDimensionSettings(saved.dimensions),
      presets: normalizePresetSettings(saved.presets),
    };
  }

  function normalizePresetSettings(value) {
    if (!Array.isArray(value)) return [];
    const out = [];
    for (let i = 0; i < value.length && out.length < 30; i += 1) {
      const preset = normalizePreset(value[i], i);
      if (preset) out.push(preset);
    }
    return out;
  }

  function normalizePreset(value, index) {
    if (!value || typeof value !== "object") return null;
    const label = normalizeText(value.label || value.name || "").slice(0, 40);
    if (!label) return null;
    const filters = [];
    const sourceFilters = Array.isArray(value.filters) ? value.filters : [];
    for (let i = 0; i < sourceFilters.length; i += 1) {
      const item = sourceFilters[i];
      if (!item || typeof item !== "object") continue;
      const indexValue = String(item.index || "").trim();
      const group = String(item.group || "").trim();
      if (!indexValue || !group) continue;
      filters.push({
        index: indexValue.slice(0, 120),
        group: group.slice(0, 80),
        value: String(item.value || "").slice(0, 120),
        label: normalizeText(item.label || item.text || indexValue).slice(0, 80),
      });
    }
    const inputs = [];
    const sourceInputs = Array.isArray(value.inputs) ? value.inputs : [];
    for (let i = 0; i < sourceInputs.length; i += 1) {
      const group = String(sourceInputs[i] && sourceInputs[i].group || "").trim();
      const inputValue = normalizeText(sourceInputs[i] && sourceInputs[i].value || "").slice(0, 120);
      if (group && inputValue) inputs.push({ group, value: inputValue });
    }
    return {
      id: normalizePresetId(value.id) || `preset-${Date.now()}-${index}`,
      label,
      tabCode: String(value.tabCode || "").slice(0, 12),
      tabLabel: normalizeText(value.tabLabel || "").slice(0, 60),
      search: normalizeText(value.search || "").slice(0, 120),
      filters,
      inputs,
    };
  }

  function normalizePresetId(value) {
    return String(value || "").trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  }

  function normalizeProviderSettings(saved) {
    const providerKeys = saved.providerKeys && typeof saved.providerKeys === "object" ? saved.providerKeys : {};
    const providerModels = saved.providerModels && typeof saved.providerModels === "object" ? saved.providerModels : {};
    const deepSeek = cloneProvider(BUILT_IN_PROVIDER);
    deepSeek.key = typeof providerKeys.deepseek === "string" ? providerKeys.deepseek : "";
    const oldModel = typeof providerModels.deepseek === "string" ? providerModels.deepseek.trim() : "";
    if (oldModel && oldModel !== "deepseek-chat") deepSeek.model = oldModel;
    const source = Array.isArray(saved.providers) ? saved.providers : [];
    const out = [];
    for (let i = 0; i < source.length; i += 1) {
      const normalized = normalizeProvider(source[i], i);
      if (!normalized) continue;
      if (normalized.id === "deepseek") {
        deepSeek.key = normalized.key;
        deepSeek.model = normalized.model || deepSeek.model;
      } else if (!providerIdExists(out, normalized.id)) {
        out.push(normalized);
      }
    }
    return [deepSeek].concat(out);
  }

  function normalizeProvider(value, index) {
    if (!value || typeof value !== "object") return null;
    const label = normalizeText(value.label || value.name || "").slice(0, 40);
    const endpoint = normalizeText(value.endpoint || "");
    if (!label || !endpoint) return null;
    const rawId = normalizeProviderId(value.id || label) || `custom-${index + 1}`;
    return {
      id: rawId === "deepseek" ? "deepseek" : uniqueProviderId(rawId),
      label,
      endpoint,
      key: typeof value.key === "string" ? value.key : "",
      model: normalizeText(value.model || ""),
      builtIn: rawId === "deepseek",
    };
  }

  function cloneProvider(provider) {
    return {
      id: provider.id,
      label: provider.label,
      endpoint: provider.endpoint,
      key: provider.key || "",
      model: provider.model || "",
      builtIn: Boolean(provider.builtIn),
    };
  }

  function normalizeProviderId(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  }

  function uniqueProviderId(base) {
    const normalized = normalizeProviderId(base) || "custom";
    return normalized === "deepseek" ? `custom-${Date.now()}` : normalized;
  }

  function providerIdExists(providers, id) {
    for (let i = 0; i < providers.length; i += 1) {
      if (providers[i].id === id) return true;
    }
    return false;
  }

  function cloneDefaultDimensions() {
    const out = [];
    for (let i = 0; i < DEFAULT_DIMENSIONS.length; i += 1) {
      out.push({ type: DEFAULT_DIMENSIONS[i].type, label: DEFAULT_DIMENSIONS[i].label, note: DEFAULT_DIMENSIONS[i].note || "" });
    }
    return out;
  }

  function normalizeDimensionSettings(value) {
    if (!Array.isArray(value) || !value.length) return cloneDefaultDimensions();
    const out = [];
    for (let i = 0; i < value.length; i += 1) {
      const item = value[i];
      if (typeof item === "string") {
        const label = item.trim();
        if (label) out.push({ type: "yesno", label, note: defaultDimensionNote(label, "yesno") });
      } else if (item && typeof item === "object") {
        const label = String(item.label || item.name || "").trim();
        const type = normalizeDimensionType(item.type);
        const note = String(item.note || item.remark || item.description || "").trim() || defaultDimensionNote(label, type);
        if (label) out.push({ type, label, note });
      }
    }
    return out.length ? out : cloneDefaultDimensions();
  }

  function defaultDimensionNote(label, type) {
    const normalizedLabel = normalizeText(label);
    const normalizedType = normalizeDimensionType(type);
    for (let i = 0; i < DEFAULT_DIMENSIONS.length; i += 1) {
      const item = DEFAULT_DIMENSIONS[i];
      if (normalizeDimensionType(item.type) === normalizedType && normalizeText(item.label) === normalizedLabel) {
        return item.note || "";
      }
    }
    return "";
  }

  function normalizeDimensionType(type) {
    const raw = String(type || "").trim().toLowerCase();
    if (raw === "open" || raw === "开放") return "open";
    return "yesno";
  }

  function saveSettings() {
    GM_setValue(SETTINGS_KEY, JSON.stringify(state.settings));
  }

  function loadJson(key, fallback) {
    try {
      const raw = GM_getValue(key, "");
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function saveJson(key, value) {
    GM_setValue(key, JSON.stringify(value));
  }

  function injectStyles() {
    if (document.querySelector("#sjtu-course-plus-style")) return;
    const style = document.createElement("style");
    style.id = "sjtu-course-plus-style";
    style.textContent = `
      .jcp-toolbar {
        margin: 8px 0;
        padding: 8px 10px;
        border: 1px solid #bce8f1;
        background: #f7fcff;
        color: #333;
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        font-size: 12px;
      }
      .jcp-toolbar button, .jcp-panel button, .jcp-summary-btn {
        border: 1px solid #adadad;
        background: #fff;
        color: #333;
        border-radius: 3px;
        padding: 3px 7px;
        line-height: 1.35;
        font-size: 12px;
        cursor: pointer;
      }
      .jcp-toolbar button.jcp-primary, .jcp-panel button.jcp-primary, .jcp-summary-btn.jcp-primary {
        border-color: #2e6da4;
        background: #337ab7;
        color: #fff;
      }
      .jcp-community-link {
        display: inline-block;
        margin-left: 6px;
        border: 1px solid #adadad;
        background: #fff;
        color: #337ab7;
        border-radius: 3px;
        padding: 3px 7px;
        line-height: 1.35;
        font-size: 12px;
        text-decoration: none;
        vertical-align: middle;
      }
      .jcp-community-link:hover {
        color: #23527c;
        text-decoration: none;
      }
      .jcp-community-link::after {
        content: "↗";
        display: inline-block;
        margin-left: 4px;
        font-size: 11px;
        transform: translateY(-1px);
      }
      .jcp-toolbar button:disabled, .jcp-summary-btn:disabled {
        cursor: default;
        opacity: 0.65;
      }
      .jcp-preset-quick {
        display: inline-flex;
        align-items: center;
        margin-left: -1px;
        vertical-align: middle;
      }
      .jcp-preset-quick-select {
        width: auto;
        min-width: 112px;
        max-width: 210px;
        height: 24px;
        box-sizing: border-box;
        border: 1px solid #ccc;
        border-radius: 0;
        background: #fff;
        color: #333;
        padding: 2px 24px 2px 8px;
        font-size: 12px;
        line-height: 18px;
        cursor: pointer;
      }
      .jcp-preset-quick-select:focus {
        position: relative;
        z-index: 2;
        border-color: #720808;
        outline: 0;
        box-shadow: none;
      }
      .jcp-preset-quick-select:disabled { cursor: default; background: #f5f5f5; color: #999; }
      .jcp-badge {
        display: inline-block;
        margin-left: 6px;
        padding: 2px 5px;
        border-radius: 3px;
        border: 1px solid #ccd6dd;
        background: #f6f8fa;
        color: #333;
        font-size: 12px;
        font-style: normal;
        vertical-align: middle;
        white-space: normal;
      }
      .jcp-rating { border-color: #bce8f1; background: #eef9ff; color: #245269; }
      .jcp-summary { border-color: #d6e9c6; background: #f6fff0; color: #2b542c; }
      .jcp-warning { border-color: #faebcc; background: #fff8e5; color: #8a6d3b; }
      .jcp-conflict-tag { border-color: #ebccd1; background: #fff0f0; color: #a94442; }
      .jcp-ok-tag { border-color: #d6e9c6; background: #f6fff0; color: #2b542c; }
      .jcp-selected-tag { border-color: #bce8f1; background: #eef9ff; color: #245269; }
      .jcp-conflict-details {
        position: relative;
        overflow: visible;
        font-family: inherit;
        line-height: 1.4;
        cursor: pointer;
      }
      .jcp-conflict-details::after {
        content: "›";
        display: inline-block;
        margin-left: 4px;
        font-size: 13px;
        transform: rotate(90deg);
      }
      .jcp-conflict-popover {
        display: none;
        position: absolute;
        z-index: 1060;
        top: calc(100% + 6px);
        right: 0;
        width: max-content;
        min-width: 220px;
        max-width: min(360px, 80vw);
        padding: 9px 11px;
        border: 1px solid #e3b9b9;
        border-radius: 4px;
        background: #fff;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.16);
        color: #555;
        font-size: 12px;
        font-weight: normal;
        line-height: 1.5;
        text-align: left;
        white-space: normal;
      }
      .jcp-conflict-details:hover .jcp-conflict-popover,
      .jcp-conflict-details:focus .jcp-conflict-popover,
      .jcp-conflict-details.jcp-popover-open .jcp-conflict-popover { display: block; }
      .jcp-conflict-popover-layer { position: relative; z-index: 30; }
      .jcp-conflict-popover-layer .panel-body.table-responsive { overflow: visible; }
      .jcp-conflict-details.jcp-popover-up .jcp-conflict-popover { top: auto; bottom: calc(100% + 6px); }
      .jcp-conflict-popover strong { display: block; margin-bottom: 4px; color: #a94442; }
      .jcp-conflict-popover ul { margin: 0; padding-left: 18px; }
      .jcp-conflict-popover li + li { margin-top: 4px; }
      .jcp-title-rating {
        margin-left: 8px;
        margin-right: 8px;
        color: #31708f;
        font-size: 12px;
        font-weight: normal;
        white-space: nowrap;
        cursor: help;
        text-decoration: underline;
        text-underline-offset: 2px;
      }
      .jcp-course-conflict > .panel-heading { background: #fff4f4 !important; }
      tr.jcp-row-conflict { background: #fff4f4 !important; }
      tr.jcp-row-selected { background: #eef9ff !important; }
      .jcp-hidden-conflict { display: none !important; }
      .panel-heading.kc_head {
        position: relative;
        padding-right: 360px;
        min-height: 42px;
        box-sizing: border-box;
      }
      .panel-heading.kc_head .panel-title {
        min-height: 28px;
      }
      .jcp-info { margin-left: 4px; }
      .jcp-heading-right {
        position: absolute;
        top: 7px;
        right: 10px;
        display: flex;
        align-items: center;
        gap: 6px;
        width: 340px;
        flex-wrap: wrap;
        justify-content: flex-end;
        z-index: 2;
        pointer-events: none;
      }
      .jcp-heading-right .jcp-badge,
      .jcp-heading-right .jcp-community-link,
      .jcp-heading-right .jcp-summary-btn {
        margin-left: 0;
        pointer-events: auto;
      }
      .jcp-heading-summary-line,
      .jcp-row-summary-card {
        clear: both;
        width: 100%;
        margin-top: 8px;
        padding: 10px 12px;
        box-sizing: border-box;
        border: 1px solid #d8e7d3;
        border-left: 4px solid #5cb85c;
        border-radius: 5px;
        background: #fbfef9;
        color: #334533;
        font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif;
        font-size: 13px;
        font-weight: 400;
        line-height: 1.65;
        text-align: left;
      }
      .jcp-summary-card * { box-sizing: border-box; }
      .jcp-summary-card-head {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
        color: #356635;
      }
      .jcp-summary-card-head strong { font-size: 13px; }
      .jcp-summary-context { color: #71806d; font-weight: 400; }
      .jcp-summary-state {
        display: flex;
        align-items: center;
        gap: 7px;
        min-height: 28px;
        color: #677565;
      }
      .jcp-summary-state.jcp-summary-error { color: #a94442; }
      .jcp-summary-loading-dots {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        min-width: 27px;
      }
      .jcp-summary-loading-dots span {
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: #69a968;
        animation: jcp-pulse 1.1s ease-in-out infinite;
      }
      .jcp-summary-loading-dots span:nth-child(2) { animation-delay: 0.14s; }
      .jcp-summary-loading-dots span:nth-child(3) { animation-delay: 0.28s; }
      @keyframes jcp-pulse { 0%, 60%, 100% { opacity: 0.28; } 30% { opacity: 1; } }
      .jcp-summary-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 10px;
      }
      .jcp-summary-item {
        display: block;
        min-width: 0;
        min-height: 60px;
        padding: 10px 11px;
        border: 1px solid #deecd9;
        border-radius: 5px;
        background: #f1f8ef;
      }
      .jcp-summary-item-label {
        display: block;
        color: #687864;
        font-size: 12px;
        line-height: 1.4;
      }
      .jcp-summary-item-value {
        display: block;
        min-width: 0;
        margin-top: 4px;
        color: #274d27;
        font-size: 13px;
        font-weight: 500;
        line-height: 1.65;
        overflow-wrap: anywhere;
      }
      .jcp-summary-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        margin-top: 8px;
      }
      .jcp-summary-meta .jcp-badge { margin: 0; background: #fff; }
      .jcp-row-summary-wrap {
        display: grid;
        grid-template-columns: repeat(2, 78px);
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
        margin-top: 4px;
      }
      .jcp-action-cell { min-width: 176px; }
      .jcp-row-summary-wrap .jcp-community-link,
      .jcp-row-summary-wrap .jcp-summary-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 78px;
        min-height: 28px;
        margin: 0;
        padding: 4px 7px;
        white-space: nowrap;
      }
      tr.jcp-row-summary-detail > td {
        padding: 0 12px 12px !important;
        border-top: 0 !important;
        background: #f8fbfd;
      }
      .jcp-row-summary-card { margin-top: 0; }
      .jcp-panel-mask { position: fixed; inset: 0; background: rgba(0,0,0,0.2); z-index: 9998; }
      .jcp-panel {
        position: fixed;
        top: 70px;
        right: 28px;
        width: 440px;
        max-width: calc(100vw - 40px);
        z-index: 9999;
        background: #fff;
        border: 1px solid #ccc;
        box-shadow: 0 4px 20px rgba(0,0,0,0.18);
        padding: 14px;
        color: #333;
        font-size: 13px;
      }
      .jcp-panel h4 { margin: 0 0 10px; font-size: 16px; }
      .jcp-panel label { display: block; margin: 9px 0 4px; font-weight: 600; }
      .jcp-panel input[type="text"], .jcp-panel input[type="password"], .jcp-panel textarea {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid #ccc;
        border-radius: 3px;
        padding: 6px;
        font-size: 13px;
      }
      .jcp-panel textarea { min-height: 72px; resize: vertical; }
      .jcp-model-row {
        display: flex;
        gap: 6px;
        align-items: center;
      }
      .jcp-model-row select {
        flex: 1 1 auto;
        min-width: 0;
        box-sizing: border-box;
        border: 1px solid #ccc;
        border-radius: 3px;
        padding: 5px;
        font-size: 13px;
      }
      .jcp-model-row button {
        flex: 0 0 auto;
      }
      .jcp-dim-table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 4px;
      }
      .jcp-dim-table th,
      .jcp-dim-table td {
        border: 1px solid #ddd;
        padding: 4px;
        vertical-align: middle;
      }
      .jcp-dim-table th {
        background: #f7f7f7;
        font-weight: 600;
        text-align: left;
      }
      .jcp-dim-table select,
      .jcp-dim-table input {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid #ccc;
        border-radius: 3px;
        padding: 4px;
        font-size: 12px;
      }
      .jcp-dim-table .jcp-dim-type-cell { width: 78px; }
      .jcp-dim-table .jcp-dim-action-cell { width: 52px; text-align: center; }
      .jcp-dim-tools { margin-top: 6px; }
      .jcp-panel .jcp-actions { margin-top: 12px; display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
      .jcp-muted { color: #777; }
      .jcp-toolbar {
        position: relative;
        border-color: #d9e4ec;
        border-left: 4px solid #337ab7;
        border-radius: 5px;
        background: linear-gradient(135deg, #fbfdff 0%, #f3f8fc 100%);
        box-shadow: 0 1px 3px rgba(34, 78, 112, 0.08);
        padding: 9px 12px;
      }
      .jcp-toolbar-brand { display: inline-flex; align-items: center; gap: 7px; color: #245269; }
      .jcp-toolbar-mark {
        display: inline-flex;
        width: 20px;
        height: 20px;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        background: #337ab7;
        color: #fff;
        font-size: 11px;
      }
      .jcp-toolbar-spacer { flex: 1 1 auto; }
      .jcp-toolbar-toggle { margin: 0; font-weight: 400; display: inline-flex; align-items: center; gap: 4px; }
      .jcp-status { color: #6a7c89; }
      .jcp-notice {
        position: fixed;
        right: 24px;
        bottom: 24px;
        z-index: 10001;
        max-width: min(420px, calc(100vw - 48px));
        padding: 10px 13px;
        border: 1px solid #bce8f1;
        border-radius: 5px;
        background: #f2fbff;
        color: #245269;
        box-shadow: 0 5px 18px rgba(0,0,0,0.16);
        font-size: 13px;
      }
      .jcp-notice-error { border-color: #ebccd1; background: #fff7f7; color: #a94442; }
      .jcp-panel-mask { background: rgba(23, 38, 50, 0.26); backdrop-filter: blur(1px); }
      .jcp-panel {
        top: 5vh;
        right: max(24px, calc((100vw - 1040px) / 2));
        width: min(760px, calc(100vw - 48px));
        max-height: 90vh;
        overflow: auto;
        border: 0;
        border-radius: 8px;
        box-shadow: 0 12px 38px rgba(18, 48, 68, 0.25);
        padding: 0;
      }
      .jcp-panel-header {
        position: sticky;
        top: 0;
        z-index: 2;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 13px 16px;
        border-bottom: 1px solid #dbe5ec;
        background: #f7fbfe;
      }
      .jcp-panel-header h4 { margin: 0; color: #245269; }
      .jcp-panel-body { padding: 4px 16px 16px; }
      .jcp-section { margin-top: 14px; padding-top: 2px; }
      .jcp-section-title { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
      .jcp-section-title h5 { margin: 0; font-size: 14px; color: #333; }
      .jcp-provider-list { display: grid; gap: 9px; margin-top: 8px; }
      .jcp-provider-card {
        border: 1px solid #d8e1e8;
        border-radius: 6px;
        background: #fff;
        padding: 10px;
      }
      .jcp-provider-card.jcp-active-provider { border-color: #7eb7dc; box-shadow: 0 0 0 2px rgba(51,122,183,0.08); }
      .jcp-provider-head { display: flex; align-items: center; gap: 7px; margin-bottom: 7px; }
      .jcp-provider-head strong { flex: 1 1 auto; color: #245269; }
      .jcp-provider-tag { padding: 1px 5px; border-radius: 9px; background: #eef6fb; color: #31708f; font-size: 11px; }
      .jcp-provider-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px 10px; }
      .jcp-provider-grid label { margin: 0; font-size: 12px; font-weight: 500; color: #667782; }
      .jcp-provider-grid input { margin-top: 3px; }
      .jcp-provider-endpoint,
      .jcp-provider-model-field { min-width: 0; }
      .jcp-preset-panel { width: min(700px, calc(100vw - 48px)); }
      .jcp-preset-create {
        display: grid;
        grid-template-columns: minmax(180px, 1fr) auto;
        gap: 8px;
        align-items: end;
        margin-top: 9px;
      }
      .jcp-preset-create label { margin: 0; color: #667782; font-size: 12px; font-weight: 500; }
      .jcp-preset-create input { margin-top: 4px; }
      .jcp-preset-list,
      .jcp-recommendation-list { display: grid; gap: 8px; margin-top: 9px; }
      .jcp-preset-card,
      .jcp-recommendation-card {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 11px;
        border: 1px solid #d8e1e8;
        border-radius: 6px;
        background: #fff;
      }
      .jcp-recommendation-card { border-color: #cfe3cf; background: #fbfef9; }
      .jcp-preset-main { flex: 1 1 auto; min-width: 0; }
      .jcp-preset-main strong { display: block; color: #245269; font-size: 13px; }
      .jcp-recommendation-card .jcp-preset-main strong { color: #356635; }
      .jcp-preset-summary { margin-top: 4px; color: #71808a; font-size: 12px; line-height: 1.55; overflow-wrap: anywhere; }
      .jcp-preset-actions { display: flex; flex: 0 0 auto; gap: 6px; }
      .jcp-preset-empty {
        padding: 12px;
        border: 1px dashed #ccd7df;
        border-radius: 6px;
        color: #71808a;
        text-align: center;
        background: #fafcfd;
      }
      .jcp-credit-gap {
        display: inline-block;
        margin-left: 6px;
        padding: 1px 6px;
        border-radius: 9px;
        background: #fff0d5;
        color: #8a6d3b;
        font-size: 11px;
        font-weight: 400;
      }
      .jcp-recommendation-status { margin: 8px 0 0; }
      .jcp-panel-footer {
        position: sticky;
        bottom: 0;
        display: flex;
        justify-content: space-between;
        gap: 10px;
        padding: 11px 16px;
        border-top: 1px solid #dbe5ec;
        background: #fff;
      }
      .jcp-panel-footer .jcp-actions { margin: 0; }
      .jcp-icon-close { border: 0 !important; background: transparent !important; font-size: 18px !important; color: #71808a !important; }
      @media (max-width: 760px) {
        .jcp-toolbar-spacer { display: none; }
        .panel-heading.kc_head { padding-right: 12px; }
        .jcp-heading-right { position: static; width: auto; justify-content: flex-start; margin-top: 6px; }
        .jcp-provider-grid { grid-template-columns: 1fr; }
        .jcp-preset-create { grid-template-columns: 1fr; }
        .jcp-preset-card, .jcp-recommendation-card { align-items: flex-start; flex-direction: column; }
        .jcp-preset-actions { width: 100%; }
        .jcp-summary-grid { grid-template-columns: 1fr; }
      }
    `;
    document.documentElement.appendChild(style);
  }

  function ensureToolbar() {
    if (document.querySelector(".jcp-toolbar")) {
      ensurePresetQuickSelect();
      return;
    }
    const toolbar = document.createElement("div");
    toolbar.className = "jcp-toolbar";
    toolbar.innerHTML = `
      <strong class="jcp-toolbar-brand"><span class="jcp-toolbar-mark">+</span>交大选课助手+</strong>
      <span class="jcp-muted jcp-status">准备扫描课程</span>
      <span class="jcp-toolbar-spacer"></span>
      <label class="jcp-toolbar-toggle">
        <input type="checkbox" class="jcp-hide-toggle">
        隐藏冲突
      </label>
      <button type="button" class="jcp-presets">筛选条件</button>
      <button type="button" class="jcp-primary jcp-rescan">重新扫描</button>
      <button type="button" class="jcp-settings">设置</button>
    `;
    const target = document.querySelector("#searchBox") || document.querySelector("#contentBox") || document.querySelector(".tjxk_list") || document.body;
    if (target === document.body) {
      document.body.insertAdjacentElement("afterbegin", toolbar);
    } else {
      target.insertAdjacentElement(target.id === "contentBox" || target.classList.contains("tjxk_list") ? "beforebegin" : "afterend", toolbar);
    }
    toolbar.querySelector(".jcp-hide-toggle").checked = state.settings.hideConflicts;
    toolbar.querySelector(".jcp-hide-toggle").addEventListener("change", (event) => {
      state.settings.hideConflicts = event.target.checked;
      saveSettings();
      scheduleScan();
    });
    toolbar.querySelector(".jcp-presets").addEventListener("click", openPresetPanel);
    toolbar.querySelector(".jcp-rescan").addEventListener("click", () => scanNow());
    toolbar.querySelector(".jcp-settings").addEventListener("click", openSettingsPanel);
    ensurePresetQuickSelect();
  }

  function ensurePresetQuickSelect() {
    const searchBox = document.querySelector("#searchBox");
    const query = searchBox ? searchBox.querySelector("button[name='query']") : null;
    if (!query || !query.parentElement) return;
    let select = searchBox.querySelector(".jcp-preset-quick-select");
    if (!select) {
      const wrapper = document.createElement("span");
      wrapper.className = "jcp-preset-quick";
      select = document.createElement("select");
      select.className = "jcp-preset-quick-select";
      select.setAttribute("aria-label", "筛选条件");
      select.title = "选择后立即应用并查询";
      wrapper.appendChild(select);
      query.insertAdjacentElement("afterend", wrapper);
      select.addEventListener("change", async () => {
        const preset = presetById(select.value);
        if (!preset) return;
        select.disabled = true;
        await applyPreset(preset);
        syncPresetQuickSelect();
      });
    }
    const wrapper = select.closest(".jcp-preset-quick");
    if (wrapper && query.nextElementSibling !== wrapper) query.insertAdjacentElement("afterend", wrapper);
    syncPresetQuickSelectMetrics(select, query);
    observePresetQuickSelectMetrics(wrapper, select, query);
    ensureResetAutoQuery(searchBox);
    syncPresetQuickSelect();
  }

  function syncPresetQuickSelectMetrics(select, query) {
    if (!select || !query) return;
    const height = query.offsetHeight;
    const style = window.getComputedStyle(query);
    if (height > 0) select.style.height = `${height}px`;
    select.style.fontSize = style.fontSize;
    select.style.lineHeight = style.lineHeight;
    select.style.paddingTop = style.paddingTop;
    select.style.paddingBottom = style.paddingBottom;
  }

  function observePresetQuickSelectMetrics(wrapper, select, query) {
    if (!wrapper || wrapper._jcpMetricSync) return;
    const sync = () => syncPresetQuickSelectMetrics(select, query);
    wrapper._jcpMetricSync = sync;
    window.addEventListener("resize", sync, { passive: true });
    if (typeof ResizeObserver === "function") {
      wrapper._jcpResizeObserver = new ResizeObserver(sync);
      wrapper._jcpResizeObserver.observe(query);
    }
  }

  function ensureResetAutoQuery(searchBox) {
    const reset = searchBox ? searchBox.querySelector("button[name='reset']") : null;
    if (!reset || reset.dataset.jcpAutoQueryBound === "1") return;
    reset.dataset.jcpAutoQueryBound = "1";
    reset.addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      window.setTimeout(async () => {
        await waitForCondition(() => {
          const selected = searchBox.querySelector(".selecteds .selected[index]");
          const input = searchBox.querySelector("input[name='searchInput']");
          return !selected && (!input || !input.value);
        }, 1500);
        const query = searchBox.querySelector("button[name='query']");
        if (query && !query.disabled) clickElement(query);
      }, 0);
    });
  }

  function syncPresetQuickSelect() {
    const select = document.querySelector("#searchBox .jcp-preset-quick-select");
    if (!select) return;
    const presets = state.settings.presets || [];
    select.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = presets.length ? "筛选条件" : "暂无筛选条件";
    select.appendChild(placeholder);
    for (let i = 0; i < presets.length; i += 1) {
      const option = document.createElement("option");
      option.value = presets[i].id;
      option.textContent = presets[i].label;
      option.title = presetSummaryText(presets[i]);
      select.appendChild(option);
    }
    select.value = "";
    select.disabled = !presets.length;
  }

  function syncSjtuExpandToggle(toggle, expanded) {
    if (!toggle || !toggle.classList) return;
    toggle.classList.toggle("close1", expanded);
    toggle.classList.toggle("expand1", !expanded);
    toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  }

  function preserveOtherExpandedCourses(event) {
    if (!event || !event.target || !event.target.closest) return;
    const heading = event.target.closest(".panel-heading.kc_head");
    if (!heading || !heading.closest(".panel.panel-info")) return;
    const clickedPanel = heading.closest(".panel.panel-info");
    const panels = document.querySelectorAll(".panel.panel-info");
    const expanded = [];
    for (let i = 0; i < panels.length; i += 1) {
      if (panels[i] === clickedPanel) continue;
      const body = panels[i].querySelector(".panel-body.table-responsive, .panel-body");
      if (body && !isElementHidden(body)) expanded.push({ body, toggle: panels[i].querySelector(".expand_close") });
    }
    if (!expanded.length) return;
    window.setTimeout(() => {
      for (let i = 0; i < expanded.length; i += 1) {
        expanded[i].body.style.display = "block";
        syncSjtuExpandToggle(expanded[i].toggle, true);
      }
    }, 0);
  }

  function openPresetPanel() {
    closeSettingsPanel();
    const mask = document.createElement("div");
    mask.className = "jcp-panel-mask";
    const panel = document.createElement("div");
    panel.className = "jcp-panel jcp-preset-panel";
    const snapshot = captureCurrentPreset("");
    panel.innerHTML = `
      <div class="jcp-panel-header">
        <h4>交大选课助手+ 筛选条件</h4>
        <button type="button" class="jcp-icon-close jcp-preset-close" title="关闭" aria-label="关闭">×</button>
      </div>
      <div class="jcp-panel-body">
        <section class="jcp-section">
          <div class="jcp-section-title"><h5>保存当前筛选</h5></div>
          <p class="jcp-muted">保存当前课程类型、关键字和高级条件，以后一键恢复并查询。</p>
          <div class="jcp-preset-create">
            <label>条件名称<input type="text" class="jcp-preset-name" maxlength="40" value="${escapeAttr(defaultPresetLabel(snapshot))}" placeholder="例如：闵行自然科学有余量"></label>
            <button type="button" class="jcp-primary jcp-save-preset">保存当前筛选</button>
          </div>
        </section>
        <section class="jcp-section">
          <div class="jcp-section-title"><h5>我的条件</h5></div>
          <div class="jcp-preset-list"></div>
        </section>
        <section class="jcp-section">
          <div class="jcp-section-title">
            <h5>通识学分建议</h5>
            <button type="button" class="jcp-refresh-recommendations">重新检查</button>
          </div>
          <p class="jcp-muted">同源读取“学生修业情况查询”，仅在内存中比较通识类别的要求与已获学分，不保存学号、成绩或课程记录。</p>
          <p class="jcp-muted jcp-recommendation-status">正在检查修业要求…</p>
          <div class="jcp-recommendation-list"></div>
        </section>
      </div>
      <div class="jcp-panel-footer">
        <span class="jcp-muted">条件仅保存在用户脚本本地存储中</span>
        <div class="jcp-actions"><button type="button" class="jcp-preset-close">关闭</button></div>
      </div>`;
    document.body.appendChild(mask);
    document.body.appendChild(panel);
    mask.addEventListener("click", closeSettingsPanel);
    const closeButtons = panel.querySelectorAll(".jcp-preset-close");
    for (let i = 0; i < closeButtons.length; i += 1) closeButtons[i].addEventListener("click", closeSettingsPanel);
    panel.querySelector(".jcp-save-preset").addEventListener("click", () => saveCurrentPreset(panel));
    panel.querySelector(".jcp-refresh-recommendations").addEventListener("click", () => loadGeneralEducationRecommendations(panel));
    panel.addEventListener("click", (event) => handlePresetPanelClick(event, panel));
    renderPresetList(panel);
    loadGeneralEducationRecommendations(panel);
  }

  function handlePresetPanelClick(event, panel) {
    const target = event.target;
    if (!target || !target.classList) return;
    if (target.classList.contains("jcp-apply-preset")) {
      const preset = presetById(target.dataset.presetId);
      if (!preset) return;
      target.disabled = true;
      applyPreset(preset).finally(() => {
        target.disabled = false;
      });
    } else if (target.classList.contains("jcp-delete-preset")) {
      deletePreset(target.dataset.presetId);
      renderPresetList(panel);
    } else if (target.classList.contains("jcp-create-recommendation")) {
      const index = Number(target.dataset.recommendationIndex);
      const recommendation = panel._jcpRecommendations && panel._jcpRecommendations[index];
      if (!recommendation) return;
      if (hasEquivalentPreset(recommendation)) {
        target.disabled = true;
        target.textContent = "已创建";
        return;
      }
      state.settings.presets.push(recommendation);
      saveSettings();
      syncPresetQuickSelect();
      target.disabled = true;
      target.textContent = "已创建";
      renderPresetList(panel);
      showNotice(`已创建筛选条件“${recommendation.label}”`);
    }
  }

  function captureCurrentPreset(label) {
    const activeTab = currentCourseTypeTab();
    const filters = [];
    const selected = document.querySelectorAll("#searchBox .selecteds .selected[index]");
    for (let i = 0; i < selected.length; i += 1) {
      const index = selected[i].getAttribute("index") || "";
      const source = findFilterSource(index, "");
      const descriptor = source ? filterDescriptorFromNode(source) : selectedFilterDescriptor(selected[i]);
      if (descriptor) filters.push(descriptor);
    }
    const inputs = [];
    const inputNodes = document.querySelectorAll("#searchBox .items[name] input.fixed");
    for (let i = 0; i < inputNodes.length; i += 1) {
      const value = normalizeText(inputNodes[i].value);
      const items = inputNodes[i].closest(".items[name]");
      if (value && items) inputs.push({ group: items.getAttribute("name") || "", value });
    }
    const search = document.querySelector("#searchBox input[name='searchInput']");
    return {
      id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      label: normalizeText(label).slice(0, 40),
      tabCode: activeTab ? courseTypeCode(activeTab) : "",
      tabLabel: activeTab ? normalizeText(activeTab.textContent) : "",
      search: search ? normalizeText(search.value).slice(0, 120) : "",
      filters,
      inputs,
    };
  }

  function currentCourseTypeTab() {
    const tabs = document.querySelectorAll("[id^='tab_kklx_']");
    for (let i = 0; i < tabs.length; i += 1) {
      if ((tabs[i].parentElement && tabs[i].parentElement.classList.contains("active")) || tabs[i].classList.contains("active") || tabs[i].getAttribute("aria-selected") === "true") {
        return tabs[i];
      }
    }
    return null;
  }

  function courseTypeCode(tab) {
    const match = String(tab && tab.id || "").match(/^tab_kklx_([^_]+)/);
    return match ? match[1] : "";
  }

  function defaultPresetLabel(preset) {
    const parts = [];
    if (preset.tabLabel) parts.push(preset.tabLabel.replace(/课程$/, ""));
    for (let i = 0; i < preset.filters.length && parts.length < 4; i += 1) {
      const label = preset.filters[i].label;
      parts.push(label.indexOf(":") >= 0 ? label.slice(label.indexOf(":") + 1) : label);
    }
    if (preset.search) parts.push(preset.search);
    return parts.length ? parts.join(" · ") : "我的筛选条件";
  }

  function selectedFilterDescriptor(node) {
    const index = node && node.getAttribute ? node.getAttribute("index") || "" : "";
    const link = node && node.querySelector ? node.querySelector("a") : null;
    const label = normalizeText(link ? link.textContent : node ? node.textContent : "");
    const separator = index.lastIndexOf("_");
    const group = separator > 0 ? index.slice(0, separator) : index;
    return index && group ? { index, group, value: separator > 0 ? index.slice(separator + 1) : "", label } : null;
  }

  function filterDescriptorFromNode(node) {
    if (!node || !node.getAttribute) return null;
    const items = node.closest(".items[name]");
    const group = items ? items.getAttribute("name") || "" : "";
    const index = node.getAttribute("index") || "";
    const link = node.querySelector("a");
    if (!group || !index || !link) return null;
    const row = node.closest(".condition-row");
    const titleNode = row ? row.querySelector(".title") : null;
    const title = normalizeText(titleNode ? titleNode.textContent : "").replace(/[：:]$/, "");
    const text = normalizeText(link.textContent);
    const key = link.getAttribute("key") || (index.indexOf(`${group}_`) === 0 ? index.slice(group.length + 1) : "");
    return { index, group, value: key, label: title ? `${title}:${text}` : text };
  }

  function findFilterSource(index, group) {
    const nodes = document.querySelectorAll("#searchBox [index]");
    for (let i = 0; i < nodes.length; i += 1) {
      if (nodes[i].getAttribute("index") !== index) continue;
      const items = nodes[i].closest(".items[name]");
      if (!items) continue;
      if (!group || items.getAttribute("name") === group) return nodes[i];
    }
    return null;
  }

  function saveCurrentPreset(panel) {
    const nameInput = panel.querySelector(".jcp-preset-name");
    const preset = captureCurrentPreset(nameInput ? nameInput.value : "");
    if (!preset.label) {
      showNotice("请先填写筛选条件名称", "error");
      if (nameInput) nameInput.focus();
      return;
    }
    state.settings.presets.push(preset);
    saveSettings();
    syncPresetQuickSelect();
    renderPresetList(panel);
    showNotice(`已保存筛选条件“${preset.label}”`);
  }

  function presetById(id) {
    const presets = state.settings.presets || [];
    for (let i = 0; i < presets.length; i += 1) {
      if (presets[i].id === id) return presets[i];
    }
    return null;
  }

  function deletePreset(id) {
    const presets = state.settings.presets || [];
    const next = [];
    for (let i = 0; i < presets.length; i += 1) {
      if (presets[i].id !== id) next.push(presets[i]);
    }
    state.settings.presets = next;
    saveSettings();
    syncPresetQuickSelect();
  }

  function renderPresetList(panel) {
    const list = panel.querySelector(".jcp-preset-list");
    if (!list) return;
    const presets = state.settings.presets || [];
    if (!presets.length) {
      list.innerHTML = '<div class="jcp-preset-empty">还没有保存的筛选条件</div>';
      return;
    }
    const html = [];
    for (let i = 0; i < presets.length; i += 1) {
      html.push(`
        <div class="jcp-preset-card">
          <div class="jcp-preset-main">
            <strong>${escapeHtml(presets[i].label)}</strong>
            <div class="jcp-preset-summary">${escapeHtml(presetSummaryText(presets[i]))}</div>
          </div>
          <div class="jcp-preset-actions">
            <button type="button" class="jcp-primary jcp-apply-preset" data-preset-id="${escapeAttr(presets[i].id)}">应用</button>
            <button type="button" class="jcp-delete-preset" data-preset-id="${escapeAttr(presets[i].id)}">删除</button>
          </div>
        </div>`);
    }
    list.innerHTML = html.join("");
  }

  function presetSummaryText(preset) {
    const parts = [];
    if (preset.tabLabel) parts.push(`类型:${preset.tabLabel}`);
    for (let i = 0; i < preset.filters.length; i += 1) parts.push(preset.filters[i].label);
    for (let i = 0; i < preset.inputs.length; i += 1) parts.push(`${preset.inputs[i].group}:${preset.inputs[i].value}`);
    if (preset.search) parts.push(`关键字:${preset.search}`);
    return parts.join(" · ") || "无额外条件";
  }

  function presetFingerprint(preset) {
    const parts = [preset.tabCode || "", preset.tabLabel || "", preset.search || ""];
    const filters = preset.filters || [];
    for (let i = 0; i < filters.length; i += 1) parts.push(`${filters[i].group}:${filters[i].index}:${filters[i].value}`);
    const inputs = preset.inputs || [];
    for (let i = 0; i < inputs.length; i += 1) parts.push(`${inputs[i].group}:${inputs[i].value}`);
    return parts.join("|");
  }

  function hasEquivalentPreset(candidate) {
    const fingerprint = presetFingerprint(candidate);
    const presets = state.settings.presets || [];
    for (let i = 0; i < presets.length; i += 1) {
      if (presetFingerprint(presets[i]) === fingerprint) return true;
    }
    return false;
  }

  async function applyPreset(preset) {
    try {
      const tab = findCourseTypeTab(preset);
      if (preset.tabLabel && !tab) throw new Error(`找不到课程类型“${preset.tabLabel}”`);
      const activeTab = currentCourseTypeTab();
      if (tab && tab !== activeTab) {
        clickElement(tab);
        await waitForCondition(() => currentCourseTypeTab() && normalizeText(currentCourseTypeTab().textContent) === preset.tabLabel, 5000);
      }
      const reset = document.querySelector("#searchBox button[name='reset']");
      if (reset) {
        clickElement(reset);
        await waitForCondition(() => !document.querySelector("#searchBox .selecteds .selected[index]"), 2500);
      }
      let missing = 0;
      for (let i = 0; i < preset.filters.length; i += 1) {
        const source = findFilterSource(preset.filters[i].index, preset.filters[i].group);
        const link = source ? source.querySelector("a") : null;
        if (link) clickElement(link);
        else missing += 1;
      }
      for (let i = 0; i < preset.inputs.length; i += 1) {
        const items = findFilterItems(preset.inputs[i].group);
        const input = items ? items.querySelector("input.fixed") : null;
        const sure = items ? items.querySelector("button.sure") : null;
        if (input) {
          input.value = preset.inputs[i].value;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          if (sure) clickElement(sure);
        } else {
          missing += 1;
        }
      }
      const search = document.querySelector("#searchBox input[name='searchInput']");
      if (search) {
        search.value = preset.search || "";
        search.dispatchEvent(new Event("input", { bubbles: true }));
        search.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const query = document.querySelector("#searchBox button[name='query']");
      if (!query) throw new Error("未找到选课页面查询按钮");
      clickElement(query);
      closeSettingsPanel();
      showNotice(missing ? `已应用“${preset.label}”，${missing} 个已失效条件被跳过` : `已应用筛选条件“${preset.label}”`, missing ? "error" : "");
    } catch (error) {
      reportError("应用筛选条件失败", error);
    }
  }

  function findCourseTypeTab(preset) {
    const tabs = document.querySelectorAll("[id^='tab_kklx_']");
    let codeFallback = null;
    for (let i = 0; i < tabs.length; i += 1) {
      const label = normalizeText(tabs[i].textContent);
      const code = courseTypeCode(tabs[i]);
      if (preset.tabLabel && label === preset.tabLabel) return tabs[i];
      if (!codeFallback && preset.tabCode && code === preset.tabCode) codeFallback = tabs[i];
    }
    return codeFallback;
  }

  function findFilterItems(group) {
    const items = document.querySelectorAll("#searchBox .items[name]");
    for (let i = 0; i < items.length; i += 1) {
      if (items[i].getAttribute("name") === group) return items[i];
    }
    return null;
  }

  function waitForCondition(predicate, timeoutMs) {
    const started = Date.now();
    return new Promise((resolve) => {
      const check = () => {
        let matched = false;
        try {
          matched = Boolean(predicate());
        } catch (_) {
          matched = false;
        }
        if (matched || Date.now() - started >= timeoutMs) {
          resolve(matched);
        } else {
          window.setTimeout(check, 80);
        }
      };
      check();
    });
  }

  async function loadGeneralEducationRecommendations(panel) {
    const status = panel.querySelector(".jcp-recommendation-status");
    const list = panel.querySelector(".jcp-recommendation-list");
    if (!status || !list) return;
    status.textContent = "正在检查修业要求…";
    list.innerHTML = "";
    const refresh = panel.querySelector(".jcp-refresh-recommendations");
    if (refresh) refresh.disabled = true;
    try {
      const gaps = await fetchGeneralEducationGaps();
      const recommendations = [];
      for (let i = 0; i < gaps.length; i += 1) {
        const recommendation = buildGeneralEducationRecommendation(gaps[i], i);
        if (recommendation) recommendations.push(recommendation);
      }
      panel._jcpRecommendations = recommendations;
      if (!gaps.length) {
        status.textContent = "通识核心类别的最低学分要求均已满足。";
        list.innerHTML = '<div class="jcp-preset-empty">暂无需要补足的通识类别</div>';
      } else if (!recommendations.length) {
        status.textContent = "检测到未满足类别，但当前选课页没有对应筛选项。";
      } else {
        status.textContent = `检测到 ${recommendations.length} 个未满足的通识类别，可创建对应筛选条件。`;
        list.innerHTML = recommendationCardsHtml(recommendations);
      }
    } catch (error) {
      panel._jcpRecommendations = [];
      status.textContent = `暂时无法读取修业要求：${friendlyErrorText(error)}`;
      list.innerHTML = '<div class="jcp-preset-empty">你仍可保存和使用手动筛选条件</div>';
      console.warn("[交大选课助手+] 修业要求读取失败", error);
    } finally {
      if (refresh) refresh.disabled = false;
    }
  }

  async function fetchGeneralEducationGaps() {
    const pageResponse = await fetch(ACADEMIC_PROGRESS_PAGE, { credentials: "same-origin" });
    if (!pageResponse.ok) throw new Error(`修业情况页面请求失败 ${pageResponse.status}`);
    const pageText = await pageResponse.text();
    const page = new DOMParser().parseFromString(pageText, "text/html");
    const studentIdNode = page.querySelector("#xh_id");
    const studentId = studentIdNode ? String(studentIdNode.value || "").trim() : "";
    if (!studentId) throw new Error("未获取到当前学生的修业查询上下文");
    const queryBody = new URLSearchParams();
    queryBody.set("queryModel.currentPage", "1");
    queryBody.set("queryModel.showCount", "-1");
    queryBody.set("queryModel.sortName", " ");
    queryBody.set("queryModel.sortOrder", "asc");
    const response = await fetch(`${ACADEMIC_PROGRESS_API}${encodeURIComponent(studentId)}`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: queryBody.toString(),
    });
    if (!response.ok) throw new Error(`修业要求请求失败 ${response.status}`);
    const data = await response.json();
    const rows = Array.isArray(data)
      ? data
      : Array.isArray(data.items)
        ? data.items
        : Array.isArray(data.rows)
          ? data.rows
          : [];
    const gaps = [];
    let activeSection = "";
    let recognizedCategories = 0;
    for (let i = 0; i < rows.length; i += 1) {
      const section = stripHtmlText(rows[i].level3 || "").replace(/\([^)]*\)\s*$/, "");
      if (section) activeSection = section;
      if (activeSection !== GENERAL_EDUCATION_SECTION) continue;
      const category = stripHtmlText(rows[i].level4 || "").replace(/\([^)]*\)\s*$/, "");
      if (!category) continue;
      recognizedCategories += 1;
      const required = Number(rows[i].yqzdxf || 0);
      const earned = Number(rows[i].hdxf || 0);
      const exempt = Number(rows[i].hmxf || 0);
      if (!Number.isFinite(required) || required <= earned + exempt) continue;
      gaps.push({ category, required, earned, exempt, missing: Math.max(0, required - earned - exempt) });
    }
    if (!recognizedCategories) throw new Error("未识别到通识核心类别数据");
    return gaps;
  }

  function stripHtmlText(value) {
    const container = document.createElement("div");
    container.innerHTML = String(value || "");
    return normalizeText(container.textContent || "");
  }

  function buildGeneralEducationRecommendation(gap, index) {
    const filters = [];
    const campus = defaultCampusFilter();
    if (campus) filters.push(campus);
    const nature = findFilterDescriptors("kcxzdm_list", (text) => text === "通识核心课程");
    if (nature.length) filters.push(nature[0]);
    let categories = findFilterDescriptors("kcgs_list", (text) => text === gap.category);
    if (!categories.length && gap.category === "艺术修养") {
      categories = findFilterDescriptors("kcgs_list", (text) => text.indexOf("/艺术修养") >= 0);
    }
    if (!categories.length && gap.category === "自然科学") {
      categories = findFilterDescriptors("kcgs_list", (text) => text.indexOf("/自然科学") >= 0);
    }
    if (!categories.length) return null;
    for (let i = 0; i < categories.length; i += 1) filters.push(categories[i]);
    const balance = findFilterDescriptors("yl_list", (text) => text === "有");
    if (balance.length) filters.push(balance[0]);
    const campusName = campus && campus.label.indexOf(":") >= 0 ? campus.label.slice(campus.label.indexOf(":") + 1) : "";
    return {
      id: `recommended-${Date.now()}-${index}`,
      label: compactValues([campusName, "通识", gap.category, "有余量"]).join(" · "),
      tabCode: "10",
      tabLabel: "通识课",
      search: "",
      filters,
      inputs: [],
      gap,
    };
  }

  function defaultCampusFilter() {
    const campusNode = document.querySelector("#xqh_id");
    const campusCode = campusNode ? String(campusNode.value || "").trim() : "";
    if (!campusCode) return null;
    const descriptors = findFilterDescriptors("xq_list", (_, node) => node.getAttribute("index") === `xq_list_${campusCode}`);
    return descriptors.length ? descriptors[0] : null;
  }

  function findFilterDescriptors(group, predicate) {
    const out = [];
    const items = findFilterItems(group);
    if (!items) return out;
    const nodes = items.querySelectorAll("li[index]");
    for (let i = 0; i < nodes.length; i += 1) {
      const link = nodes[i].querySelector("a");
      const text = normalizeText(link ? link.textContent : nodes[i].textContent);
      if (!predicate(text, nodes[i])) continue;
      const descriptor = filterDescriptorFromNode(nodes[i]);
      if (descriptor) out.push(descriptor);
    }
    return out;
  }

  function recommendationCardsHtml(recommendations) {
    const html = [];
    for (let i = 0; i < recommendations.length; i += 1) {
      const gap = recommendations[i].gap;
      const created = hasEquivalentPreset(recommendations[i]);
      html.push(`
        <div class="jcp-recommendation-card">
          <div class="jcp-preset-main">
            <strong>${escapeHtml(gap.category)}<span class="jcp-credit-gap">还差 ${escapeHtml(formatCredits(gap.missing))} 学分</span></strong>
            <div class="jcp-preset-summary">${escapeHtml(presetSummaryText(recommendations[i]))}</div>
          </div>
          <div class="jcp-preset-actions">
            <button type="button" class="jcp-primary jcp-create-recommendation" data-recommendation-index="${i}" ${created ? "disabled" : ""}>${created ? "已创建" : "创建条件"}</button>
          </div>
        </div>`);
    }
    return html.join("");
  }

  function formatCredits(value) {
    const number = Number(value || 0);
    return Number.isInteger(number) ? String(number) : number.toFixed(1);
  }

  function setStatus(text) {
    const node = document.querySelector(".jcp-toolbar .jcp-status");
    if (node) node.textContent = text;
  }

  function reportError(message, detail, options = {}) {
    state.errorCount += 1;
    const detailText = detail ? `：${friendlyErrorText(detail)}` : "";
    console.warn(`[交大选课助手+] ${message}${detailText}`);
    if (options.silent) return;
    showNotice(`${message}${detailText}`, "error");
  }

  function showNotice(message, type) {
    clearTimeout(state.noticeTimer);
    removeNodes(document.querySelectorAll(".jcp-notice"));
    const notice = document.createElement("div");
    notice.className = `jcp-notice${type === "error" ? " jcp-notice-error" : ""}`;
    notice.textContent = message;
    document.body.appendChild(notice);
    state.noticeTimer = window.setTimeout(() => notice.remove(), type === "error" ? 6000 : 2800);
  }

  function friendlyErrorText(detail) {
    const text = normalizeText(detail && detail.message ? detail.message : detail);
    if (/401|403|unauthorized|forbidden/i.test(text)) return "认证失败，请检查 API Key";
    if (/429|rate.?limit/i.test(text)) return "请求过于频繁，请稍后再试";
    if (/timeout|超时/i.test(text)) return "请求超时，请稍后重试";
    if (/network|网络/i.test(text)) return "网络连接失败";
    if (/请求失败\s*5\d\d/.test(text)) return "服务暂时不可用";
    return text.replace(/请求失败\s*\d+\s*:\s*[\s\S]*/i, "服务请求失败").slice(0, 140);
  }

  function openSettingsPanel() {
    closeSettingsPanel();
    const mask = document.createElement("div");
    mask.className = "jcp-panel-mask";
    const panel = document.createElement("div");
    panel.className = "jcp-panel";
    panel.innerHTML = `
      <div class="jcp-panel-header">
        <h4>交大选课助手+ 设置</h4>
        <button type="button" class="jcp-icon-close jcp-cancel" title="关闭" aria-label="关闭">×</button>
      </div>
      <div class="jcp-panel-body">
        <section class="jcp-section">
          <div class="jcp-section-title">
            <h5>LLM 来源</h5>
            <button type="button" class="jcp-add-provider">添加来源</button>
          </div>
          <p class="jcp-muted">选择一个来源生成评价总结。DeepSeek 为内置来源；其他来源需兼容 OpenAI Chat Completions API。</p>
          <div class="jcp-provider-list">${providerCardsHtml(state.settings.providers, state.settings.activeProviderId)}</div>
        </section>
        <section class="jcp-section">
          <h5>jCourse</h5>
          <label>jCourse API Key（可选）</label>
          <input type="password" class="jcp-key-jcourse" placeholder="用于 Bearer 认证访问 jCourse API" value="${escapeAttr(state.settings.jcourseApiKey)}">
        </section>
        <section class="jcp-section">
          <div class="jcp-section-title"><h5>总结维度</h5><button type="button" class="jcp-add-dim">添加维度</button></div>
          <table class="jcp-dim-table">
            <thead>
              <tr><th class="jcp-dim-type-cell">类型</th><th>维度</th><th>备注</th><th class="jcp-dim-action-cell">操作</th></tr>
            </thead>
            <tbody>${dimensionsToTableRowsHtml(state.settings.dimensions)}</tbody>
          </table>
          <p class="jcp-muted">“是否”输出 是/否/未知；“开放”输出 20 字内短语。备注会作为额外要求发送给 LLM。</p>
        </section>
        <section class="jcp-section">
          <label style="font-weight:400;">
            <input type="checkbox" class="jcp-hide-conflicts" ${state.settings.hideConflicts ? "checked" : ""}>
            隐藏与已选课冲突的教学班/课程
          </label>
          <p class="jcp-muted">打开“筛选条件”时会同源查询通识学分缺口；外部服务仅在你点击社区或总结按钮时调用。</p>
        </section>
      </div>
      <div class="jcp-panel-footer">
        <button type="button" class="jcp-clear-cache">清除缓存</button>
        <div class="jcp-actions">
          <button type="button" class="jcp-cancel">取消</button>
          <button type="button" class="jcp-primary jcp-save">保存</button>
        </div>
      </div>
    `;
    document.body.appendChild(mask);
    document.body.appendChild(panel);
    mask.addEventListener("click", closeSettingsPanel);
    const cancelButtons = panel.querySelectorAll(".jcp-cancel");
    for (let i = 0; i < cancelButtons.length; i += 1) cancelButtons[i].addEventListener("click", closeSettingsPanel);
    panel.querySelector(".jcp-add-provider").addEventListener("click", () => addProviderCard(panel));
    panel.querySelector(".jcp-add-dim").addEventListener("click", () => addDimensionRow(panel, { type: "yesno", label: "", note: "" }));
    panel.addEventListener("click", (event) => {
      const target = event.target;
      if (!target || !target.classList) return;
      if (target.classList.contains("jcp-delete-dim")) {
        const row = target.closest("tr");
        if (row) row.remove();
      } else if (target.classList.contains("jcp-delete-provider")) {
        const card = target.closest(".jcp-provider-card");
        if (card) card.remove();
        ensureActiveProviderCard(panel);
      }
    });
    panel.addEventListener("change", (event) => {
      if (event.target && event.target.classList && event.target.classList.contains("jcp-provider-active")) {
        markActiveProviderCard(panel);
      }
    });
    panel.addEventListener("input", (event) => {
      const target = event.target;
      if (!target || !target.classList) return;
      const card = target.closest(".jcp-provider-card");
      if (!card) return;
      if (target.classList.contains("jcp-provider-label")) {
        const title = card.querySelector(".jcp-provider-title");
        if (title) title.textContent = target.value.trim() || "未命名来源";
      }
    });
    panel.querySelector(".jcp-clear-cache").addEventListener("click", () => {
      state.jcourseCache = {};
      state.llmCache = {};
      saveJson(JCACHE_KEY, state.jcourseCache);
      saveJson(LCACHE_KEY, state.llmCache);
      removeNodes(document.querySelectorAll(".jcp-result"));
      showNotice("缓存已清除");
    });
    panel.querySelector(".jcp-save").addEventListener("click", () => {
      const parsed = parseProviderCards(panel);
      if (parsed.error) {
        showNotice(parsed.error, "error");
        return;
      }
      state.settings.providers = parsed.providers;
      state.settings.activeProviderId = parsed.activeProviderId;
      state.settings.jcourseApiKey = panel.querySelector(".jcp-key-jcourse").value.trim();
      state.settings.dimensions = parseDimensionSettingsTable(panel);
      if (!state.settings.dimensions.length) state.settings.dimensions = cloneDefaultDimensions();
      state.settings.hideConflicts = panel.querySelector(".jcp-hide-conflicts").checked;
      saveSettings();
      const hideToggle = document.querySelector(".jcp-hide-toggle");
      if (hideToggle) hideToggle.checked = state.settings.hideConflicts;
      closeSettingsPanel();
      scheduleScan();
      showNotice("设置已保存");
    });
    markActiveProviderCard(panel);
  }

  function closeSettingsPanel() {
    removeNodes(document.querySelectorAll(".jcp-panel-mask, .jcp-panel"));
  }

  function providerCardsHtml(providers, activeProviderId) {
    const out = [];
    for (let i = 0; i < providers.length; i += 1) out.push(providerCardHtml(providers[i], providers[i].id === activeProviderId));
    return out.join("");
  }

  function providerCardHtml(provider, active) {
    return `
      <div class="jcp-provider-card${active ? " jcp-active-provider" : ""}" data-provider-id="${escapeAttr(provider.id)}" data-built-in="${provider.builtIn ? "true" : "false"}">
        <div class="jcp-provider-head">
          <input type="radio" class="jcp-provider-active" name="jcp-active-provider" ${active ? "checked" : ""} title="设为当前来源">
          <strong class="jcp-provider-title">${escapeHtml(provider.label)}</strong>
          ${provider.builtIn ? '<span class="jcp-provider-tag">内置</span>' : '<button type="button" class="jcp-delete-provider">删除</button>'}
        </div>
        <div class="jcp-provider-grid">
          <label>名称<input type="text" class="jcp-provider-label" value="${escapeAttr(provider.label)}" ${provider.builtIn ? "readonly" : ""}></label>
          <label>API Key<input type="password" class="jcp-provider-key" value="${escapeAttr(provider.key)}" placeholder="sk-..."></label>
          <label class="jcp-provider-endpoint">Chat Completions 地址<input type="text" class="jcp-provider-endpoint-input" value="${escapeAttr(provider.endpoint)}" ${provider.builtIn ? "readonly" : ""} placeholder="https://example.com/v1/chat/completions"></label>
          <label class="jcp-provider-model-field">模型<input type="text" class="jcp-provider-model" value="${escapeAttr(provider.model)}" placeholder="model-id"></label>
        </div>
      </div>`;
  }

  function addProviderCard(panel) {
    const id = `custom-${Date.now()}`;
    const provider = { id, label: "自定义来源", endpoint: "", key: "", model: "", builtIn: false };
    panel.querySelector(".jcp-provider-list").insertAdjacentHTML("beforeend", providerCardHtml(provider, false));
    const cards = panel.querySelectorAll(".jcp-provider-card");
    const card = cards[cards.length - 1];
    if (card) card.querySelector(".jcp-provider-label").focus();
  }

  function ensureActiveProviderCard(panel) {
    if (panel.querySelector(".jcp-provider-active:checked")) return;
    const first = panel.querySelector(".jcp-provider-active");
    if (first) first.checked = true;
    markActiveProviderCard(panel);
  }

  function markActiveProviderCard(panel) {
    const cards = panel.querySelectorAll(".jcp-provider-card");
    for (let i = 0; i < cards.length; i += 1) {
      const radio = cards[i].querySelector(".jcp-provider-active");
      cards[i].classList.toggle("jcp-active-provider", Boolean(radio && radio.checked));
    }
  }

  function parseProviderCards(panel) {
    const cards = toArray(panel.querySelectorAll(".jcp-provider-card"));
    const providers = [];
    let activeProviderId = "";
    for (let i = 0; i < cards.length; i += 1) {
      const card = cards[i];
      const builtIn = card.dataset.builtIn === "true";
      const label = normalizeText(card.querySelector(".jcp-provider-label").value);
      const endpoint = normalizeText(card.querySelector(".jcp-provider-endpoint-input").value);
      const model = normalizeText(card.querySelector(".jcp-provider-model").value);
      if (!label) return { error: "LLM 来源名称不能为空" };
      if (!isAllowedEndpoint(endpoint)) return { error: `${label} 的 Chat Completions 地址无效` };
      if (!model) return { error: `${label} 的模型不能为空` };
      let id = builtIn ? "deepseek" : normalizeProviderId(card.dataset.providerId || label);
      if (!id || providerIdExists(providers, id)) id = `custom-${Date.now()}-${i}`;
      const provider = {
        id,
        label,
        endpoint,
        key: card.querySelector(".jcp-provider-key").value.trim(),
        model,
        builtIn,
      };
      providers.push(provider);
      if (card.querySelector(".jcp-provider-active").checked) activeProviderId = id;
    }
    if (!providers.length) return { error: "至少需要保留一个 LLM 来源" };
    return { providers, activeProviderId: activeProviderId || providers[0].id };
  }

  function isAllowedEndpoint(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" || (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1"));
    } catch (error) {
      return false;
    }
  }

  function mutationHasRelevantNode(mutation) {
    if (!mutation) return false;
    const added = toArray(mutation.addedNodes);
    const removed = toArray(mutation.removedNodes);
    for (let i = 0; i < added.length; i += 1) {
      if (isRelevantMutationNode(added[i])) return true;
    }
    for (let i = 0; i < removed.length; i += 1) {
      if (isRelevantMutationNode(removed[i])) return true;
    }
    return false;
  }

  function isRelevantMutationNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    if (!node.classList) return true;
    return !node.classList.contains("jcp-badge") && !node.classList.contains("jcp-info");
  }

  function observeDom() {
    if (state.observer) state.observer.disconnect();
    state.observer = new MutationObserver((mutations) => {
      let relevant = false;
      for (let i = 0; i < mutations.length && !relevant; i += 1) {
        relevant = mutationHasRelevantNode(mutations[i]);
      }
      if (relevant) scheduleScan();
    });
    state.observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  function findLoadMoreControl() {
    const containers = toArray(document.querySelectorAll("#more, #contentBox, .tjxk_list"));
    for (let i = 0; i < containers.length; i += 1) {
      const controls = containers[i].querySelectorAll("button, a, [role='button'], input[type='button'], input[type='submit']");
      for (let j = 0; j < controls.length; j += 1) {
        const control = controls[j];
        const label = normalizeText(control.value || control.textContent || "");
        if (/^(?:点击|点此)?(?:加载|查看)更多(?:课程)?$/.test(label)) return control;
      }
    }
    return null;
  }

  function isLoadMoreControlReady(control) {
    if (!control || !document.documentElement.contains(control)) return false;
    if (control.disabled || control.getAttribute("aria-disabled") === "true" || control.classList.contains("disabled")) return false;
    const style = window.getComputedStyle(control);
    return style.display !== "none" && style.visibility !== "hidden" && control.getClientRects().length > 0;
  }

  function isNearViewport(control) {
    if (!isLoadMoreControlReady(control)) return false;
    const rect = control.getBoundingClientRect();
    return rect.top <= window.innerHeight + 120 && rect.bottom >= -120;
  }

  function observeLoadMoreControl(control) {
    if (!control || state.loadMorePending || state.loadMoreFailedControl === control) return;
    if (state.loadMoreObserver) {
      state.loadMoreObserver.disconnect();
      state.loadMoreObserver.observe(control);
      return;
    }
    if (!state.loadMoreFallbackBound) {
      state.loadMoreFallbackBound = true;
      window.addEventListener("scroll", () => {
        clearTimeout(state.loadMoreFallbackTimer);
        state.loadMoreFallbackTimer = window.setTimeout(() => {
          if (isNearViewport(state.loadMoreControl)) triggerAutoLoadMore(state.loadMoreControl);
        }, 80);
      }, { passive: true });
    }
    if (isNearViewport(control)) triggerAutoLoadMore(control);
  }

  function ensureAutoLoadMoreObserver() {
    if (state.loadMoreObserver || typeof window.IntersectionObserver !== "function") return;
    state.loadMoreObserver = new IntersectionObserver((entries) => {
      for (let i = 0; i < entries.length; i += 1) {
        if (entries[i].isIntersecting && entries[i].target === state.loadMoreControl) {
          triggerAutoLoadMore(entries[i].target);
          break;
        }
      }
    }, { root: null, rootMargin: "0px 0px 120px 0px", threshold: 0 });
  }

  function ensureAutoLoadMore() {
    ensureAutoLoadMoreObserver();
    const control = findLoadMoreControl();
    if (control === state.loadMoreControl) return;
    if (state.loadMoreObserver) state.loadMoreObserver.disconnect();
    state.loadMoreControl = control;
    if (state.loadMoreFailedControl !== control) state.loadMoreFailedControl = null;
    observeLoadMoreControl(control);
  }

  async function triggerAutoLoadMore(control) {
    if (state.loadMorePending || control !== state.loadMoreControl || !isLoadMoreControlReady(control)) return;
    state.loadMorePending = true;
    if (state.loadMoreObserver) state.loadMoreObserver.unobserve(control);
    const beforeCount = collectCandidatePanels().length;
    control.click();
    const loaded = await waitForCondition(() => {
      const nextControl = findLoadMoreControl();
      return collectCandidatePanels().length > beforeCount
        || !document.documentElement.contains(control)
        || (nextControl && nextControl !== control);
    }, LOAD_MORE_WAIT_TIMEOUT_MS);
    state.loadMorePending = false;
    if (!loaded) {
      state.loadMoreFailedControl = control;
      return;
    }
    state.loadMoreFailedControl = null;
    scheduleScan();
    window.requestAnimationFrame(() => {
      ensureAutoLoadMore();
      if (state.loadMoreControl === control) observeLoadMoreControl(control);
    });
  }

  function scheduleScan() {
    clearTimeout(state.scanTimer);
    state.scanTimer = window.setTimeout(scanNow, SCAN_DEBOUNCE_MS);
  }

  function scanNow() {
    ensureToolbar();
    ensureAutoLoadMore();
    state.selectedCourses = collectSelectedCourses();
    state.selectedSlots = collectSelectedSlotsFromCourses(state.selectedCourses);
    const courses = collectCandidatePanels();
    let rowCount = 0;
    let conflictRows = 0;
    let pendingRows = 0;
    let selectedRows = 0;
    for (let i = 0; i < courses.length; i += 1) {
      const course = courses[i];
      rowCount += course.rows.length;
      const result = applyConflictState(course);
      conflictRows += result.conflicts;
      pendingRows += result.pending;
      selectedRows += result.selected;
      ensureSummaryButton(course);
    }

    if (!courses.length) {
      setStatus("等待课程列表");
      if (!state.zeroDomReported) {
        state.zeroDomReported = true;
        console.debug("[交大选课助手+] 暂未找到候选课程列表", location.pathname);
      }
      return;
    }
    state.zeroDomReported = false;
    setStatus(`已选时间 ${state.selectedSlots.length} 段，候选 ${courses.length} 门/${rowCount} 班，已选 ${selectedRows} 班，冲突 ${conflictRows} 班，待确认 ${pendingRows} 班`);
  }

  function collectCandidatePanels() {
    const scoped = toArray(document.querySelectorAll("#contentBox .panel.panel-info, .tjxk_list .panel.panel-info"));
    const allPanels = toArray(document.querySelectorAll(".panel.panel-info"));
    const fallback = [];
    for (let i = 0; i < allPanels.length; i += 1) {
      if (allPanels[i] && typeof allPanels[i].querySelector === "function" && allPanels[i].querySelector(".kcmc")) {
        fallback.push(allPanels[i]);
      }
    }
    const panels = uniqueNodes(scoped.concat(fallback));
    const courses = [];
    for (let i = 0; i < panels.length; i += 1) {
      const course = parseCoursePanel(panels[i]);
      if (course) courses.push(course);
    }
    return courses;
  }

  function parseCoursePanel(panel) {
    if (!panel || typeof panel.querySelector !== "function") return null;
    const heading = panel.querySelector(".panel-heading.kc_head") || panel.querySelector(".panel-heading");
    const nameNode = panel.querySelector(".kcmc a");
    const kcmc = panel.querySelector(".kcmc");
    const headingText = normalizeText(kcmc ? kcmc.textContent : heading ? heading.textContent : "");
    const codeMatch = headingText.match(/\(([A-Za-z0-9._-]+)\)/);
    const code = codeMatch ? codeMatch[1] : "";
    const courseName = nameNode ? normalizeText(nameNode.textContent) : headingText.replace(/^\([^)]+\)/, "").replace(/\s+-\s+.*$/, "").trim();
    const rowNodes = toArray(panel.querySelectorAll("tr.body_tr"));
    const rows = [];
    for (let j = 0; j < rowNodes.length; j += 1) {
      const row = rowNodes[j];
      const teacher = normalizeText(textOf(row.querySelector(".jsxm")) || textOf(row.querySelector(".jsxmzc")));
      const department = normalizeText(textOf(row.querySelector(".kkxymc")));
      const timeText = getMultilineText(row.querySelector(".sksj"));
      rows.push({ row, teacher, department, timeText, slots: parseScheduleText(timeText) });
    }
    const course = { panel, heading, nameNode, kcmc, code, courseName, rows, department: firstDepartment(rows), multiTeacher: hasMultipleTeachers(rows) };
    return course.panel && course.heading && course.kcmc && course.courseName ? course : null;
  }

  function collectSelectedSlots() {
    return collectSelectedSlotsFromCourses(collectSelectedCourses());
  }

  function collectSelectedSlotsFromCourses(selectedCourses) {
    const slots = [];
    for (let i = 0; i < selectedCourses.length; i += 1) {
      const parsed = selectedCourses[i].slots || [];
      for (let j = 0; j < parsed.length; j += 1) slots.push(parsed[j]);
    }
    return slots;
  }

  function collectSelectedCourses() {
    const selected = [];
    const items = toArray(document.querySelectorAll(".right_div .outer_xkxx_list li.list-group-item, .outer_xkxx_list li.list-group-item"));
    for (let i = 0; i < items.length; i += 1) {
      const text = getMultilineText(items[i]);
      selected.push({
        node: items[i],
        text,
        label: selectedCourseLabel(items[i], text),
        normalizedText: normalizeText(text).toUpperCase(),
        slots: parseScheduleText(getMultilineText(items[i].querySelector("p.time, .time")) || text),
      });
    }
    return selected;
  }

  function selectedCourseLabel(node, fallback) {
    const group = node && node.closest ? node.closest(".outer_xkxx_list") : null;
    const heading = group ? group.querySelector("h1, h2, h3, h4, h5, h6, .panel-title") : null;
    const source = normalizeText(heading ? heading.textContent : fallback);
    const match = source.match(/\(([A-Za-z0-9._-]+)\)\s*(.*?)(?:\s+-\s+\d+(?:\.\d+)?\s*学分|$)/);
    if (match) return `${match[1]} ${match[2]}`.trim().slice(0, 80);
    return source.split("\n")[0].slice(0, 80) || "未命名课程";
  }

  function hasConflict(slots, selectedSlots) {
    for (let i = 0; i < slots.length; i += 1) {
      for (let j = 0; j < selectedSlots.length; j += 1) {
        if (schedulesConflict(slots[i], selectedSlots[j])) return true;
      }
    }
    return false;
  }

  function findConflictMatches(slots, selectedCourses) {
    const matches = [];
    for (let i = 0; i < selectedCourses.length; i += 1) {
      const selected = selectedCourses[i];
      if (hasConflict(slots, selected.slots || [])) matches.push(selected);
    }
    return matches;
  }

  function mergeConflictMatches(target, matches) {
    for (let i = 0; i < matches.length; i += 1) {
      let exists = false;
      for (let j = 0; j < target.length; j += 1) {
        if (target[j].node === matches[i].node) exists = true;
      }
      if (!exists) target.push(matches[i]);
    }
  }

  function applyConflictState(course) {
    let conflicts = 0;
    let pending = 0;
    let allRowsAreConflict = course.rows.length > 0;
    let anyRowConflict = false;
    let selectedRows = 0;
    const courseConflictMatches = [];

    for (let i = 0; i < course.rows.length; i += 1) {
      const entry = course.rows[i];
      const rowSelected = isSelectedCourseRow(course, entry);
      const rowConflictMatches = !rowSelected && entry.slots.length > 0 ? findConflictMatches(entry.slots, state.selectedCourses) : [];
      const rowConflict = rowConflictMatches.length > 0;
      const rowPending = !entry.timeText || entry.slots.length === 0;
      entry.row.classList.toggle("jcp-row-selected", rowSelected);
      entry.row.classList.toggle("jcp-row-conflict", rowConflict);
      entry.row.classList.toggle("jcp-hidden-conflict", rowConflict && state.settings.hideConflicts);
      const detailRow = entry.row.nextElementSibling;
      if (detailRow && detailRow.classList && detailRow.classList.contains("jcp-row-summary-detail")) {
        detailRow.classList.toggle("jcp-hidden-conflict", rowConflict && state.settings.hideConflicts);
      }
      removeOwned(entry.row, ".jcp-row-status");
      if (rowSelected) {
        selectedRows += 1;
        addRowStatus(entry.row, "已选", "jcp-selected-tag");
      } else if (rowConflict) {
        conflicts += 1;
        anyRowConflict = true;
        mergeConflictMatches(courseConflictMatches, rowConflictMatches);
        addConflictStatus(entry.row.querySelector(".an") || entry.row.lastElementChild || entry.row, `冲突 ${rowConflictMatches.length} 门`, rowConflictMatches, "jcp-row-status");
      } else if (rowPending) {
        pending += 1;
      }
      if (!rowConflict) allRowsAreConflict = false;
    }

    course.panel.classList.toggle("jcp-course-conflict", anyRowConflict);
    course.panel.classList.toggle("jcp-hidden-conflict", allRowsAreConflict && selectedRows === 0 && state.settings.hideConflicts);
    updateHeadingConflictStatus(course, conflicts, pending, selectedRows, courseConflictMatches);

    return { conflicts, pending, selected: selectedRows };
  }

  function isSelectedCourseRow(course, entry) {
    if (!state.selectedCourses || !state.selectedCourses.length || !course || !entry) return false;
    const code = normalizeText(course.code).toUpperCase();
    const name = normalizeText(course.courseName);
    const teacher = normalizeTeacherName(entry.teacher);
    for (let i = 0; i < state.selectedCourses.length; i += 1) {
      const selected = state.selectedCourses[i];
      const text = selected.normalizedText || "";
      const hasCourseIdentity = Boolean((code && text.indexOf(code) >= 0) || (name && selected.text && selected.text.indexOf(name) >= 0));
      if (!hasCourseIdentity) continue;
      const selectedTeacherText = normalizeTeacherName(selected.text);
      const teacherMatches = !teacher || selectedTeacherText.indexOf(teacher) >= 0 || teacher.indexOf(selectedTeacherText) >= 0;
      if (!teacherMatches && selectedTeacherText) continue;
      if (!entry.slots.length || !selected.slots.length || hasConflict(entry.slots, selected.slots)) return true;
    }
    return false;
  }

  function updateHeadingConflictStatus(course, conflicts, pending, selectedRows, conflictMatches) {
    const info = ensureHeadingRight(course);
    if (!info) return;
    removeOwned(info, ".jcp-heading-status");
    const total = course.rows.length;
    let text = "不冲突";
    let className = "jcp-ok-tag";
    if (selectedRows > 0) {
      text = selectedRows === total ? "已选" : `已选 ${selectedRows} 班`;
      className = "jcp-selected-tag";
    } else if (conflicts > 0 && total > 0 && conflicts === total) {
      text = "全部冲突";
      className = "jcp-conflict-tag";
    } else if (conflicts > 0) {
      text = "部分冲突";
      className = "jcp-conflict-tag";
    } else if (pending > 0) {
      text = "冲突未知";
      className = "jcp-warning";
    }
    if (conflicts > 0 && conflictMatches && conflictMatches.length) {
      addConflictStatus(info, `${text} · ${conflictMatches.length}门`, conflictMatches, "jcp-heading-status");
    } else {
      const tag = document.createElement("span");
      tag.className = `jcp-badge jcp-heading-status ${className}`;
      tag.textContent = text;
      info.appendChild(tag);
    }
    normalizeHeadingRatingPosition(course);
    updateTeacherBadge(course, info);
  }

  function ensureSummaryButton(course) {
    const info = ensureHeadingRight(course);
    if (!info) return;
    if (hasMultipleTeachingClasses(course)) {
      removeOwned(info, ".jcp-summary-btn, .jcp-community-link");
      removeOwned(course.heading, ".jcp-heading-summary-line");
      ensureRowSummaryButtons(course);
      return;
    }
    removeOwned(course.panel, ".jcp-row-summary-wrap");
    ensureCommunityLink(course, info);
    if (info.querySelector(".jcp-summary-btn")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "jcp-summary-btn jcp-primary";
    button.textContent = "总结评价";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      runCourseSummary(course, course.rows[0] || null, button);
    });
    info.appendChild(button);
  }

  function hasMultipleTeachingClasses(course) {
    return Boolean(course && course.rows && course.rows.length > 1);
  }

  function ensureHeadingRight(course) {
    if (!course.heading) return null;
    const title = course.heading.querySelector(".panel-title") || course.heading;
    let info = title.querySelector(".jcp-heading-right");
    if (!info) {
      info = document.createElement("span");
      info.className = "jcp-info jcp-heading-right";
      title.appendChild(info);
    }
    return info;
  }

  function updateTeacherBadge(course, info) {
    removeOwned(info, ".jcp-teacher-status");
    if (!hasMultipleTeachingClasses(course)) return;
    const tag = document.createElement("span");
    tag.className = "jcp-badge jcp-warning jcp-teacher-status";
    tag.textContent = `${course.rows.length} 个教学班`;
    info.appendChild(tag);
  }

  function ensureRowSummaryButtons(course) {
    for (let i = 0; i < course.rows.length; i += 1) {
      const entry = course.rows[i];
      const target = entry.row.querySelector(".an") || entry.row.lastElementChild || entry.row;
      target.classList.add("jcp-action-cell");
      if (target.querySelector(".jcp-row-summary-wrap")) continue;
      const wrap = document.createElement("span");
      wrap.className = "jcp-row-summary-wrap";
      const link = document.createElement("a");
      link.className = "jcp-community-link";
      link.href = "https://course.sjtu.plus/course";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "选课社区";
      link.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        openCommunityCourse(course, entry, link);
      });
      const button = document.createElement("button");
      button.type = "button";
      button.className = "jcp-summary-btn jcp-primary";
      button.textContent = "总结评价";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        runCourseSummary(course, entry, button);
      });
      wrap.appendChild(link);
      wrap.appendChild(button);
      target.appendChild(wrap);
    }
  }

  function ensureCommunityLink(course, info) {
    if (info.querySelector(".jcp-community-link")) return;
    const link = document.createElement("a");
    link.className = "jcp-community-link";
    link.href = "https://course.sjtu.plus/course";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "选课社区";
    link.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      openCommunityCourse(course, course.multiTeacher ? null : course.rows[0] || null, link);
    });
    info.appendChild(link);
  }

  async function openCommunityCourse(course, rowEntry, link) {
    const oldText = link.textContent;
    link.textContent = "匹配中...";
    try {
      const prepared = await prepareExpandedCourse(course, rowEntry, true);
      course = prepared.course;
      rowEntry = prepared.rowEntry;
      if (course.multiTeacher && (!rowEntry || !rowEntry.teacher)) throw new Error("多教师课程需要先选择具体教学班");
      const teacher = rowEntry && rowEntry.teacher ? rowEntry.teacher : firstTeacher(course.rows);
      const sourceResult = await searchJCourseSources(course, teacher, rowEntry && rowEntry.department ? rowEntry.department : course.department);
      if (!sourceResult || !sourceResult.sources || !sourceResult.sources.length) throw new Error("未匹配到 jCourse 课程");
      const url = `https://course.sjtu.plus/course/${encodeURIComponent(sourceResult.sources[0].course.id)}`;
      link.href = url;
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      reportError(`选课社区跳转失败：${course.code} ${course.courseName}`, message);
    } finally {
      link.textContent = oldText;
    }
  }

  async function runCourseSummary(course, rowEntry, button) {
    button.disabled = true;
    button.textContent = "总结中…";
    let result = ensureSummaryResult(course, rowEntry);
    const initialTeacher = rowEntry && rowEntry.teacher ? rowEntry.teacher : firstTeacher(course.rows);
    renderSummaryState(result, { teacher: initialTeacher, status: "正在准备评价…", loading: true });
    try {
      const prepared = await prepareExpandedCourse(course, rowEntry, true);
      course = prepared.course;
      rowEntry = prepared.rowEntry;
      if (hasMultipleTeachingClasses(course) && !rowEntry) {
        renderSummaryState(result, { status: "请选择具体教学班后再总结" });
        scheduleScan();
        return;
      }
      result = ensureSummaryResult(course, rowEntry) || result;
      const teacher = rowEntry && rowEntry.teacher ? rowEntry.teacher : firstTeacher(course.rows);
      const department = rowEntry && rowEntry.department ? rowEntry.department : course.department;
      renderSummaryState(result, { teacher, status: "正在读取选课社区评价…", loading: true });
      if (!teacher) throw new Error("缺少具体老师信息，无法进行评价总结");
      const sourceResult = await searchJCourseSources(course, teacher, department);
      if (!sourceResult || !sourceResult.sources || !sourceResult.sources.length) throw new Error(`jCourse 未匹配：${course.code} ${course.courseName}${department ? `（学院：${department}）` : "（缺少开课学院）"}`);
      const sources = sourceResult.sources;
      if (!hasMultipleTeachingClasses(course)) updateHeadingRating(course, sources);
      const sourceText = oldCodeSourcesText(course, sources);
      const teacherText = matchedTeacherSourcesText(sources);
      const loadingMeta = summaryMetaHtml(course, sources, sourceText, teacherText, false);
      renderSummaryState(result, { teacher, status: "正在生成总结…", loading: true, metaHtml: loadingMeta });
      const summarizingSince = Date.now();
      const reviews = await fetchReviewsForSources(sources);
      if (!reviews.length) {
        await waitUntilElapsed(summarizingSince, 100);
        renderSummaryState(result, { teacher, status: "暂无评价可总结", metaHtml: loadingMeta });
        return;
      }
      const stale = isPossiblyStale(reviews);
      const provider = activeProvider();
      if (!provider) throw new Error("未选择 LLM 来源");
      if (!provider.key) throw new Error(`${provider.label} API Key 未配置`);
      const summary = await summarizeReviews(provider, sources, reviews);
      await waitUntilElapsed(summarizingSince, 100);
      renderSummaryState(result, {
        teacher,
        summary,
        metaHtml: summaryMetaHtml(course, sources, sourceText, teacherText, stale),
      });
    } catch (error) {
      const message = friendlyErrorText(error);
      result = ensureSummaryResult(course, rowEntry) || result;
      renderSummaryState(result, { teacher: rowEntry && rowEntry.teacher ? rowEntry.teacher : initialTeacher, status: message, error: true });
      reportError(`课程总结失败：${course.code} ${course.courseName}`, error);
    } finally {
      button.disabled = false;
      button.textContent = "重新总结";
    }
  }

  async function prepareExpandedCourse(course, rowEntry, requireTeacher) {
    expandCoursePanel(course);
    let freshCourse = parseCoursePanel(course.panel) || course;
    let freshRow = resolveFreshRow(freshCourse, rowEntry);
    if (courseHasLoadedRows(freshCourse, freshRow, requireTeacher)) {
      return { course: freshCourse, rowEntry: freshRow };
    }
    const start = Date.now();
    while (Date.now() - start < EXPAND_WAIT_TIMEOUT_MS) {
      await delay(EXPAND_WAIT_INTERVAL_MS);
      freshCourse = parseCoursePanel(course.panel) || freshCourse;
      freshRow = resolveFreshRow(freshCourse, rowEntry);
      if (courseHasLoadedRows(freshCourse, freshRow, requireTeacher)) {
        return { course: freshCourse, rowEntry: freshRow };
      }
    }
    return { course: freshCourse, rowEntry: freshRow };
  }

  function courseHasLoadedRows(course, rowEntry, requireTeacher) {
    if (!course || !course.rows || !course.rows.length) return false;
    if (!requireTeacher) return true;
    if (rowEntry && rowEntry.teacher) return true;
    return Boolean(firstTeacher(course.rows));
  }

  function resolveFreshRow(course, rowEntry) {
    if (!course || !course.rows || !course.rows.length) return null;
    if (rowEntry && rowEntry.row) {
      for (let i = 0; i < course.rows.length; i += 1) {
        if (course.rows[i].row === rowEntry.row) return course.rows[i];
      }
      const oldId = rowEntry.row.getAttribute ? rowEntry.row.getAttribute("id") : "";
      if (oldId) {
        for (let i = 0; i < course.rows.length; i += 1) {
          const newId = course.rows[i].row && course.rows[i].row.getAttribute ? course.rows[i].row.getAttribute("id") : "";
          if (newId === oldId) return course.rows[i];
        }
      }
    }
    if (course.rows.length === 1) return course.rows[0];
    return null;
  }

  function delay(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function waitUntilElapsed(startTime, minMs) {
    const remaining = minMs - (Date.now() - startTime);
    return remaining > 0 ? delay(remaining) : Promise.resolve();
  }

  function ensureSummaryResult(course, rowEntry) {
    if (rowEntry && rowEntry.row) {
      if (course && course.heading) removeOwned(course.heading, ".jcp-heading-summary-line");
      let detailRow = rowEntry.row.nextElementSibling;
      if (!detailRow || !detailRow.classList.contains("jcp-row-summary-detail")) {
        detailRow = document.createElement("tr");
        detailRow.className = "jcp-row-summary-detail jcp-result";
        const cell = document.createElement("td");
        cell.colSpan = Math.max(1, rowEntry.row.cells ? rowEntry.row.cells.length : 1);
        detailRow.appendChild(cell);
        rowEntry.row.insertAdjacentElement("afterend", detailRow);
      }
      return ensureSummaryCard(detailRow.querySelector("td"), "jcp-row-summary-card");
    }
    if (!course || !course.heading) return null;
    return ensureSummaryCard(course.heading, "jcp-heading-summary-line");
  }

  function ensureSummaryCard(container, className) {
    if (!container) return null;
    let card = null;
    const children = container.children || [];
    for (let i = 0; i < children.length; i += 1) {
      if (children[i].classList && children[i].classList.contains(className)) {
        card = children[i];
        break;
      }
    }
    if (!card) {
      card = document.createElement("div");
      card.className = `${className} jcp-summary-card`;
      card.innerHTML = '<div class="jcp-summary-card-head"></div><div class="jcp-summary-card-body"></div><div class="jcp-summary-meta"></div>';
      container.appendChild(card);
    }
    return card;
  }

  function renderSummaryState(card, options) {
    if (!card) return;
    const head = card.querySelector(".jcp-summary-card-head");
    const body = card.querySelector(".jcp-summary-card-body");
    const meta = card.querySelector(".jcp-summary-meta");
    const teacher = options && options.teacher ? `<span class="jcp-summary-context">${escapeHtml(options.teacher)}</span>` : "";
    if (head) head.innerHTML = `<strong>评价总结</strong>${teacher}`;
    if (body) {
      if (options && options.summary) {
        body.innerHTML = summaryGridHtml(options.summary);
      } else {
        const spinner = options && options.loading ? '<span class="jcp-summary-loading-dots" aria-hidden="true"><span></span><span></span><span></span></span>' : "";
        const errorClass = options && options.error ? " jcp-summary-error" : "";
        body.innerHTML = `<div class="jcp-summary-state${errorClass}">${spinner}<span>${escapeHtml(options && options.status ? options.status : "")}</span></div>`;
      }
    }
    if (meta) {
      meta.innerHTML = options && options.metaHtml ? options.metaHtml : "";
      meta.style.display = meta.innerHTML ? "flex" : "none";
    }
  }

  function summaryGridHtml(summary) {
    const items = String(summary || "").split(" | ");
    const html = [];
    for (let i = 0; i < items.length; i += 1) {
      const separator = items[i].indexOf(":");
      if (separator < 0) {
        html.push(`<div class="jcp-summary-item"><span class="jcp-summary-item-value">${escapeHtml(items[i])}</span></div>`);
        continue;
      }
      const label = items[i].slice(0, separator);
      const value = items[i].slice(separator + 1);
      html.push(`<div class="jcp-summary-item"><span class="jcp-summary-item-label">${escapeHtml(label)}</span><span class="jcp-summary-item-value">${escapeHtml(value)}</span></div>`);
    }
    return `<div class="jcp-summary-grid">${html.join("")}</div>`;
  }

  function summaryMetaHtml(course, sources, sourceText, teacherText, stale) {
    const extras = [];
    if (hasMultipleTeachingClasses(course)) extras.push(metaChipHtml("评分", formatSourcesRating(sources), "jcp-rating"));
    if (sourceText) extras.push(metaChipHtml("旧课号", sourceText, "jcp-warning"));
    if (teacherText) extras.push(metaChipHtml("教师", teacherText, "jcp-warning"));
    if (stale) extras.push(metaChipHtml("", "评价可能过时", "jcp-warning"));
    return extras.join("");
  }

  function metaChipHtml(label, value, className) {
    const safeValue = escapeHtml(value);
    const labelHtml = label ? `<span class="jcp-chip-label">${escapeHtml(label)}:</span>` : "";
    return `<span class="jcp-badge ${className || ""}">${labelHtml}${safeValue}</span>`;
  }

  function expandCoursePanel(course) {
    if (!course || !course.panel) return;
    if (expandSjtuCoursePanel(course)) return;
    const collapse = findCourseCollapse(course);
    if (!collapse || isCollapseOpen(collapse)) return;
    const toggles = findCourseCollapseToggles(course, collapse);
    if (toggles.length) {
      try {
        clickElement(toggles[0]);
      } catch (error) {
        dispatchMouseClick(toggles[0]);
      }
    }
    window.setTimeout(() => {
      if (!isCollapseOpen(collapse)) forceOpenCollapse(collapse, toggles);
    }, 80);
  }

  function expandSjtuCoursePanel(course) {
    const body = course.panel.querySelector(".panel-body.table-responsive, .panel-body");
    const heading = course.panel.querySelector(".panel-heading.kc_head") || course.heading;
    if (!body || !heading || !isElementHidden(body)) return false;
    clickElement(heading);
    window.setTimeout(() => {
      if (isElementHidden(body)) body.style.display = "";
    }, 120);
    return true;
  }

  function isElementHidden(element) {
    if (!element) return false;
    if (element.style && element.style.display === "none") return true;
    const computed = window.getComputedStyle ? window.getComputedStyle(element) : null;
    return Boolean(computed && computed.display === "none");
  }

  function findCourseCollapse(course) {
    const direct = course.panel.querySelector(".panel-collapse.collapse, .collapse");
    if (direct) return direct;
    const toggles = findCourseCollapseToggles(course, null);
    for (let i = 0; i < toggles.length; i += 1) {
      const target = collapseTargetFromToggle(toggles[i]);
      if (target) return target;
    }
    return null;
  }

  function findCourseCollapseToggles(course, collapse) {
    const nodes = [];
    const roots = [];
    if (course.heading) roots.push(course.heading);
    if (course.panel) roots.push(course.panel);
    for (let r = 0; r < roots.length; r += 1) {
      const found = toArray(roots[r].querySelectorAll("[data-toggle='collapse'], [data-target], a[href^='#']"));
      for (let i = 0; i < found.length; i += 1) {
        const target = collapseTargetFromToggle(found[i]);
        const matchesTarget = !collapse || target === collapse;
        if (matchesTarget && nodes.indexOf(found[i]) === -1) nodes.push(found[i]);
      }
    }
    return nodes;
  }

  function collapseTargetFromToggle(toggle) {
    if (!toggle || !toggle.getAttribute) return null;
    const selector = toggle.getAttribute("data-target") || toggle.getAttribute("href") || "";
    if (!selector || selector.charAt(0) !== "#") return null;
    const id = selector.slice(1);
    if (!id) return null;
    return document.getElementById(id);
  }

  function isCollapseOpen(collapse) {
    if (!collapse || !collapse.classList) return true;
    return collapse.classList.contains("in") || collapse.classList.contains("show") || collapse.getAttribute("aria-expanded") === "true";
  }

  function forceOpenCollapse(collapse, toggles) {
    if (collapse && collapse.classList) {
      collapse.classList.add("in");
      collapse.classList.add("show");
      collapse.style.height = "auto";
      collapse.setAttribute("aria-expanded", "true");
    }
    for (let i = 0; i < toggles.length; i += 1) {
      toggles[i].setAttribute("aria-expanded", "true");
      if (toggles[i].classList) toggles[i].classList.remove("collapsed");
    }
  }

  function dispatchMouseClick(element) {
    if (!element || !element.dispatchEvent) return;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, view: window });
    element.dispatchEvent(event);
  }

  function clickElement(element) {
    if (!element) return;
    if (typeof element.click === "function") {
      element.click();
    } else {
      dispatchMouseClick(element);
    }
  }

  function updateHeadingRating(course, sources) {
    if (!course || !course.heading) return;
    removeOwned(course.panel || course.heading, ".jcp-heading-rating");
    const target = findRatingAnchor(course);
    if (!target) return;
    const tag = document.createElement("span");
    tag.className = "jcp-heading-rating jcp-title-rating";
    tag.title = formatRatingTooltip(sources);
    tag.textContent = formatHeadingRating(sources);
    insertRatingAfterAnchor(target, tag);
    normalizeHeadingRatingPosition(course);
  }

  function findRatingAnchor(course) {
    return findNativeStatusNode(course);
  }

  function normalizeHeadingRatingPosition(course) {
    if (!course || !course.heading) return;
    const rating = course.heading.querySelector(".jcp-heading-rating");
    const target = findRatingAnchor(course);
    if (!rating || !target) return;
    const next = target.nextSibling;
    if (next === rating) return;
    insertRatingAfterAnchor(target, rating);
  }

  function insertRatingAfterAnchor(target, rating) {
    if (!target || !rating) return;
    if (target.nodeType === 3 && target.parentNode) {
      target.parentNode.insertBefore(rating, target.nextSibling);
    } else if (target.parentNode) {
      target.parentNode.insertBefore(rating, target.nextSibling);
    }
  }

  function findNativeStatusNode(course) {
    if (!course || !course.heading) return null;
    const statusById = course.heading.querySelector("[id^='zt_txt_']");
    if (statusById && !closestPluginNode(statusById)) return statusById;
    const nodes = toArray(course.heading.querySelectorAll("span, b, strong, em, i, small, label, div"));
    let fallback = null;
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (!node || !node.classList) continue;
      if (node.classList.contains("jcp-heading-right") || node.classList.contains("jcp-heading-summary-line")) continue;
      if (closestPluginNode(node)) continue;
      const text = normalizeText(node.textContent);
      if (text.indexOf("状态") < 0) continue;
      if (!fallback || text.length < normalizeText(fallback.textContent).length) fallback = node;
    }
    if (fallback) return fallback;
    const walker = document.createTreeWalker(course.heading, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (!node || !node.parentNode || closestPluginNode(node.parentNode)) return NodeFilter.FILTER_REJECT;
        return normalizeText(node.nodeValue).indexOf("状态") >= 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    return walker.nextNode();
  }

  function closestPluginNode(node) {
    let current = node;
    while (current && current !== document.body) {
      if (current.classList) {
        for (let i = 0; i < current.classList.length; i += 1) {
          if (String(current.classList[i]).indexOf("jcp-") === 0) return current;
        }
      }
      current = current.parentNode;
    }
    return null;
  }

  function activeProvider() {
    const providers = state.settings.providers || [];
    for (let i = 0; i < providers.length; i += 1) {
      if (providers[i].id === state.settings.activeProviderId) return providers[i];
    }
    return providers.length ? providers[0] : null;
  }

  function firstTeacher(rows) {
    for (let i = 0; i < rows.length; i += 1) {
      if (rows[i].teacher) return rows[i].teacher;
    }
    return "";
  }

  function firstDepartment(rows) {
    for (let i = 0; i < rows.length; i += 1) {
      if (rows[i].department) return rows[i].department;
    }
    return "";
  }

  function hasMultipleTeachers(rows) {
    const seen = [];
    for (let i = 0; i < rows.length; i += 1) {
      const teacher = normalizeTeacherName(rows[i].teacher);
      if (!teacher) continue;
      if (seen.indexOf(teacher) === -1) seen.push(teacher);
      if (seen.length > 1) return true;
    }
    return false;
  }

  function normalizeTeacherName(text) {
    return normalizeText(text)
      .replace(/[（(].*?[）)]/g, "")
      .replace(/、/g, ",")
      .replace(/\s+/g, "");
  }

  function isPossiblyStale(reviews) {
    const now = Date.now();
    const twoYearsMs = 1000 * 60 * 60 * 24 * 365 * 2;
    let oldCount = 0;
    const limit = Math.min(5, reviews.length);
    for (let i = 0; i < limit; i += 1) {
      const review = reviews[i].review || reviews[i];
      const rawDate = review.created_at || review.updated_at || "";
      const time = Date.parse(rawDate);
      if (Number.isFinite(time) && now - time > twoYearsMs) oldCount += 1;
    }
    return oldCount >= 2;
  }

  async function searchJCourseSources(course, teacher, department) {
    const normalizedTeacher = normalizeTeacherName(teacher);
    const cacheKey = stableKey(["sources-v3", course.code, course.courseName, normalizedTeacher, department, course.multiTeacher ? "multi" : "single", state.settings.jcourseApiKey ? "key" : "session"]);
    const cached = getCache(state.jcourseCache, cacheKey);
    if (cached !== undefined) return cached;
    const queries = jcourseSearchQueries(course, teacher);
    const candidates = [];
    for (let qIndex = 0; qIndex < queries.length; qIndex += 1) {
      const q = queries[qIndex];
      const data = await requestJCourseJson(`${COURSE_API_BASE}/course/?q=${encodeURIComponent(q)}&page=1&page_size=20`);
      const items = Array.isArray(data.items) ? data.items : [];
      for (let i = 0; i < items.length; i += 1) {
        if (!sourceExists(candidates, items[i].id)) candidates.push({ course: items[i], queryIndex: qIndex });
      }
    }

    const found = pickJCourseMatches(candidates, course, teacher, department);
    const value = { sources: found };
    setCache(state.jcourseCache, cacheKey, value);
    saveJson(JCACHE_KEY, state.jcourseCache);
    return value;
  }

  function jcourseSearchQueries(course, teacher) {
    const name = normalizeText(course && course.courseName ? course.courseName : "");
    const teacherName = normalizeText(teacher);
    return uniqueStrings(compactValues([
      teacherName && name ? `${name} ${teacherName}` : "",
      name,
    ]));
  }

  function pickJCourseMatches(candidates, course, teacher, department) {
    const levels = [
      { teacher: true, name: true, minScore: 105 },
      { teacher: false, name: true, minScore: 80 },
    ];
    const found = [];
    for (let levelIndex = 0; levelIndex < levels.length; levelIndex += 1) {
      const level = levels[levelIndex];
      if (course.multiTeacher && !level.teacher) continue;
      for (let i = 0; i < candidates.length; i += 1) {
        const item = candidates[i].course;
        if (!departmentMatches(item, department)) continue;
        const score = scoreCourseMatch(item, course, teacher, level.teacher, level.name);
        if (score >= level.minScore && !sourceExists(found, item.id)) found.push({ course: item, score });
      }
    }
    found.sort((a, b) => b.score - a.score);
    return found;
  }

  function scoreCourseMatch(item, course, teacher, requireTeacher, requireName) {
    let score = 0;
    const itemCode = normalizeText(item.code || "");
    const itemName = normalizeText(item.name || "");
    const itemTeacher = normalizeText(item.main_teacher && item.main_teacher.name ? item.main_teacher.name : "");
    const normalizedTeacher = normalizeTeacherName(teacher);
    const normalizedItemTeacher = normalizeTeacherName(itemTeacher);
    const nameExact = Boolean(course.courseName && itemName === course.courseName);
    const nameLoose = Boolean(course.courseName && (itemName.indexOf(course.courseName) >= 0 || course.courseName.indexOf(itemName) >= 0));
    const codeExact = Boolean(course.code && itemCode.toUpperCase() === course.code.toUpperCase());
    const teacherMatch = Boolean(normalizedTeacher && normalizedItemTeacher && (normalizedTeacher.indexOf(normalizedItemTeacher) >= 0 || normalizedItemTeacher.indexOf(normalizedTeacher) >= 0));
    if (requireTeacher && !teacherMatch) return 0;
    if (requireName && !nameLoose && !nameExact) return 0;
    if (nameExact) score += 90;
    else if (nameLoose) score += 45;
    if (codeExact) score += 25;
    if (teacherMatch) score += 35;
    if (item.rating && Number(item.rating.count) > 0) score += Math.min(10, Number(item.rating.count));
    return score;
  }

  function oldCodeSourceText(localCourse, matchedCourse) {
    const localCode = normalizeText(localCourse && localCourse.code ? localCourse.code : "").toUpperCase();
    const matchedCode = normalizeText(matchedCourse && matchedCourse.code ? matchedCourse.code : "").toUpperCase();
    if (!localCode || !matchedCode || localCode === matchedCode) return "";
    return `匹配旧课号: ${matchedCourse.code}`;
  }

  function oldCodeSourcesText(localCourse, sources) {
    const codes = [];
    for (let i = 0; i < sources.length; i += 1) {
      const text = oldCodeSourceText(localCourse, sources[i].course);
      if (text) {
        const code = sources[i].course.code;
        if (codes.indexOf(code) === -1) codes.push(code);
      }
    }
    return codes.length ? codes.join(",") : "";
  }

  function matchedTeacherSourcesText(sources) {
    const teachers = [];
    for (let i = 0; i < sources.length; i += 1) {
      const teacher = normalizeText(sources[i].course && sources[i].course.main_teacher && sources[i].course.main_teacher.name ? sources[i].course.main_teacher.name : "");
      if (teacher && teachers.indexOf(teacher) === -1) teachers.push(teacher);
    }
    return teachers.join(",");
  }

  function formatSourcesRating(sources) {
    if (!sources.length) return "暂无评分";
    if (sources.length === 1) return formatRating(sources[0].course.rating);
    const stats = ratingStats(sources);
    if (!stats.count) return `${sources.length} 个评价来源，暂无评分`;
    return `均分 ${stats.avg.toFixed(1)} (${stats.count}人/${stats.sourceCount}源)`;
  }

  function formatHeadingRating(sources) {
    const stats = ratingStats(sources);
    if (!stats.count) return "暂无评分";
    return `均分 ${stats.avg.toFixed(1)}`;
  }

  function formatRatingTooltip(sources) {
    const stats = ratingStats(sources);
    if (!stats.count) return `评分人数：0；来源数：${stats.sourceCount}`;
    return `评分人数：${stats.count}；来源数：${stats.sourceCount}`;
  }

  function ratingStats(sources) {
    const stats = { count: 0, weightedAvg: 0, avg: 0, sourceCount: sources ? sources.length : 0 };
    if (!sources || !sources.length) return stats;
    let totalCount = 0;
    let weightedAvg = 0;
    for (let i = 0; i < sources.length; i += 1) {
      const rating = sources[i].course.rating || {};
      const count = Number(rating.count || 0);
      const avg = Number(rating.avg || 0);
      if (count > 0 && Number.isFinite(avg)) {
        totalCount += count;
        weightedAvg += avg * count;
      }
    }
    stats.count = totalCount;
    stats.weightedAvg = weightedAvg;
    stats.avg = totalCount ? weightedAvg / totalCount : 0;
    return stats;
  }

  function departmentMatches(item, department) {
    const local = normalizeDepartment(department);
    const remote = normalizeDepartment(item && item.department ? item.department : "");
    if (!local) return true;
    if (!remote) return false;
    return local === remote || local.indexOf(remote) >= 0 || remote.indexOf(local) >= 0;
  }

  function normalizeDepartment(text) {
    return normalizeText(text).replace(/\s+/g, "");
  }

  function sourceExists(sources, id) {
    for (let i = 0; i < sources.length; i += 1) {
      if (sources[i].course && sources[i].course.id === id) return true;
    }
    return false;
  }

  async function fetchReviewsForSources(sources) {
    const all = [];
    for (let i = 0; i < sources.length; i += 1) {
      const reviews = await fetchReviews(sources[i].course.id);
      for (let j = 0; j < reviews.length; j += 1) {
        all.push({ source: sources[i].course, review: reviews[j] });
      }
    }
    all.sort((a, b) => {
      const at = Date.parse((a.review && (a.review.created_at || a.review.updated_at)) || "") || 0;
      const bt = Date.parse((b.review && (b.review.created_at || b.review.updated_at)) || "") || 0;
      return bt - at;
    });
    return all;
  }

  async function fetchReviews(courseId) {
    const cacheKey = stableKey(["topReviews-v2", courseId, state.settings.jcourseApiKey ? "key" : "session"]);
    const cached = getCache(state.jcourseCache, cacheKey);
    if (cached !== undefined) return cached;
    const data = await requestJCourseJson(`${COURSE_API_BASE}/course/${encodeURIComponent(courseId)}/review?order_by=like_count&page=1&page_size=10`);
    const reviews = Array.isArray(data.items) ? data.items : [];
    setCache(state.jcourseCache, cacheKey, reviews);
    saveJson(JCACHE_KEY, state.jcourseCache);
    return reviews;
  }

  async function summarizeReviews(provider, sources, reviews) {
    const dimensions = state.settings.dimensions;
    const model = provider.model;
    const cacheKey = stableKey(["summary", provider.id, provider.endpoint, sourcesFingerprint(sources), latestReviewFingerprint(reviews), dimensionsKey(dimensions), model]);
    const cached = getCache(state.llmCache, cacheKey);
    if (cached !== undefined) return cached;

    const reviewLines = [];
    const reviewLimit = Math.min(12, reviews.length);
    for (let index = 0; index < reviewLimit; index += 1) {
      const review = reviews[index];
      const wrapped = review.review || review;
      const source = review.source || {};
      const likes = wrapped.vote && typeof wrapped.vote.like_count === "number" ? `赞同:${wrapped.vote.like_count}` : "";
      reviewLines.push(`${index + 1}. 来源:${source.code || ""} ${source.name || ""} 教师:${source.main_teacher && source.main_teacher.name ? source.main_teacher.name : "未知"} 评分:${wrapped.rating || "未知"} 学期:${wrapped.semester || "未知"} 时间:${wrapped.created_at || wrapped.updated_at || "未知"} ${likes}\n${String(wrapped.content || "").slice(0, 900)}`);
    }
    const reviewText = reviewLines.join("\n\n");

    const prompt = [
      `评价来源数：${sources.length}`,
      "请只基于下面最新的学生评价总结，不要使用外部知识。",
      `维度要求：${dimensionPromptText(dimensions)}`,
      "返回严格 JSON，key 使用维度名。",
      "“是否”维度的值必须以“是”、“否”或“未知”开头，可以追加一组中文括号作简短解释，例如“是（线下签到）”。",
      "各维度备注中的解释或判断依据如果需要体现在答案中，必须写入该维度值的中文括号内，不要另起字段。",
      "“开放”维度的值必须是中文短语，不得超过 20 个字；证据不足时写“未知”。",
      "",
      reviewText,
    ].join("\n");

    const response = await requestJson(provider.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.key}`,
        "Content-Type": "application/json",
      },
      data: {
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: "你是交大选课助手+。只输出符合要求的 JSON，不要输出 Markdown。" },
          { role: "user", content: prompt },
        ],
      },
    });
    const content = response && response.choices && response.choices[0] && response.choices[0].message ? response.choices[0].message.content : "";
    const summary = formatSummary(content, dimensions);
    setCache(state.llmCache, cacheKey, summary);
    saveJson(LCACHE_KEY, state.llmCache);
    return summary;
  }

  function latestReviewFingerprint(reviews) {
    const parts = [];
    const limit = Math.min(5, reviews.length);
    for (let i = 0; i < limit; i += 1) {
      const review = reviews[i].review || reviews[i];
      const source = reviews[i].source || {};
      parts.push(`${source.id || ""}:${review.id || ""}:${review.updated_at || review.created_at || ""}`);
    }
    return parts.join(",");
  }

  function sourcesFingerprint(sources) {
    const parts = [];
    for (let i = 0; i < sources.length; i += 1) {
      parts.push(`${sources[i].course.id || ""}:${sources[i].course.code || ""}`);
    }
    return parts.join(",");
  }

  function dimensionsKey(dimensions) {
    const parts = [];
    for (let i = 0; i < dimensions.length; i += 1) {
      parts.push(`${dimensions[i].type}|${dimensions[i].label}|${dimensions[i].note || ""}`);
    }
    return parts.join(";");
  }

  function dimensionPromptText(dimensions) {
    const parts = [];
    for (let i = 0; i < dimensions.length; i += 1) {
      const typeText = dimensions[i].type === "open" ? "开放" : "是否";
      const note = dimensions[i].note ? `|备注：${dimensions[i].note}；备注相关解释必须放在该维度值的括号中` : "";
      parts.push(`${typeText}|${dimensions[i].label}${note}`);
    }
    return parts.join("；");
  }

  function requestJson(url, options = {}) {
    const method = options.method || "GET";
    const requestKey = `${method} ${url} ${options.data ? JSON.stringify(options.data).slice(0, 200) : ""}`;
    if (method === "GET" && state.activeRequests.has(requestKey)) return state.activeRequests.get(requestKey);
    const promise = new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        headers: options.headers || { "Content-Type": "application/json" },
        data: options.data ? JSON.stringify(options.data) : undefined,
        timeout: 30000,
        onload: (response) => {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`请求失败 ${response.status}: ${String(response.responseText || "").slice(0, 300)}`));
            return;
          }
          try {
            resolve(JSON.parse(response.responseText || "{}"));
          } catch (error) {
            reject(new Error("响应不是 JSON"));
          }
        },
        onerror: () => reject(new Error("网络请求失败")),
        ontimeout: () => reject(new Error("网络请求超时")),
      });
    }).finally(() => state.activeRequests.delete(requestKey));
    if (method === "GET") state.activeRequests.set(requestKey, promise);
    return promise;
  }

  function requestJCourseJson(url, options = {}) {
    const headers = {};
    if (options.headers) {
      const keys = Object.keys(options.headers);
      for (let i = 0; i < keys.length; i += 1) headers[keys[i]] = options.headers[keys[i]];
    }
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
    if (state.settings.jcourseApiKey) headers.Authorization = `Bearer ${state.settings.jcourseApiKey}`;
    const nextOptions = {};
    const optionKeys = Object.keys(options);
    for (let i = 0; i < optionKeys.length; i += 1) nextOptions[optionKeys[i]] = options[optionKeys[i]];
    nextOptions.headers = headers;
    return requestJson(url, nextOptions);
  }

  function formatRating(rating) {
    if (!rating || !Number(rating.count)) return "暂无评分";
    const avg = Number(rating.avg);
    const avgText = Number.isFinite(avg) && avg > 0 ? avg.toFixed(1) : "无";
    return `均分 ${avgText} (${rating.count}人)`;
  }

  function formatSummary(content, dimensions) {
    const parsed = parseJsonLoose(content);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const parts = [];
      for (let i = 0; i < dimensions.length; i += 1) {
        const dim = dimensions[i];
        const shortName = dim.label.replace(/^是否/, "");
        const rawValue = parsed[dim.label] || parsed[shortName] || "未知";
        const value = sanitizeDimensionValue(rawValue, dim.type);
        parts.push(`${shortName}:${value}`);
      }
      return parts.join(" | ");
    }
    return normalizeText(content).slice(0, 100) || "总结为空";
  }

  function sanitizeDimensionValue(value, type) {
    const text = normalizeText(value);
    if (type === "yesno") {
      if (/^未知/.test(text)) return text.slice(0, 24);
      if (/^是/.test(text)) return text.slice(0, 24);
      if (/^否/.test(text)) return text.slice(0, 24);
      if (/有|会|需要|存在|较多|明显/.test(text)) return "是";
      if (/无|不会|不需要|没有|很少|不明显/.test(text)) return "否";
      return "未知";
    }
    return (text || "未知").slice(0, 20);
  }

  function parseJsonLoose(text) {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (error) {
      const match = String(text).match(/\{[\s\S]*\}/);
      if (!match) return null;
      try {
        return JSON.parse(match[0]);
      } catch (_) {
        return null;
      }
    }
  }

  function parseScheduleText(text) {
    const normalized = normalizeScheduleText(text);
    if (!normalized) return [];
    const patterns = [
      /星期([一二三四五六日天])\s*第?\s*(\d{1,2})(?:\s*[-~－—至]\s*(\d{1,2}))?\s*节(?:\s*\{([^}]+)\})?/g,
      /(?:\{([^}]+)\}\s*)?星期([一二三四五六日天])\s*第?\s*(\d{1,2})(?:\s*[-~－—至]\s*(\d{1,2}))?\s*节/g,
      /星期([一二三四五六日天])\s*[（(]?\s*(\d{1,2})(?:\s*[-~－—至]\s*(\d{1,2}))?\s*节?[）)]?(?:\s*\{([^}]+)\})?/g,
    ];
    const slots = [];
    for (let i = 0; i < patterns.length; i += 1) {
      let match;
      while ((match = patterns[i].exec(normalized))) {
        const weekTextFirst = i === 1;
        const weekday = weekdayToNumber(weekTextFirst ? match[2] : match[1]);
        const start = Number(weekTextFirst ? match[3] : match[2]);
        const end = Number((weekTextFirst ? match[4] : match[3]) || start);
        const weeks = parseWeeks((weekTextFirst ? match[1] : match[4]) || "1-16周");
        const slot = weekday && start && end && weeks.size
          ? { weekday, start: Math.min(start, end), end: Math.max(start, end), weeks: sortedSetValues(weeks) }
          : null;
        if (slot && !slotExists(slots, slot)) slots.push(slot);
      }
    }
    return slots;
  }

  function normalizeScheduleText(text) {
    return normalizeText(text)
      .replace(/；/g, ";")
      .replace(/，/g, ",")
      .replace(/周一/g, "星期一")
      .replace(/周二/g, "星期二")
      .replace(/周三/g, "星期三")
      .replace(/周四/g, "星期四")
      .replace(/周五/g, "星期五")
      .replace(/周六/g, "星期六")
      .replace(/周日/g, "星期日")
      .replace(/周天/g, "星期日")
      .replace(/礼拜一/g, "星期一")
      .replace(/礼拜二/g, "星期二")
      .replace(/礼拜三/g, "星期三")
      .replace(/礼拜四/g, "星期四")
      .replace(/礼拜五/g, "星期五")
      .replace(/礼拜六/g, "星期六")
      .replace(/礼拜日/g, "星期日")
      .replace(/礼拜天/g, "星期日");
  }

  function slotExists(slots, slot) {
    for (let i = 0; i < slots.length; i += 1) {
      const existing = slots[i];
      if (existing.weekday === slot.weekday && existing.start === slot.start && existing.end === slot.end && sameNumberArray(existing.weeks, slot.weeks)) {
        return true;
      }
    }
    return false;
  }

  function sameNumberArray(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  function parseWeeks(text) {
    const weeks = new Set();
    const normalized = normalizeText(text)
      .replace(/周/g, "")
      .replace(/第/g, "")
      .replace(/，/g, ",")
      .replace(/、/g, ",")
      .replace(/；/g, ",")
      .replace(/;/g, ",");
    const odd = /单/.test(normalized);
    const even = /双/.test(normalized);
    const parts = splitNonEmptyCsv(normalized);
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      const range = part.match(/(\d{1,2})\s*[-~－—至]\s*(\d{1,2})/);
      if (range) {
        addWeekRange(weeks, Number(range[1]), Number(range[2]), odd, even);
        continue;
      }
      const single = part.match(/(\d{1,2})/);
      if (single) weeks.add(Number(single[1]));
    }
    if (!weeks.size && (odd || even)) addWeekRange(weeks, 1, 16, odd, even);
    return weeks;
  }

  function addWeekRange(weeks, start, end, odd, even) {
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    for (let week = lo; week <= hi; week += 1) {
      if (odd && week % 2 === 0) continue;
      if (even && week % 2 !== 0) continue;
      weeks.add(week);
    }
  }

  function sortedSetValues(set) {
    const out = [];
    for (const value of set) out.push(value);
    out.sort((a, b) => a - b);
    return out;
  }

  function weekdayToNumber(text) {
    return { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 }[text] || 0;
  }

  function schedulesConflict(a, b) {
    if (!a || !b || a.weekday !== b.weekday) return false;
    if (a.end < b.start || b.end < a.start) return false;
    const bWeeks = new Set(b.weeks);
    for (let i = 0; i < a.weeks.length; i += 1) {
      if (bWeeks.has(a.weeks[i])) return true;
    }
    return false;
  }

  function addRowStatus(row, text, className) {
    const target = row.querySelector(".an") || row.lastElementChild || row;
    const tag = document.createElement("span");
    tag.className = `jcp-badge jcp-row-status ${className}`;
    tag.textContent = text;
    target.appendChild(tag);
  }

  function addConflictStatus(target, text, matches, ownedClass) {
    const tag = document.createElement("button");
    tag.type = "button";
    tag.className = `jcp-badge jcp-conflict-tag jcp-conflict-details ${ownedClass}`;
    tag.setAttribute("aria-expanded", "false");
    tag.setAttribute("aria-label", `${text}，查看冲突课程`);
    tag.appendChild(document.createTextNode(text));
    const popover = document.createElement("span");
    popover.className = "jcp-conflict-popover";
    popover.setAttribute("role", "tooltip");
    const title = document.createElement("strong");
    title.textContent = "与以下已选课程冲突";
    popover.appendChild(title);
    const list = document.createElement("ul");
    for (let i = 0; i < matches.length; i += 1) {
      const item = document.createElement("li");
      item.appendChild(document.createTextNode(matches[i].label || "未命名课程"));
      list.appendChild(item);
    }
    popover.appendChild(list);
    tag.appendChild(popover);
    const layer = target.closest && target.closest(".panel");
    tag.addEventListener("mouseenter", () => {
      if (layer) layer.classList.add("jcp-conflict-popover-layer");
      positionConflictPopover(tag);
    });
    tag.addEventListener("mouseleave", () => {
      if (layer && !tag.classList.contains("jcp-popover-open")) layer.classList.remove("jcp-conflict-popover-layer");
    });
    tag.addEventListener("focus", () => {
      if (layer) layer.classList.add("jcp-conflict-popover-layer");
      positionConflictPopover(tag);
    });
    tag.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const open = !tag.classList.contains("jcp-popover-open");
      tag.classList.toggle("jcp-popover-open", open);
      tag.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) positionConflictPopover(tag);
    });
    tag.addEventListener("blur", () => {
      tag.classList.remove("jcp-popover-open");
      tag.setAttribute("aria-expanded", "false");
      if (layer) layer.classList.remove("jcp-conflict-popover-layer");
    });
    target.appendChild(tag);
  }

  function positionConflictPopover(tag) {
    const popover = tag.querySelector(".jcp-conflict-popover");
    if (!popover) return;
    tag.classList.remove("jcp-popover-up");
    const rect = tag.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    if (popover.offsetHeight + 12 > spaceBelow && rect.top > spaceBelow) tag.classList.add("jcp-popover-up");
  }

  function addHeadingBadge(heading, text, className) {
    const tag = document.createElement("span");
    tag.className = `jcp-badge ${className}`;
    tag.textContent = text;
    const title = heading.querySelector(".panel-title") || heading;
    title.appendChild(tag);
  }

  function removeOwned(root, selector) {
    if (!root) return;
    removeNodes(root.querySelectorAll(selector));
  }

  function toArray(list) {
    const out = [];
    if (!list || typeof list.length !== "number") return out;
    for (let i = 0; i < list.length; i += 1) out.push(list[i]);
    return out;
  }

  function removeNodes(list) {
    const nodes = toArray(list);
    for (let i = 0; i < nodes.length; i += 1) {
      if (nodes[i] && typeof nodes[i].remove === "function") nodes[i].remove();
    }
  }

  function compactValues(items) {
    const out = [];
    for (let i = 0; i < items.length; i += 1) {
      if (items[i]) out.push(items[i]);
    }
    return out;
  }

  function splitNonEmptyLines(text) {
    const parts = String(text || "").split(/\r?\n/);
    const out = [];
    for (let i = 0; i < parts.length; i += 1) {
      const item = parts[i].trim();
      if (item) out.push(item);
    }
    return out;
  }

  function parseDimensionSettingsText(text) {
    const lines = splitNonEmptyLines(text);
    const out = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const sep = line.indexOf("|") >= 0 ? "|" : line.indexOf("：") >= 0 ? "：" : line.indexOf(":") >= 0 ? ":" : "";
      let type = "yesno";
      let label = line;
      let note = "";
      if (sep) {
        const idx = line.indexOf(sep);
        type = normalizeDimensionType(line.slice(0, idx));
        label = line.slice(idx + 1).trim();
        if (sep === "|" && label.indexOf("|") >= 0) {
          const noteIdx = label.indexOf("|");
          note = label.slice(noteIdx + 1).trim();
          label = label.slice(0, noteIdx).trim();
        }
      }
      if (label) out.push({ type, label, note: note || defaultDimensionNote(label, type) });
    }
    return out;
  }

  function parseDimensionSettingsTable(panel) {
    const rows = toArray(panel.querySelectorAll(".jcp-dim-table tbody tr"));
    const out = [];
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const typeNode = row.querySelector(".jcp-dim-type");
      const labelNode = row.querySelector(".jcp-dim-label");
      const noteNode = row.querySelector(".jcp-dim-note");
      const label = labelNode ? normalizeText(labelNode.value) : "";
      if (!label) continue;
      out.push({
        type: normalizeDimensionType(typeNode ? typeNode.value : "yesno"),
        label,
        note: noteNode ? normalizeText(noteNode.value) : "",
      });
    }
    return out;
  }

  function addDimensionRow(panel, dimension) {
    const body = panel.querySelector(".jcp-dim-table tbody");
    if (!body) return;
    body.insertAdjacentHTML("beforeend", dimensionRowHtml(dimension));
  }

  function dimensionsToTableRowsHtml(dimensions) {
    const normalized = normalizeDimensionSettings(dimensions);
    const rows = [];
    for (let i = 0; i < normalized.length; i += 1) {
      rows.push(dimensionRowHtml(normalized[i]));
    }
    return rows.join("");
  }

  function dimensionRowHtml(dimension) {
    const type = normalizeDimensionType(dimension && dimension.type);
    const label = dimension && dimension.label ? dimension.label : "";
    const note = dimension && dimension.note ? dimension.note : "";
    return `
      <tr>
        <td class="jcp-dim-type-cell">
          <select class="jcp-dim-type">
            <option value="yesno" ${type === "yesno" ? "selected" : ""}>是否</option>
            <option value="open" ${type === "open" ? "selected" : ""}>开放</option>
          </select>
        </td>
        <td><input type="text" class="jcp-dim-label" value="${escapeAttr(label)}" placeholder="是否点名"></td>
        <td><input type="text" class="jcp-dim-note" value="${escapeAttr(note)}" placeholder="额外要求，可留空"></td>
        <td class="jcp-dim-action-cell"><button type="button" class="jcp-delete-dim">删除</button></td>
      </tr>
    `;
  }

  function dimensionsToSettingsText(dimensions) {
    const normalized = normalizeDimensionSettings(dimensions);
    const lines = [];
    for (let i = 0; i < normalized.length; i += 1) {
      lines.push(`${normalized[i].type === "open" ? "开放" : "是否"}|${normalized[i].label}${normalized[i].note ? `|${normalized[i].note}` : ""}`);
    }
    return lines.join("\n");
  }

  function splitNonEmptyCsv(text) {
    const parts = String(text || "").split(",");
    const out = [];
    for (let i = 0; i < parts.length; i += 1) {
      const item = parts[i].trim();
      if (item) out.push(item);
    }
    return out;
  }

  function getMultilineText(element) {
    if (!element) return "";
    const htmlText = element.innerHTML ? element.innerHTML.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "") : "";
    const titleText = element.getAttribute && element.getAttribute("title") ? element.getAttribute("title") : "";
    return normalizeText(`${htmlText}\n${titleText}`);
  }

  function textOf(element) {
    return element ? element.textContent : "";
  }

  function normalizeText(text) {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = String(text || "");
    return textarea.value.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  }

  function getCache(cache, key) {
    const entry = cache[key];
    if (!entry) return undefined;
    if (Date.now() - entry.time > CACHE_TTL_MS) {
      delete cache[key];
      return undefined;
    }
    return entry.value;
  }

  function setCache(cache, key, value) {
    cache[key] = { time: Date.now(), value };
    pruneCache(cache, CACHE_MAX_ENTRIES);
  }

  function pruneCache(cache, maxEntries) {
    if (!cache || typeof cache !== "object") return;
    const now = Date.now();
    const keys = Object.keys(cache);
    for (let i = 0; i < keys.length; i += 1) {
      const entry = cache[keys[i]];
      if (!entry || typeof entry.time !== "number" || now - entry.time > CACHE_TTL_MS) {
        delete cache[keys[i]];
      }
    }
    const freshKeys = Object.keys(cache);
    if (freshKeys.length <= maxEntries) return;
    freshKeys.sort((a, b) => {
      const at = cache[a] && typeof cache[a].time === "number" ? cache[a].time : 0;
      const bt = cache[b] && typeof cache[b].time === "number" ? cache[b].time : 0;
      return at - bt;
    });
    const removeCount = freshKeys.length - maxEntries;
    for (let i = 0; i < removeCount; i += 1) {
      delete cache[freshKeys[i]];
    }
  }

  function stableKey(parts) {
    const out = [];
    for (let i = 0; i < parts.length; i += 1) out.push(String(parts[i] == null ? "" : parts[i]));
    return out.join("::");
  }

  function uniqueStrings(items) {
    const seen = {};
    const out = [];
    for (let i = 0; i < items.length; i += 1) {
      const key = String(items[i]);
      if (!Object.prototype.hasOwnProperty.call(seen, key)) {
        seen[key] = true;
        out.push(items[i]);
      }
    }
    return out;
  }

  function uniqueNodes(nodes) {
    const out = [];
    for (let i = 0; i < nodes.length; i += 1) {
      if (out.indexOf(nodes[i]) === -1) out.push(nodes[i]);
    }
    return out;
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttr(text) {
    return escapeHtml(text).replace(/`/g, "&#96;");
  }
})();
