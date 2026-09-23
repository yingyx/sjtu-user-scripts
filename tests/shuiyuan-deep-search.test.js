const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const scriptPath = path.join(root, "scripts", "shuiyuan-deep-search", "shuiyuan-deep-search.user.js");
const readmePath = path.join(root, "scripts", "shuiyuan-deep-search", "README.zh-CN.md");
const source = fs.readFileSync(scriptPath, "utf8");
const readme = fs.readFileSync(readmePath, "utf8");

test("Shuiyuan follow-ups can acquire and cite new evidence", () => {
  assert.match(source, /async function planFollowup\(/);
  assert.match(source, /searchWithRecovery\(session\.question/);
  assert.match(source, /session\.documents\.push\(doc\)/);
  assert.match(source, /newSourceIds\.add\(source\.id\)/);
  assert.match(readme, /每次追问最多补读 3 个主题/);
});

function harness(extra = {}) {
  const context = vm.createContext({
    window: { setTimeout() {}, addEventListener() {} },
    GM_getValue: () => ({}), location: { origin: "https://example.test" },
    URL, TextEncoder, crypto: require("node:crypto").webcrypto,
    ...extra,
  });
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, `
    globalThis.api = {
      searchWithRecovery, selectRelevant, conversationContext, evidence, planQuestion, reviewGaps, makeReport, planFollowup, mountLauncher, syncLauncherStyle, state,
      readHistory, writeHistory, saveHistory, deleteHistory, openHistory, showHistory, buildUi, render, persistSession, setRunning,
      configure: function (options) {
        if (options.discourse) discourse = options.discourse;
        if (options.model) model = options.model;
        if (options.native) nativeSearchButton = options.native;
        if (options.button) launcherButton = options.button;
        if (options.host) launcherHost = options.host;
        if (options.surface) surface = options.surface;
      }
    };
  })();`), context);
  return context.api;
}

function searchResponse(titles) {
  return { topics: titles.map((title, index) => ({ id: index + 1, title, views: 1 })), posts: [] };
}

function historySession() {
  return {
    question: "如何学习", plan: { queries: ["学习"], angles: ["方法"] },
    documents: [{ id: 1, title: "经验", url: "https://example.test/t/topic/1", content: "正文", postsRead: 1 }],
    sources: [{ id: "S1", title: "经验", url: "https://example.test/t/topic/1", postsRead: 1 }],
    report: { title: "报告", summary: "摘要", findings: [{ heading: "方法", detail: "结论", sourceIds: ["S1"] }], uncertainties: [], suggestedQuestions: [] },
    conversation: [{ question: "进一步说明", answer: "回答", sourceIds: ["S1"] }], searchHistory: [{ query: "学习", count: 1 }],
  };
}

function memoryStorage() {
  const values = new Map();
  return { values, GM_getValue: (key, fallback) => values.has(key) ? values.get(key) : fallback, GM_setValue: (key, value) => values.set(key, value) };
}

test("history survives reload and updates the same conversation without storing credentials", () => {
  const storage = memoryStorage();
  const api = harness(storage);
  const session = historySession();
  session.config = { apiKey: "secret-key" };
  api.saveHistory(session);
  const id = session.historyId;
  session.conversation.push({ question: "追加", answer: "新回答", sourceIds: ["S1"] });
  api.saveHistory(session);
  const reloaded = harness(storage).readHistory();
  assert.equal(reloaded.length, 1);
  assert.equal(reloaded[0].id, id);
  assert.equal(reloaded[0].session.conversation.length, 2);
  assert.equal(reloaded[0].session.documents[0].content, "正文");
  assert.doesNotMatch(JSON.stringify(reloaded), /secret-key|apiKey/);
});

test("history capacity and storage failures preserve existing data", () => {
  const storage = memoryStorage();
  const api = harness(storage);
  for (let i = 0; i < 20; i += 1) api.saveHistory(historySession());
  const before = storage.values.get("shuiyuanDeepSearch.history.v1");
  const unsaved = historySession();
  assert.throws(() => api.saveHistory(unsaved), /容量上限/);
  assert.equal(unsaved.historyId, undefined);
  assert.equal(storage.values.get("shuiyuanDeepSearch.history.v1"), before);
  assert.throws(() => api.writeHistory([{ payload: "文".repeat(3 * 1024 * 1024) }]), /容量上限/);
  const failing = harness({ ...storage, GM_setValue: () => { throw new Error("quota"); } });
  assert.throws(() => failing.writeHistory([]), /quota/);
  assert.equal(storage.values.get("shuiyuanDeepSearch.history.v1"), before);
});

