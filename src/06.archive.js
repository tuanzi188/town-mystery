"use strict";
const BioArchive = {
  _toastTimer: null,

  /** 已解锁人物档案存储键列表 */
  getUnlocked() {
    return StorageUtil.readBioRecord();
  },

  /** 档案存储键：关卡序号 + 居民 id（id 在各关重复，需复合键保证跨关唯一） */
  _keyOf(levelIndex, residentId) {
    return "L" + levelIndex + "_" + residentId;
  },

  /** 某居民档案（按关卡定位）是否已解锁 */
  isUnlocked(levelIndex, residentId) {
    return this.getUnlocked().indexOf(this._keyOf(levelIndex, residentId)) !== -1;
  },

  /** 当前关卡是否已通关：本关全部居民档案均已解锁即视为已通关 */
  isLevelCleared() {
    const cfg = GameFlow.getLevelConfig();
    if (!cfg || !cfg.residents || !cfg.residents.length) return false;
    return cfg.residents.every((r) => this.isUnlocked(App.currentLevel, r.id));
  },

  /** 通关后解锁本关全部居民档案，返回本次「新增解锁」的居民列表（已在列表中的不重复写入） */
  unlockLevel(cfg) {
    const unlocked = new Set(this.getUnlocked());
    const newly = [];
    (cfg.residents || []).forEach((r) => {
      const key = this._keyOf(App.currentLevel, r.id);
      if (!unlocked.has(key)) { unlocked.add(key); newly.push(r); }
    });
    if (newly.length) StorageUtil.writeBioRecord(Array.from(unlocked));
    return newly;
  },

  /** 文本兜底：缺失字段给占位文案（后 6 关居民尚未补档案时避免空白） */
  _textOf(str, fallback) {
    return str ? ClueCards.escapeHtml(str) : fallback;
  },

  /** 打开人物档案弹窗：已解锁 → 完整档案；未解锁 → 上锁蒙版
   *  @param {Object} resident 居民对象
   *  @param {number} [levelIndex] 所属关卡序号（缺省用当前关卡；档案馆传入对应关卡）
   */
  openResidentBio(resident, levelIndex) {
    const mask = document.getElementById("bio-mask");
    const box = document.getElementById("bio-box");
    if (!mask || !box || !resident) return;
    // 用空值判断而非 ||：0/NaN/空串不应被静默回退到当前关卡
    const lv = levelIndex != null ? levelIndex : App.currentLevel;
    const esc = ClueCards.escapeHtml;
    const headHtml =
      '<div class="bio-head">' +
        '<span class="bio-avatar">' + AvatarFactory.buildWithPortrait(resident, { size: 80 }, lv) + "</span>" +
        '<div class="bio-id">' +
          '<h3 class="bio-name">' + esc(resident.name || "无名居民") + "</h3>" +
          '<span class="bio-tag">' + this._textOf(resident.tagShort, "身份未知") + "</span>" +
        "</div>" +
        '<button type="button" class="bio-close" id="bio-close" aria-label="关闭">×</button>' +
      "</div>";
    if (this.isUnlocked(lv, resident.id)) {
      box.innerHTML = headHtml +
        '<div class="bio-body">' +
          '<p class="bio-sec-title">· 人物生平</p>' +
          '<p class="bio-text">' + this._textOf(resident.bio, "档案记录整理中，请稍后再来。") + "</p>" +
          '<div class="bio-secret-box">' +
            '<p class="bio-sec-title">· 隐藏心事</p>' +
            '<p class="bio-text bio-secret">' + this._textOf(resident.secret, "这段往事被尘封，尚未有人知晓。") + "</p>" +
          "</div>" +
        "</div>";
    } else {
      box.innerHTML = headHtml +
        '<div class="bio-body">' +
          '<p class="bio-sec-title">· 人物生平</p>' +
          '<div class="bio-lock-veil">' +
            '<span class="bio-lock-icon">🔒</span>' +
            '<p class="bio-lock-tip">通关本关解锁完整档案</p>' +
            '<p class="bio-lock-sub">人物生平与隐藏心事已上锁</p>' +
          "</div>" +
        "</div>";
    }
    const closeBtn = box.querySelector("#bio-close");
    if (closeBtn) closeBtn.addEventListener("click", () => this.close());
    // 增量：渲染「相关人物」标签（同关其他居民，已解锁可点击跳转）
    this._renderRelated(box, resident, lv);
    mask.classList.add("show");
    // 可用性：弹窗出现后聚焦关闭键，便于键盘 / 读屏用户直接 ESC 或 Tab 操作
    if (closeBtn) closeBtn.focus();
  },

  /** 渲染相关人物标签：取同关其他居民（最多3个），已解锁可点击跳转档案 */
  _renderRelated(box, resident, levelIndex) {
    const cfg = LevelData[levelIndex - 1];
    if (!cfg || !cfg.residents) return;
    const others = cfg.residents.filter(r => r.id !== resident.id).slice(0, 3);
    if (!others.length) return;
    const esc = ClueCards.escapeHtml;
    const tagsHtml = others.map(r => {
      const unlocked = this.isUnlocked(levelIndex, r.id);
      if (unlocked) {
        return '<span class="bio-related-tag" data-lv="' + levelIndex + '" data-rid="' + esc(r.id) + '">' +
          esc(r.name) + "</span>";
      }
      return '<span class="bio-related-tag locked">' + esc(r.name) + "（未解锁）</span>";
    }).join("");
    const related = document.createElement("div");
    related.className = "bio-related";
    related.innerHTML = '<p class="bio-related-title">· 相关人物</p><div class="bio-related-tags">' + tagsHtml + "</div>";
    box.querySelector(".bio-body").appendChild(related);
    // 已解锁标签点击跳转
    related.querySelectorAll(".bio-related-tag:not(.locked)").forEach(tag => {
      tag.addEventListener("click", () => {
        const lv = Number(tag.dataset.lv);
        const rid = tag.dataset.rid;
        const target = ((LevelData[lv - 1] || {}).residents || []).find(r => r.id === rid);
        if (target) this.openResidentBio(target, lv);
      });
    });
  },

  /** 关闭人物档案弹窗 */
  close() {
    const mask = document.getElementById("bio-mask");
    if (mask) mask.classList.remove("show");
  },

  /** 首次解锁轻提示：淡入显示新增居民姓名，停留后自动淡出 */
  showUnlockToast(newly) {
    if (!newly || !newly.length) return;
    const toast = document.getElementById("toast-tip");
    if (!toast) return;
    toast.textContent = "解锁新人物档案：" + newly.map((r) => r.name).join("、");
    toast.classList.add("show");
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      toast.classList.remove("show");
    }, 2600);
  },
};

