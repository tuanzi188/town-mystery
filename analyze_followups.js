/**
 * 追问价值分析：把 85 条追问按"对推理的贡献"分类
 * 不再用 _categoryOf（已删除），改为基于 cids 线索 schema 直接判定
 * 判定标准：cids 包含 isEvidence / isWitness / isSuspectStatement / conflictGroup 之一 → 推进推理
 * 用法：node analyze_followups.js
 */
const fs = require("fs");
const path = require("path");
const HTML_PATH = path.join(__dirname, "index.html");
const TOWN_PATH = path.join(__dirname, "town_data.js");
const html = fs.readFileSync(HTML_PATH, "utf8");
const scriptStart = html.indexOf("<script>") + "<script>".length;
const scriptEnd = html.lastIndexOf("</script>");
const scriptCode = html.slice(scriptStart, scriptEnd);
const townSrc = fs.readFileSync(TOWN_PATH, "utf8");

function makeEl() {
  return { innerHTML: "", value: "", dataset: {}, style: {}, _listeners: {},
    addEventListener() {}, removeEventListener() {}, appendChild() {}, removeChild() {},
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} } };
}
const documentMock = { addEventListener() {}, removeEventListener() {}, body: makeEl(),
  createElement: () => makeEl(), createElementNS: () => makeEl(), elementFromPoint: () => null,
  getElementById: () => makeEl(), querySelector: () => null, querySelectorAll: () => [] };
const localStorageMock = (() => {
  const s = {};
  return { getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); },
    removeItem: (k) => { delete s[k]; }, clear: () => { Object.keys(s).forEach((k) => delete s[k]); } };
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
return { App, LevelData, GameFlow, StorageUtil, DialogSystem, TOWN_FOLLOWUPS };
`;
const ctx = new Function(wrapped)(documentMock, windowMock, localStorageMock, CSSMock, () => {}, { userAgent: "analyze" });
const { LevelData, TOWN_FOLLOWUPS } = ctx;

const counts = { advance: 0, sideinfo: 0, total: 0 };
const details = { advance: [], sideinfo: [] };

LevelData.forEach((lv, idx) => {
  const num = idx + 1;
  const clueMap = {};
  (lv.clues || []).forEach((c) => { clueMap[c.id] = c; });
  (lv.residents || []).forEach((r) => {
    const fkey = "L" + num + "_" + r.id;
    const list = TOWN_FOLLOWUPS[fkey];
    if (!list) return;
    list.forEach((fu) => {
      counts.total++;
      const clues = (fu.cids || []).map((cid) => clueMap[cid]).filter(Boolean);
      // 推进推理：cids 至少一条含 isEvidence/isWitness/isSuspectStatement/conflictGroup
      const isAdvance = clues.some((c) => c.isEvidence || c.isWitness || c.isSuspectStatement || c.conflictGroup);
      if (isAdvance) {
        counts.advance++;
        details.advance.push(`L${num} ${r.name}: ${fu.q.slice(0, 30)}`);
      } else {
        counts.sideinfo++;
        details.sideinfo.push(`L${num} ${r.name}: ${fu.q.slice(0, 30)} → [${(fu.cids || []).join(",")}]`);
      }
    });
  });
});

console.log("=== 追问价值分布（不显示角标后的隐藏价值分析）===\n");
console.log("  推进推理（cids 含 isEvidence/isWitness/isSuspectStatement/conflictGroup）: " + counts.advance);
console.log("  旁证/补完（看似有用但实际不能推进推理）                              : " + counts.sideinfo);
console.log("  ───────────────────────────────");
console.log("  合计                                                                  : " + counts.total);
console.log("  推进率                                                                : " + Math.round((counts.advance / counts.total) * 100) + "%");
console.log("  旁证率                                                                : " + Math.round((counts.sideinfo / counts.total) * 100) + "%");
console.log("\n设计目标：旁证率约 40%（40% 的追问让玩家白问，靠自己分析判断）");
