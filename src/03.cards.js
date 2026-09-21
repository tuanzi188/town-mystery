"use strict";
const ClueCards = {
  /** 转义 HTML 特殊字符，防止线索文本破坏结构 */
  escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  },
  /** 线索两级分类：第一级是「来源」（口供=人物证词 / 物证=实物 / 干扰=真假标记），
   *  第二级是口供的「形态」（目击 / 自白 / 陈述），供 buildCard 与 clue-toast 共用。
   *  返回 { family, typeCls, badge, subBadge, badgeIcon, badgeText }。 */
  classify(clue) {
    if (!clue) return { family: "", typeCls: "", badge: "", subBadge: "", badgeIcon: "", badgeText: "" };
    if (clue.type === "fake") {
      return { family: "fake", typeCls: "", badge: "", subBadge: "", badgeIcon: "⚠", badgeText: "干扰" };
    }
    if (clue.isEvidence) {
      return { family: "evidence", typeCls: "evidence", badge: '<span class="clue-badge family-evidence">🔑 物证</span>', subBadge: "", badgeIcon: "🔑", badgeText: "物证" };
    }
    if (clue.isWitness) {
      return { family: "verbal", typeCls: "", badge: '<span class="clue-badge family-verbal">💬 口供</span>', subBadge: '<span class="clue-sub-badge form-witness">👁 目击</span>', badgeIcon: "👁", badgeText: "口供·目击" };
    }
    if (clue.isSuspectStatement) {
      return { family: "verbal", typeCls: "", badge: '<span class="clue-badge family-verbal">💬 口供</span>', subBadge: '<span class="clue-sub-badge form-statement">🗣 自白</span>', badgeIcon: "🗣", badgeText: "口供·自白" };
    }
    return { family: "verbal", typeCls: "", badge: '<span class="clue-badge family-verbal">💬 口供</span>', subBadge: '<span class="clue-sub-badge form-plain">📁 陈述</span>', badgeIcon: "📁", badgeText: "口供·陈述" };
  },
  /** 顶部徽标：来源大类（口供 / 物证）+ 口供形态（目击 / 自白 / 陈述）+ 说话人 / 物证身份角标。 */
  topBadgesHtml(clue) {
    if (!clue) return "";
    const cls = this.classify(clue);
    const isFake = clue.type === "fake";
    const owner = App.clueOwner ? App.clueOwner[clue.id] : null;
    if (isFake) {
      // 干扰线索：不显示来源徽标，但保留说话人角标作为干扰方
      return owner ? '<span class="clue-speak">' + this.escapeHtml(owner) + "</span>" : "";
    }
    if (clue.isEvidence) {
      const ownerTag = clue.evidenceOwnerTag ? this.escapeHtml(clue.evidenceOwnerTag) : "";
      const dirCls = clue.evidenceDirection === "clear" ? " ev-owner--clear" : "";
      return cls.badge +
        (ownerTag ? '<span class="clue-speak ev-owner' + dirCls + '" data-ev-owner="' + ownerTag + '">对应：' + ownerTag + "</span>" : "");
    }
    return cls.badge + cls.subBadge +
      (owner ? '<span class="clue-speak">' + this.escapeHtml(owner) + "</span>" : "");
  },
  /** 按线索类型构建卡片元素：type === "fake" 为浅灰色干扰线索，其余按 isEvidence/isSuspectStatement/isWitness 分层。
   *  卡片右上角加 ⊕ 按钮：把线索加入/移出 CaseFile 证据链（独立于卡槽/时间轴）。 */
  buildCard(clue, lockedIds) {
    const isFake = clue.type === "fake";
    const locked = lockedIds && lockedIds.indexOf(clue.id) !== -1;
    const cls = this.classify(clue);
    const inCase = (typeof CaseFile !== "undefined") && CaseFile.has(clue.id);
    // 关键物证角标：evidenceKeys 显式配置的关键佐证在卡面亮「🔍关键」，
    // 与指认弹窗「缺少关键佐证」一一对应，让玩家提前知晓哪些是必须收集的铁证
    const evKeys = (App.levelData && App.levelData.ext && App.levelData.ext.evidenceKeys) || [];
    const isKey = !isFake && evKeys.indexOf(clue.id) !== -1;
    const keyBadge = isKey ? '<span class="clue-badge key-badge">🔍关键</span>' : "";
    // Item 1: 半真半假线索角标
    var partialBadge = "";
    if (!isFake && clue.partialTruth) {
      var _collected = new Set([].concat(App.layout.pool || [], App.layout.timeline || []));
      var _resolved = clue.partialTruth.revealCid && _collected.has(clue.partialTruth.revealCid);
      partialBadge = _resolved
        ? '<span class="clue-badge partial-badge resolved">✓ 已拆穿</span>'
        : '<span class="clue-badge partial-badge">⚖ 半真半假</span>';
    }
    // Item 3: 物证组合角标 — 该物证属于某组合锁凶所需，提示玩家必须收集整组才能定罪
    var comboBadge = "";
    if (!isFake) {
      const combos = (App.levelData && App.levelData.ext && App.levelData.ext.comboEvidence) || [];
      const hitCombo = combos.find((c) => Array.isArray(c.need) && c.need.indexOf(clue.id) !== -1);
      if (hitCombo) comboBadge = '<span class="clue-badge combo-badge">🔗 组合物证 ' + hitCombo.need.length + " 件套</span>";
    }
    const el = document.createElement("div");
    el.className = "clue-card foldable" + (isFake ? " fake" : " valid") +
      (cls.typeCls ? " " + cls.typeCls : "") +
      (locked ? " locked" : "") +
      (inCase ? " in-case" : "");
    el.dataset.clueId = clue.id;
    el.dataset.type = clue.type;
    el.dataset.clueKind = cls.family || "verbal"; // 来源大类：evidence / verbal / fake（筛选用）
    el.dataset.clueForm = (cls.family === "verbal")
      ? (clue.isWitness ? "witness" : (clue.isSuspectStatement ? "statement" : "plain"))
      : ""; // 口供形态：witness / statement / plain（口供子筛用）
    el.dataset.locked = locked ? "1" : "0";
    el.draggable = false; // 本游戏用手势拖拽，禁用 HTML5 原生拖拽
    const speak = this.topBadgesHtml(clue);
    // ⊕ 按钮：把线索加入/移出 CaseFile 证据链。点击事件由 GameFlow 统一代理（事件委托）。
    const caseBtn = '<button type="button" class="clue-case-toggle' + (inCase ? " in-case" : "") +
      '" data-cid="' + this.escapeHtml(clue.id) + '" title="' + (inCase ? "从证据链移除" : "加入证据链") +
      '" aria-label="' + (inCase ? "从证据链移除" : "加入证据链") + '">' + (inCase ? "✓" : "⊕") + "</button>";
    // ⏱ 时间轴快捷按钮（仅移动端显示）：带时间的线索一键 入轴/出轴，免去长距离拖拽。
    // 锁定线索不可挪动，不渲染；点击事件同样由 GameFlow 事件委托处理。
    const inTimeline = !locked &&
      (App.layout && App.layout.timeline && App.layout.timeline.indexOf(clue.id) !== -1);
    const tlBtn = '<button type="button" class="clue-tl-toggle' + (inTimeline ? " in-tl" : "") +
      '" data-cid="' + this.escapeHtml(clue.id) + '" title="' + (inTimeline ? "从时间轴移回线索池" : "加入时间轴") +
      '" aria-label="' + (inTimeline ? "从时间轴移回线索池" : "加入时间轴") + '">' + (inTimeline ? "◀" : "⏱") + "</button>";
    const linksHtml = this.linkChipsHtml(clue.id);
    el.innerHTML =
      '<div class="clue-card-controls">' +
      (locked ? "" : tlBtn) +
      '<span class="clue-card-controls-gap"></span>' +
      caseBtn +
      "</div>" +
      speak +
      keyBadge +
      partialBadge +
      comboBadge +
      '<p class="clue-text">' + this.escapeHtml(clue.text) + "</p>" +
      (isFake || locked
        ? '<span class="clue-type">' + (isFake ? "干扰线索" : "") +
            (locked ? '<span class="clue-lock-mark">🔒 已锁定</span>' : "") + "</span>"
        : "") +
      (linksHtml ? '<div class="clue-links">' + linksHtml + "</div>" : "") +
      '<button type="button" class="clue-fold-toggle" data-cid="' + this.escapeHtml(clue.id) +
        '" title="展开全文" aria-label="展开全文">▾ 展开</button>';
    return el;
  },
  /** 移动端时间轴快捷操作：带时间的线索在「线索池 ↔ 时间轴」间一键切换（复用拖拽的归档逻辑）。
   *  无时间描述的线索（干扰等）点击时给出与拖拽一致的红灯提示；锁定线索不会渲染此按钮。 */
  toggleTimeline(cid) {
    if (!cid || !App.layout || !App.clueMap || !App.clueMap[cid]) return;
    if (typeof DragManager._moveCard !== "function" || typeof GameFlow.commitLayout !== "function") return;
    const clue = App.clueMap[cid];
    const inTimeline = (App.layout.timeline || []).indexOf(cid) !== -1;
    if (inTimeline) {
      DragManager._moveCard(cid, { type: "pool" });      // 出轴：放回线索池
    } else {
      if (typeof clue.timeMin !== "number") {            // 无时间信息：与拖拽一致的提示
        if (typeof DragManager._showInvalidTimelineTip === "function") DragManager._showInvalidTimelineTip();
        return;
      }
      DragManager._moveCard(cid, { type: "timeline" });  // 入轴：按时间排序插入
    }
    GameFlow.commitLayout();                             // 存档 → 重渲染 → 刷新冲突标红
    if (!inTimeline) GameFlow.notifyTimeOverlap();       // 入轴后弹时间重叠排查（与拖拽一致）
  },
  /** 给本轮新加入池子的线索卡片加上「入卷」动画（fly-in + 短暂高亮）。
   *  调用方传入 newCids 数组，渲染后比对 DOM，命中即加 entering class，动画结束自动移除。
   *  留空时直接返回，不影响正常渲染。 */
  markEntering(poolEls, newCids) {
    if (!newCids || !newCids.length) return;
    const set = new Set(newCids);
    poolEls.forEach((el) => {
      if (set.has(el.dataset.clueId)) {
        el.classList.add("entering");
        el.addEventListener("animationend", function once() {
          el.classList.remove("entering");
          el.removeEventListener("animationend", once);
        });
      }
    });
  },
  /** 构建线索关联 / 物证身份匹配的轻提示角标。
   *  依赖 App.insights（由 GameFlow.renderLevel 注入）。
   *  返回 HTML 字符串；无提示时返回空串。 */
  linkChipsHtml(cid) {
    const ins = App.insights || {};
    const list = (ins.byClue && ins.byClue[cid]) || [];
    if (!list.length) return "";
    const ownerNames = [];
    let hasCorroborate = false;
    list.forEach((link) => {
      if (link.kind === "owner") {
        if (link.name && ownerNames.indexOf(link.name) === -1) ownerNames.push(link.name);
      } else {
        hasCorroborate = true;
      }
    });
    const chips = [];
    if (hasCorroborate) {
      chips.push('<span class="clue-link" title="与其他线索可互相印证">🔗 印证</span>');
    }
    ownerNames.forEach((name) => {
      chips.push('<span class="clue-link owner" title="物证身份与「' + this.escapeHtml(name) +
        '」匹配，请留意">🔗 身份·' + this.escapeHtml(name) + "</span>");
    });
    return chips.join("");
  },
  /** 展开 / 收起线索全文（仅线索池卡片绑定了 foldable 样式） */
  toggleFold(cid) {
    const card = document.querySelector('.clue-card[data-clue-id="' + CSS.escape(cid) + '"]');
    if (!card) return;
    const expanded = card.classList.toggle("expanded");
    const btn = card.querySelector(".clue-fold-toggle");
    if (btn) {
      btn.textContent = expanded ? "▴ 收起" : "▾ 展开";
      btn.title = expanded ? "收起全文" : "展开全文";
      btn.setAttribute("aria-label", btn.title);
    }
  },
};