test("corrupt or future history is not overwritten; stale sessions cannot resurrect deletions", () => {
  const storage = memoryStorage();
  const api = harness(storage);
  storage.values.set("shuiyuanDeepSearch.history.v1", '{"version":2,"entries":[]}');
  assert.throws(() => api.saveHistory(historySession()), /格式不兼容/);
  assert.equal(JSON.parse(storage.values.get("shuiyuanDeepSearch.history.v1")).version, 2);
  storage.values.delete("shuiyuanDeepSearch.history.v1");
  const session = historySession();
  api.saveHistory(session);
  const stale = JSON.parse(JSON.stringify(session));
  api.saveHistory(session);
  assert.throws(() => api.saveHistory(stale), /其他页面/);
  api.deleteHistory(session.historyId);
  assert.equal(api.readHistory().length, 0);
  assert.throws(() => api.saveHistory(session), /删除/);
});

// Minimal DOM model: exercise rendering and event handlers without a browser.
class HistoryNode {
  constructor(tag = "div") { this.tag = tag; this.children = []; this.dataset = {}; this.events = {}; this.attributes = {}; this.hidden = false; this.value = ""; this.classList = { add() {} }; }
  appendChild(node) { this.children.push(node); return node; }
  append(...nodes) { nodes.forEach((node) => this.appendChild(node)); }
  get firstChild() { return this.children[0]; }
  removeChild(node) { this.children.splice(this.children.indexOf(node), 1); }
  set textContent(value) { this.children = []; this.content = value; }
  get textContent() { return (this.content || "") + this.children.map((node) => node.textContent).join(""); }
  setAttribute(key, value) { this.attributes[key] = value; if (key === "hidden") this.hidden = true; }
  removeAttribute(key) { delete this.attributes[key]; if (key === "hidden") this.hidden = false; }
  addEventListener(type, handler) { this.events[type] = handler; }
  focus() { this.focused = true; }
}

function historyUi(storage) {
  const api = harness({ ...storage, document: {
    createElement: (tag) => new HistoryNode(tag), createElementNS: (_ns, tag) => new HistoryNode(tag),
    createTextNode: (text) => { const node = new HistoryNode("text"); node.textContent = text; return node; }, addEventListener() {},
  } });
  api.configure({ surface: new HistoryNode() });
  api.buildUi();
  return api;
}

test("history UI restores report and cited turns offline, confirms deletion and guards active work", () => {
  const storage = memoryStorage();
  const api = historyUi(storage);
  const session = historySession();
  api.saveHistory(session);
  api.showHistory();
  assert.match(api.state.ui.history.textContent, /如何学习/);
  api.openHistory(session.historyId);
  assert.match(api.state.ui.output.textContent, /进一步说明/);
  assert.match(api.state.ui.output.textContent, /新回答|回答/);
  assert.equal(api.state.session.sources[0].id, "S1");
  assert.equal(api.state.ui.history.hidden, true);
  api.state.running = true;
  api.setRunning(true);
  assert.equal(api.state.ui.historyButton.disabled, true);
  api.deleteHistory(session.historyId);
  assert.equal(api.readHistory().length, 1);
  api.state.running = false;
  api.showHistory();
  const row = api.state.ui.history.children.at(-1);
  const remove = row.children[1];
  remove.events.click();
  assert.equal(api.readHistory().length, 1);
  assert.equal(remove.textContent, "确认删除");
  remove.events.click();
  assert.equal(api.readHistory().length, 0);
  assert.equal(api.state.session, null);
  assert.equal(api.state.ui.output.hidden, true);
});

test("save failure leaves the visible report and offers retry; unsafe stored links cannot open", () => {
  const storage = memoryStorage();
  let fail = true;
  const api = historyUi({ ...storage, GM_setValue: (key, value) => { if (fail) throw new Error("quota"); storage.GM_setValue(key, value); } });
  api.state.session = historySession();
  api.render(api.state.session);
  api.persistSession();
  assert.match(api.state.ui.output.textContent, /报告/);
  assert.equal(api.state.ui.retrySave.hidden, false);
  fail = false;
  api.state.ui.retrySave.events.click();
  assert.equal(api.state.ui.retrySave.hidden, true);
  const entries = api.readHistory();
  entries[0].session.sources[0].url = "javascript:alert(1)";
  api.writeHistory(entries);
  assert.throws(() => api.openHistory(entries[0].id), /来源无效/);
});

