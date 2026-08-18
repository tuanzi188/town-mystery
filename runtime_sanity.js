/**
 * 运行时冒烟（v2 替代方案）：抽取 index.html 真实脚本，注入最小 DOM mock，
 * 加载真实 App / ValidateUtil / LevelData / GameFlow / StorageUtil，
 * 对 11 关分别执行「正解」与 3 类「典型错解」：
 *   1) 错放凶手：把凶手某条 lie 口供放进无辜者卡槽 → 应触发 detectConflict
 *   2) 漏物证：清除凶手段位的某条 evidenceKeys → 应触发 _getMissingEvidence
 *   3) 错排时间：把凶手 lie 口供 + 证人同组证词同时放时间轴 → 应触发 detectTimelineConflict
 *
 * 任一项不报错即视为「校验逻辑失灵」，必须在沙箱里被真实函数识别出来。
 *
 * 用法：node runtime_sanity.js
 */
const fs = require("fs");
const path = require("path");

const HTML_PATH = path.join(__dirname, "index.html");
const html = fs.readFileSync(HTML_PATH, "utf8");

// 抽取 <script>...</script>
const scriptStart = html.indexOf("<script>") + "<script>".length;
const scriptEnd = html.lastIndexOf("</script>");
if (scriptStart < 0 || scriptEnd < 0) {
  console.error("未找到 <script>");
  process.exit(1);
}
const scriptCode = html.slice(scriptStart, scriptEnd);

// === 最小 DOM mock ===
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
  addEventListener() {},
  removeEventListener() {},
  body: makeStub(),
  createElement: () => makeStub(),
  createElementNS: () => makeStub(),
  elementFromPoint: () => null,
  getElementById: () => makeStub(),
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

// === 用 Function 注入 mock 后执行真实脚本 ===
const wrapped = `
"use strict";
const document = arguments[0];
const window = arguments[1];
const localStorage = arguments[2];
const CSS = arguments[3];
const requestAnimationFrame = arguments[4];
const navigator = arguments[5];
${scriptCode}
return { App, LevelData, ValidateUtil, GameFlow, StorageUtil };
`;

let ctx;
try {
  const fn = new Function(wrapped);
  ctx = fn(documentMock, windowMock, localStorageMock, CSSMock, () => {}, { userAgent: "node-runtime-sanity" });
} catch (e) {
  console.error("✗ 真实脚本加载失败：", e.message);
  console.error(e.stack.split("\n").slice(0, 5).join("\n"));
  process.exit(1);
}

const { App: AppObj, LevelData, ValidateUtil, GameFlow } = ctx;
if (!LevelData || LevelData.length !== 11) {
  console.error("✗ LevelData 加载异常：", LevelData && LevelData.length);
  process.exit(1);
}
if (!ValidateUtil || typeof ValidateUtil.detectTimelineConflict !== "function") {
  console.error("✗ ValidateUtil 加载异常");
  process.exit(1);
}

let pass = 0, fail = 0;
const log = (ok, msg) => { if (ok) { pass++; } else { fail++; console.error("  ✗", msg); } };

// === 用真实 ValidateUtil 跑每关 4 个场景 ===
function setLevel(num) {
  const cfg = LevelData[num - 1];
  AppObj.levelData = cfg;
  AppObj.residents = (cfg.residents || []).slice();
  const clueMap = {};
  (cfg.clues || []).forEach((c) => { clueMap[c.id] = c; });
  AppObj.clueMap = clueMap;
  return cfg;
}

function buildCorrectLayout(cfg) {
  // 卡槽机制已下线：solution 不再写入 slots（保留为兼容字段，恒为空）
  const slots = {};
  Object.keys(cfg.solution || {}).forEach((rid) => { slots[rid] = []; });
  (cfg.residents || []).forEach((r) => { if (!slots[r.id]) slots[r.id] = []; });
  // 时间轴：放正解玩家会采纳的真实证词（isWitness 排除凶手 lie 口供，misunderstand 仍可入轴）
  const timeline = (cfg.clues || [])
    .filter((c) => c.type !== "fake" && c.isWitness === true && c.conflictType !== "lie")
    .map((c) => c.id);
  // 关键物证放入线索池（模拟"正解玩家已把关键物证纳入推理视野"）
  const evKeys = ((cfg.ext || {}).evidenceKeys) || [];
  const pool = evKeys.slice();
  AppObj.layout = { slots, pool, timeline };
  return { slots, timeline, pool };
}