/* ============================================================
   模块七·补三：居民档案馆（全局人物收集总览页）
   说明：跨关卡统一图鉴，复用 BioArchive 的解锁记录。
   - 顶部实时统计：已解锁 / 本筛选下居民总数
   - 筛选：全部 / 第 1~11 关，记住上次筛选状态（localStorage）
   - 卡片：已解锁 → 彩色头像 + 姓名 + 身份标签，点击打开完整档案；
            未解锁 → 灰色蒙版 + 加锁图标，点击提示通关解锁
   - 卡片底部小字标注所属关卡编号
   仅增量；不触碰 DragManager / ValidateUtil / 推理校验逻辑。
   ============================================================ */
const Archive = {
  FILTER_KEY: "archiveFilter",
  /** 读取上次筛选状态：'all' 或关卡序号，非法值回退 'all' */
  getFilter() {
    const f = StorageUtil.read(this.FILTER_KEY, "all");
    if (f === "all") return "all";
    const n = Number(f);
    return (n >= 1 && n <= App.totalLevels) ? n : "all";
  },
  /** 记住筛选状态 */
  setFilter(f) {
    StorageUtil.write(this.FILTER_KEY, f);
  },
  /** 全关卡居民总数 */
  totalResidents() {
    return LevelData.reduce((sum, l) => sum + (((l.residents) || []).length), 0);
  },
  /** 当前筛选下已解锁的居民数 */
  unlockedCount(filter) {
    let count = 0;
    LevelData.forEach((l, idx) => {
      const lv = idx + 1;
      if (filter !== "all" && Number(filter) !== lv) return;
      (l.residents || []).forEach((r) => {
        if (BioArchive.isUnlocked(lv, r.id)) count++;
      });
    });
    return count;
  },
  /** 渲染整页：进度 + 筛选按钮 + 人物网格 */
  render() {
    const filter = this.getFilter();
    const total = filter === "all"
      ? this.totalResidents()
      : (((LevelData[Number(filter) - 1] || {}).residents) || []).length;
    const unlocked = this.unlockedCount(filter);
    document.getElementById("archive-progress").textContent =
      "已解锁 " + unlocked + " / " + total + " 位居民";
    this.renderFilter(filter);
    this.renderGrid(filter);
    // 增量：进入档案馆时兜底检测全收集（防止通关时错过弹窗）
    Achievement.check();
  },
  /** 渲染顶部筛选按钮 */
  renderFilter(active) {
    const bar = document.getElementById("archive-filter");
    bar.innerHTML = "";
    const mk = (val, label) => {
      const b = document.createElement("button");
      const isActive = String(val) === String(active);
      b.className = "archive-filter-btn" + (isActive ? " active" : "");
      b.setAttribute("aria-pressed", isActive ? "true" : "false");
      b.textContent = label;
      b.addEventListener("click", () => {
        this.setFilter(val);
        this.render();
      });
      bar.appendChild(b);
    };
    mk("all", "全部人物");
    LevelData.forEach((l, i) => mk(i + 1, "第 " + (i + 1) + " 关"));
  },
  /** 渲染人物卡片网格 */
  renderGrid(filter) {
    const grid = document.getElementById("archive-grid");
    grid.innerHTML = "";
    LevelData.forEach((l, idx) => {
      const lv = idx + 1;
      if (filter !== "all" && Number(filter) !== lv) return;
      (l.residents || []).forEach((r) => {
        const unlocked = BioArchive.isUnlocked(lv, r.id);
        const card = document.createElement("button");
        card.className = "archive-card" + (unlocked ? "" : " locked");
        card.innerHTML =
          '<span class="arc-avatar">' + (unlocked
            ? AvatarFactory.buildWithPortrait(r, { size: 52 }, lv)
            : "🔒") + "</span>" +
          '<span class="arc-name">' + ClueCards.escapeHtml(r.name || "？？？") + "</span>" +
          (unlocked && r.tagShort
            ? '<span class="arc-tag">' + ClueCards.escapeHtml(r.tagShort) + "</span>"
            : '<span class="arc-tag">档案未解锁</span>') +
          '<span class="arc-level">第 ' + lv + ' 关</span>';
        card.addEventListener("click", () => {
          if (unlocked) {
            BioArchive.openResidentBio(r, lv);
          } else {
            Modal.alert("档案已上锁", "通关第 " + lv + " 关即可解锁「" +
              ClueCards.escapeHtml(r.name || "该人物") + "」的完整档案。");
          }
        });
        grid.appendChild(card);
      });
    });
  },
};

