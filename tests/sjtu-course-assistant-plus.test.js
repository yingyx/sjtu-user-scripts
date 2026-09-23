"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const script = fs.readFileSync(
  path.join(root, "scripts", "sjtu-course-assistant-plus", "sjtu-course-assistant-plus.user.js"),
  "utf8",
);
const fixture = fs.readFileSync(
  path.join(root, "tests", "fixtures", "sjtu-course-assistant-plus-page.html"),
  "utf8",
);

test("course assistant keeps DeepSeek built in while supporting custom LLM sources", () => {
  assert.match(script, /const BUILT_IN_PROVIDER = \{[\s\S]*id: "deepseek"[\s\S]*builtIn: true/);
  assert.match(script, /function addProviderCard\(/);
  assert.match(script, /function parseProviderCards\(/);
  assert.match(script, /OpenAI Chat Completions API/);
  assert.match(script, /provider\.builtIn \? '<span class="jcp-provider-tag">内置<\/span>' : '<button type="button" class="jcp-delete-provider">删除<\/button>'/);
});

test("course assistant preserves legacy DeepSeek settings and validates custom endpoints", () => {
  assert.match(script, /saved\.providerKeys/);
  assert.match(script, /saved\.providerModels/);
  assert.match(script, /url\.protocol === "https:"/);
  assert.match(script, /url\.hostname === "localhost"/);
  assert.match(script, /@connect\s+\*/);
});

test("course assistant keeps background diagnostics out of the page", () => {
  assert.doesNotMatch(script, /jcp-clear-errors/);
  assert.doesNotMatch(script, /class="jcp-errors"/);
  assert.match(script, /setStatus\("等待课程列表"\)/);
  assert.match(script, /jcp-notice-error/);
});

test("course assistant gives each teaching class an independent summary card", () => {
  assert.match(script, /function hasMultipleTeachingClasses\(/);
  assert.match(script, /jcp-row-summary-detail/);
  assert.match(script, /function ensureSummaryResult\(/);
  assert.match(script, /function summaryGridHtml\(/);
  assert.match(script, /button\.textContent = "总结评价"/);
  assert.match(script, /content: "↗"/);
  assert.match(script, />交大选课助手\+<\/strong>/);
  assert.match(script, /<h4>交大选课助手\+ 设置<\/h4>/);
  assert.match(script, /if \(rowEntry && rowEntry\.row\)/);
  assert.match(script, /jcp-summary-loading-dots/);
  assert.doesNotMatch(script, /jcp-summary-spinner/);
  assert.match(script, /target\.classList\.add\("jcp-action-cell"\)/);
  assert.match(script, /grid-template-columns: repeat\(2, 78px\)/);
  assert.doesNotMatch(script, /metaChipHtml\("LLM"/);
  assert.doesNotMatch(script, /metaChipHtml\("社区教师"/);
  assert.match(script, /metaChipHtml\("教师", teacherText/);
});

test("course assistant uses direct model entry without model-list requests", () => {
  assert.doesNotMatch(script, /jcp-refresh-models/);
  assert.doesNotMatch(script, /jcp-provider-models-endpoint/);
  assert.doesNotMatch(script, /function refreshProviderModels\(/);
  assert.match(script, /jcp-provider-endpoint/);
  assert.match(script, /jcp-provider-model-field/);
});

test("course assistant allows multiple native course panels to stay expanded", () => {
  assert.match(script, /@version\s+\d+\.\d+\.\d+(?:-rc\.\d+)?/);
  assert.match(script, /function preserveOtherExpandedCourses\(/);
  assert.match(script, /if \(panels\[i\] === clickedPanel\) continue/);
  assert.match(script, /expanded\[i\]\.body\.style\.display = "block"/);
  assert.doesNotMatch(script, /jcp-expand-all/);
  assert.doesNotMatch(script, /展开全部|收起全部/);
});

test("course assistant groups settings and keeps list behavior out of the toolbar", () => {
  assert.doesNotMatch(script, /class="jcp-hide-toggle"/);
  assert.match(script, /<h5>课程列表<\/h5>/);
  assert.match(script, /<h5>评价数据<\/h5>/);
  assert.match(script, /<h5>LLM 来源<\/h5>/);
  assert.match(script, /<h5>总结维度<\/h5>/);
  assert.match(script, /<h5>本地数据<\/h5>/);
  assert.match(script, /\.jcp-section \+ \.jcp-section/);
  assert.match(script, /class="jcp-auto-load-more"/);
  assert.match(script, /class="jcp-review-limit"/);
  assert.match(script, /class="jcp-reset-dims"/);
  assert.match(script, /autoLoadMore: saved\.autoLoadMore !== false/);
  assert.match(script, /summaryReviewLimit: normalizeReviewLimit/);
  assert.match(script, /!state\.settings\.autoLoadMore/);
  assert.match(script, /Math\.min\(reviewLimit, reviews\.length\)/);
  assert.match(script, /page_size=\$\{pageSize\}/);
});

test("course assistant loads more courses when the native control reaches the viewport", () => {
  assert.match(script, /function findLoadMoreControl\(/);
  assert.match(script, /#more, #contentBox, \.tjxk_list/);
  assert.match(script, /点此/);
  assert.match(script, /new IntersectionObserver\(/);
  assert.match(script, /function triggerAutoLoadMore\(/);
  assert.match(script, /state\.loadMorePending/);
  assert.match(script, /collectCandidatePanels\(\)\.length > beforeCount/);
  assert.match(fixture, /id="more"/);
  assert.match(fixture, /点此查看更多/);
});

test("course assistant identifies the selected courses behind each conflict", () => {
  assert.match(script, /function findConflictMatches\(/);
  assert.match(script, /function addConflictStatus\(/);
  assert.match(script, /与以下已选课程冲突/);
  assert.match(script, /jcp-conflict-popover/);
  assert.match(script, /function positionConflictPopover\(/);
  assert.match(script, /jcp-popover-up/);
  assert.match(script, /\.panel-body\.table-responsive \{ overflow: visible; \}/);
  assert.match(script, /`冲突 \$\{rowConflictMatches\.length\} 门`/);
  assert.match(script, /`\$\{text\} · \$\{conflictMatches\.length\}门`/);
});

test("course assistant saves and applies reusable native filter conditions", () => {
  assert.match(script, /function captureCurrentPreset\(/);
  assert.match(script, /function applyPreset\(/);
  assert.match(script, /button\[name='reset'\]/);
  assert.match(script, /button\[name='query'\]/);
  assert.match(script, /state\.settings\.presets/);
  assert.match(script, />筛选条件<\/button>/);
});

test("course assistant exposes saved conditions between the native search actions", () => {
  assert.match(script, /function ensurePresetQuickSelect\(/);
  assert.match(script, /className = "jcp-preset-quick-select"/);
  assert.match(script, /query\.insertAdjacentElement\("afterend", wrapper\)/);
  assert.match(script, /placeholder\.textContent = presets\.length \? "筛选条件" : "暂无筛选条件"/);
  assert.match(script, /select\.addEventListener\("change", async \(\) =>/);
  assert.match(script, /await applyPreset\(preset\)/);
  assert.match(script, /syncPresetQuickSelect\(\)/);
  assert.match(script, /new ResizeObserver\(sync\)/);
  assert.match(script, /select\.style\.height = `\$\{height\}px`/);
  assert.match(script, /function ensureResetAutoQuery\(/);
  assert.match(script, /if \(!event\.isTrusted\) return/);
});

test("course assistant recommends filter conditions from same-origin general education gaps", () => {
  assert.match(script, /ACADEMIC_PROGRESS_API/);
  assert.match(script, /credentials: "same-origin"/);
  assert.match(script, /method: "POST"/);
  assert.match(script, /Array\.isArray\(data\.items\)/);
  assert.match(script, /GENERAL_EDUCATION_SECTION = "通识核心类模块"/);
  assert.match(script, /if \(section\) activeSection = section/);
  assert.match(script, /if \(!recognizedCategories\) throw new Error\("未识别到通识核心类别数据"\)/);
  assert.match(script, /function buildGeneralEducationRecommendation\(/);
  assert.match(script, /required <= earned \+ exempt/);
  assert.match(script, /jcp-create-recommendation/);
  assert.match(fixture, /JSON\.stringify\(\{ items: \[/);
  assert.match(fixture, /String\(options\.method \|\| "GET"\)\.toUpperCase\(\) !== "POST"/);
});

test("offline course fixture is sanitized and blocks network requests", () => {
  assert.match(fixture, /离线脱敏测试页/);
  assert.match(fixture, /TEST2001/);
  assert.match(fixture, /GM_xmlhttpRequest/);
  assert.match(fixture, /options\.onerror/);
  assert.match(fixture, /fixture-student/);
  assert.match(fixture, /通识核心类模块/);
  assert.match(fixture, /\.\.\/\.\.\/scripts\/sjtu-course-assistant-plus\/sjtu-course-assistant-plus\.user\.js/);
  assert.doesNotMatch(fixture, /i\.sjtu\.edu\.cn/);
});
