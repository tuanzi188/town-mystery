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
  /** 线索类型分层：根据元数据判定是「物证 / 自白 / 目击 / 普通口供」，
   *  返回 { typeCls, badge, badgeIcon, badgeText }，供 buildCard 与 clue-toast 共用 */
  classify(clue) {
    if (!clue) return { typeCls: "", badge: "", badgeIcon: "", badgeText: "" };
    if (clue.isEvidence) {
      return { typeCls: "evidence", badge: '<span class="clue-badge">🔑 物证</span>', badgeIcon: "🔑", badgeText: "物证" };
    }
    if (clue.isSuspectStatement) {
      return { typeCls: "statement", badge: '<span class="clue-badge">🗣 自白</span>', badgeIcon: "🗣", badgeText: "自白" };
    }
    if (clue.isWitness) {
      return { typeCls: "witness", badge: '<span class="clue-badge">👁 目击</span>', badgeIcon: "👁", badgeText: "目击" };
    }
    return { typeCls: "", badge: "", badgeIcon: "📁", badgeText: "口供" };
  },
  /** 按线索类型构建卡片元素：type === "fake" 为浅灰色干扰线索，其余按 isEvidence/isSuspectStatement/isWitness 分层。
   *  卡片右上角加 ⊕ 按钮：把线索加入/移出 CaseFile 证据链（独立于卡槽/时间轴）。 */
  buildCard(clue, lockedIds) {
    const isFake = clue.type === "fake";
    const locked = lockedIds && lockedIds.indexOf(clue.id) !== -1;
    const cls = this.classify(clue);
    const inCase = (typeof CaseFile !== "undefined") && CaseFile.has(clue.id);
    const el = document.createElement("div");
    el.className = "clue-card" + (isFake ? " fake" : " valid") +
      (cls.typeCls ? " " + cls.typeCls : "") +
      (locked ? " locked" : "") +
      (inCase ? " in-case" : "");
    el.dataset.clueId = clue.id;
    el.dataset.type = clue.type;
    el.dataset.clueKind = cls.typeCls || (isFake ? "fake" : "statement");
    el.dataset.locked = locked ? "1" : "0";
    el.draggable = false; // 本游戏用手势拖拽，禁用 HTML5 原生拖拽
    let speak = "";
    if (!isFake) {
      if (clue.isEvidence) {
        const ownerTag = clue.evidenceOwnerTag ? this.escapeHtml(clue.evidenceOwnerTag) : "";
        const dirCls = clue.evidenceDirection === "clear" ? " ev-owner--clear" : "";
        speak = cls.badge +
          (ownerTag ? '<span class="clue-speak ev-owner' + dirCls + '" data-ev-owner="' + ownerTag + '">对应：' + ownerTag + "</span>" : "");
      } else if (cls.badge) {
        // 自白 / 目击：用统一 clue-badge 作为类型徽标
        const owner = App.clueOwner ? App.clueOwner[clue.id] : null;
        speak = cls.badge + (owner ? '<span class="clue-speak">' + this.escapeHtml(owner) + "</span>" : "");
      } else {
        // 普通口供：保留原"说话人"角标
        const owner = App.clueOwner ? App.clueOwner[clue.id] : null;
        if (owner) speak = '<span class="clue-speak">' + this.escapeHtml(owner) + "</span>";
      }
    } else {
      // 干扰线索：不显示类型徽标，但保留说话人角标作为干扰方
      const owner = App.clueOwner ? App.clueOwner[clue.id] : null;
      if (owner) speak = '<span class="clue-speak">' + this.escapeHtml(owner) + "</span>";
    }
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
    el.innerHTML =
      caseBtn +
      (locked ? "" : tlBtn) +
      speak +
      '<p class="clue-text">' + this.escapeHtml(clue.text) + "</p>" +
      '<span class="clue-type">' + (isFake ? "干扰线索" : "有效线索") +
        (locked ? '<span class="clue-lock-mark">🔒 已锁定</span>' : "") + "</span>";
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
    if (n === 0) hintEl.textContent = "点线索卡片右上角 ⊕ 收集证据；至少 3 条才能指认";
    else if (n < 3) hintEl.textContent = "至少还要再选 " + (3 - n) + " 条线索才能提交";
    else hintEl.textContent = "已收集 " + n + " 条，可以提交指认";
    const accuseBtn = document.getElementById("btn-accuse");
    if (accuseBtn) {
      // 不强制禁用——玩家可继续选/调整；_checkMix 与 _showCulpritPicker 内部会校验
      accuseBtn.classList.toggle("primary", n >= 3);
    }
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
