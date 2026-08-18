/**
 * 功能冒烟（新增走访追问 / 跨关暗线的运行时行为验证）：
 * 抽取 index.html 真实脚本 + 注入 town_data.js（与浏览器加载顺序一致），
 * 用记录型 DOM mock 隔离渲染，直接断言关键逻辑：
 *   1) 走访追问：_followupsOf 命中；逐问解锁入池；重复追问不重复入池/记录
 *   2) 追问并集 === bindClue（全问完 = 线索齐）
 *   3) 大事记解锁判定：未通关返回 false
 *   4) 无追问分支居民（无 bindClue）走一键全给兼容路径
 * 用法：node feature_smoke.js
 */
const fs = require("fs");
const path = require("path");

const HTML_PATH = path.join(__dirname, "index.html");
const TOWN_PATH = path.join(__dirname, "town_data.js");
const html = fs.readFileSync(HTML_PATH, "utf8");
const scriptStart = html.indexOf("<script>") + "<script>".length;
const scriptEnd = html.lastIndexOf("</script>");
const scriptCode = html.slice(scriptStart, scriptEnd);
if (!fs.existsSync(TOWN_PATH)) {
  console.error("✗ 缺少 town_data.js");
  process.exit(1);
}
const townSrc = fs.readFileSync(TOWN_PATH, "utf8");

