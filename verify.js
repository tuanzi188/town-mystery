/**
 * 验证脚本：从 index.html 抽取 LevelData 数组
 * 对 11 关做静态结构检查（不依赖浏览器）：
 *   1. residents 必须 4 人
 *   2. 每条 solution 引用的 clue id 必须存在
 *   3. 每个 bindClue 引用的 id 必须存在
 *   4. isWitness 必须有 timeMin
 *   5. isSuspectStatement 必须有 conflictGroup + conflictType
 *   6. isEvidence 在普通/中等关(diffLevel ≤ 2)必须有 evidenceOwnerTag；
 *      困难关(diffLevel = 3) evidenceOwnerTag 改为可选（玩家通过 bio 文本自行推理归属）
 *   7. evidenceKeys 引用的 id 必须存在
 *   8. fake 线索不应有 isWitness/isSuspectStatement/isEvidence
 *   9. 凶手必须被指认（r* 出现在 solution 且 culpritId 命中）
 *  10. 难度 ≤ 2 的关卡不应使用重度连环（≥3 个 G-lie-* 分组）
 *
 * 用法：node verify.js
 */
const fs = require("fs");
const path = require("path");

const HTML_PATH = path.join(__dirname, "index.html");
const html = fs.readFileSync(HTML_PATH, "utf8");

// 提取 LevelData 数组：定位 "const LevelData = [" 到 "const GameFlow = "
const startMarker = "const LevelData = [";
// 找 const GameFlow 之前的 "];" 作为 LevelData 真实结束位置
const endMarkerConst = "const GameFlow";
const startIdx = html.indexOf(startMarker);
if (startIdx < 0) {
  console.error("未找到 LevelData 起点");
  process.exit(1);
}
const constIdx = html.indexOf(endMarkerConst, startIdx);
if (constIdx < 0) {
  console.error("未找到 const GameFlow 位置");
  process.exit(1);
}
// 从 constIdx 向前找最近的 "]"（不含分号，截到 ] 之后）
let cutIdx = -1;
for (let i = constIdx - 1; i > startIdx; i--) {
  if (html[i] === "]") {
    cutIdx = i + 1; // 取到 ] 之后
    break;
  }
}
if (cutIdx < 0) {
  console.error("未找到 LevelData 结束的 ]");
  process.exit(1);
}
// dataJson 已包含末尾的 ]，直接拼接为合法数组字面量
const dataJson = html.slice(startIdx + "const LevelData = ".length, cutIdx).trim();
let LevelData;
try {
  LevelData = (new Function("return " + dataJson + ";"))();
} catch (e) {
  fs.writeFileSync(path.join(__dirname, "debug_leveldata.js"), dataJson);
  console.error("解析 LevelData 失败：", e.message, "（已落盘到 debug_leveldata.js）");
  process.exit(1);
}

let pass = 0, fail = 0;
const log = (ok, msg) => { if (ok) { pass++; } else { fail++; console.error("  ✗", msg); } };

console.log("=== 小镇疑云 11 关静态结构验证 ===\n");
console.log("解析得到关卡数：", LevelData.length);
if (LevelData.length !== 11) {
  console.error("关卡数应为 11，实际为", LevelData.length);
  process.exit(1);
}