test("numeric-string topic IDs retain actual search hits without another search round", async () => {
  const api = harness();
  let calls = 0;
  api.configure({
    discourse: async () => searchResponse(["备考经验", "资料分享", "学习计划"]),
    model: async () => { calls += 1; return { topicIds: [" 1 ", "2", "3", "1"], queries: [] }; },
  });
  const results = await api.searchWithRecovery("考试备考", ["考试"], [], new Set(), () => {});
  assert.deepEqual(Array.from(results, (item) => item.id), [1, 2, 3]);
  assert.equal(calls, 1);
});

test("sparse searches expand in bounded rounds using observed clues and preserve provenance", async () => {
  const api = harness();
  const requests = [];
  const reviews = [];
  api.configure({
    discourse: async (url) => {
      const query = new URL(url, "https://example.test").searchParams.get("q");
      requests.push(query);
      if (query === "旧称") return searchResponse([]);
      if (query === "类别") return searchResponse(["正式名称 使用体验"]);
      return searchResponse(["正式名称 使用体验", "正式名称 选购", "正式名称 对比"]);
    },
    model: async (_system, input) => {
      reviews.push(JSON.parse(JSON.stringify(input)));
      return { topicIds: input.candidates.map((item) => item.topicId), queries: reviews.length === 1 ? ["旧称", "类别", "类别"] : ["正式名称"] };
    },
  });
  const history = [];
  const results = await api.searchWithRecovery("模糊对象", ["旧称"], history, new Set(), () => {});
  assert.deepEqual(requests, ["旧称", "类别", "正式名称"]);
  assert.equal(reviews[0].searches[0].count, 0);
  assert.equal(reviews[1].candidates[0].title, "正式名称 使用体验");
  assert.equal(reviews.length, 3, "screening and recovery share one model call per round");
  assert.equal(reviews[2].canExpand, false);
  assert.equal(results.length, 3);
  assert.deepEqual(Array.from(results[0].queries), ["类别", "正式名称"]);
  assert.equal(history.length, 3);
});

test("recovery stops after two rounds even when every search is empty", async () => {
  const api = harness();
  let searches = 0;
  let reviews = 0;
  api.configure({
    discourse: async () => { searches += 1; return searchResponse([]); },
    model: async () => ({ topicIds: [], queries: ["方向" + (++reviews)] }),
  });
  const results = await api.searchWithRecovery("对象", ["原词"], [], new Set(), () => {});
  assert.equal(results.length, 0);
  assert.equal(searches, 3);
  assert.equal(reviews, 2);
});

test("follow-up recovery counts only unseen topics and stops when the model has no new direction", async () => {
  const api = harness();
  let reviews = 0;
  api.configure({
    discourse: async () => searchResponse(["已有一", "已有二", "已有三"]),
    model: async () => { reviews += 1; return { topicIds: [], queries: [] }; },
  });
  await api.searchWithRecovery("追问", ["线索"], [], new Set([1, 2, 3]), () => {});
  assert.equal(reviews, 1);
});

test("successful searches need no expansion; request failures and cancellation do not become zero hits", async () => {
  const api = harness();
  api.configure({
    discourse: async () => searchResponse(["一", "二", "三"]),
    model: async (_system, input) => {
      if (input.candidates) return { topicIds: input.candidates.map((item) => item.topicId) };
      assert.fail("unexpected expansion");
    },
  });
  await api.searchWithRecovery("对象", ["关键词"], [], new Set(), () => {});
  api.configure({ discourse: async () => { throw new Error("HTTP 429"); } });
  await assert.rejects(api.searchWithRecovery("对象", ["关键词"], [], new Set(), () => {}), /429/);
  api.state.cancelled = true;
  await assert.rejects(api.searchWithRecovery("对象", ["关键词"], [], new Set(), () => {}), { name: "AbortError" });
});

