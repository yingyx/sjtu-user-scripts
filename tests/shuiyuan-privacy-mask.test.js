const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const scriptPath = path.join(
  root,
  "scripts",
  "shuiyuan-privacy-mask",
  "shuiyuan-privacy-mask.user.js"
);
const readmePath = path.join(
  root,
  "scripts",
  "shuiyuan-privacy-mask",
  "README.md"
);
const source = fs.readFileSync(scriptPath, "utf8");
const readme = fs.readFileSync(readmePath, "utf8");

test("privacy mask installs its first-paint protection at document start", () => {
  assert.match(source, /@version\s+0\.2\.0/);
  assert.match(source, /@run-at\s+document-start/);
  assert.match(
    source,
    /@supportURL\s+https:\/\/github\.com\/yingyx\/sjtu-user-scripts\/issues/
  );
  assert.match(
    source,
    /html\.\$\{ROOT_CLASS\} \.d-header \.current-user img\.avatar/
  );
  assert.match(source, /Promise\.resolve\(\)\.then/);
  assert.doesNotMatch(source, /SCAN_DELAY_MS|document-idle/);
});

test("privacy toggle cannot feed its own DOM observer indefinitely", () => {
  assert.match(source, /state\.button\.contains\(target\)/);
  assert.match(source, /label\.textContent !== labelText/);
  assert.match(source, /setAttributeIfChanged/);
  assert.doesNotMatch(source, /label\.textContent = state\.fallbackButton/);
});

test("privacy mask is scoped to current-account surfaces", () => {
  assert.match(source, /user-profile-avatar img\.avatar/);
  assert.match(source, /user-profile-names \.username/);
  assert.match(source, /data-link-name='my-posts'/);
  assert.match(source, /user_avatar/);
  assert.match(source, /user-nav__preferences/);

  assert.doesNotMatch(source, /markAvatars|markTextNodes|markProfileLinks/);
  assert.doesNotMatch(
    source,
    /\.topic-avatar|\.poster-name|\.user-card|a\.mention/
  );
});

test("documentation states the intentional public-content boundary", () => {
  assert.match(
    readme,
    /leaves post authors, topic participants, mentions, user cards/i
  );
  assert.match(readme, /last confirmed signed-in username/i);
  assert.match(readme, /makes no network requests/i);
});
