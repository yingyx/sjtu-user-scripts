# 上海交通大学用户脚本

[English](README.md) | 简体中文

面向上海交通大学相关网站和使用场景的浏览器用户脚本。

## 脚本

<!-- BEGIN GENERATED SCRIPT LIST -->
| 脚本 | 入口文件 | 用途 |
| --- | --- | --- |
| [水源深度搜索助手](scripts/shuiyuan-deep-search/README.md) | `scripts/shuiyuan-deep-search/shuiyuan-deep-search.user.js` | 自动拆解问题、并行检索并精读水源帖子，生成带来源链接的研究报告并支持继续追问。 |
| [水源隐私遮罩](scripts/shuiyuan-privacy-mask/README.md) | `scripts/shuiyuan-privacy-mask/shuiyuan-privacy-mask.user.js` | 隐藏你在水源中的头像、用户名、显示名称和个人资料身份，并提供符合原生界面的侧边栏开关。 |
| [交大选课助手+](scripts/sjtu-course-assistant-plus/README.md) | `scripts/sjtu-course-assistant-plus/sjtu-course-assistant-plus.user.js` | 增强交大选课页面，支持冲突筛选、选课社区评价和可管理的 LLM 总结来源。 |
<!-- END GENERATED SCRIPT LIST -->

## 仓库结构

```text
.
├── AGENTS.md
├── CLAUDE.md / GEMINI.md
├── scripts/
│   └── <script-id>/
│       ├── <script-id>.user.js
│       ├── README.md
│       ├── CHANGELOG.md
│       └── greasyfork.json
├── templates/userscript/
├── tools/
├── tests/
├── shared/
└── docs/
```

每个脚本的完整入口文件位于 `scripts/<script-id>/`。该 `.user.js` 文件同时是 GreasyFork 发布制品，必须包含完整的用户脚本元数据。

`shared/` 只用于开发说明或最终会复制、打包进 `.user.js` 的源代码片段。除非脚本明确使用外部 `@require`，GreasyFork 用户不应在运行时依赖 `shared/` 中的文件。

## 兼容性

- 最终发布制品必须是独立可运行的 `.user.js` 文件。
- 除非明确构建浏览器扩展，否则不要依赖仅扩展可用的 API。
- 各脚本针对具体页面的兼容性约束应记录在脚本目录的 README 中。
- 使用下述仓库级检查，不在根 README 中维护逐脚本检查命令。

## 开发检查

在本地运行仓库校验和工具测试：

```powershell
npm run check
```

根目录两个 README 中的脚本表格由 `scripts.json` 和用户脚本元数据生成。修改注册信息或元数据后运行 `npm run docs:sync`；如果生成内容过时，`npm run check` 会失败。

当前注册的脚本均使用 standards-version-1 严格校验，覆盖元数据、文档、安全性、兼容性和 GreasyFork 配置。

## 一句话 Agent 开发

开发者只需向编码 Agent 描述目标页面和期望行为，例如：

> 制作一个只显示楼主回复的水源用户脚本，并补齐测试、文档和发布准备。

`AGENTS.md` 是 Codex、GitHub Copilot、Cursor 及其他兼容 Agent 的统一开发约定。单行的 `CLAUDE.md` 和 `GEMINI.md` 只负责导入该文件，不重复维护规则。

Agent 使用以下命令生成确定性的脚手架：

```powershell
npm run new -- --id <script-id> --name <中文名称> --name-en <English-name> --description <中文简介> --description-en <English-description> --match <URL-pattern>
```

新脚本从创建时就接受严格校验。详见 `docs/agent-development.md` 和 `docs/standards.md`。

## 发布流程

仓库中的用户脚本彼此独立。每个可发布脚本都必须注册到 `scripts.json`，在各自的 `CHANGELOG.md` 中维护发布说明，并通过独立的 `release/<script-id>` 分支发布。

`Validate repository` 负责检查 pull request 和相关 push。它在 `main` 上成功后，`Publish userscript updates` 会检测已发布脚本的版本提升并生成发布计划，再调用 `Promote userscript (internal)`；真正拥有写权限的任务会等待 `userscript-production` 审批。唯一的手动发布入口 `Bootstrap new userscript` 只用于尚未记录 GreasyFork ID 的脚本首次发布。

完整 CI/CD 和 GreasyFork 同步说明见 `docs/release.md`。
