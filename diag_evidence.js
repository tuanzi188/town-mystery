/**
 * 精确诊断：按 index.html 中 _getMissingEvidence 的判定逻辑，找出每关缺失的物证。
 * 与游戏运行时完全一致。
 */
const fs = require("fs");
const path = require("path");

const HTML_PATH = path.join(__dirname, "index.html");
const html = fs.readFileSync(HTML_PATH, "utf8");

const startIdx = html.indexOf("const LevelData = [");
const constIdx = html.indexOf("const GameFlow", startIdx);
let cutIdx = -1;
for (let i = constIdx - 1; i > startIdx; i--) {
  if (html[i] === "]") { cutIdx = i + 1; break; }
}
const dataJson = html.slice(startIdx + "const LevelData = ".length, cutIdx).trim();
const LevelData = (new Function("return " + dataJson + ";"))();

console.log("=== 物证缺失精确诊断（与游戏判定一致）===\n");

let totalMissing = 0;
LevelData.forEach((lv, idx) => {
  const num = idx + 1;
  const evKeys = (lv.ext && lv.ext.evidenceKeys) || [];
  if (!evKeys.length) return;
  const clueMap = {};
  (lv.clues || []).forEach((c) => { clueMap[c.id] = c; });
  const slots = {};
  Object.keys(lv.solution || {}).forEach((rid) => { slots[rid] = (lv.solution[rid] || []).slice(); });

  const missing = evKeys.map((k) => {
    const clue = clueMap[k];
    return clue && clue.evidenceOwnerTag ? { id: k, tag: clue.evidenceOwnerTag } : k;
  }).filter((m) => {
    const k = m && m.id !== undefined ? m.id : m;
    const clue = clueMap[k];
    if (!clue) return true;
    if (clue.evidenceOwnerTag) {
      const owner = (lv.residents || []).find((r) => r.tagShort === clue.evidenceOwnerTag);
      const targetRid = (owner && owner.id) === lv.culpritId ? owner.id : lv.culpritId;
      return !(slots[targetRid] || []).includes(k);
    }
    const sol = lv.solution || {};
    let rid = null;
    Object.keys(sol).forEach((rid2) => {
      if (sol[rid2].indexOf(k) !== -1) rid = rid2;
    });
    return !rid || !(slots[rid] || []).includes(k);
  });

  if (missing.length) {
    totalMissing += missing.length;
    console.log(`第 ${num} 关 ${lv.title}：${missing.length} 项缺失`);
    missing.forEach((m) => {
      const k = m && m.id !== undefined ? m.id : m;
      const clue = clueMap[k];
      console.log(`  - ${k}：${clue ? clue.text.slice(0, 30) + "..." : "(不存在)"}`);
      console.log(`    evidenceOwnerTag="${clue ? clue.evidenceOwnerTag || "无" : "?"}"`);
    });
  }
});

console.log(`\n=== 共 ${totalMissing} 项缺失 ===`);