/* ============================================================
   模块三·增：线索详情二级弹窗 (ClueDetail)
   点击线索卡片弹出，展示完整证词 + 印证链 + 收集/入轴操作，
   缓解移动端卡片信息过载；操作态与主卡/底部计数条实时同步。
   ============================================================ */
const ClueDetail = {
  /** 打开某条线索的详情弹窗 */
  open(cid) {
    if (!cid || !App.clueMap || !App.clueMap[cid]) return;
    this.render(cid);
    const mask = document.getElementById("clue-detail-mask");
    if (mask) mask.classList.add("show");
  },
  /** 关闭详情弹窗 */
  close() {
    const mask = document.getElementById("clue-detail-mask");
    if (mask) mask.classList.remove("show");
  },
  /** 渲染详情弹窗内容并绑定内部按钮 */
  render(cid) {
    const box = document.getElementById("clue-detail-box");
    if (!box) return;
    const c = App.clueMap[cid];
    if (!c) { box.innerHTML = ""; return; }
    const esc = ClueCards.escapeHtml;
    const isFake = c.type === "fake";
    const locked = App.layout.locked && App.layout.locked.indexOf(cid) !== -1;
    const inCase = (typeof CaseFile !== "undefined") && CaseFile.has(cid);
    const inTimeline = !locked && App.layout.timeline && App.layout.timeline.indexOf(cid) !== -1;
    const hasTime = typeof c.timeMin === "number";
    const evKeys = (App.levelData && App.levelData.ext && App.levelData.ext.evidenceKeys) || [];
    const isKey = !isFake && evKeys.indexOf(cid) !== -1;
    const keyBadge = isKey ? '<span class="clue-badge key-badge">🔍 关键</span>' : "";
    const links = ClueCards.linkChipsHtml(cid);
    box.innerHTML =
      '<div class="clue-detail-head">' +
        '<div class="clue-detail-badges">' + ClueCards.topBadgesHtml(c) + keyBadge + "</div>" +
        '<button type="button" class="clue-detail-close" data-close title="关闭" aria-label="关闭">×</button>' +
      "</div>" +
      '<p class="clue-detail-text">' + esc(c.text) + "</p>" +
      '<div class="clue-detail-meta">' +
        (isFake ? '<span class="clue-detail-tag">⚠ 干扰线索</span>' : "") +
        (locked ? '<span class="clue-detail-tag">🔒 已锁定</span>' : "") +
        (hasTime ? '<span class="clue-detail-tag">🕐 ' + esc(c.timeText || "有时间信息") + "</span>" : "") +
      "</div>" +
      (links ? '<div class="clue-links">' + links + "</div>" : "") +
      '<div class="clue-detail-actions">' +
        '<button type="button" class="clue-detail-btn" data-case>' +
          (inCase ? "✓ 已加入证据链" : "⊕ 加入证据链") + "</button>" +
        (locked ? "" :
          '<button type="button" class="clue-detail-btn" data-tl>' +
            (inTimeline ? "◀ 移出时间轴" : "⏱ 加入时间轴") + "</button>") +
      "</div>";
    const closeBtn = box.querySelector("[data-close]");
    if (closeBtn) closeBtn.onclick = () => this.close();
    const caseBtn = box.querySelector("[data-case]");
    if (caseBtn) caseBtn.onclick = () => { this.close(); CaseFile.toggle(cid); };
    const tlBtn = box.querySelector("[data-tl]");
    if (tlBtn) tlBtn.onclick = () => {
      if (!hasTime) {
        if (typeof DragManager._showInvalidTimelineTip === "function") DragManager._showInvalidTimelineTip();
        return;
      }
      this.close();
      ClueCards.toggleTimeline(cid);
    };
  },
};