/* ============================================================
   模块七·补四：小镇群像总图（TownMap，SVG 按地点排布所有居民）
   说明：
   - 按 tagShort 关键词推断每位居民所属地点，不修改 LevelData
   - SVG 分 8 个地点区域，区域内居民竖排
   - 已解锁节点彩色可点击打开档案；未解锁灰色锁
   - hover 显示人设 tooltip
   仅增量；不触碰 DragManager / ValidateUtil / 推理校验逻辑。
   ============================================================ */
const TownMap = {
  ZONES: [
    { id: "market",    name: "镇东菜市场",   x: 30,  y: 50 },
    { id: "shops",     name: "镇口商铺街",   x: 200, y: 50 },
    { id: "gate",      name: "小区门卫室",   x: 370, y: 50 },
    { id: "school",    name: "镇中学",       x: 540, y: 50 },
    { id: "clinic",    name: "镇卫生院",     x: 30,  y: 270 },
    { id: "hall",      name: "社区活动室",   x: 200, y: 270 },
    { id: "residents", name: "小区住宅楼",   x: 370, y: 270 },
    { id: "square",    name: "镇广场",       x: 540, y: 270 },
  ],
  ZONE_W: 160,
  NODE_H: 24,

  /** tagShort 关键词 → 地点 id（未命中默认归「小区住宅楼」）
   *  学生类覆盖「学生/备考生/小学/初中/高中/大学/年级/女生/男生」，
   *  避免「小学五年级」「高中女生」「在校大学生」等称呼漏归。 */
  _zoneOf(tagShort) {
    if (!tagShort) return "residents";
    const t = tagShort;
    if (t.indexOf("摊主") !== -1) return "market";
    if (["老板", "店员", "驿站", "花店", "花艺", "收银员", "汽修", "快递站"].some(k => t.indexOf(k) !== -1)) return "shops";
    if (["门卫", "保安"].some(k => t.indexOf(k) !== -1)) return "gate";
    if (["学生", "备考生", "小学", "初中", "高中", "大学", "年级", "女生", "男生"].some(k => t.indexOf(k) !== -1)) return "school";
    if (["护士", "医生"].some(k => t.indexOf(k) !== -1)) return "clinic";
    if (["活动室", "志愿者", "维修工"].some(k => t.indexOf(k) !== -1)) return "hall";
    if (["晨跑", "太极", "货运", "外卖", "水电工", "环卫", "退休老教师", "退休老木匠", "退休职工", "退休钳工"].some(k => t.indexOf(k) !== -1)) return "square";
    return "residents";
  },

  /** 收集全部居民并按地点分组 */
  _collectByZone() {
    const groups = {};
    this.ZONES.forEach(z => { groups[z.id] = []; });
    LevelData.forEach((lv, idx) => {
      const lvNum = idx + 1;
      (lv.residents || []).forEach(r => {
        const zid = this._zoneOf(r.tagShort);
        if (!groups[zid]) groups[zid] = [];
        groups[zid].push({ resident: r, level: lvNum, unlocked: BioArchive.isUnlocked(lvNum, r.id) });
      });
    });
    return groups;
  },

  /** 渲染 SVG 群像总图并弹出 */
  render() {
    const box = document.getElementById("town-map-box");
    if (!box) return;
    const esc = ClueCards.escapeHtml;
    const groups = this._collectByZone();
    // 计算画布高度：两行区域各取最大节点数
    const row1Max = Math.max(1, ...this.ZONES.slice(0, 4).map(z => groups[z.id].length));
    const row2Max = Math.max(1, ...this.ZONES.slice(4).map(z => groups[z.id].length));
    const row1H = row1Max * this.NODE_H + 40;
    const row2H = row2Max * this.NODE_H + 40;
    const svgW = 710;
    const svgH = 50 + row1H + 30 + row2H + 20;

    let html = '<div class="town-map-head"><h3>小镇群像总图</h3>' +
      '<button type="button" class="town-map-close" id="tm-close" aria-label="关闭">×</button></div>';
    html += '<svg class="town-map-svg" viewBox="0 0 ' + svgW + " " + svgH + '" xmlns="http://www.w3.org/2000/svg">';
    this.ZONES.forEach(z => {
      const list = groups[z.id] || [];
      html += '<g transform="translate(' + z.x + "," + z.y + ')">';
      html += '<text class="tm-zone-label" x="0" y="0">' + esc(z.name) + "（" + list.length + "）</text>";
      list.forEach((item, i) => {
        const ny = 20 + i * this.NODE_H;
        const cx = 12;
        const nodeCls = "tm-node" + (item.unlocked ? "" : " locked");
        const label = item.unlocked ? esc(item.resident.name || "?") : "🔒";
        html += '<g class="' + nodeCls + '" data-lv="' + item.level + '" data-rid="' + esc(item.resident.id) + '">';
        html += '<circle class="tm-node-circle" cx="' + cx + '" cy="' + ny + '" r="9"/>';
        html += '<text class="tm-node-text" x="' + (cx + 16) + '" y="' + (ny + 3) + '" text-anchor="start">' + label + "</text>";
        html += "</g>";
      });
      html += "</g>";
    });
    html += "</svg>";
    box.innerHTML = html;

    // 绑定关闭
    const closeBtn = box.querySelector("#tm-close");
    if (closeBtn) closeBtn.addEventListener("click", () => this.close());
    // 节点交互
    box.querySelectorAll(".tm-node").forEach(node => {
      const lv = Number(node.dataset.lv);
      const rid = node.dataset.rid;
      const cfg = LevelData[lv - 1] || {};
      const resident = (cfg.residents || []).find(r => r.id === rid);
      if (!resident) return;
      const unlocked = BioArchive.isUnlocked(lv, rid);
      node.addEventListener("mouseenter", e => this._onHover(e, resident, lv, unlocked));
      node.addEventListener("mousemove", e => this._moveTooltip(e));
      node.addEventListener("mouseleave", () => this._hideTooltip());
      node.addEventListener("click", () => {
        if (unlocked) {
          this._hideTooltip();
          BioArchive.openResidentBio(resident, lv);
        } else {
          Modal.alert("档案已上锁", "通关第 " + lv + " 关即可解锁「" +
            esc(resident.name || "该人物") + "」的完整档案。");
        }
      });
    });
    document.getElementById("town-map-mask").classList.add("show");
    if (closeBtn) closeBtn.focus();
  },

  _onHover(e, resident, lv, unlocked) {
    let tip = document.getElementById("tm-tooltip");
    if (!tip) {
      tip = document.createElement("div");
      tip.id = "tm-tooltip";
      tip.className = "tm-tooltip";
      document.body.appendChild(tip);
    }
    const esc = ClueCards.escapeHtml;
    if (unlocked) {
      const bioShort = resident.bio ? resident.bio.slice(0, 50) + (resident.bio.length > 50 ? "…" : "") : "档案整理中";
      tip.innerHTML = "<strong>" + esc(resident.name) + "</strong> · " + esc(resident.tagShort || "") + "<br/>" +
        '<span style="opacity:.8">第 ' + lv + " 关</span><br/>" + esc(bioShort);
    } else {
      tip.innerHTML = "<strong>档案未解锁</strong><br/>通关第 " + lv + " 关解锁";
    }
    this._moveTooltip(e);
    tip.classList.add("show");
  },
  _moveTooltip(e) {
    const tip = document.getElementById("tm-tooltip");
    if (!tip) return;
    // 边界兜底：极窄屏下避免负数定位、超出视口
    const left = Math.max(0, Math.min(e.clientX + 14, window.innerWidth - 240));
    const top = Math.max(0, e.clientY + 14);
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  },
  _hideTooltip() {
    const tip = document.getElementById("tm-tooltip");
    if (tip) tip.classList.remove("show");
  },
  close() {
    this._hideTooltip();
    const mask = document.getElementById("town-map-mask");
    if (mask) mask.classList.remove("show");
  },
};

