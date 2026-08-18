/**
 * 追问价值分析：把 85 条追问按"对推理的贡献"分类
 * 不再用 _categoryOf（已删除），改为基于 cids 线索 schema 直接判定
 * 判定标准：cids 包含 isEvidence / isWitness / isSuspectStatement / conflictGroup 之一 → 推进推理
 * 用法：node analyze_followups.js
 */
const { loadRuntime } = require("./lib/extract");
const { createMocks } = require("./lib/mocks");

let ctx;
try {
  const r = loadRuntime({
    expose: ["App", "LevelData", "GameFlow", "StorageUtil", "DialogSystem", "TOWN_FOLLOWUPS"],
    includeTownData: true,
    userAgent: "analyze",
  });
  ctx = r.ctx;
} catch (e) {
  console.error("✗ 真实脚本 + town_data 加载失败：", e.message);
  console.error(e.stack.split("\n").slice(0, 4).join("\n"));
  process.exit(1);
}

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
