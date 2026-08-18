/**
 * 新手引导冒烟（真实函数）：
 *   1) 未看过 + 第 1 关 → 弹 3 张引导卡（含 跳过/下一步/开始探索 按钮）+ 写 tutorialSeen
 *   2) 已看过 + 第 1 关 → 不弹
 *   3) 未看过 + 第 2/9 关 → 不弹
 *   4) migrateIfNeeded（DATA_VERSION 升级）→ tutorialSeen 不被清
 *
 * 用法：node tutorial_smoke.js
 */
const { loadRuntime } = require("./lib/extract");
const { createMocks } = require("./lib/mocks");

// 5 个 mock 共享一次,确保 localStorage 状态在 makeContext() 间延续
const sharedMocks = createMocks({ userAgent: "tutorial-smoke" });
const localStorageMock = sharedMocks.localStorageMock;

let pass = 0, fail = 0;
const log = (ok, msg) => { if (ok) { pass++; } else { fail++; console.error("  ✗", msg); } };

// 抓弹窗：替换 Modal.show 拦截（引导卡经 Modal.show 渲染，按钮数组 btns）
function makeContext() {
  const alerts = [];
  const r = loadRuntime({
    expose: ["App", "LevelData", "Modal", "StorageUtil", "GameFlow"],
    includeTownData: false,
    mocks: sharedMocks,
  });
  const ctx = r.ctx;
  ctx.Modal.show = (title, text, btns, onClose) => {
    const labels = (btns || []).map((b) => b.label);
    alerts.push({ title, text, labels });
    // 模拟玩家逐张点「下一步 / 开始探索」：递归弹出后续卡片
    const next = (btns || []).find((b) => b.label === "下一步" || b.label === "开始探索");
    if (next) {
      try { next.onClick(); } catch (e) { /* 忽略内部错误 */ }
      // 模拟"点完按钮后弹窗关闭"——触发 onClose 钩子，与真实玩家路径一致（覆盖教程标记写入）
      if (onClose) { try { onClose(); } catch (e) { /* ignore */ } }
    }
  };
  return { ctx, alerts };
}

// === 场景 1：未看过 + L1 → 弹 3 张 + 写标记 ===
localStorageMock.clear();
{
  const { ctx, alerts } = makeContext();
  ctx.App.currentLevel = 1;
  log(ctx.StorageUtil.readTutorialSeen() === false, "场景 1：初始 tutorialSeen=false");
  ctx.GameFlow.maybeShowTutorial();
  log(alerts.length === 3, `场景 1：弹窗数应为 3（实际 ${alerts.length}）`);
  log(alerts[0] && alerts[0].title === "🌸 欢迎来到小镇疑云", `场景 1：第 1 张标题正确（${alerts[0] && alerts[0].title}）`);
  log(alerts[1] && alerts[1].title === "🎮 四条核心操作", `场景 1：第 2 张标题正确（${alerts[1] && alerts[1].title}）`);
  log(alerts[2] && alerts[2].title === "💡 卡壳了怎么办", `场景 1：第 3 张标题正确（${alerts[2] && alerts[2].title}）`);
  log(alerts[0] && alerts[0].labels.join() === "跳过,下一步", `场景 1：第 1 张按钮为 跳过/下一步（${alerts[0] && alerts[0].labels.join()}）`);
  log(alerts[1] && alerts[1].labels.join() === "上一步,跳过,下一步", `场景 1：第 2 张按钮为 上一步/跳过/下一步（${alerts[1] && alerts[1].labels.join()}）`);
  log(alerts[2] && alerts[2].labels.join() === "上一步,跳过,开始探索", `场景 1：第 3 张按钮为 上一步/跳过/开始探索（${alerts[2] && alerts[2].labels.join()}）`);
  log(ctx.StorageUtil.readTutorialSeen() === true, "场景 1：看完后 tutorialSeen=true");
}

// === 场景 2：已看过 + L1 → 不弹 ===
{
  localStorageMock.clear();
  // 模拟玩家看过引导：直接写 localStorage
  localStorageMock.setItem("townMystery_tutorialSeen", "true");
  const { ctx, alerts } = makeContext();
  ctx.App.currentLevel = 1;
  log(ctx.StorageUtil.readTutorialSeen() === true, "场景 2：前置已写 tutorialSeen=true");
  ctx.GameFlow.maybeShowTutorial();
  log(alerts.length === 0, `场景 2：已看过则不弹（实际 ${alerts.length}）`);
}

// === 场景 3：未看过 + 任意未通关关卡 → 都弹（保证萌新任何路径都看到引导） ===
{
  localStorageMock.clear();
  const { ctx, alerts } = makeContext();
  ctx.App.currentLevel = 2;
  ctx.GameFlow.maybeShowTutorial();
  log(alerts.length === 3, `场景 3a：L2 未看过 + 未碰过布局 → 应弹 3 张（实际 ${alerts.length}）`);
  // 场景 3a 结束后 tutorialSeen=true；3b 是验证"已看过任何一关" → 后面的关不再弹
  ctx.App.currentLevel = 9;
  ctx.GameFlow.maybeShowTutorial();
  log(alerts.length === 3, `场景 3b：L9 已通过 3a 看过了 → 不再弹（实际 ${alerts.length}）`);
}

// === 场景 3c：未看过 + 本关已被玩过（layout 非空） → 不弹 ===
{
  localStorageMock.clear();
  const { ctx, alerts } = makeContext();
  ctx.App.currentLevel = 3;
  // 模拟玩家在 L3 已经动过布局（拖了线索入时间轴）
  ctx.StorageUtil.writeLevelState(3, { pool: ["c1"], timeline: ["c2"], mapPlace: {}, locked: [] });
  ctx.GameFlow.maybeShowTutorial();
  log(alerts.length === 0, `场景 3c：L3 已动过布局 → 不弹（实际 ${alerts.length}）`);
}

// === 场景 4：migrateIfNeeded 升级 → tutorialSeen 不清 ===
{
  localStorageMock.clear();
  // 模拟旧版本：先写 tutorialSeen=true，再制造版本落后
  localStorageMock.setItem("townMystery_tutorialSeen", "true");
  localStorageMock.setItem("townMystery_dataVersion", "0");
  // 重新加载 ctx 读取当前最新 DATA_VERSION
  const { ctx } = makeContext();
  ctx.StorageUtil.migrateIfNeeded();
  log(ctx.StorageUtil.readTutorialSeen() === true, "场景 4：migrateIfNeeded 后 tutorialSeen 仍为 true");
}

console.log(`\n=== 总结：通过 ${pass} 项 / 失败 ${fail} 项 ===`);
process.exit(fail > 0 ? 1 : 0);