/* ============================================================
   模块七·补五：跨关人物关系（LorePanel，TOWN_LORE）
   说明：
   - 双方居民档案均已解锁 → 关系条目可见，人名可点击打开档案
   - 任一方未解锁 → 关系描述隐藏，显示「通关相关关卡解锁」
   仅增量；不触碰 DragManager / ValidateUtil / 推理校验逻辑。
   ============================================================ */
const LorePanel = {
  /** 按关卡 + 居民 id 取居民对象 */
  _resident(lv, rid) {
    const cfg = LevelData[lv - 1];
    return cfg ? ((cfg.residents || []).find((r) => r.id === rid) || null) : null;
  },
  /** 该关卡居民档案是否已解锁 */
  _unlocked(lv, rid) {
    return BioArchive.isUnlocked(lv, rid);
  },
  /** 打开人物关系弹窗 */
  open() {
    const box = document.getElementById("lore-box");
    const mask = document.getElementById("lore-mask");
    if (!box || !mask) return;
    if (typeof TOWN_LORE === "undefined" || !TOWN_LORE) return;
    const esc = ClueCards.escapeHtml;
    let unlockedCount = 0;
    const cards = TOWN_LORE.map((item) => {
      const a = this._resident(item.a.lv, item.a.rid);
      const b = this._resident(item.b.lv, item.b.rid);
      const aOk = !!(a && this._unlocked(item.a.lv, item.a.rid));
      const bOk = !!(b && this._unlocked(item.b.lv, item.b.rid));
      const open = aOk && bOk;
      if (open) unlockedCount++;
      // 人名：已解锁可点击打开档案；未解锁置灰
      const person = (r, lv, ok) =>
        r
          ? '<span class="lore-pname' + (ok ? "" : " locked") + '" data-lv="' + lv + '" data-rid="' + esc(r.id) + '">' + esc(r.name) + "</span>"
          : '<span class="lore-pname locked">？</span>';
      const avatar = (r) => (r ? AvatarFactory.build(r, { size: 34 }) : "");
      return '<div class="lore-card' + (open ? "" : " locked") + '">' +
        '<div class="lore-pair">' +
          '<span class="lore-avatar">' + avatar(a) + "</span>" + person(a, item.a.lv, aOk) +
          '<span class="lore-and">×</span>' +
          '<span class="lore-avatar">' + avatar(b) + "</span>" + person(b, item.b.lv, bOk) +
        "</div>" +
        (open
          ? '<p class="lore-rel">' + esc(item.rel) + "</p><p class=\"lore-lock-tip\">第 " + item.a.lv + " 关 · 第 " + item.b.lv + " 关</p>"
          : '<p class="lore-lock-tip">🔒 通关相关关卡后，看清这段关系</p>') +
        "</div>";
    }).join("");
    box.innerHTML =
      '<div class="town-map-head"><h3>人物关系 · 小镇人情网</h3>' +
        '<button type="button" class="town-map-close" id="lore-close" aria-label="关闭">×</button></div>' +
      '<p class="lore-progress">已解锁 <b>' + unlockedCount + "</b> / " + TOWN_LORE.length + " 条关系</p>" +
      '<div class="bio-body"><div class="lore-grid">' + cards + "</div></div>";
    const closeBtn = box.querySelector("#lore-close");
    if (closeBtn) closeBtn.addEventListener("click", () => this.close());
    // 人名点击：已解锁 → 打开档案；未解锁 → 提示
    box.querySelectorAll(".lore-pname:not(.locked)").forEach((el) => {
      el.addEventListener("click", () => {
        const lv = Number(el.dataset.lv);
        const rid = el.dataset.rid;
        const resident = this._resident(lv, rid);
        if (resident) BioArchive.openResidentBio(resident, lv);
      });
    });
    box.querySelectorAll(".lore-pname.locked").forEach((el) => {
      el.addEventListener("click", () => {
        Modal.alert("档案已上锁", "通关对应关卡、解锁双方人物档案后，才能查看这段关系。");
      });
    });
    mask.classList.add("show");
    if (closeBtn) closeBtn.focus();
  },
  close() {
    const mask = document.getElementById("lore-mask");
    if (mask) mask.classList.remove("show");
  },
};

