/**
 * 端到端正解模拟（真实路径版）：卡槽机制已下线，改为「线索池 + 时间轴 + 证据链」模型。
 * 对 11 关执行「正解玩家会做的操作」，并断言每关确实可通关：
 *   1. 走访全部居民 → 线索池 = bindClue ∪ 追问并集（真实获取路径）
 *   2. 把 witness 类证词放入时间轴 → 不应触发撒谎冲突
 *   3. 关键物证（evidenceKeys）必须 ⊆ 池∪时间轴（可被玩家拿到）
 *   4. 凶手自白线索必须 ⊆ 池∪时间轴（可被收集）
 *   5. 决定性证据（铁证）候选 ≥ 1，且至少 1 条在池中（可被 ⊕ 收集）
 *   6. 指认凶手 + 决定性证据双对
 *
 * 校验口径与运行时 GameFlow._getMissingEvidence / _killerKeyIds / detectTimelineConflict 一致。
 * 用法：node simulate_solve.js
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { extractLevelData } = require("./lib/extract");
const LevelData = extractLevelData();

// 走访追问并集（与运行时 DialogSystem._followupsOf 同源）：从 town_data.js 以 vm 读取
const townSandbox = {};
vm.createContext(townSandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "src", "town_data.js"), "utf8"), townSandbox);
const TOWN_FOLLOWUPS = townSandbox.TOWN_FOLLOWUPS || {};

// === 校验逻辑（与运行时 index.html / GameFlow 保持一致） ===

// 时序冲突：时间轴上同 conflictGroup ≥ 2 条
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

// getLevelRule（与 GameFlow.getLevelRule 一致）
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

// 决定性证据候选（与 GameFlow._killerKeyIds 一致）：
//   ① 凶手 solution 中 isEvidence=true 的物证；② pointsTo 凶手的 isEvidence 物证
function killerKeyIds(cfg, clueMap) {
  const key = new Set();
  ((cfg.solution && cfg.solution[cfg.culpritId]) || []).forEach((cid) => {
    const c = clueMap[cid];
    if (c && c.isEvidence === true) key.add(cid);
  });
  (cfg.clues || []).forEach((c) => {
    if (c.pointsTo === cfg.culpritId && c.isEvidence === true) key.add(c.id);
  });
  return key;
}

// 走访全部居民后的可达线索集合 = bindClue ∪ 追问 cids（真实获取路径）
function buildReachablePool(lv, num) {
  const pool = new Set();
  (lv.residents || []).forEach((r) => {
    (Array.isArray(r.bindClue) ? r.bindClue : (r.bindClue ? [r.bindClue] : [])).forEach((cid) => pool.add(cid));
    (TOWN_FOLLOWUPS["L" + num + "_" + r.id] || []).forEach((fu) => {
      (fu.cids || []).forEach((cid) => pool.add(cid));
    });
  });
  return pool;
}

// === 主流程 ===
let pass = 0, fail = 0;
const log = (ok, msg) => { if (ok) { pass++; } else { fail++; console.error("  ✗", msg); } };

console.log("=== 小镇疑云 11 关端到端正解模拟（真实路径） ===\n");

LevelData.forEach((lv, idx) => {
  const num = idx + 1;
  const rule = getLevelRule(lv, num);
  const clueMap = {};
  (lv.clues || []).forEach((c) => { clueMap[c.id] = c; });

  // 1) 走访全部居民（软门槛）
  log(rule.needInterview, `第 ${num} 关：走访门槛开启（needInterview=${rule.needInterview}）`);

  // 2) 线索池 = bindClue ∪ 追问并集
  const poolSet = buildReachablePool(lv, num);
  log(poolSet.size > 0, `第 ${num} 关：线索池非空（可达 ${poolSet.size} 条）`);

  // 3) 时间轴：正解玩家只放 witness 类证词（不含撒谎自白），避免谎言冲突
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

  // 4) 关键物证门槛：evidenceKeys ⊆ 池 ∪ 时间轴（可被玩家拿到）
  const seen = new Set([].concat(Array.from(poolSet), timeline));
  if (rule.checkEvidence && rule.evidenceKeys.length) {
    const missing = rule.evidenceKeys.filter((eid) => !seen.has(eid));
    log(missing.length === 0, `第 ${num} 关：关键物证可达（缺=${missing.join(",") || "无"}）`);
  } else {
    log(true, `第 ${num} 关：物证校验关闭`);
  }

  // 5) 凶手自白线索覆盖：凶手 solution 线索应全部可达（可被收集）
  const culprit = lv.culpritId;
  const culpritClues = lv.solution[culprit] || [];
  const unReachCulprit = culpritClues.filter((cid) => !seen.has(cid));
  log(unReachCulprit.length === 0, `第 ${num} 关：凶手线索全部可达（缺=${unReachCulprit.join(",") || "无"}）`);

  // 6) 决定性证据：候选 ≥ 1 且至少 1 条在池中（可被 ⊕ 加入证据链）
  const keySet = killerKeyIds(lv, clueMap);
  const keyIds = Array.from(keySet);
  log(keyIds.length >= 1, `第 ${num} 关：决定性证据候选 ≥ 1（${keyIds.length}: ${keyIds.slice(0, 4).join(",")}）`);
  const keyInPool = keyIds.some((cid) => seen.has(cid));
  log(keyInPool, `第 ${num} 关：决定性证据可在池/轴中收集`);

  // 7) 指认凶手 + 决定性证据双对
  const evId = keyIds.find((cid) => seen.has(cid));
  log(!!culprit && !!evId && keySet.has(evId), `第 ${num} 关：指认 ${culprit} + 决定性证据 ${evId} 双对`);

  // 8) fake 干扰线索 ≥ 1
  const fakeCount = (lv.clues || []).filter((c) => c.type === "fake").length;
  log(fakeCount >= 1, `第 ${num} 关：fake 干扰 ≥ 1（${fakeCount}）`);

  // 9) 凶手必须参与 ≥ 1 个 lie 冲突组（确保有撒谎行为）
  const lieGroupsWithCulprit = new Set();
  (lv.clues || []).forEach((c) => {
    if (c.conflictType === "lie" && culpritClues.includes(c.id) && c.conflictGroup) {
      lieGroupsWithCulprit.add(c.conflictGroup);
    }
  });
  log(lieGroupsWithCulprit.size >= 1, `第 ${num} 关：凶手参与 lie 冲突组 ≥ 1（${lieGroupsWithCulprit.size}）`);

  // 10) 物证 ≥ 1
  const evCount = (lv.clues || []).filter((c) => c.isEvidence === true).length;
  log(evCount >= 1, `第 ${num} 关：物证 ≥ 1（${evCount}）`);

  // 11) 间接目击（困难关 ≥ 3）
  if (rule.checkEvidence) {
    const witnessCount = (lv.clues || []).filter((c) => c.isWitness === true).length;
    log(witnessCount >= 3, `第 ${num} 关：困难关 witness ≥ 3（${witnessCount}）`);
  }
});

console.log(`\n=== 总结：通过 ${pass} 项 / 失败 ${fail} 项 ===`);
process.exit(fail > 0 ? 1 : 0);