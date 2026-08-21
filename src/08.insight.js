"use strict";

/* ============================================================
   模块九：推理提示引擎（InsightEngine）—— 非强制的轻提示层
   定位：在「时间冲突 / 缺物证」这类硬校验之外，帮玩家发现线索之间的
        印证关系与证据链质量，全部为可选提示，绝不阻断推理。

   能力一：detectCorroboration —— 自动推导「可互相印证」的线索对
     · point   两条线索 pointsTo 指向同一居民 → 共同指向
     · owner   物证 evidenceOwnerTag 命中另一条证词所属居民的 tagShort
               → 「这条物证身份和某人匹配」
     · involve 目击在场(involve)与指认(pointsTo)交叉命中 → 在场印证
   能力二：caseQuality —— 复用 town_data 的 evaluateCase，实时给出
         证据链的「铁证 / 旁证 / 干扰」计数与结论。

   依赖：App.clueMap / App.layout（由 GameFlow.renderLevel 注入）、
         town_data.js 的 evaluateCase。仅在浏览器运行期被调用。
   ============================================================ */
const InsightEngine = {
  /** 由 solution 反查「线索 id → 所属居民 id」 */
  _ownerOf(cfg) {
    const ownerOf = {};
    const sol = (cfg && cfg.solution) || {};
    Object.keys(sol).forEach((rid) => {
      (sol[rid] || []).forEach((cid) => { ownerOf[cid] = rid; });
    });
    return ownerOf;
  },

  /** 居民 id → { name, tag } 索引 */
  _residentMap(cfg) {
    const map = {};
    ((cfg && cfg.residents) || []).forEach((r) => { map[r.id] = { name: r.name, tag: r.tagShort }; });
    return map;
  },

  /** 玩家当前「已收集」的线索 id（线索池 ∪ 时间轴，去重） */
  _collectedIds() {
    const set = new Set();
    [].concat(App.layout.pool || [], App.layout.timeline || []).forEach((id) => {
      if (id) set.add(id);
    });
    return Array.from(set);
  },

  /** 写入一条关联提示；同一线索对 + 同 kind 只保留一次 */
  _push(map, cid, entry) {
    if (!map[cid]) map[cid] = [];
    const dup = map[cid].some((e) => e.withCid === entry.withCid && e.kind === entry.kind);
    if (!dup) map[cid].push(entry);
  },

  /**
   * 主入口：扫描当前已收集线索的两两组合，输出按线索 id 索引的关联提示。
   * @param {Object} cfg 当前关卡配置
   * @returns {{ byClue: Object.<string, Array> }}
   *   byClue[cid] = [{ kind, withCid, name?, reason }]
   */
  detectCorroboration(cfg) {
    const byClue = {};
    const ids = this._collectedIds();
    const clueById = {};
    ids.forEach((id) => { if (App.clueMap[id]) clueById[id] = App.clueMap[id]; });
    const ownerOf = this._ownerOf(cfg);
    const resMap = this._residentMap(cfg);
    const list = Object.keys(clueById);

    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const A = clueById[list[i]];
        const B = clueById[list[j]];
        this._pair(A, B, ownerOf, resMap, byClue);
      }
    }
    return { byClue };
  },

  /** 处理一对线索 (A, B)，识别三种印证关系并双向写入提示 */
  _pair(A, B, ownerOf, resMap, byClue) {
    // 1) 共同指向同一居民
    if (A.pointsTo && B.pointsTo && A.pointsTo === B.pointsTo) {
      const name = (resMap[A.pointsTo] && resMap[A.pointsTo].name) || "某人";
      this._push(byClue, A.id, { kind: "point", withCid: B.id, reason: "共同指向「" + name + "」" });
      this._push(byClue, B.id, { kind: "point", withCid: A.id, reason: "共同指向「" + name + "」" });
    }
    // 2) 物证身份标签 == 证词所属居民的身份标签（A 为物证、B 为居民证词）
    this._ownerMatch(A, B, ownerOf, resMap, byClue);
    this._ownerMatch(B, A, ownerOf, resMap, byClue);
    // 3) 目击在场(involve) 与 指认(pointsTo) 交叉命中
    this._involveMatch(A, B, resMap, byClue);
    this._involveMatch(B, A, resMap, byClue);
  },

  /** 规则二：ev 为物证且带 evidenceOwnerTag，证词 clue 所属居民 tagShort 与之相同 */
  _ownerMatch(ev, clue, ownerOf, resMap, byClue) {
    if (!ev.isEvidence || !ev.evidenceOwnerTag) return;
    if (clue.isEvidence) return; // 物证↔物证不做身份匹配，只做「物证↔人物证词」
    const rid = ownerOf[clue.id];
    if (!rid) return;
    const r = resMap[rid];
    if (!r || r.tag !== ev.evidenceOwnerTag) return;
    this._push(byClue, ev.id, { kind: "owner", withCid: clue.id, name: r.name, reason: "物证身份与「" + r.name + "」匹配，请留意" });
    this._push(byClue, clue.id, { kind: "owner", withCid: ev.id, name: r.name, reason: "物证身份与「" + r.name + "」匹配，请留意" });
  },

  /** 规则三：涉及(目击在场)线索的 involve 命中另一条线索的 pointsTo 对象 */
  _involveMatch(a, b, resMap, byClue) {
    if (!a.involve || !b.pointsTo) return;
    if (a.involve.indexOf(b.pointsTo) === -1) return;
    const name = (resMap[b.pointsTo] && resMap[b.pointsTo].name) || "某人";
    this._push(byClue, a.id, { kind: "involve", withCid: b.id, reason: "目击在场与指认对象一致（「" + name + "」）" });
    this._push(byClue, b.id, { kind: "involve", withCid: a.id, reason: "目击在场与指认对象一致（「" + name + "」）" });
  },

  /** 证据链质量：复用 evaluateCase 的 core/aux/red/amb 计数。
   *  @returns {{ verdict, counts } | null} */
  caseQuality() {
    if (typeof evaluateCase !== "function") return null;
    const list = (App.layout && App.layout.caseFile) || [];
    return evaluateCase("L" + App.currentLevel, list);
  },
};