/* ============================================================
   模块七·补七：小镇大事记（ChroniclePanel，TOWN_CHRONICLE）
   说明：
   - 每关对应一条大事记，通关（该关全部居民档案解锁）后可见
   - 垂直时间线列表，未解锁条目以锁提示展示（不剧透文案）
   仅增量；不触碰 DragManager / ValidateUtil / 推理校验逻辑。
   ============================================================ */
const ChroniclePanel = {
  /** 该关卡是否已通关（全部居民档案解锁即视为通关） */
  _cleared(lv) {
    const cfg = LevelData[lv - 1];
    if (!cfg || !cfg.residents) return false;
    return cfg.residents.every((r) => BioArchive.isUnlocked(lv, r.id));
  },
  /** 打开小镇大事记弹窗 */
  open() {
    const box = document.getElementById("chronicle-box");
    const mask = document.getElementById("chronicle-mask");
    if (!box || !mask) return;
    if (typeof TOWN_CHRONICLE === "undefined" || !TOWN_CHRONICLE) return;
    const esc = ClueCards.escapeHtml;
    let unlockedCount = 0;
    const items = TOWN_CHRONICLE.map((c) => {
      const ok = this._cleared(c.lv);
      if (ok) unlockedCount++;
      const cfg = LevelData[c.lv - 1] || {};
      const ending = (cfg.ext && cfg.ext.endingStory) || "";
      return ok
        ? '<div class="chron-item">' +
            '<p class="chron-title">' + esc(c.title) + ' <span class="chron-tag">第 ' + c.lv + " 章</span></p>" +
            '<p class="chron-event">' + esc(ending) + "</p></div>"
        : '<div class="chron-item locked">' +
            '<p class="chron-title">' + esc(c.title) + ' <span class="chron-tag">第 ' + c.lv + " 章</span></p>" +
            '<p class="chron-lock">🔒 通关第 ' + c.lv + ' 关，解锁这段小镇往事</p></div>';
    }).join("");
    box.innerHTML =
      '<div class="town-map-head"><h3>小镇大事记</h3>' +
        '<button type="button" class="town-map-close" id="chron-close" aria-label="关闭">×</button></div>' +
      '<p class="lore-progress">已解锁 <b>' + unlockedCount + "</b> / " + TOWN_CHRONICLE.length + " 章往事</p>" +
      '<div class="bio-body"><div class="chron-list">' + items + "</div></div>";
    const closeBtn = box.querySelector("#chron-close");
    if (closeBtn) closeBtn.addEventListener("click", () => this.close());
    mask.classList.add("show");
    if (closeBtn) closeBtn.focus();
  },
  close() {
    const mask = document.getElementById("chronicle-mask");
    if (mask) mask.classList.remove("show");
  },
};

/* ============================================================
   模块七·补五：全收集成就纪念弹窗（Achievement，一次性）
   说明：
   - 全部居民解锁时弹出全屏纪念弹窗，localStorage 标记已展示
   - 已展示过不再重复弹出
   - 弹窗内可一键跳转群像总图
   仅增量；不触碰 DragManager / ValidateUtil / 推理校验逻辑。
   ============================================================ */