test("irrelevant raw hits do not prevent recovery and relevance order is preserved", async () => {
  const api = harness();
  let searches = 0;
  let recoveries = 0;
  api.configure({
    discourse: async () => { searches += 1; return searchResponse(["品牌新闻", "产品使用", "读书记录", "产品收费"]); },
    model: async (_system, input) => {
      recoveries += 1;
      return { topicIds: searches === 1 ? [] : [4, 2, 4, 999, "1"], queries: recoveries === 1 ? ["对象 使用"] : [] };
    },
  });
  const result = await api.searchWithRecovery("对象", ["品牌"], [], new Set(), () => {});
  assert.equal(searches, 2);
  assert.equal(recoveries, 2);
  assert.deepEqual(Array.from(result, (item) => item.id), [4, 2, 1]);
});

test("unknown or malformed IDs cannot masquerade as an empty search", async () => {
  const api = harness();
  api.configure({
    discourse: async () => searchResponse(["备考经验"]),
    model: async () => ({ topicIds: ["1foo", "1.0", "1e0", true, null, 999], queries: [] }),
  });
  await assert.rejects(api.searchWithRecovery("考试", ["考试"], [], new Set(), () => {}), /ID 与搜索结果不符/);
});

test("all-rejected snippets get at most two provisional reads, excluding existing topics", async () => {
  const api = harness();
  let calls = 0;
  api.configure({
    discourse: async () => searchResponse(["主题一", "主题二", "主题三", "主题四"]),
    model: async () => { calls += 1; return { topicIds: [], queries: [] }; },
  });
  const results = await api.searchWithRecovery("考试", ["考试"], [], new Set([1]), () => {});
  assert.equal(calls, 1, "no additional model call for fallback reads");
  assert.equal(results.length, 2);
  assert.ok(results.every((item) => item.provisional && item.id !== 1));
  const evidence = api.evidence([{ title: "待核实", content: "正文", provisional: true }], [{ id: "S1" }]);
  assert.equal(evidence[0].provisional, true);
});

test("previously relevant topics survive an empty selection in a later recovery round", async () => {
  const api = harness();
  let calls = 0;
  api.configure({
    discourse: async () => searchResponse(["经验", "其他"]),
    model: async () => (++calls === 1 ? { topicIds: [1], queries: ["补充"] } : { topicIds: [], queries: [] }),
  });
  const results = await api.searchWithRecovery("考试", ["考试"], [], new Set(), () => {});
  assert.deepEqual(Array.from(results, (item) => item.id), [1]);
  assert.equal(results[0].provisional, undefined);
});

test("planning searches core terms independently of restrictive generated queries", async () => {
  const api = harness();
  api.configure({ model: async () => ({ coreTerms: ["考试中文名"], queries: ["考试 听力 阅读 写作 全套经验"], angles: ["方法"] }) });
  const plan = await api.planQuestion("ABC 如何备考？");
  assert.deepEqual(Array.from(plan.queries), ["ABC", "考试中文名", "考试 听力 阅读 写作 全套经验"]);
  assert.ok(plan.queries.length <= 6);
});

test("malformed relevance output fails explicitly instead of reading arbitrary topics", async () => {
  const api = harness();
  api.configure({
    discourse: async () => searchResponse(["一", "二", "三"]),
    model: async () => ({}),
  });
  await assert.rejects(api.searchWithRecovery("对象", ["词"], [], new Set(), () => {}), /筛选结果/);
});

test("a full batch of irrelevant topics cannot crowd out new recovery results", async () => {
  const api = harness();
  let searches = 0;
  let recoveries = 0;
  api.configure({
    discourse: async () => {
      searches += 1;
      return searches === 1 ? searchResponse(Array.from({ length: 40 }, (_, i) => "无关" + i)) : { topics: [{ id: 101, title: "对象体验" }], posts: [] };
    },
    model: async (_system, input) => {
      recoveries += 1;
      return { topicIds: input.candidates.filter((item) => item.topicId === 101).map((item) => item.topicId), queries: recoveries === 1 ? ["对象体验"] : [] };
    },
  });
  const result = await api.searchWithRecovery("对象", ["类别"], [], new Set(), () => {});
  assert.deepEqual(Array.from(result, (item) => item.id), [101]);
});

test("information goals reach gap review and reports while queries remain retrieval-only", async () => {
  const api = harness();
  const inputs = [];
  api.configure({ model: async (_system, input) => {
    inputs.push(input);
    if (inputs.length === 1) return { goal: "了解使用体验与费用", angles: ["使用体验", "费用"], queries: ["候选名称", "类别"] };
    return {};
  } });
  const plan = await api.planQuestion("模糊产品名");
  await api.reviewGaps("模糊产品名", plan, []);
  await api.makeReport("模糊产品名", plan, [], []);
  for (const input of inputs.slice(1)) {
    assert.equal(input.goal, "了解使用体验与费用");
    assert.deepEqual(Array.from(input.angles), ["使用体验", "费用"]);
    assert.equal(input.queries, undefined);
  }
});

