const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const scriptPath = path.join(root, "scripts", "shuiyuan-deep-search", "shuiyuan-deep-search.user.js");
const readmePath = path.join(root, "scripts", "shuiyuan-deep-search", "README.md");
const source = fs.readFileSync(scriptPath, "utf8");
const readme = fs.readFileSync(readmePath, "utf8");

test("Shuiyuan follow-ups can acquire and cite new evidence", () => {
  assert.match(source, /async function planFollowup\(/);
  assert.match(source, /searchAll\(searchPlan\.queries\)/);
  assert.match(source, /session\.documents\.push\(doc\)/);
  assert.match(source, /newSourceIds\.add\(source\.id\)/);
  assert.match(readme, /每次追问最多补读 3 个主题/);
});

test("Shuiyuan accepts a configurable OpenAI-compatible endpoint", () => {
  assert.match(source, /normalizeEndpoint\(endpointInput\.value\)/);
  assert.match(source, /state\.config\.endpoint/);
  assert.match(source, /@connect\s+api\.deepseek\.com/);
  assert.match(source, /@connect\s+api\.openai\.com/);
  assert.match(source, /@connect\s+\*/);
  assert.match(source, /GM_xmlhttpRequest\(\{/);
  assert.doesNotMatch(source, /const providers =/);
  assert.doesNotMatch(source, /mode: "cors"/);
});

test("Shuiyuan uses the compact native-header entry and copy", () => {
  assert.match(source, /#search-button/);
  assert.match(source, /svgIcon\("search-spark"\)/);
  assert.match(source, /function syncLauncherStyle\(\)/);
  assert.match(source, /\["keydown", "keyup", "keypress"\]/);
  assert.match(source, /event\.stopPropagation\(\)/);
  assert.doesNotMatch(source, /问题和选中的帖子正文会发送/);
  assert.doesNotMatch(source, /例如：近两年水源上/);
  assert.doesNotMatch(source, /button\("配置 LLM"/);
});
