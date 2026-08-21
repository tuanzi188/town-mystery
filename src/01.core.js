"use strict";
/* ============================================================
   游戏全局状态（仅存 UI 状态，业务数据后续模块填充）
   ============================================================ */
"use strict";

const App = {
  currentLevel: 1,        // 当前关卡编号（占位）
  totalLevels: 11,        // 关卡总数
  levelData: null,        // 当前关卡配置（B2 起由关卡数据模块填充，B1 保持 null）
  residents: [],          // 当前关卡居民列表：[{ id, name, role }]
  clueMap: {},            // 当前关卡线索索引：线索 id -> 线索对象
  layout: { pool: [], mapPlace: {}, timeline: [], locked: [] }, // 当前关卡摆放状态：pool 线索池 id；mapPlace 地图地点副本；timeline 时间轴副本；locked 锁定线索
};

/* ============================================================
   模块一：localStorage 存档工具
   存储字段：
   - key: levelProgress  -> 关卡解锁进度
   - key: levelState     -> 当前关卡状态：{ slots, pool, hintCount,
                              mapPlace, timeline, locked }
   ============================================================ */
const StorageUtil = {
  _prefix: "townMystery_",
  /**
   * DATA_VERSION：仅在「机制级」变更（卡槽系统、checkEvidence 行为、走访机制等）时递增。
   * 调整 DATA_VERSION 会触发「全档清空 + 进度回 1」——属于兜底重置。
   * 单关内容微调（错别字、线索文案、evidenceKeys 增减）**不要动** DATA_VERSION，
   * 改用 _levelHash(levelIndex) 走按关卡粒度的细粒度迁移。
   */
  DATA_VERSION: 2,
  _versionKey() { return this._prefix + "dataVersion"; },
  /** 单关内容指纹：用于"内容变更 → 仅清该关"细粒度迁移。 */
  _hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(36);
  },
  /**
   * 计算当前关卡的内容指纹：culpritId + solution 排序 + evidenceKeys 排序 + 关键 isWitness/isEvidence 数量。
   * 任何会改变"正解/校验逻辑"的结构变更都会改变 hash。
   * @param {number} idx 关卡序号（1-based）
   */
  _levelHash(idx) {
    const lv = (typeof LevelData !== "undefined" && LevelData[idx - 1]) || null;
    if (!lv) return "";
    const sol = lv.solution || {};
    const solKey = Object.keys(sol).sort().map((rid) => rid + ":" + (sol[rid] || []).slice().sort().join(",")).join("|");
    const evKeys = ((lv.ext || {}).evidenceKeys || []).slice().sort().join(",");
    const wCount = (lv.clues || []).filter((c) => c.isWitness === true).length;
    const eCount = (lv.clues || []).filter((c) => c.isEvidence === true).length;
    return this._hashStr([
      lv.culpritId || "",
      solKey,
      evKeys,
      "w" + wCount,
      "e" + eCount,
    ].join("#"));
  },
  /**
   * 启动期一次性迁移：
   *  - 若 DATA_VERSION 落后 → 整档清空 + 进度回 1（机制级变更）
   *  - 否则按关卡 hash 对比：仅清 hash 变化的关（内容微调）
   *  本局失败计数 (layout.accuseFails) 在 _restartLevel 内清零，不需要在 migrate 里清理。
   */
  migrateIfNeeded() {
    const curVer = Number(this.read("dataVersion", 0));
    if (curVer < this.DATA_VERSION) {
      LevelData.forEach((_, idx) => {
        this.clearLevelState(idx + 1);
        this.write(this.dialogKey(idx + 1), []);
      });
      this.writeProgress(1);
      this.write("dataVersion", this.DATA_VERSION);
      // 把当前所有关的 hash 一并落盘，后续只做 diff
      this._writeAllLevelHashes();
      return;
    }
    // DATA_VERSION 一致 → 逐关 hash 对比，只清 hash 变化的关
    LevelData.forEach((_, idx) => {
      const lvNum = idx + 1;
      const curHash = String(this.read("levelHash_" + lvNum, ""));
      const newHash = this._levelHash(lvNum);
      if (curHash === newHash) return;
      this.clearLevelState(lvNum);
      this.write(this.dialogKey(lvNum), []);
      this.write("levelHash_" + lvNum, newHash);
    });
  },
  /** 启动时一次性把当前所有关的 hash 落盘（首次运行/整档清空后用） */
  _writeAllLevelHashes() {
    LevelData.forEach((_, idx) => {
      this.write("levelHash_" + (idx + 1), this._levelHash(idx + 1));
    });
  },
  _key(name) { return this._prefix + name; },
  /** 读取存档，失败或不存在时返回默认值 */
  read(key, fallback) {
    try {
      const raw = localStorage.getItem(this._key(key));
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      console.warn("[存档] 读取失败，使用默认值：", e);
      return fallback;
    }
  },
  /** 写入存档 */
  write(key, value) {
    try {
      localStorage.setItem(this._key(key), JSON.stringify(value));
    } catch (e) {
      console.warn("[存档] 写入失败：", e);
    }
  },
  /** 读取关卡解锁进度，返回 { unlocked: number } 占位结构 */
  readProgress() {
    const p = this.read("levelProgress", { unlocked: 1 });
    return { unlocked: Number(p.unlocked) || 1 };
  },
  /** 写入关卡解锁进度 */
  writeProgress(unlocked) {
    this.write("levelProgress", { unlocked });
  },
  /** 读取新手引导已看标记（true=已看；false/不存在=未看） */
  readTutorialSeen() {
    return this.read("tutorialSeen", false) === true;
  },
  /** 写入新手引导已看标记（不参与 migrateIfNeeded，跨版本升级不清） */
  writeTutorialSeen() {
    this.write("tutorialSeen", true);
  },
  /**
   * 读取当前关卡状态（含推理辅助面板数据）。
   * 返回：{ slots, pool, hintCount, mapPlace, timeline, locked }
   * - slots:     {居民id: [线索id]}
   * - pool:      [线索id]
   * - hintCount: 已用提示次数（单档，最多 2 / 关）
   * - mapPlace:  {地点id: [线索id]}（线索副本钉在地图上，不影响 slots/pool）
   * - timeline:  [线索id]（线索副本按时间排序，不影响 slots/pool）
   * - locked:    [线索id]（锁定后不可拖动）
   */
  readLevelState(level) {
    const raw = this.read("levelState_" + level, null);
    // 兼容旧档：raw.slots（旧卡槽字段）存在时仍视为有效；新档无 slots，只要 pool/timeline 是数组即视为有效
    const hasPool = raw && Array.isArray(raw.pool);
    const hasTimeline = raw && Array.isArray(raw.timeline);
    const hasSlots = raw && typeof raw.slots === "object";
    const valid = raw && typeof raw === "object" && (hasPool || hasTimeline || hasSlots);
    // 提示已用次数（单档，最多 2 次）：优先读 hintCount；旧档从 hintCounts / hintUsed 迁移
    let hintCount = 0;
    if (valid && typeof raw.hintCount === "number") {
      hintCount = Math.max(0, Math.min(2, Math.floor(raw.hintCount)));
    } else if (valid && raw.hintCounts && typeof raw.hintCounts === "object") {
      const blur = Number(raw.hintCounts.blur) || 0;
      const mid = Number(raw.hintCounts.mid) || 0;
      hintCount = Math.max(0, Math.min(2, Math.max(blur, mid)));
    } else if (valid && typeof raw.hintUsed === "number") {
      hintCount = Math.max(0, Math.min(2, Math.floor(raw.hintUsed)));
    }
    if (!valid) {
      return {
        pool: [], hintCount, mapPlace: {}, timeline: [], locked: [], caseFile: [],
      };
    }
    // 旧档：尝试从 slots 推断 pool（兼容老玩家）；新档：以 pool 为准
    const strArr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
    const pool = strArr(raw.pool);
    const timeline = strArr(raw.timeline);
    // 地图地点：{地点id:[线索id]}
    const mapPlace = {};
    if (raw.mapPlace && typeof raw.mapPlace === "object") {
      Object.keys(raw.mapPlace).forEach((locId) => {
        const ids = strArr(raw.mapPlace[locId]);
        if (ids.length) mapPlace[locId] = ids;
      });
    }
    // E6 白名单合并：raw 在前、标准化字段在后（后者覆盖前者），杜绝脏值覆盖标准字段导致下游 .filter 抛 TypeError。
    const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0);
    return Object.assign(
      raw && typeof raw === "object" ? raw : {},
      {
        pool, hintCount, mapPlace, timeline,
        locked: strArr(raw.locked),
        caseFile: strArr(raw.caseFile),
        accuseFails: num(raw.accuseFails),
        overlapWarned: raw.overlapWarned === true,
      }
    );
  },
  /** 写入当前关卡状态 */
  writeLevelState(level, state) {
    this.write("levelState_" + level, state);
  },
  /** 清空当前关卡状态（重置本局用，含推理辅助数据） */
  clearLevelState(level) {
    this.write("levelState_" + level, {
      pool: [], hintCount: 0,
      mapPlace: {}, timeline: [], locked: [], caseFile: [],
    });
  },
  /**
   * 读取已解锁人物档案 id 列表（unlockedBioList）。
   * 说明：居民 id 在各关重复，存储键统一为「L关卡序号_居民id」，
   * 保证跨关唯一、与后续档案馆按关筛选兼容。
   * 旧存档无该字段 / 脏数据 → 自动回退空数组，不丢其他进度。
   */
  readBioRecord() {
    const list = this.read("unlockedBioList", []);
    if (!Array.isArray(list)) return [];
    return list.filter((x) => typeof x === "string");
  },
  /** 写入已解锁人物档案 id 列表 */
  writeBioRecord(ids) {
    this.write("unlockedBioList", (Array.isArray(ids) ? ids : []).filter((x) => typeof x === "string"));
  },
  /** 盘问记录存储键：L{关卡号}_dialog */
  dialogKey(levelIndex) {
    return "dialog_L" + levelIndex;
  },
  /** 读取某关已交谈居民 id 列表（未交谈过返回空数组） */
  readDialogRecord(levelIndex) {
    const list = this.read(this.dialogKey(levelIndex), []);
    if (!Array.isArray(list)) return [];
    return list.filter((x) => typeof x === "string");
  },
  /** 写入某关已交谈居民 id 列表 */
  writeDialogRecord(levelIndex, ids) {
    this.write(this.dialogKey(levelIndex), (Array.isArray(ids) ? ids : []).filter((x) => typeof x === "string"));
  },
  /** 追问记录存储键：L{关卡号}_asked */
  askedKey(levelIndex) {
    return "asked_L" + levelIndex;
  },
  /** 读取某关已追问的问题键列表（键格式：居民id#问题序号，如 "r1#0"） */
  readAskedFollowups(levelIndex) {
    const list = this.read(this.askedKey(levelIndex), []);
    if (!Array.isArray(list)) return [];
    return list.filter((x) => typeof x === "string");
  },
  /** 写入某关已追问的问题键列表 */
  writeAskedFollowups(levelIndex, keys) {
    this.write(this.askedKey(levelIndex), (Array.isArray(keys) ? keys : []).filter((x) => typeof x === "string"));
  },
};