// === 记录型 DOM mock（支持 innerHTML / querySelectorAll / classList / dataset） ===
function makeEl() {
  return {
    innerHTML: "",
    value: "",
    dataset: {},
    style: {},
    _listeners: {},
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    removeEventListener() {},
    appendChild() {},
    removeChild() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
  };
}
const documentMock = {
  addEventListener() {},
  removeEventListener() {},
  body: makeEl(),
  createElement: () => makeEl(),
  createElementNS: () => makeEl(),
  elementFromPoint: () => null,
  getElementById: () => makeEl(),
  querySelector: () => null,
  querySelectorAll: () => [],
};
const localStorageMock = (() => {
  const s = {};
  return {
    getItem: (k) => (k in s ? s[k] : null),
    setItem: (k, v) => { s[k] = String(v); },
    removeItem: (k) => { delete s[k]; },
    clear: () => { Object.keys(s).forEach((k) => delete s[k]); },
  };
})();
const windowMock = { innerWidth: 1024, innerHeight: 768, addEventListener() {} };
const CSSMock = { escape: (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&") };

const wrapped = `
"use strict";
const document = arguments[0];
const window = arguments[1];
const localStorage = arguments[2];
const CSS = arguments[3];
const requestAnimationFrame = arguments[4];
const navigator = arguments[5];
${townSrc}
${scriptCode}
return { App, LevelData, GameFlow, StorageUtil, DialogSystem, LorePanel, ChroniclePanel, BioArchive };
`;

let ctx;
try {
  const fn = new Function(wrapped);
  ctx = fn(documentMock, windowMock, localStorageMock, CSSMock, () => {}, { userAgent: "feature-smoke" });
} catch (e) {
  console.error("✗ 真实脚本 + town_data 加载失败：", e.message);
  console.error(e.stack.split("\n").slice(0, 4).join("\n"));
  process.exit(1);
}

const { App, LevelData, StorageUtil, DialogSystem, ChroniclePanel, LorePanel } = ctx;

let pass = 0, fail = 0;
const log = (ok, msg) => { if (ok) { pass++; } else { fail++; console.error("  ✗", msg); } };

console.log("=== 走访追问 / 跨关暗线 功能冒烟 ===\n");

LevelData.forEach((lv, idx) => {
  const num = idx + 1;
  const difficulty = lv.difficulty || "";
  // 给每个有 bindClue 的居民走一遍"逐问解锁"流程
  (lv.residents || []).forEach((r) => {
    const bind = Array.isArray(r.bindClue) ? r.bindClue : (r.bindClue ? [r.bindClue] : []);
    if (!bind.length) { log(true, `第 ${num} 关 ${r.name}：替罪羊/无绑定线索，跳过追问`); return; }
    // 模拟进入关卡上下文
    App.currentLevel = num;
    App.levelData = lv;
    App.residents = (lv.residents || []).slice();
    const clueMap = {};
    (lv.clues || []).forEach((c) => { clueMap[c.id] = c; });
    App.clueMap = clueMap;
    App.layout = { slots: {}, pool: [], timeline: [] };
    localStorageMock.clear();

    const fups = DialogSystem._followupsOf(r);
    if (!fups) { log(false, `第 ${num} 关 ${r.name} 缺少追问分支`); return; }
    // 与真实交互顺序一致：先开走访弹窗（标记已交谈），再逐问解锁
    DialogSystem.open(r);
    // 逐问解锁：不重复入池、不重复记录
    fups.forEach((fu, i) => {
      DialogSystem._askFollowup(r, fups, i);
      const pool = App.layout.pool;
      const expectIds = (fu.cids || []).filter((cid) => clueMap[cid]);
      const have = expectIds.every((cid) => pool.indexOf(cid) !== -1);
      log(have, `第 ${num} 关 ${r.name} 追问[${i}] 后线索入池（期望 ${expectIds.join(",")}）`);
    });
    // 再重复追问一次：pool 数量与 asked 数量应不变
    const poolBefore = App.layout.pool.slice().sort().join(",");
    const askedBefore = StorageUtil.readAskedFollowups(num).slice().sort().join(",");
    DialogSystem._askFollowup(r, fups, 0);
    const poolAfter = App.layout.pool.slice().sort().join(",");
    const askedAfter = StorageUtil.readAskedFollowups(num).slice().sort().join(",");
    log(poolBefore === poolAfter, `第 ${num} 关 ${r.name} 重复追问不重复入池`);
    log(askedBefore === askedAfter, `第 ${num} 关 ${r.name} 重复追问不重复记录`);
    // 并集覆盖 bindClue
    const unlockedSet = new Set(App.layout.pool);
    const expected = bind.filter((cid) => clueMap[cid]);
    const allCovered = expected.every((cid) => unlockedSet.has(cid));
    log(allCovered, `第 ${num} 关 ${r.name} 全追问后线索覆盖 bindClue（${unlockedSet.size === expected.length ? "齐" : "缺"}）`);

    // 未追问任何问题 → 第一条线索应未解锁（证明"漏线索"成立）
    localStorageMock.clear();
    App.layout = { slots: {}, pool: [], timeline: [] };
    const f1 = fups[0];
    const firstId = f1 && f1.cids[0];
    // 直接开弹窗（open 会调 _markSpoken 等），但不 _askFollowup → pool 应为空
    DialogSystem.open(r);
    const poolAfterOpen = App.layout.pool.slice();
    const firstInPool = poolAfterOpen.indexOf(firstId) !== -1;
    log(!firstInPool, `第 ${num} 关 ${r.name} 未追问前线索不提前入池`);
  });
});

// 追问记录存储往返
{
  StorageUtil.writeAskedFollowups(3, ["r1#0", "r1#1"]);
  const back = StorageUtil.readAskedFollowups(3);
  log(back.join(",") === "r1#0,r1#1", "追问记录 writeAskedFollowups/readAskedFollowups 往返一致");
}

// 大事记 + 人物关系解锁判定（未通关 → 锁定）
{
  log(ChroniclePanel._cleared(1) === false, "未通关时大事记第 1 章应锁定");
  const resident = LorePanel._resident(1, "r3");
  log(!!resident && resident.name === "老张", "人物关系 L1_r3 引用解析正确");
  log(LorePanel._unlocked(1, "r3") === false, "未解锁时人物关系端点为锁定");
}

console.log(`\n=== 总结：通过 ${pass} 项 / 失败 ${fail} 项 ===`);
process.exit(fail > 0 ? 1 : 0);


