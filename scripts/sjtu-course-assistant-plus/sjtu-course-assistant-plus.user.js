// ==UserScript==
// @name         SJTU Course Assistant Plus
// @name:zh-cn   交大选课助手+
// @namespace    https://course.sjtu.plus/
// @version      0.8.0
// @description  Enhance SJTU course selection with time-conflict filtering and on-demand jCourse + DeepSeek review summaries.
// @description:zh-cn  增强交大选课页面，使用 DeepSeek 对选课社区评价进行总结，并支持自定义维度。
// @author       Codex
// @match        https://i.sjtu.edu.cn/xsxk/zzxkyzb_cxZzxkYzbIndex.html?*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// @connect      course.sjtu.plus
// @connect      api.deepseek.com
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
  const EXPAND_WAIT_TIMEOUT_MS = 4000;
  const EXPAND_WAIT_INTERVAL_MS = 150;
  const DEFAULT_DIMENSIONS = [
    { type: "yesno", label: "是否点名", note: "若能判断线上/线下，必须说明线上或线下" },
    { type: "yesno", label: "是否有互动", note: "" },
    { type: "yesno", label: "是否有考试", note: "如果没有人提到评分标准中包含考试，则认为没有" },
  ];
  const PROVIDERS = {
    deepseek: {
      label: "DeepSeek",
      endpoint: "https://api.deepseek.com/chat/completions",
      modelsEndpoint: "https://api.deepseek.com/models",
      defaultModel: "deepseek-v4-flash",
    },
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
    deepseekModels: [],
    errorCount: 0,
    zeroDomReported: false,
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
    observeDom();
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
    const providerModels = saved.providerModels && typeof saved.providerModels === "object" ? saved.providerModels : {};
    const providerKeys = saved.providerKeys && typeof saved.providerKeys === "object" ? saved.providerKeys : {};
    const savedDeepSeekModel = typeof providerModels.deepseek === "string" && providerModels.deepseek.trim() && providerModels.deepseek.trim() !== "deepseek-chat"
      ? providerModels.deepseek.trim()
      : PROVIDERS.deepseek.defaultModel;
    return {
      hideConflicts: Boolean(saved.hideConflicts),
      enabledProviders: Array.isArray(saved.enabledProviders) && saved.enabledProviders.length ? saved.enabledProviders : ["deepseek"],
      providerKeys: { deepseek: typeof providerKeys.deepseek === "string" ? providerKeys.deepseek : "" },
      providerModels: { deepseek: savedDeepSeekModel },
      jcourseApiKey: typeof saved.jcourseApiKey === "string" ? saved.jcourseApiKey : "",
      dimensions: normalizeDimensionSettings(saved.dimensions),
    };
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
      .jcp-toolbar button:disabled, .jcp-summary-btn:disabled {
        cursor: default;
        opacity: 0.65;
      }
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
      .jcp-heading-summary-line {
        clear: both;
        display: flex;
        align-items: flex-start;
        gap: 8px;
        justify-content: space-between;
        width: 100%;
        margin-top: 5px;
        padding-right: 4px;
        box-sizing: border-box;
        font-size: 12px;
        line-height: 1.45;
      }
      .jcp-heading-summary-line .jcp-chip-label {
        color: #666;
        margin-right: 2px;
      }
      .jcp-heading-summary-main {
        min-width: 0;
        flex: 1 1 auto;
        line-height: 1.7;
      }
      .jcp-heading-summary-extra {
        flex: 0 0 auto;
        max-width: 45%;
        text-align: right;
        line-height: 1.7;
      }
      .jcp-heading-summary-line .jcp-badge {
        margin-left: 0;
        margin-right: 6px;
      }
      .jcp-heading-summary-extra .jcp-badge {
        margin-right: 0;
        margin-left: 6px;
      }
      .jcp-heading-summary-line .jcp-summary {
        border-color: transparent;
        background: transparent;
        color: #2b542c;
        padding: 0;
      }
      .jcp-row-result {
        display: block;
        margin-top: 4px;
        white-space: normal;
      }
      .jcp-errors {
        flex-basis: 100%;
        display: none;
        border-top: 1px solid #e6c9c9;
        margin-top: 6px;
        padding-top: 6px;
        color: #a94442;
      }
      .jcp-errors.jcp-visible { display: block; }
      .jcp-errors pre {
        margin: 4px 0 0;
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 120px;
        overflow: auto;
        font-size: 12px;
        background: transparent;
        border: 0;
        padding: 0;
      }
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
    `;
    document.documentElement.appendChild(style);
  }

  function ensureToolbar() {
    if (document.querySelector(".jcp-toolbar")) return;
    const toolbar = document.createElement("div");
    toolbar.className = "jcp-toolbar";
    toolbar.innerHTML = `
      <strong>交大选课助手+（SJTU Course Assistant Plus）</strong>
      <span class="jcp-muted jcp-status">准备扫描课程</span>
      <label style="margin:0; font-weight:400;">
        <input type="checkbox" class="jcp-hide-toggle">
        隐藏冲突课程
      </label>
      <button type="button" class="jcp-primary jcp-rescan">重新扫描</button>
      <button type="button" class="jcp-settings">设置</button>
      <button type="button" class="jcp-clear-errors">清除错误</button>
      <div class="jcp-errors"><strong>错误</strong><pre></pre></div>
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
    toolbar.querySelector(".jcp-rescan").addEventListener("click", () => scanNow());
    toolbar.querySelector(".jcp-settings").addEventListener("click", openSettingsPanel);
    toolbar.querySelector(".jcp-clear-errors").addEventListener("click", clearErrors);
  }

  function setStatus(text) {
    const node = document.querySelector(".jcp-toolbar .jcp-status");
    if (node) node.textContent = text;
  }

  function reportError(message, detail) {
    state.errorCount += 1;
    const box = document.querySelector(".jcp-errors");
    const pre = box && box.querySelector("pre");
    if (!box || !pre) return;
    const time = new Date().toLocaleTimeString();
    const detailText = detail ? `\n${String(detail).slice(0, 1000)}` : "";
    pre.textContent = `[${time}] ${message}${detailText}\n\n${pre.textContent}`.slice(0, 5000);
    box.classList.add("jcp-visible");
  }

  function clearErrors() {
    state.errorCount = 0;
    const box = document.querySelector(".jcp-errors");
    if (!box) return;
    const pre = box.querySelector("pre");
    if (pre) pre.textContent = "";
    box.classList.remove("jcp-visible");
  }

  function openSettingsPanel() {
    closeSettingsPanel();
    const mask = document.createElement("div");
    mask.className = "jcp-panel-mask";
    const panel = document.createElement("div");
    panel.className = "jcp-panel";
    panel.innerHTML = `
      <h4>SJTU Course Plus 设置</h4>
      <label>LLM 来源</label>
      <label style="font-weight:400; margin-top:4px;">
        <input type="checkbox" class="jcp-provider" value="deepseek" checked disabled>
        DeepSeek（当前内置）
      </label>
      <label>DeepSeek API Key</label>
      <input type="password" class="jcp-key-deepseek" placeholder="sk-..." value="${escapeAttr(state.settings.providerKeys.deepseek)}">
      <label>DeepSeek Model</label>
      <div class="jcp-model-row">
        <select class="jcp-model-deepseek">${deepSeekModelOptionsHtml(state.settings.providerModels.deepseek)}</select>
        <button type="button" class="jcp-refresh-models">刷新模型</button>
      </div>
      <p class="jcp-muted jcp-model-status">配置 DeepSeek API Key 后可刷新模型列表。</p>
      <label>jCourse API Key</label>
      <input type="password" class="jcp-key-jcourse" placeholder="可选；用于 Bearer 认证访问 jCourse API" value="${escapeAttr(state.settings.jcourseApiKey)}">
      <label>总结维度</label>
      <table class="jcp-dim-table">
        <thead>
          <tr>
            <th class="jcp-dim-type-cell">类型</th>
            <th>维度</th>
            <th>备注</th>
            <th class="jcp-dim-action-cell">操作</th>
          </tr>
        </thead>
        <tbody>${dimensionsToTableRowsHtml(state.settings.dimensions)}</tbody>
      </table>
      <div class="jcp-dim-tools">
        <button type="button" class="jcp-add-dim">添加维度</button>
      </div>
      <p class="jcp-muted">“是否”输出 是/否/未知，可带括号解释；“开放”输出 20 字内短语。备注会作为该维度的额外要求发送给 LLM。</p>
      <label style="font-weight:400;">
        <input type="checkbox" class="jcp-hide-conflicts" ${state.settings.hideConflicts ? "checked" : ""}>
        隐藏与已选课冲突的教学班/课程
      </label>
      <p class="jcp-muted">脚本不会自动调用 DeepSeek。只有点击“选课社区”或评价总结按钮时，才会请求 jCourse；只有点击总结按钮且配置 DeepSeek API Key 时才会请求 DeepSeek。</p>
      <div class="jcp-actions">
        <button type="button" class="jcp-clear-cache">清除缓存</button>
        <button type="button" class="jcp-cancel">取消</button>
        <button type="button" class="jcp-primary jcp-save">保存</button>
      </div>
    `;
    document.body.appendChild(mask);
    document.body.appendChild(panel);
    mask.addEventListener("click", closeSettingsPanel);
    panel.querySelector(".jcp-cancel").addEventListener("click", closeSettingsPanel);
    panel.querySelector(".jcp-refresh-models").addEventListener("click", () => refreshDeepSeekModels(panel));
    panel.querySelector(".jcp-key-deepseek").addEventListener("change", () => refreshDeepSeekModels(panel));
    panel.querySelector(".jcp-add-dim").addEventListener("click", () => addDimensionRow(panel, { type: "yesno", label: "", note: "" }));
    panel.querySelector(".jcp-dim-table").addEventListener("click", (event) => {
      const target = event.target;
      if (!target || !target.classList || !target.classList.contains("jcp-delete-dim")) return;
      const row = target.closest("tr");
      if (row) row.parentNode.removeChild(row);
    });
    panel.querySelector(".jcp-clear-cache").addEventListener("click", () => {
      state.jcourseCache = {};
      state.llmCache = {};
      saveJson(JCACHE_KEY, state.jcourseCache);
      saveJson(LCACHE_KEY, state.llmCache);
      removeNodes(document.querySelectorAll(".jcp-result"));
      reportError("缓存已清除");
    });
    panel.querySelector(".jcp-save").addEventListener("click", () => {
      state.settings.enabledProviders = ["deepseek"];
      state.settings.providerKeys.deepseek = panel.querySelector(".jcp-key-deepseek").value.trim();
      state.settings.providerModels.deepseek = panel.querySelector(".jcp-model-deepseek").value.trim() || PROVIDERS.deepseek.defaultModel;
      state.settings.jcourseApiKey = panel.querySelector(".jcp-key-jcourse").value.trim();
      state.settings.dimensions = parseDimensionSettingsTable(panel);
      if (!state.settings.dimensions.length) state.settings.dimensions = cloneDefaultDimensions();
      state.settings.hideConflicts = panel.querySelector(".jcp-hide-conflicts").checked;
      saveSettings();
      const hideToggle = document.querySelector(".jcp-hide-toggle");
      if (hideToggle) hideToggle.checked = state.settings.hideConflicts;
      closeSettingsPanel();
      scheduleScan();
    });
    refreshDeepSeekModels(panel);
  }

  function closeSettingsPanel() {
    removeNodes(document.querySelectorAll(".jcp-panel-mask, .jcp-panel"));
  }

  function deepSeekModelOptionsHtml(selectedModel) {
    const current = selectedModel || PROVIDERS.deepseek.defaultModel;
    const models = state.deepseekModels && state.deepseekModels.length ? state.deepseekModels : [current];
    const normalized = uniqueStrings(compactValues(models.concat([current, PROVIDERS.deepseek.defaultModel])));
    const options = [];
    for (let i = 0; i < normalized.length; i += 1) {
      const model = normalized[i];
      options.push(`<option value="${escapeAttr(model)}" ${model === current ? "selected" : ""}>${escapeHtml(model)}</option>`);
    }
    return options.join("");
  }

  async function refreshDeepSeekModels(panel) {
    if (!panel) return;
    const keyNode = panel.querySelector(".jcp-key-deepseek");
    const select = panel.querySelector(".jcp-model-deepseek");
    const status = panel.querySelector(".jcp-model-status");
    const button = panel.querySelector(".jcp-refresh-models");
    const key = keyNode ? keyNode.value.trim() : "";
    if (!select) return;
    if (!key) {
      if (status) status.textContent = "配置 DeepSeek API Key 后可刷新模型列表。";
      return;
    }
    if (button) button.disabled = true;
    if (status) status.textContent = "正在获取 DeepSeek 模型列表...";
    try {
      const data = await requestDeepSeekModels(key);
      const models = normalizeDeepSeekModels(data);
      if (!models.length) throw new Error("模型列表为空");
      state.deepseekModels = models;
      const current = select.value || state.settings.providerModels.deepseek || PROVIDERS.deepseek.defaultModel;
      select.innerHTML = deepSeekModelOptionsHtml(current);
      if (models.indexOf(current) >= 0) select.value = current;
      if (status) status.textContent = `已获取 ${models.length} 个模型。`;
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      if (status) status.textContent = `模型列表获取失败：${message}`;
      reportError("DeepSeek 模型列表获取失败", message);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function requestDeepSeekModels(apiKey) {
    return requestJson(PROVIDERS.deepseek.modelsEndpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });
  }

  function normalizeDeepSeekModels(data) {
    const out = [];
    const items = data && Array.isArray(data.data) ? data.data : [];
    for (let i = 0; i < items.length; i += 1) {
      const id = normalizeText(items[i] && items[i].id ? items[i].id : "");
      if (id && out.indexOf(id) === -1) out.push(id);
    }
    return out;
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

  function scheduleScan() {
    clearTimeout(state.scanTimer);
    state.scanTimer = window.setTimeout(scanNow, SCAN_DEBOUNCE_MS);
  }

  function scanNow() {
    ensureToolbar();
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
      const hasContentBox = Boolean(document.querySelector("#contentBox"));
      const hasPanels = document.querySelectorAll(".panel.panel-info").length;
      setStatus(`未找到课程 DOM；contentBox=${hasContentBox ? "有" : "无"}，panel=${hasPanels}`);
      if (!state.zeroDomReported) {
        state.zeroDomReported = true;
        reportError("未找到候选课程列表", `当前页面：${location.pathname}`);
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
        normalizedText: normalizeText(text).toUpperCase(),
        slots: parseScheduleText(getMultilineText(items[i].querySelector("p.time, .time")) || text),
      });
    }
    return selected;
  }

  function hasConflict(slots, selectedSlots) {
    for (let i = 0; i < slots.length; i += 1) {
      for (let j = 0; j < selectedSlots.length; j += 1) {
        if (schedulesConflict(slots[i], selectedSlots[j])) return true;
      }
    }
    return false;
  }

  function applyConflictState(course) {
    let conflicts = 0;
    let pending = 0;
    let allRowsAreConflict = course.rows.length > 0;
    let anyRowConflict = false;
    let selectedRows = 0;

    for (let i = 0; i < course.rows.length; i += 1) {
      const entry = course.rows[i];
      const rowSelected = isSelectedCourseRow(course, entry);
      const rowConflict = !rowSelected && entry.slots.length > 0 && hasConflict(entry.slots, state.selectedSlots);
      const rowPending = !entry.timeText || entry.slots.length === 0;
      entry.row.classList.toggle("jcp-row-selected", rowSelected);
      entry.row.classList.toggle("jcp-row-conflict", rowConflict);
      entry.row.classList.toggle("jcp-hidden-conflict", rowConflict && state.settings.hideConflicts);
      removeOwned(entry.row, ".jcp-row-status");
      if (rowSelected) {
        selectedRows += 1;
        addRowStatus(entry.row, "已选", "jcp-selected-tag");
      } else if (rowConflict) {
        conflicts += 1;
        anyRowConflict = true;
      } else if (rowPending) {
        pending += 1;
      }
      if (!rowConflict) allRowsAreConflict = false;
    }

    course.panel.classList.toggle("jcp-course-conflict", anyRowConflict);
    course.panel.classList.toggle("jcp-hidden-conflict", allRowsAreConflict && selectedRows === 0 && state.settings.hideConflicts);
    updateHeadingConflictStatus(course, conflicts, pending, selectedRows);

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

  function updateHeadingConflictStatus(course, conflicts, pending, selectedRows) {
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
    const tag = document.createElement("span");
    tag.className = `jcp-badge jcp-heading-status ${className}`;
    tag.textContent = text;
    info.appendChild(tag);
    normalizeHeadingRatingPosition(course);
    updateTeacherBadge(course, info);
  }

  function ensureSummaryButton(course) {
    const info = ensureHeadingRight(course);
    if (!info) return;
    ensureCommunityLink(course, info);
    if (course.multiTeacher) {
      removeOwned(info, ".jcp-summary-btn");
      ensureRowSummaryButtons(course);
      return;
    }
    removeOwned(course.panel, ".jcp-row-summary-wrap");
    if (info.querySelector(".jcp-summary-btn")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "jcp-summary-btn jcp-primary";
    button.textContent = "选课社区评价总结";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      runCourseSummary(course, course.rows[0] || null, info, button);
    });
    info.appendChild(button);
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
    if (!course.multiTeacher) return;
    const tag = document.createElement("span");
    tag.className = "jcp-badge jcp-warning jcp-teacher-status";
    tag.textContent = "有多个老师";
    info.appendChild(tag);
  }

  function ensureRowSummaryButtons(course) {
    for (let i = 0; i < course.rows.length; i += 1) {
      const entry = course.rows[i];
      const target = entry.row.querySelector(".an") || entry.row.lastElementChild || entry.row;
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
      button.textContent = "本班评价总结";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        runCourseSummary(course, entry, wrap, button);
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

  async function runCourseSummary(course, rowEntry, info, button) {
    button.disabled = true;
    button.textContent = "总结中...";
    try {
      const prepared = await prepareExpandedCourse(course, rowEntry, true);
      course = prepared.course;
      rowEntry = prepared.rowEntry;
      if (course.multiTeacher && (!rowEntry || !rowEntry.teacher)) {
        clearHeadingSummary(course);
        reportError(`多教师课程不支持总体总结：${course.code} ${course.courseName}`, "请点击具体教学班旁边的“本班评价总结”。");
        return;
      }
      const result = ensureHeadingSummaryLine(course);
      const teacher = rowEntry && rowEntry.teacher ? rowEntry.teacher : firstTeacher(course.rows);
      const department = rowEntry && rowEntry.department ? rowEntry.department : course.department;
      const contextHtml = teacher ? metaChipHtml("教师", teacher, "jcp-warning") : "";
      renderHeadingSummary(result, `${contextHtml}${metaChipHtml("", "正在读取 jCourse", "jcp-warning")}`, "");
      if (!teacher) throw new Error("缺少具体老师信息，无法进行评价总结");
      const sourceResult = await searchJCourseSources(course, teacher, department);
      if (!sourceResult || !sourceResult.sources || !sourceResult.sources.length) throw new Error(`jCourse 未匹配：${course.code} ${course.courseName}${department ? `（学院：${department}）` : "（缺少开课学院）"}`);
      const sources = sourceResult.sources;
      updateHeadingRating(course, sources);
      const sourceText = oldCodeSourcesText(course, sources);
      const teacherText = matchedTeacherSourcesText(sources);
      renderHeadingSummary(result, `${contextHtml}${metaChipHtml("", "正在总结评价", "jcp-warning")}`, sourceMetaHtml(sourceText, teacherText));
      const summarizingSince = Date.now();
      const reviews = await fetchReviewsForSources(sources);
      if (!reviews.length) {
        await waitUntilElapsed(summarizingSince, 100);
        renderHeadingSummary(result, `${contextHtml}${metaChipHtml("", "暂无评价可总结", "jcp-warning")}`, sourceMetaHtml(sourceText, teacherText));
        return;
      }
      const stale = isPossiblyStale(reviews);
      const provider = firstEnabledProvider();
      if (!provider) throw new Error("未启用 LLM 来源");
      const key = state.settings.providerKeys[provider];
      if (!key) throw new Error(`${PROVIDERS[provider].label} API Key 未配置`);
      const summary = await summarizeReviews(provider, sources, reviews);
      await waitUntilElapsed(summarizingSince, 100);
      const extras = [];
      if (sourceText) extras.push(metaChipHtml("旧课号", sourceText, "jcp-warning"));
      if (teacherText) extras.push(metaChipHtml("jCourse教师", teacherText, "jcp-warning"));
      if (stale) extras.push(metaChipHtml("", "可能过时", "jcp-warning"));
      renderHeadingSummary(result, `${contextHtml}<span class="jcp-badge jcp-summary">${escapeHtml(summary)}</span>`, extras.join(""));
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      const result = ensureHeadingSummaryLine(course);
      renderHeadingSummary(result, metaChipHtml("错误", message, "jcp-conflict-tag"), "");
      reportError(`课程总结失败：${course.code} ${course.courseName}`, message);
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

  function ensureHeadingSummaryLine(course) {
    if (!course.heading) return null;
    let line = course.heading.querySelector(".jcp-heading-summary-line");
    if (!line) {
      line = document.createElement("div");
      line.className = "jcp-heading-summary-line jcp-result";
      const main = document.createElement("span");
      main.className = "jcp-heading-summary-main";
      const extra = document.createElement("span");
      extra.className = "jcp-heading-summary-extra";
      line.appendChild(main);
      line.appendChild(extra);
      course.heading.appendChild(line);
    }
    return line;
  }

  function renderHeadingSummary(line, mainHtml, extraHtml) {
    if (!line) return;
    const main = line.querySelector(".jcp-heading-summary-main");
    const extra = line.querySelector(".jcp-heading-summary-extra");
    if (main) main.innerHTML = mainHtml || "";
    if (extra) extra.innerHTML = extraHtml || "";
  }

  function clearHeadingSummary(course) {
    if (!course || !course.heading) return;
    removeOwned(course.heading, ".jcp-heading-summary-line");
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

  function firstEnabledProvider() {
    for (let i = 0; i < state.settings.enabledProviders.length; i += 1) {
      const provider = state.settings.enabledProviders[i];
      if (PROVIDERS[provider]) return provider;
    }
    return "";
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

  function sourceMetaHtml(sourceText, teacherText) {
    const parts = [];
    if (sourceText) parts.push(metaChipHtml("旧课号", sourceText, "jcp-warning"));
    if (teacherText) parts.push(metaChipHtml("jCourse教师", teacherText, "jcp-warning"));
    return parts.join("");
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

  async function summarizeReviews(providerId, sources, reviews) {
    const provider = PROVIDERS[providerId];
    const dimensions = state.settings.dimensions;
    const model = state.settings.providerModels[providerId] || provider.defaultModel;
    const cacheKey = stableKey(["summary", providerId, sourcesFingerprint(sources), latestReviewFingerprint(reviews), dimensionsKey(dimensions), model]);
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
        Authorization: `Bearer ${state.settings.providerKeys[providerId]}`,
        "Content-Type": "application/json",
      },
      data: {
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: "你是上海交通大学选课助手。只输出符合要求的 JSON，不要输出 Markdown。" },
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
