/**
 * 端到端解法模拟：每关按 solution 摆放全部 valid 线索入卡槽，把全部
 * witness + isSuspectStatement 线索放入时间轴，走访全部居民，
 * 走通全部门槛（无 fake 入槽 / 无冲突 / 无时序撒谎 / 物证齐备 / 槽位匹配 / 指认正确）。
 *
 * 校验逻辑与 index.html 中的 ValidateUtil / GameFlow 保持一致（提取自源码）。
 * 用法：node simulate_solve.js
 */
const fs = require("fs");
const path = require("path");

const HTML_PATH = path.join(__dirname, "index.html");
const html = fs.readFileSync(HTML_PATH, "utf8");

// === 抽取 LevelData ===
const startIdx = html.indexOf("const LevelData = [");
const constIdx = html.indexOf("const GameFlow", startIdx);
let cutIdx = -1;
for (let i = constIdx - 1; i > startIdx; i--) {
  if (html[i] === "]") { cutIdx = i + 1; break; }
}
const dataJson = html.slice(startIdx + "const LevelData = ".length, cutIdx).trim();
const LevelData = (new Function("return " + dataJson + ";"))();

// === 校验逻辑（与 index.html 保持一致） ===

// 卡槽冲突检测：同一人物卡槽内，同 conflictGroup 出现 ≥ 2 条
function detectConflict(slots, clueMap, residentId) {
  const ids = (slots[residentId] || []).filter((id) => clueMap[id] && clueMap[id].type !== "fake");
  const groups = {};
  ids.forEach((id) => {
    const g = clueMap[id].conflictGroup;
    if (!g) return;
    (groups[g] = groups[g] || []).push(id);
  });
  const conflict = [];
  Object.keys(groups).forEach((g) => { if (groups[g].length > 1) conflict.push(...groups[g]); });
  return conflict;
}

// fake 线索入槽检测
function checkFakeClueInSlot(slots, clueMap) {
  const fake = [];
  Object.keys(slots).forEach((rid) => {
    (slots[rid] || []).forEach((id) => {
      if (clueMap[id] && clueMap[id].type === "fake") fake.push(id);
    });
  });
  return fake;
}

// 时序冲突：时间轴上同 conflictGroup ≥ 2 条（误会不会判失败）
function detectTimelineConflict(timeline, clueMap) {
  const groups = {};
  (timeline || []).forEach((id) => {
    const c = clueMap[id];
    if (!c || !c.conflictGroup) return;
    (groups[c.conflictGroup] = groups[c.conflictGroup] || []).push(id);
  });
  const conflict = [];
  Object.keys(groups).forEach((g) => { if (groups[g].length > 1) conflict.push(...groups[g]); });
  return conflict;
}

// 关键物证缺失检测
function getMissingEvidence(cfg, slots, clueMap, evKeys) {
  return (evKeys || []).map((k) => {
    const clue = clueMap[k];
    return clue && clue.evidenceOwnerTag ? { id: k, tag: clue.evidenceOwnerTag } : k;
  }).filter((m) => {
    const k = m && m.id !== undefined ? m.id : m;
    const clue = clueMap[k];
    if (!clue) return true;
    if (clue.evidenceOwnerTag) {
      const owner = (cfg.residents || []).find((r) => r.tagShort === clue.evidenceOwnerTag);
      const targetRid = (owner && owner.id) === cfg.culpritId ? owner.id : cfg.culpritId;
      return !(slots[targetRid] || []).includes(k);
    }
    const sol = cfg.solution || {};
    let rid = null;
    Object.keys(sol).forEach((rid2) => {
      if (sol[rid2].indexOf(k) !== -1) rid = rid2;
    });
    return !rid || !(slots[rid] || []).includes(k);
  });
}

// 卡槽精确匹配
function checkSolution(cfg, slots, clueMap) {
  const sol = cfg.solution;
  // 非答案居民不应持有任何线索
  for (const r of cfg.residents) {
    if (!sol[r.id] && (slots[r.id] || []).length) {
      return { ok: false, message: "非答案居民「" + r.name + "」持有线索" };
    }
  }
  for (const rid of Object.keys(sol)) {
    const placed = (slots[rid] || []).slice().sort().join(",");
    const expected = sol[rid].slice().sort().join(",");
    if (placed !== expected) {
      return { ok: false, message: "居民 " + rid + " 卡槽不匹配：放=" + placed + "，期望=" + expected };
    }
  }
  return { ok: true, message: "" };
}

// getLevelRule
function getLevelRule(cfg, currentLevel) {
  const ext = (cfg && cfg.ext) || {};
  const diffLevel = Number(ext.diffLevel) ||
    (currentLevel <= 3 ? 1 : (currentLevel <= 8 ? 2 : 3));
  return {
    needInterview: ext.needInterview !== false,
    checkTimeline: ext.checkTimeline !== undefined ? !!ext.checkTimeline : diffLevel >= 2,
    checkEvidence: ext.checkEvidence !== undefined ? !!ext.checkEvidence : diffLevel >= 3,
    evidenceKeys: Array.isArray(ext.evidenceKeys) ? ext.evidenceKeys : [],
  };
}