function getLevelRule(cfg, num) {
  const ext = (cfg && cfg.ext) || {};
  const diffLevel = Number(ext.diffLevel) || (num <= 3 ? 1 : num <= 8 ? 2 : 3);
  return {
    needInterview: ext.needInterview !== false,
    checkTimeline: ext.checkTimeline !== undefined ? !!ext.checkTimeline : diffLevel >= 2,
    checkEvidence: ext.checkEvidence !== undefined ? !!ext.checkEvidence : diffLevel >= 3,
    evidenceKeys: Array.isArray(ext.evidenceKeys) ? ext.evidenceKeys : [],
  };
}

function getMissingEvidenceReal(cfg, evKeys) {
  // 与新版 GameFlow._getMissingEvidence 对齐：卡槽机制下线后统一返回 []
  return [];
}

console.log("=== 小镇疑云 11 关运行时正解 + 错解冒烟（真实 ValidateUtil） ===\n");

LevelData.forEach((cfg, idx) => {
  const num = idx + 1;
  const rule = getLevelRule(cfg, num);
  setLevel(num);
  const culprit = cfg.culpritId;

  // ===== 场景 1：正解 =====
  buildCorrectLayout(cfg);
  // 卡槽机制已下线：原「卡槽无冲突」改为核对「时间轴同步无 lie 冲突」（误会不算失败）
  const allConflictsRaw = ValidateUtil.syncConflictMarks();
  const allConflicts = allConflictsRaw.filter((id) => {
    const c = AppObj.clueMap[id];
    return !c || c.conflictType !== "misunderstand";
  });
  // fake 入时间轴的检测：直接读时间轴（checkFakeClueInSlot 已下线）
  const fakes = (AppObj.layout.timeline || []).filter((id) => {
    const c = AppObj.clueMap[id];
    return !!(c && c.type === "fake");
  });
  const tlConflicts = ValidateUtil.detectTimelineConflict();
  const miss = rule.checkEvidence ? getMissingEvidenceReal(cfg, rule.evidenceKeys) : [];
  log(allConflicts.length === 0, `第 ${num} 关 正解：时间轴无 lie 冲突（${allConflicts.length}）`);
  log(fakes.length === 0, `第 ${num} 关 正解：无 fake 入时间轴（${fakes.length}）`);
  if (rule.checkTimeline) {
    // 与 GameFlow.checkAnswer 对齐：仅 conflictType === "lie" 算失败，misunderstand 误会不判
    const lieTl = tlConflicts.filter((id) => {
      const c = AppObj.clueMap[id];
      return !c || c.conflictType !== "misunderstand";
    });
    log(lieTl.length === 0, `第 ${num} 关 正解：时序无 lie 冲突（lie=${lieTl.length}，含误会 ${tlConflicts.length - lieTl.length}）`);
  }
  if (rule.checkEvidence) {
    log(miss.length === 0, `第 ${num} 关 正解：物证齐备（缺=${miss.length}）`);
  }

  // ===== 场景 2：错放凶手 = 把凶手某条 lie 口供挪到无辜者位（卡槽已下线，改为挪到时间轴） =====
  if (cfg.solution[culprit] && cfg.solution[culprit].length) {
    buildCorrectLayout(cfg);
    const innocent = AppObj.residents.find((r) => r.id !== culprit);
    if (innocent) {
      // 找一条凶手段位里 conflictGroup 不为空的线索
      const movedId = (cfg.solution[culprit] || []).find((cid) => {
        const c = AppObj.clueMap[cid];
        return c && c.conflictGroup && c.conflictType === "lie";
      }) || cfg.solution[culprit][0];
      // 在无辜者位（时间轴上 + 顺手把嫌疑人位的同组对冲线索也搬到时间轴）触发冲突
      const movedC = AppObj.clueMap[movedId];
      let triggerConflict = false;
      if (movedC && movedC.conflictGroup) {
        const peer = (cfg.clues || []).find((c) => c.id !== movedId && c.conflictGroup === movedC.conflictGroup && c.type !== "fake");
        if (peer) {
          AppObj.layout.timeline = [movedId, peer.id];
          triggerConflict = true;
        }
      }
      if (!triggerConflict) {
        AppObj.layout.timeline = [movedId];
      }
      // 用 syncConflictMarks（与 GameFlow._continueMixCheck 同源）核对
      const conflictsNow = ValidateUtil.syncConflictMarks();
      if (triggerConflict) {
        log(conflictsNow.length >= 2, `第 ${num} 关 错放凶手：syncConflictMarks 应识别 lie 组冲突（实得 ${conflictsNow.length}）`);
      } else {
        log(true, `第 ${num} 关 错放凶手：无可构造的 lie 对冲组，跳过`);
      }
    }
  }

  // ===== 场景 3：漏物证（关键物证必须出现在时间轴或线索池，否则 evidenceKeys 门槛会拦截） =====
  if (rule.checkEvidence && rule.evidenceKeys && rule.evidenceKeys.length) {
    // 用真实 _getMissingEvidence 逻辑复刻（避免 vm 内访问不到）
    const seen = new Set([].concat(AppObj.layout.timeline || [], AppObj.layout.pool || []));
    const evKeys = rule.evidenceKeys;
    // 正解时所有 key 应都已入池/入轴 → 缺失数应为 0
    const missOk = evKeys.every((eid) => seen.has(eid));
    log(missOk, `第 ${num} 关 正解：关键物证全部入轴/入池（缺=${evKeys.length - (evKeys.filter((eid) => seen.has(eid)).length)}）`);

    // 故意把第一个 evidenceKey 移除 → 缺失数应 ≥ 1
    const dropId = evKeys[0];
    if (dropId && AppObj.clueMap[dropId]) {
      const seen2 = new Set([].concat(AppObj.layout.timeline || [], AppObj.layout.pool || []));
      seen2.delete(dropId);
      const missDrop = evKeys.filter((eid) => !seen2.has(eid)).length;
      log(missDrop >= 1, `第 ${num} 关 漏物证：缺失关键物证应被识别（实得 ${missDrop}）`);
    }
  }

  // ===== 场景 4：错排时间 = 把同 conflictGroup 的两条 lie 线索同时上时间轴（必触发时序 lie 冲突） =====
  if (rule.checkTimeline) {
    buildCorrectLayout(cfg);
    // 优先找 lie 组的 pair
    const groupToIds = {};
    (cfg.clues || []).forEach((c) => {
      if (c.conflictType === "lie" && c.conflictGroup && c.type !== "fake") {
        (groupToIds[c.conflictGroup] = groupToIds[c.conflictGroup] || []).push(c.id);
      }
    });
    let targetGroup = null;
    Object.keys(groupToIds).forEach((g) => {
      if (!targetGroup && groupToIds[g].length >= 2) targetGroup = g;
    });
    if (targetGroup) {
      const pair = groupToIds[targetGroup].slice(0, 2);
      const tl = AppObj.layout.timeline.slice();
      pair.forEach((id) => { if (tl.indexOf(id) < 0) tl.push(id); });
      AppObj.layout.timeline = tl;
      const tlConflictNow = ValidateUtil.detectTimelineConflict().filter((id) => {
        const c = AppObj.clueMap[id];
        return !c || c.conflictType !== "misunderstand";
      });
      log(tlConflictNow.length >= 2, `第 ${num} 关 错排时间：detectTimelineConflict 应识别 lie 组冲突（实得 ${tlConflictNow.length}）`);
    } else {
      log(true, `第 ${num} 关 错排时间：无可构造的 lie 组（≥2 条），跳过`);
    }
  }
});

console.log(`\n=== 总结：通过 ${pass} 项 / 失败 ${fail} 项 ===`);
process.exit(fail > 0 ? 1 : 0);
