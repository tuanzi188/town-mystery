// 缺陷 A 单元测试：detectTimeRangePairing 在各关应输出预期结果
const fs = require("fs");
const path = require("path");
const HTML_PATH = path.join(__dirname, "index.html");
const html = fs.readFileSync(HTML_PATH, "utf8");
const scriptStart = html.indexOf("<script>") + "<script>".length;
const scriptEnd = html.lastIndexOf("</script>");
const scriptCode = html.slice(scriptStart, scriptEnd);

function makeStub() {
  const stub = {};
  ["addEventListener", "removeEventListener", "appendChild", "removeChild", "classList", "setAttribute", "getAttribute", "hasAttribute", "dataset", "style", "parentNode"].forEach((k) => {
    if (k === "classList") stub.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
    else if (k === "dataset") stub.dataset = {};
    else if (k === "style") stub.style = {};
    else if (k === "parentNode") stub.parentNode = null;
    else stub[k] = () => {};
  });
  stub.cloneNode = () => makeStub();
  stub.closest = () => null;
  stub.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });
  stub.querySelector = () => null;
  stub.querySelectorAll = () => [];
  return stub;
}
const documentMock = {
  addEventListener() {}, removeEventListener() {}, body: makeStub(),
  createElement: () => makeStub(), createElementNS: () => makeStub(),
  elementFromPoint: () => null, getElementById: () => makeStub(),
  querySelector: () => null, querySelectorAll: () => [],
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
const wrapped = [
  '"use strict";',
  'const document = arguments[0];',
  'const window = arguments[1];',
  'const localStorage = arguments[2];',
  'const CSS = arguments[3];',
  'const requestAnimationFrame = arguments[4];',
  'const navigator = arguments[5];',
  scriptCode,
  'return { App, LevelData, ValidateUtil };',
].join("\n");
const fn = new Function(wrapped);
const ctx = fn(documentMock, { innerWidth: 1024, innerHeight: 768, addEventListener() {} }, localStorageMock, { escape: (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&") }, () => {}, { userAgent: "test" });
const { App: A, LevelData, ValidateUtil } = ctx;

let pass = 0, fail = 0;
const log = (ok, msg) => { if (ok) { pass++; } else { fail++; console.error("  ✗", msg); } };

console.log("=== detectTimeRangePairing 单元测试 ===\n");

// 场景 1: L1 把 c2, c3, c5 全部入时间轴（区间均重叠）
{
  const lv = LevelData[0];
  A.levelData = lv;
  A.residents = lv.residents.slice();
  const cm = {};
  lv.clues.forEach((c) => { cm[c.id] = c; });
  A.clueMap = cm;
  A.layout = { slots: {}, pool: [], timeline: ["c2", "c3", "c5"] };
  const r = ValidateUtil.detectTimeRangePairing(lv);
  // c2 6:14-6:16, c3 6:10-6:20, c5 6:05-6:30 都关于老张（involve 或 solution 映射 r3）
  // 三条都重叠 → overlap 应有 3 对
  console.log("L1 全部入时间轴 pairing:", JSON.stringify(r));
  log(r.overlap.length >= 1, `L1 overlap 应识别 c2/c3/c5 同时窗对（实际 ${r.overlap.length}）`);
  log(r.mutex.length === 0, `L1 不应有 mutex 对（实际 ${r.mutex.length}）`);
}

// 场景 2: L1 只入 c2 (374-376) + 模拟一条 6:30-6:35 的新线索（mutex）
{
  const lv = LevelData[0];
  A.levelData = lv;
  A.residents = lv.residents.slice();
  const cm = {};
  lv.clues.forEach((c) => { cm[c.id] = c; });
  // 注入一条临时线索：6:30-6:35, pointsTo: r3（也涉及老张）
  cm.cMock = { id: "cMock", timeMin: 390, timeMax: 395, timeText: "6:30~6:35", pointsTo: "r3", type: "valid" };
  A.clueMap = cm;
  A.layout = { slots: {}, pool: [], timeline: ["c2", "cMock"] };
  const r = ValidateUtil.detectTimeRangePairing(lv);
  console.log("L1 c2 + cMock(6:30-6:35) pairing:", JSON.stringify(r));
  log(r.mutex.length === 1, `L1 c2 与 cMock 应识别为 mutex（实际 ${r.mutex.length}）`);
  log(r.mutex[0] && r.mutex[0].a === "c2" && r.mutex[0].b === "cMock", "mutex 对正确为 c2/cMock");
}

// 场景 3: L9（hard）evidence c9 已无 evidenceOwnerTag
{
  const lv = LevelData[8];
  const c9 = lv.clues.find((c) => c.id === "c9");
  log(!c9.evidenceOwnerTag, `L9 c9 evidenceOwnerTag 已移除（实际 ${c9.evidenceOwnerTag === undefined ? "undefined" : c9.evidenceOwnerTag}）`);
}

// 场景 4: L10 / L11 同样验证
{
  const lv10 = LevelData[9];
  const c9_10 = lv10.clues.find((c) => c.id === "c9");
  log(!c9_10.evidenceOwnerTag, `L10 c9 evidenceOwnerTag 已移除`);
  const lv11 = LevelData[10];
  const c9_11 = lv11.clues.find((c) => c.id === "c9");
  log(!c9_11.evidenceOwnerTag, `L11 c9 evidenceOwnerTag 已移除`);
}

// 场景 5: 普通关 (L4) evidenceOwnerTag 必须保留
{
  const lv4 = LevelData[3];
  const ev = lv4.clues.filter((c) => c.isEvidence);
  const allHaveTag = ev.every((c) => c.evidenceOwnerTag && c.evidenceOwnerTag.length);
  log(allHaveTag, `L4 全部物证 evidenceOwnerTag 保留（${ev.length} 条）`);
}

console.log(`\n=== 总结：通过 ${pass} 项 / 失败 ${fail} 项 ===`);
process.exit(fail > 0 ? 1 : 0);