/* ============================================================
   模块三·补：证据链 (CaseFile) — 玩家自主收集的「指认证据」池
   - 状态：App.layout.caseFile = [cid, ...]，由 StorageUtil 持久化
   - 操作：toggle/clear/render，三件套与 ClueCards 互不耦合
   - 与 evaluateCase 联动：玩家点击「指认凶手」时，若 caseFile.length >= 3，
     弹窗展示证据链并由 _handleAccusation 调 evaluateCase 出 verdict
   ============================================================ */
const CaseFile = {
  /** 读取当前证据链（保证是字符串数组） */
  get() {
    const arr = (App.layout && App.layout.caseFile) || [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  },
  /** 是否包含某条线索 */
  has(cid) { return this.get().indexOf(cid) !== -1; },
  /** 切换单条线索的「在/不在证据链」状态。
   *  返回最新 caseFile 数组。已脱离线索池的 cid（玩家原本锁后被系统剔除）不写入。 */
  toggle(cid) {
    if (!cid || !App.clueMap || !App.clueMap[cid]) return this.get();
    const list = this.get();
    const idx = list.indexOf(cid);
    let next;
    if (idx === -1) {
      next = list.concat([cid]);
    } else {
      next = list.slice();
      next.splice(idx, 1);
    }
    App.layout.caseFile = next;
    StorageUtil.writeLevelState(App.currentLevel, App.layout);
    this._syncDom(cid);
    this.render();
    return next;
  },
  /** 清空全部 */
  clear() {
    if (!App.layout) return;
    App.layout.caseFile = [];
    StorageUtil.writeLevelState(App.currentLevel, App.layout);
    document.querySelectorAll(".clue-card.in-case").forEach((el) => el.classList.remove("in-case"));
    document.querySelectorAll(".clue-case-toggle.in-case").forEach((b) => {
      b.classList.remove("in-case");
      b.textContent = "⊕";
    });
    this.render();
  },
  /** 同步单张卡片 + 切换按钮的视觉态（在 toggle 内部调用） */
  _syncDom(cid) {
    const card = document.querySelector('.clue-card[data-clue-id="' + CSS.escape(cid) + '"]');
    if (card) card.classList.toggle("in-case", this.has(cid));
    const btn = document.querySelector('.clue-case-toggle[data-cid="' + CSS.escape(cid) + '"]');
    if (btn) {
      const on = this.has(cid);
      btn.classList.toggle("in-case", on);
      btn.textContent = on ? "✓" : "⊕";
      btn.title = on ? "从证据链移除" : "加入证据链";
    }
  },
  /** 刷新底部计数条 / 按钮可用态。Modal 不在时安全。 */
  render() {
    const countEl = document.getElementById("cfb-count");
    const hintEl = document.getElementById("cfb-hint");
    if (!countEl || !hintEl) return;
    const n = this.get().length;
    countEl.textContent = "📂 证据链 (" + n + ")";
    let hint = "";
    if (n === 0) {
      hint = "点线索卡片右上角 ⊕ 收集证据；至少 3 条才能指认";
    } else {
      hint = n < 3
        ? "至少还要再选 " + (3 - n) + " 条线索才能提交"
        : "已收集 " + n + " 条，可以提交指认";
      // 证据链质量实时分析：铁证 / 旁证 / 干扰计数 + 缺项提醒（非强制）
      const quality = (typeof InsightEngine !== "undefined" && InsightEngine.caseQuality)
        ? InsightEngine.caseQuality()
        : null;
      if (quality) {
        const c = quality.counts || { core: 0, aux: 0, red: 0 };
        hint += " · 🔴铁证 " + c.core + " · 🟢旁证 " + c.aux + (c.red ? " · 🟡干扰 " + c.red : "");
        if (c.red > 0) hint += " ⚠混入干扰";
        if (c.core === 0) hint += " ⚠缺铁证";
      }
    }
    hintEl.textContent = hint;
    const accuseBtn = document.getElementById("btn-accuse");
    if (accuseBtn) {
      // 不强制禁用——玩家可继续选/调整；_checkMix 与 _showCulpritPicker 内部会校验
      accuseBtn.classList.toggle("primary", n >= 3);
    }
    // 证据链不足时，给池中「未加入证据链」的有效线索 ⊕ 按钮加高亮，择要提示还有可收集证据
    // （减少反复点击指认才发现「证据链不足」弹窗的打断）
    document.querySelectorAll(".clue-card.valid .clue-case-toggle").forEach(function (t) {
      const alreadyInCase = t.classList.contains("in-case");
      t.classList.toggle("prompt", n < 3 && !alreadyInCase);
    });
  },
  /** 渲染指认弹窗里的「证据链」展示。返回 HTML 字符串。 */
  renderPillsHtml() {
    const esc = ClueCards.escapeHtml;
    const list = this.get();
    if (!list.length) {
      return '<p class="cf-empty">（证据链为空）— 关闭此弹窗，点线索卡片 ⊕ 添加</p>';
    }
    return '<div class="case-file-pills">' + list.map((cid) => {
      const c = (App.levelData && App.levelData.clues || []).find((x) => x.id === cid);
      const text = c ? esc(c.text) : esc(cid);
      return '<span class="case-file-pill" data-pill-cid="' + esc(cid) + '">' +
        '<span title="' + text + '">' + text + '</span>' +
        '<button type="button" class="cfp-remove" data-rm-cid="' + esc(cid) + '" title="移除">×</button>' +
        '</span>';
    }).join("") + '</div>';
  },
  /** 校验证据链长度；返回 true 表示可以进入指认弹窗 */
  canAccuse() { return this.get().length >= 3; },
};

/* ============================================================
   模块三·补：居民头像 SVG 立绘工厂（AvatarFactory · v3）
   v3 变更：
   - 固定基底色：未显式配置肤色/发色时用固定色，杜绝重现波动
   - 关键字 Map + 联合正则索引：告别线性 for 循环
   - 全局渐变 defs：头像间复用同一份渐变，减少重复 DOM
   - 主题色体系：配饰/微特征统一取色，整体换色只改 THEMES
   - 静态模板缓存：发型/身体/五官形状零重复字符串拼接
   - 安全转义：进入 SVG 的颜色经 hex 校验，文本预留 _esc
   - v1/v2 的 avatar 字段（skin/hair hex、skinIdx/hairIdx、hat、hairStyle）全部兼容
   - 入口：build(resident, opts)
   ============================================================ */
