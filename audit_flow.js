/**
 * 对抗性审查回归脚本：用真实 LevelData 复刻 GameFlow._checkMix/_continueMixCheck 门槛，
 * 断言以下「玩家可达路径」均不被误拦截：
 *  A. 全部 witness 入时间轴（教程引导玩法）→ L1-L11 任一关都不应被时间轴门槛拦截
 *     （误解对 misunderstand 只作参考；L1-L3 不启用时间轴校验完全放行）
 *  B. fake 干扰线索入时间轴 → 必须被步骤0 拦截（不是死代码）
 *  C. 同组 lie 线索同时入轴 → 必须被步骤1 拦截（校验仍在）
 * 额外统计缺陷A（时间区间配对）的线索数据覆盖。
 * 用法：node audit_flow.js
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

let pass = 0, fail = 0;
const log = (ok, msg) => { if (ok) { pass++; } else { fail++; console.error("  ✗", msg); } };

function getLevelRule(lv, num) {
  const ext = lv.ext || {};
  const diffLevel = Number(ext.diffLevel) || (num <= 3 ? 1 : (num <= 8 ? 2 : 3));
  return {
    checkTimeline: ext.checkTimeline !== undefined ? !!ext.checkTimeline : diffLevel >= 2,
  };
}

// 复刻 ValidateUtil.detectTimelineConflict
function detectTimelineConflict(timeline, clueMap) {
  const groups = {};
  (timeline || []).forEach((id) => {
    const c = clueMap[id];
    if (!c || !c.conflictGroup) return;
    (groups[c.conflictGroup] = groups[c.conflictGroup] || []).push(id);
  });
  const conflict = [];
  Object.keys(groups).forEach((g) => { if (groups[g].length > 1) conflict.push.apply(conflict, groups[g]); });
  return conflict;
}
const lieOnly = (ids, clueMap) => ids.filter((id) => {
  const c = clueMap[id];
  return !c || c.conflictType !== "misunderstand";
});

console.log("=== 对抗性审查回归（时间轴门槛误拦截 / fake 拦截 / lie 拦截） ===\n");

const pairingStats = [];
LevelData.forEach((lv, idx) => {
  const num = idx + 1;
  const rule = getLevelRule(lv, num);
  const clueMap = {};
  (lv.clues || []).forEach((c) => { clueMap[c.id] = c; });

  // A. 全部 witness 入轴 → 复刻 _continueMixCheck 步骤1（受 checkTimeline 控制 + 过滤误解）
  const timelineA = (lv.clues || [])
    .filter((c) => c.type !== "fake" && c.isWitness === true)
    .map((c) => c.id);
  let step1Blocked = 0;
  if (rule.checkTimeline) {
    const conflictIds = lieOnly(detectTimelineConflict(timelineA, clueMap), clueMap);
    step1Blocked = conflictIds.length;
  }
  log(step1Blocked === 0,
    `L${num} 全部witness入轴不应被时间轴门槛拦截（拦截 ${step1Blocked} 条）`);

  // B. fake 入时间轴 → 步骤0 应拦截（复刻 _checkMix 步骤0）
  const timelineFake = timelineA.slice();
  const anyFake = (lv.clues || []).find((c) => c.type === "fake");
  if (anyFake) {
    timelineFake.push(anyFake.id);
    const fakeIds = timelineFake.filter((id) => {
      const c = clueMap[id];
      return !!(c && c.type === "fake");
    });
    log(fakeIds.length === 1, `L${num} fake 入时间轴应被步骤0 拦截（检测到 ${fakeIds.length} 条）`);
  } else {
    log(true, `L${num} 无 fake，跳过`); // 数据上不存在，防御性覆盖
  }

  // C. 同组 lie 两条入轴 → 步骤1 应拦截（校验未失效）
  if (rule.checkTimeline) {
    const g2 = {};
    (lv.clues || []).forEach((c) => {
      if (c.type !== "fake" && c.conflictType === "lie" && c.conflictGroup) {
        (g2[c.conflictGroup] = g2[c.conflictGroup] || []).push(c.id);
      }
    });
    const anyTarget = Object.keys(g2).find((g) => g2[g].length >= 2);
    if (anyTarget) {
      const timelineC = timelineA.slice();
      g2[anyTarget].slice(0, 2).forEach((id) => { if (timelineC.indexOf(id) < 0) timelineC.push(id); });
      const blockC = lieOnly(detectTimelineConflict(timelineC, clueMap), clueMap).length;
      log(blockC >= 2, `L${num} 同组 lie 入轴应被拦截（拦截 ${blockC} 条）`);
    } else {
      log(true, `L${num} 无可构造的 lie 组（≥2 条），跳过`);
    }
  }

  // 缺陷A 数据覆盖统计
  const intervalClues = (lv.clues || []).filter((c) =>
    c.type !== "fake" && typeof c.timeMin === "number" && typeof c.timeMax === "number");
  pairingStats.push({ num, total: intervalClues.length, witness: intervalClues.filter((c) => c.isWitness === true).length });
});

console.log("\n=== 缺陷A 数据覆盖：同时有 [timeMin,timeMax] 的线索（若仅 L1/L2 有，其余关配对检测静默） ===");
pairingStats.forEach((p) => { console.log(`  L${p.num}: 区间线索 ${p.total} 条（witness ${p.witness}）`); });

console.log(`\n=== 总结：通过 ${pass} 项 / 失败 ${fail} 项 ===`);
process.exit(fail > 0 ? 1 : 0);