LevelData.forEach((lv, idx) => {
  const num = idx + 1;
  if (num === 1 || num === 2) {
    console.log("DEBUG L" + num + " conflictGroups:");
    lv.clues.forEach(c => {
      if (c.conflictGroup) console.log(" ", c.id, "->", c.conflictGroup, c.conflictType);
    });
  }
  console.log(`\n--- 第 ${num} 关：${lv.title}（${lv.difficulty}）---`);

  // 1) residents：核心 4 人；嫁祸型关卡可能加 1 个「替罪羊」人物（无 bindClue）也算合规
  const coreResidents = (lv.residents || []).filter((r) => r.bindClue);
  const hasScapegoat = coreResidents.length < (lv.residents || []).length;
  log(coreResidents.length === 4, `核心居民数（带 bindClue）应为 4，实际 ${coreResidents.length}`);
  if (hasScapegoat) {
    log((lv.residents || []).length === 5, `嫁祸型关卡多 1 个替罪羊居民（无 bindClue），总数应 ≤ 5`);
  }
  const residentIds = new Set((lv.residents || []).map((r) => r.id));

  // 2) culpritId 必须命中一个 resident
  log(residentIds.has(lv.culpritId), `culpritId "${lv.culpritId}" 必须在 residents 中`);

  // 3) clues 完整性
  const clueIds = new Set((lv.clues || []).map((c) => c.id));
  log(clueIds.size === (lv.clues || []).length, `clue id 唯一（${clueIds.size}/${(lv.clues || []).length}）`);

  // 4) bindClue 引用校验
  (lv.residents || []).forEach((r) => {
    const list = Array.isArray(r.bindClue) ? r.bindClue : (r.bindClue ? [r.bindClue] : []);
    list.forEach((cid) => {
      log(clueIds.has(cid), `resident ${r.id} 的 bindClue "${cid}" 存在`);
    });
  });

  // 5) solution 引用校验 + 凶手线索覆盖
  const sol = lv.solution || {};
  const allSolClues = new Set();
  Object.values(sol).forEach((arr) => (arr || []).forEach((cid) => allSolClues.add(cid)));
  log(allSolClues.size > 0, `solution 至少包含 1 条线索`);
  [...allSolClues].forEach((cid) => {
    log(clueIds.has(cid), `solution 引用的 "${cid}" 存在`);
  });
  const culpritSlot = sol[lv.culpritId] || [];
  log(culpritSlot.length >= 2, `凶手 ${lv.culpritId} 的 solution 至少 2 条自白线索（实际 ${culpritSlot.length}）`);

  // 6) clue 字段一致性
  const fakeIds = new Set();
  // 缺陷 B：困难关 evidenceOwnerTag 可选（玩家通过 bio 自行推理物证归属）
  const evDiffLevel = (lv.ext && Number(lv.ext.diffLevel)) || 0;
  (lv.clues || []).forEach((c) => {
    if (c.isWitness === true) {
      log(typeof c.timeMin === "number", `isWitness 线索 ${c.id} 必须有 timeMin（当前 ${c.timeMin}）`);
    }
    if (c.isSuspectStatement === true) {
      // 必须有 conflictGroup（被 G-lie/G-mis 引用）+ conflictType
      log(typeof c.conflictGroup === "string" && c.conflictGroup.length > 0, `isSuspectStatement 线索 ${c.id} 必须有 conflictGroup`);
      log(["lie", "misunderstand"].includes(c.conflictType), `isSuspectStatement 线索 ${c.id} 的 conflictType 必须是 lie/misunderstand（当前 ${c.conflictType}）`);
    }
    if (c.isEvidence === true) {
      if (evDiffLevel <= 2) {
        log(typeof c.evidenceOwnerTag === "string" && c.evidenceOwnerTag.length > 0,
          `isEvidence 线索 ${c.id}（diffLevel=${evDiffLevel}）必须有 evidenceOwnerTag`);
      } else {
        // 困难关：evidenceOwnerTag 改为可选，但仍不能是「空串/非法值」
        const ok = c.evidenceOwnerTag === undefined || (typeof c.evidenceOwnerTag === "string" && c.evidenceOwnerTag.length > 0);
        log(ok, `isEvidence 线索 ${c.id}（diffLevel=${evDiffLevel}）evidenceOwnerTag 可选/非空（当前 ${c.evidenceOwnerTag === undefined ? "未设（bio 推理）" : c.evidenceOwnerTag}）`);
      }
    }
    if (c.type === "fake") {
      fakeIds.add(c.id);
      log(!c.isWitness && !c.isSuspectStatement && !c.isEvidence, `fake 线索 ${c.id} 不应同时是 witness/suspect/evidence`);
    }
  });

  // 7) evidenceKeys 引用校验
  const ext = lv.ext || {};
  (ext.evidenceKeys || []).forEach((cid) => {
    const evClue = lv.clues.find((x) => x.id === cid);
    log(clueIds.has(cid), `evidenceKeys 引用的 "${cid}" 存在`);
    log(!!(evClue && evClue.isEvidence === true), `evidenceKeys 引用的 "${cid}" 必须是 isEvidence 物证`);
    log(allSolClues.has(cid), `evidenceKeys 引用的 "${cid}" 必须存在于 solution`);
  });

  // 8) 同槽冲突检查：同一居民 solution 槽内同一 conflictGroup 最多出现 1 次
  Object.keys(sol).forEach((rid) => {
    const slotGroups = {};
    (sol[rid] || []).forEach((cid) => {
      const c = lv.clues.find((x) => x.id === cid);
      if (c && c.conflictGroup) slotGroups[c.conflictGroup] = (slotGroups[c.conflictGroup] || 0) + 1;
    });
    Object.keys(slotGroups).forEach((g) => {
      log(slotGroups[g] <= 1, `居民 ${rid} 槽内 ${g} 出现 ${slotGroups[g]} 次（应 ≤ 1）`);
    });
  });

  // 8) conflictGroup 配对核查：每组至少 2 条线索
  const groups = {};
  (lv.clues || []).forEach((c) => {
    if (c.conflictGroup) {
      if (!groups[c.conflictGroup]) groups[c.conflictGroup] = [];
      groups[c.conflictGroup].push(c.id);
    }
  });
  Object.entries(groups).forEach(([g, ids]) => {
    log(ids.length >= 2, `conflictGroup ${g} 至少 2 条线索（当前 ${ids.length}: ${ids.join(",")}）`);
  });

  // 9) 凶手必须至少出现在 1 个 G-lie-* 冲突组（确保有撒谎行为）
  const culpritConflictGroups = new Set();
  (lv.clues || []).forEach((c) => {
    if (c.conflictGroup && c.conflictType === "lie" && culpritSlot.includes(c.id)) {
      culpritConflictGroups.add(c.conflictGroup);
    }
  });
  log(culpritConflictGroups.size >= 1, `凶手至少参与 1 个 G-lie 冲突组（实际 ${culpritConflictGroups.size}）`);

  // 10) 难度检查
  const lieGroups = Object.entries(groups).filter(([g, ids]) => {
    return ids.some((cid) => {
      const c = lv.clues.find((x) => x.id === cid);
      return c && c.conflictType === "lie";
    });
  }).length;
  const diffLevel = ext.diffLevel || 0;
  if (diffLevel <= 2) {
    log(lieGroups >= 1 && lieGroups <= 2, `普通关（diffLevel=${diffLevel}）G-lie 组 1~2（实际 ${lieGroups}）`);
  } else {
    log(lieGroups >= 3, `困难关（diffLevel=${diffLevel}）G-lie 组 ≥ 3（实际 ${lieGroups}）`);
  }

  // 11) 干扰线索数量：新手关 ≥ 1，普通/困难关 ≥ 2，困难/终极 ≥ 3
  const minFake = diffLevel <= 1 ? 1 : (diffLevel === 2 ? 2 : 3);
  log(fakeIds.size >= minFake, `fake 干扰线索 ≥ ${minFake}（实际 ${fakeIds.size}）`);

  // 12) 物证至少 1 条
  const evidenceCount = (lv.clues || []).filter((c) => c.isEvidence).length;
  log(evidenceCount >= 1, `isEvidence 物证 ≥ 1（实际 ${evidenceCount}）`);

  console.log(`  关卡线索总数: ${(lv.clues || []).length}, 居民数: ${(lv.residents || []).length}, fake 干扰: ${fakeIds.size}`);
});