test("screening bounds snippets and history without modifying stored candidates", async () => {
  const api = harness();
  const item = { id: 7, title: "产品", excerpt: "文".repeat(600), queries: new Set(["产品"]), position: 0, views: 1, replies: 0 };
  const history = Array.from({ length: 40 }, (_, i) => ({ query: "词" + i, count: 0 }));
  api.configure({ model: async (system, input) => {
    assert.ok(system.length < 300);
    assert.equal(input.candidates[0].excerpt.length, 240);
    assert.equal(input.searches.length, 18);
    return { topicIds: [7], queries: ["不得继续"] };
  } });
  const result = await api.selectRelevant("产品", {}, [item], history, false);
  assert.equal(result.queries.length, 0);
  assert.equal(item.excerpt.length, 600);
});

test("follow-up context is bounded while source evidence and saved conversation remain intact", () => {
  const api = harness();
  const session = {
    report: { summary: "文".repeat(5000), findings: Array.from({ length: 10 }, () => ({ detail: "文".repeat(5000), sourceIds: ["S1"] })) },
    conversation: Array.from({ length: 6 }, (_, i) => ({ question: "问题" + i, answer: "文".repeat(6000), sourceIds: ["S1"] })),
  };
  const context = api.conversationContext(session);
  assert.equal(context.report.summary.length, 1000);
  assert.equal(context.report.findings.length, 6);
  assert.equal(context.report.findings[0].detail.length, 300);
  assert.equal(context.priorConversation.length, 4);
  assert.equal(context.priorConversation[0].question, "问题2");
  assert.equal(context.priorConversation[0].answer.length, 600);
  assert.equal(session.conversation[0].answer.length, 6000);
  const docs = [{ title: "原帖", content: "证据".repeat(6000) }];
  assert.equal(api.evidence(docs, [{ id: "S1" }])[0].content, docs[0].content);
});

test("follow-up goals can switch to an explicit identity question without inheriting earlier angles", async () => {
  const api = harness();
  const question = "这两个名称是不是同一个产品？";
  api.configure({ model: async (_system, input) => {
    assert.equal(input.followupQuestion, question);
    return { goal: "核实两个名称的关系", angles: ["名称对应依据"], needsSearch: true, queries: ["名称对照"] };
  } });
  const plan = await api.planFollowup({ question: "产品", report: {}, conversation: [], documents: [], sources: [] }, question);
  assert.equal(plan.goal, "核实两个名称的关系");
  assert.equal(plan.needsSearch, true);
  assert.deepEqual(Array.from(plan.angles), ["名称对应依据"]);
});

test("launcher mounts before native search and tracks changing native dimensions", () => {
  let onResize;
  let width = 36;
  let iconSize = 20;
  const properties = new Map();
  const icon = { getBoundingClientRect: () => ({ width: iconSize, height: iconSize }) };
  const item = { parentElement: {}, insertAdjacentElement(position, host) {
    assert.equal(position, "beforebegin"); host.nextElementSibling = item;
  } };
  const native = {
    matches: () => true, closest: () => item, querySelector: () => icon,
    getBoundingClientRect: () => ({ width, height: width }),
  };
  const host = { hidden: true };
  const api = harness({
    document: { querySelector: () => native, documentElement: {} },
    getComputedStyle: () => ({ color: "rgb(100, 100, 100)" }),
    ResizeObserver: class { constructor(callback) { onResize = callback; } disconnect() {} observe() {} },
    MutationObserver: class { observe() {} },
  });
  api.configure({ host, button: { style: { setProperty: (key, value) => properties.set(key, value) } } });
  api.mountLauncher();
  assert.equal(host.hidden, false);
  assert.equal(properties.get("--sds-launch-width"), "36px");
  assert.equal(properties.get("--sds-icon-width"), "20px");
  width = 44; iconSize = 28; onResize();
  assert.equal(properties.get("--sds-launch-width"), "44px");
  assert.equal(properties.get("--sds-icon-height"), "28px");
  assert.equal(properties.get("--sds-launch-color"), "rgb(100, 100, 100)");
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
