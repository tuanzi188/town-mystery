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

// ===== 新增：三层分类（type 字段）分布 + 数量上限（试点：第 1 关已迁移） =====
console.log("\n=== 三层分类 type 分布（core 推理核心 / profile 性格侧写 / chatter 干扰闲话）===\n");
const caps = { 1: 3, 2: 3, 3: 3, 4: 4, 5: 4, 6: 4, 7: 4, 8: 4, 9: 5, 10: 5, 11: 5 };
const dist = { core: 0, profile: 0, chatter: 0, untagged: 0 };
LevelData.forEach((lv, idx) => {
  const num = idx + 1;
  (lv.residents || []).forEach((r) => {
    const fups = TOWN_FOLLOWUPS["L" + num + "_" + r.id];
    if (!fups || !fups.length) return;
    const tag = { core: 0, profile: 0, chatter: 0 };
    fups.forEach((fu) => {
      const t = fu.type;
      if (t === "core" || t === "profile" || t === "chatter") { dist[t]++; tag[t]++; }
      else dist.untagged++;
    });
    const over = fups.length > caps[num] ? " ⚠超上限" : "";
    console.log(`  L${num} ${r.name}: ${fups.length}/${caps[num]} 条 [core=${tag.core} profile=${tag.profile} chatter=${tag.chatter}]${over}`);
  });
});
const taggedTotal = dist.core + dist.profile + dist.chatter;
console.log(`\n  已标注合计：core=${dist.core} profile=${dist.profile} chatter=${dist.chatter}（未标注 ${dist.untagged} 条）`);
if (taggedTotal > 0) {
  console.log(`  已标注比例：core=${Math.round(dist.core / taggedTotal * 100)}% profile=${Math.round(dist.profile / taggedTotal * 100)}% chatter=${Math.round(dist.chatter / taggedTotal * 100)}%`);
}
console.log("  目标配比约 50% core / 40% profile / 10% chatter；chatter 仅承载 fake 干扰线索，不删机制。");