/* ============================================================
   模块一·补：走访对话系统（DialogSystem，混合模式专属 · 沉浸感增强 v2）
   说明：
   - 弹窗打开 → 走访次数开场白（首次/再次/三次+/熟客）→ 口供按句末标点逐句淡入（~700ms/句）→
     完成后展示引导行与「继续询问」按钮。
   - 追问入口：单条「继续询问」按钮，每点一次吐出一条；不再一次列出全部。
   - 线索呈现：完全融入对白末尾的 chip（💡 普通 / 🔑 物证 / 🤥 干扰），不再单列 walk-clue-list。
   - 反复走访：每次有新开场；已问过的追问不再显示。
   - 兼容性：保留原 _unlockBoundClue / _markSpoken / close 行为；进度条统计、存档键、
     ValidateUtil 门槛均不变。
   ============================================================ */
const ValidateUtil = {
  /**
   * 检测并返回时间轴上处于冲突状态的线索 id 列表（含 lie 与 misunderstand 两类）。
   * 注意：本方法只做检测、不直接刷新 DOM 标红——标红由调用方（renderLevel/commitLayout）负责。 */
  syncConflictMarks() {
    return ValidateUtil.detectTimelineConflict();
  },
  /**
   * 检测时间轴上的时序冲突：同一 conflictGroup 的证词同时出现在时间轴即视为矛盾。
   * @returns {string[]} 处于冲突状态的线索 id 列表
   */
  detectTimelineConflict() {
    const ids = App.layout.timeline || [];
    const groups = {};
    ids.forEach((id) => {
      const c = App.clueMap[id];
      if (!c || !c.conflictGroup) return;
      (groups[c.conflictGroup] = groups[c.conflictGroup] || []).push(id);
    });
    const conflict = [];
    Object.keys(groups).forEach((g) => {
      if (groups[g].length > 1) conflict.push.apply(conflict, groups[g]);
    });
    return conflict;
  },
  /** 汇总全图 conflictGroup → conflictType 映射（lie=主动撒谎；misunderstand=观察误会），供差异化提示 */
  groupTypes() {
    const m = {};
    Object.keys(App.clueMap || {}).forEach((id) => {
      const c = App.clueMap[id];
      if (c && c.conflictGroup && c.conflictType) m[c.conflictGroup] = c.conflictType;
    });
    return m;
  },
  /**
   * 时间重叠排查：仅统计「目击在场」类证据（isWitness 且有 [timeMin, timeMax] 区间），
   * 扫描端点找出同时在场人数最多的连续时段，列出全部在场者姓名。
   * 用于弹窗警示“多人具备作案时间”，防止单人锁凶。
   * @param {Object} cfg 当前关卡配置（读 solution 反查线索所属居民）
   * @returns {{lo:number, hi:number, names:string[], clueIds:string[]}|null} 重叠数 < 2 或数据不足返回 null
   */
  detectTimeOverlap(cfg) {
    const intervals = [];
    (App.layout.timeline || []).forEach((id) => {
      const c = App.clueMap[id];
      if (!c || c.isWitness !== true || typeof c.timeMin !== "number") return;
      if (typeof c.timeMax !== "number") return; // 瞬时时点不参与在场区间统计
      const lo = Math.min(c.timeMin, c.timeMax);
      const hi = Math.max(c.timeMin, c.timeMax);
      if (hi > lo) intervals.push({ id, lo, hi, involve: c.involve || [] });
    });
    if (intervals.length < 2) return null;
    // 端点扫描：寻找覆盖人数最多的连续时段
    const pts = [];
    intervals.forEach((iv) => { pts.push(iv.lo); pts.push(iv.hi); });
    pts.sort((a, b) => a - b);
    let best = null, bestCount = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const lo = pts[i], hi = pts[i + 1];
      if (hi <= lo) continue;
      const hit = intervals.filter((iv) => iv.lo <= lo && iv.hi >= hi);
      if (hit.length > bestCount) { bestCount = hit.length; best = { lo, hi, hits: hit }; }
    }
    if (!best || bestCount < 2) return null;
    // 线索 → 所属居民名（经 solution 映射；involve 字段把「被目击在场的人」一并计入名单）
    const ownerOf = {};
    const sol = (cfg && cfg.solution) || {};
    Object.keys(sol).forEach((rid) => { sol[rid].forEach((cid) => { ownerOf[cid] = rid; }); });
    const ridName = {};
    ((cfg && cfg.residents) || []).forEach((r) => { ridName[r.id] = r.name; });
    const names = [];
    const clueIds = [];
    best.hits.forEach((iv) => {
      clueIds.push(iv.id);
      const rid = ownerOf[iv.id];
      names.push(rid ? (ridName[rid] || "某人") : "某人");
      (iv.involve || []).forEach((rid2) => { names.push(ridName[rid2] || "某人"); });
    });
    const uniq = names.filter((n, i) => names.indexOf(n) === i);
    if (uniq.length < 2) return null;
    return { lo: best.lo, hi: best.hi, names: uniq, clueIds };
  },
  /** 由线索 id 反查其所在人物的姓名列表（用于报错提示文案）。
   *  卡槽机制已下线，改为查 solution 映射推断线索所属居民。 */
  conflictResidents(clueIds) {
    const set = new Set(clueIds);
    const names = [];
    const cfg = (typeof App !== "undefined" && App.levelData) || null;
    const sol = (cfg && cfg.solution) || {};
    const ridName = {};
    ((cfg && cfg.residents) || []).forEach((r) => { ridName[r.id] = r.name; });
    const ownerOf = {};
    Object.keys(sol).forEach((rid) => {
      (sol[rid] || []).forEach((cid) => { ownerOf[cid] = rid; });
    });
    set.forEach((cid) => {
      const rid = ownerOf[cid];
      if (rid && ridName[rid]) names.push(ridName[rid]);
    });
    return names.filter((n, i) => names.indexOf(n) === i);
  },
  /** 时间区间配对分析（缺陷 A 修复）：
   *  扫描时间轴上 [timeMin, timeMax] 区间已知的线索，识别两条线索的
   *  时间区间与"所描述对象"的关系，配对结果仅作软提示，不阻断。
   *  - overlap: 区间有交集 + 共同对象 → 提示"同一时间窗的多次描述"
   *  - mutex:   区间无交集 + 共同对象 → 提示"时间上不可能同时成立"
   *  共同对象判定优先级：pointsTo / involve 字段 → solution 映射推断。
   *  @param {Object} cfg 当前关卡配置（用于 solution 反查线索所属居民）
   *  @returns {{overlap:Array<{a:string,b:string,subject:string}>,mutex:Array<{a:string,b:string,subject:string}>}} */
  detectTimeRangePairing(cfg) {
    const ids = (App.layout.timeline || []).slice();
    const intervals = [];
    ids.forEach((id) => {
      const c = App.clueMap[id];
      if (!c || c.type === "fake") return;
      if (typeof c.timeMin !== "number" || typeof c.timeMax !== "number") return;
      intervals.push({
        id,
        lo: Math.min(c.timeMin, c.timeMax),
        hi: Math.max(c.timeMin, c.timeMax),
        pointsTo: c.pointsTo || null,
        involve: Array.isArray(c.involve) ? c.involve.slice() : [],
      });
    });
    const sol = (cfg && cfg.solution) || {};
    const ownerOf = {};
    Object.keys(sol).forEach((rid) => {
      (sol[rid] || []).forEach((cid) => { ownerOf[cid] = rid; });
    });
    const subjectsOf = (iv) => {
      const s = new Set();
      if (iv.pointsTo) s.add(iv.pointsTo);
      (iv.involve || []).forEach((r) => { if (r) s.add(r); });
      if (ownerOf[iv.id]) s.add(ownerOf[iv.id]);
      return s;
    };
    const overlap = [];
    const mutex = [];
    for (let i = 0; i < intervals.length; i++) {
      for (let j = i + 1; j < intervals.length; j++) {
        const A = intervals[i];
        const B = intervals[j];
        if (A.id === B.id) continue;
        const sa = subjectsOf(A);
        const sb = subjectsOf(B);
        const common = [];
        sa.forEach((s) => { if (sb.has(s)) common.push(s); });
        if (!common.length) continue;
        // 区间重叠：A.lo ≤ B.hi 且 B.lo ≤ A.hi
        if (A.lo <= B.hi && B.lo <= A.hi) {
          overlap.push({ a: A.id, b: B.id, subject: common[0] });
        } else if (A.hi < B.lo || B.hi < A.lo) {
          mutex.push({ a: A.id, b: B.id, subject: common[0] });
        }
      }
    }
    return { overlap, mutex };
  },
};

/* ============================================================
   模块五：拖拽管理（Pointer Events 统一方案，鼠标 / 触屏通用）
   移动端「长按锁定再拖」：按下后需长按 0.3s 锁定卡片，滑动才进入拖拽；
   锁定前的手指滑动一律视为页面滚动（防误拖）。
   ============================================================ */
/** 移动端长按锁定阈值（毫秒）：按住超过该时长后允许拖动 */
