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
