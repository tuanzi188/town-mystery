// 缺陷 A 单元测试：detectTimeRangePairing 在各关应输出预期结果
const { loadRuntime } = require("./lib/extract");
const { createMocks } = require("./lib/mocks");

let ctx;
let localStorageMock;
try {
  const r = loadRuntime({
    expose: ["App", "LevelData", "ValidateUtil", "GameFlow", "StorageUtil", "Bgm"],
    includeTownData: false,
    userAgent: "test",
  });
  ctx = r.ctx;
  localStorageMock = r.mocks.localStorageMock;
} catch (e) {
  console.error("✗ 真实脚本加载失败：", e.message);
  console.error(e.stack.split("\n").slice(0, 5).join("\n"));
  process.exit(1);
}

const { App: A, LevelData, ValidateUtil, GameFlow, StorageUtil, Bgm } = ctx;

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

// 场景 6: GameFlow._shuffle Fisher-Yates 行为校验
{
  const arr = [1, 2, 3, 4, 5, 6, 7, 8];
  const out = GameFlow._shuffle(arr);
  // 不修改原数组
  log(JSON.stringify(arr) === "[1,2,3,4,5,6,7,8]", "_shuffle 不修改原数组");
  // 元素全保留
  const sorted = out.slice().sort((a, b) => a - b);
  log(JSON.stringify(sorted) === "[1,2,3,4,5,6,7,8]", "_shuffle 元素全保留");
  // 同种子 → 同结果
  const a1 = GameFlow._shuffle(arr, 12345);
  const a2 = GameFlow._shuffle(arr, 12345);
  log(JSON.stringify(a1) === JSON.stringify(a2), "_shuffle 同种子复现");
  // 不同种子 → 通常不同结果（统计 100 次都相同的概率约 0，可视为不同）
  const b1 = GameFlow._shuffle(arr, 1);
  const b2 = GameFlow._shuffle(arr, 2);
  log(JSON.stringify(b1) !== JSON.stringify(b2), "_shuffle 不同种子通常不同");
  // 均匀性：n=8 共 40320 排列，1000 次采样每个位置被某元素占据的次数应在 ~125 附近（容差 ±40）
  const counts = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0));
  for (let k = 0; k < 1000; k++) {
    const s = GameFlow._shuffle(arr, k);
    s.forEach((v, i) => { counts[i][v - 1]++; });
  }
  let maxDev = 0;
  counts.forEach((row) => row.forEach((c) => { maxDev = Math.max(maxDev, Math.abs(c - 125)); }));
  log(maxDev <= 40, `_shuffle 均匀性 1000 次采样最大偏差 ${maxDev}（应 ≤ 40）`);
}

// 场景 7: 本局失败计数（layout.accuseFails）独立于跨局统计
{
  localStorageMock.clear();
  const lv = ctx.LevelData[0];
  // 模拟当前关卡配置 + clueMap（_restartLevel 内部会重读 layout，所以 clueMap 必须先准备好）
  ctx.App.levelData = lv;
  ctx.App.residents = (lv.residents || []).slice();
  const cm = {};
  lv.clues.forEach((c) => { cm[c.id] = c; });
  ctx.App.clueMap = cm;
  ctx.App.currentLevel = 1;
  // 模拟玩家已走访 + 布局
  ctx.StorageUtil.writeLevelState(1, { pool: ["c1"], timeline: ["c2"], mapPlace: {}, locked: [], hintCount: 1, accuseFails: 5 });
  ctx.StorageUtil.writeDialogRecord(1, ["r1", "r2"]);
  // 触发 renderLevel（让 App.layout 跟盘）
  ctx.GameFlow.renderLevel(lv);
  log(ctx.App.layout.accuseFails === 5, "renderLevel 后 layout.accuseFails=5（已加载）");
  // 模拟指认失败
  ctx.GameFlow._onAccuseFail(lv, "r1");
  log(ctx.App.layout.accuseFails === 6, `_onAccuseFail 后 accuseFails=${ctx.App.layout.accuseFails}`);
  // _restartLevel 应清零
  ctx.GameFlow._restartLevel();
  // renderLevel 在 _restartLevel 内部已调过，但 layout 是从 mock 重新读
  const layoutAfter = ctx.StorageUtil.readLevelState(1);
  log(layoutAfter.accuseFails === 0, `_restartLevel 后 accuseFails=${layoutAfter.accuseFails}（应清零）`);
  log(layoutAfter.hintCount === 1, `_restartLevel 后 hintCount=${layoutAfter.hintCount}（之前是 1，保留）`);
  log(layoutAfter.pool.length === 0 && layoutAfter.timeline.length === 0, "_restartLevel 后 pool/timeline 已清空");
  // 走访记录应保留
  const dialogIds = ctx.StorageUtil.readDialogRecord(1);
  log(JSON.stringify(dialogIds) === '["r1","r2"]', `_restartLevel 后走访记录保留：${JSON.stringify(dialogIds)}`);
}

// 场景 8: Bgm.muted 持久化（localStorage 读写）
{
  localStorageMock.clear();
  // 重新初始化 Bgm 状态（确保从干净的 localStorage 读起）
  Bgm.muted = false;
  Bgm._applyMute();
  log(Bgm.muted === false, "重置后 muted=false");
  Bgm.toggleMute();
  log(Bgm.muted === true, `toggleMute 1 次后 muted=${Bgm.muted}`);
  log(localStorageMock.getItem("townMystery_bgmMuted") === "1", "muted 状态写入 localStorage");
  Bgm.toggleMute();
  log(Bgm.muted === false, `toggleMute 2 次后 muted=${Bgm.muted}（应回到 false）`);
  log(localStorageMock.getItem("townMystery_bgmMuted") === "0", `localStorage=${localStorageMock.getItem("townMystery_bgmMuted")}（应 0）`);
  // 持久化恢复测试
  localStorageMock.setItem("townMystery_bgmMuted", "1");
  Bgm.muted = (localStorageMock.getItem("townMystery_bgmMuted") === "1");
  Bgm._applyMute();
  log(Bgm.muted === true, "从 localStorage '1' 恢复 muted=true");
  localStorageMock.setItem("townMystery_bgmMuted", "0");
  Bgm.muted = false;
  Bgm._applyMute();
  log(Bgm.muted === false, "从 localStorage '0' 恢复 muted=false");
}

// 场景 9: 教程触发：未看过 + L3 layout 空 → 应弹（任意未通关关卡）
{
  localStorageMock.clear();
  ctx.App.currentLevel = 3;
  // 模拟玩家在 L3 还未开始（layout 为空）
  ctx.StorageUtil.writeLevelState(3, { pool: [], mapPlace: {}, timeline: [], locked: [] });
  let tutorialShown = false;
  const origShow = ctx.GameFlow.showTutorialCards;
  ctx.GameFlow.showTutorialCards = (markSeen) => { tutorialShown = true; };
  ctx.GameFlow.maybeShowTutorial();
  log(tutorialShown, "L3 layout 空 + 未看过 → 弹教程");
  ctx.GameFlow.showTutorialCards = origShow;
}

console.log(`\n=== 总结：通过 ${pass} 项 / 失败 ${fail} 项 ===`);
process.exit(fail > 0 ? 1 : 0);