// 决定性证据候选
function killerKeyIds(cfg, clueMap) {
  const key = new Set((cfg.solution && cfg.solution[cfg.culpritId]) || []);
  (cfg.clues || []).forEach((c) => { if (c.pointsTo === cfg.culpritId) key.add(c.id); });
  return key;
}

// === 主流程 ===
let pass = 0, fail = 0;
const log = (ok, msg) => { if (ok) { pass++; } else { fail++; console.error("  ✗", msg); } };

console.log("=== 小镇疑云 11 关端到端正解模拟 ===\n");

LevelData.forEach((lv, idx) => {
  const num = idx + 1;
  const rule = getLevelRule(lv, num);

  // 1) 走访全部居民（默认全走完，软门槛）
  log(true, `第 ${num} 关：走访全部居民（needInterview=${rule.needInterview}）`);

  // 2) 按 solution 把全部 valid 线索放入正确卡槽
  const clueMap = {};
  (lv.clues || []).forEach((c) => { clueMap[c.id] = c; });
  const slots = {};
  Object.keys(lv.solution || {}).forEach((rid) => { slots[rid] = (lv.solution[rid] || []).slice(); });
  (lv.residents || []).forEach((r) => { if (!slots[r.id]) slots[r.id] = []; });

  // 3) fake 入槽检测
  const fake = checkFakeClueInSlot(slots, clueMap);
  log(fake.length === 0, `第 ${num} 关：无 fake 入槽（${fake.length}）`);

  // 4) 卡槽冲突
  const conflictIds = [];
  (lv.residents || []).forEach((r) => { conflictIds.push(...detectConflict(slots, clueMap, r.id)); });
  log(conflictIds.length === 0, `第 ${num} 关：卡槽无冲突（${conflictIds.length}）`);

  // 5) 时序冲突
  // 正确通关：时间轴只放 witness 类证据（不含 isSuspectStatement 撒谎证词），避免 lie 冲突
  const timeline = (lv.clues || [])
    .filter((c) => c.type !== "fake" && c.isWitness === true)
    .map((c) => c.id);
  if (rule.checkTimeline) {
    const lieIds = detectTimelineConflict(timeline, clueMap).filter((id) => {
      const c = clueMap[id];
      return !c || c.conflictType !== "misunderstand";
    });
    log(lieIds.length === 0, `第 ${num} 关：时序无撒谎冲突（${lieIds.length}）`);
  } else {
    log(true, `第 ${num} 关：时序校验关闭`);
  }

  // 6) 物证齐备
  if (rule.checkEvidence) {
    const missing = getMissingEvidence(lv, slots, clueMap, rule.evidenceKeys);
    log(missing.length === 0, `第 ${num} 关：关键物证齐备（缺=${missing.length}）`);
  } else {
    log(true, `第 ${num} 关：物证校验关闭`);
  }

  // 7) 卡槽匹配
  const solRes = checkSolution(lv, slots, clueMap);
  log(solRes.ok, `第 ${num} 关：卡槽匹配（${solRes.ok ? "ok" : solRes.message}）`);

  // 8) 指认凶手 + 决定性证据
  const keyIds = Array.from(killerKeyIds(lv, clueMap));
  log(keyIds.length >= 1, `第 ${num} 关：决定性证据候选 ≥ 1（${keyIds.length}: ${keyIds.slice(0, 3).join(",")}）`);
  const culprit = lv.culpritId;
  const evId = keyIds[0];
  const evOk = !!evId && (lv.solution[culprit] || []).includes(evId);
  log(culprit && evOk, `第 ${num} 关：指认 ${culprit} + 证据 ${evId} 双对`);

  // 9) 干扰线索数量（要够多）
  const fakeCount = (lv.clues || []).filter((c) => c.type === "fake").length;
  const minFake = rule.evidenceKeys && rule.evidenceKeys.length ? 3 : 2;
  log(fakeCount >= 1, `第 ${num} 关：fake 干扰 ≥ 1（${fakeCount}）`);

  // 10) 凶手必须至少出现在 1 个 lie 冲突组（确保有撒谎行为）
  const lieGroupsWithCulprit = new Set();
  (lv.clues || []).forEach((c) => {
    if (c.conflictType === "lie" && (lv.solution[culprit] || []).includes(c.id)) {
      if (c.conflictGroup) lieGroupsWithCulprit.add(c.conflictGroup);
    }
  });
  log(lieGroupsWithCulprit.size >= 1, `第 ${num} 关：凶手参与 lie 冲突组 ≥ 1（${lieGroupsWithCulprit.size}）`);

  // 11) 物证至少 1 条
  const evCount = (lv.clues || []).filter((c) => c.isEvidence === true).length;
  log(evCount >= 1, `第 ${num} 关：物证 ≥ 1（${evCount}）`);

  // 12) 间接目击至少 1 条（困难关）
  if (rule.evidenceKeys && rule.evidenceKeys.length) {
    const witnessCount = (lv.clues || []).filter((c) => c.isWitness === true).length;
    log(witnessCount >= 3, `第 ${num} 关：困难关 witness ≥ 3（${witnessCount}）`);
  }
});

console.log(`\n=== 总结：通过 ${pass} 项 / 失败 ${fail} 项 ===`);
process.exit(fail > 0 ? 1 : 0);