// 13) 走访追问数据（town_data.js）一致性校验：不修改上述既有断言，仅追加
{
  const townPath = path.join(__dirname, "town_data.js");
  if (!fs.existsSync(townPath)) {
    console.error("  ✗ 缺少 town_data.js（走访追问 / 跨关暗线数据模块）");
    fail++;
  } else {
    const vm = require("vm");
    const townSandbox = {};
    try {
      vm.createContext(townSandbox);
      vm.runInContext(fs.readFileSync(townPath, "utf8"), townSandbox);
    } catch (e) {
      console.error("  ✗ town_data.js 解析失败：", e.message);
      fail++;
    }
    const TOWN_FOLLOWUPS = townSandbox.TOWN_FOLLOWUPS || {};
    const TOWN_LORE = townSandbox.TOWN_LORE || [];
    const TOWN_CHRONICLE = townSandbox.TOWN_CHRONICLE || [];
    console.log("\n=== town_data.js 走访追问 / 跨关暗线数据校验 ===");

    // 键格式 L{n}_{rid} + 居民/线索引用 + cids 并集 === bindClue
    const keyVisible = /^L(\d+)_(r\d+)$/;
    LevelData.forEach((lv, idx) => {
      const num = idx + 1;
      (lv.residents || []).forEach((r) => {
        const fups = TOWN_FOLLOWUPS["L" + num + "_" + r.id];
        const bind = Array.isArray(r.bindClue) ? r.bindClue : (r.bindClue ? [r.bindClue] : []);
        if (!bind.length) return; // 替罪羊无需追问
        log(!!fups && fups.length > 0, `L${num}_${r.id}（${r.name}）配齐追问分支（${fups ? fups.length : 0}）`);
        if (!fups) return;
        const union = new Set();
        fups.forEach((fu, i) => {
          log(!!fu.q && typeof fu.q === "string", `L${num}_${r.id} 追问[${i}] 有文案`);
          log(!!fu.a && typeof fu.a === "string", `L${num}_${r.id} 追问[${i}] 有角色化对白 a（全关强制）`);
          (fu.cids || []).forEach((cid) => {
            const clueOk = (lv.clues || []).some((c) => c.id === cid);
            log(clueOk, `L${num}_${r.id} 追问[${i}] 引用的线索 "${cid}" 存在`);
            union.add(cid);
          });
        });
        const expected = bind.slice().sort().join(",");
        const actual = Array.from(union).sort().join(",");
        // 规则①：所有 bindClue 必须在追问并集中（不漏关键线索）
        const allInUnion = bind.every((cid) => union.has(cid));
        // 规则②：追问并集中的额外线索必须是真实存在的线索（已由"线索存在"检查保证）
        // 允许追问解锁 fake 干扰/旁证线索——这是"无用追问"的设计：玩家问出看似有用但实际是补完的追问
        log(allInUnion, `L${num}_${r.id} 追问并集 ⊇ bindClue（并=${actual}，期望 ${expected}，额外=${Array.from(union).filter((id) => !bind.includes(id)).join(",") || "无"}）`);
      });
    });
    // 额外：不应出现指向不存在的居民键
    Object.keys(TOWN_FOLLOWUPS).forEach((k) => {
      const m = keyVisible.exec(k);
      let ok = false;
      if (m) {
        const num = Number(m[1]);
        const lv = LevelData[num - 1];
        ok = !!lv && (lv.residents || []).some((r) => r.id === m[2]);
      }
      log(ok, `追问键 "${k}" 指向存在的居民`);
    });

    // 跨关人物关系：a / b 引用存在
    TOWN_LORE.forEach((item, i) => {
      const aLv = LevelData[item.a.lv - 1];
      const bLv = LevelData[item.b.lv - 1];
      log(!!aLv && (aLv.residents || []).some((r) => r.id === item.a.rid),
        `人物关系[${i}] A（L${item.a.lv}_${item.a.rid}）引用存在`);
      log(!!bLv && (bLv.residents || []).some((r) => r.id === item.b.rid),
        `人物关系[${i}] B（L${item.b.lv}_${item.b.rid}）引用存在`);
      log(!!item.rel && typeof item.rel === "string", `人物关系[${i}] 有关系描述`);
    });

    // 小镇大事记：lv 1..11 各一次
    const chronicleLvs = TOWN_CHRONICLE.map((c) => c.lv);
    for (let lv = 1; lv <= LevelData.length; lv++) {
      log(chronicleLvs.indexOf(lv) !== -1, `大事记覆盖第 ${lv} 关`);
    }
    log(chronicleLvs.length === new Set(chronicleLvs).size, `大事记 lv 无重复`);
  }
}

console.log(`\n=== 总结：通过 ${pass} 项 / 失败 ${fail} 项 ===`);
process.exit(fail > 0 ? 1 : 0);
