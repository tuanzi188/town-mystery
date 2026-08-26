"use strict";
const DRAG_HOLD_MS = 300;
/** 时间轴落点「长按确认」时长：拖到时间轴上方按住该时长即可松手落点（桌面 / 触屏统一） */
const DRAG_CONFIRM_MS = 300;
/** 长按锁定前的位移容差（px）：手指小幅抖动不算滑动；超过即放弃拖拽、归还滚动 */
const DRAG_ARM_TOLERANCE = 8;
const DragManager = {
  dragging: false,   // 是否处于拖拽流程中（含未越过阈值的按压）
  moving: false,     // 是否已越过阈值进入实际移动
  card: null,        // 当前被拖拽的卡片元素
  startX: 0,         // 按压起点 X
  startY: 0,         // 按压起点 Y
  offsetX: 0,        // 指针相对卡片左上角的横向偏移
  offsetY: 0,        // 指针相对卡片左上角的纵向偏移
  ghost: null,       // 跟随指针的幽灵卡片
  _onMove: null,     // document 级 pointermove 处理器引用
  _onUp: null,       // document 级 pointerup / pointercancel 处理器引用
  _onPointerDown: null, // 全局 pointerdown 处理器引用（init 幂等 / destroy 用）
  _onDragStart: null,   // 全局 dragstart 处理器引用（init 幂等 / destroy 用）
  _moveFrame: null,     // move 坐标节流的 rAF 句柄
  _pendingMove: null,   // 最近一次 move 事件的待处理坐标 { x, y }
  /** 触屏设备标记：true 时启用移动端「长按锁定再拖」（0.3s _armDragLock 锁定后滑动进入拖拽）。 */
  _isTouch: false,
  /** 移动端「长按锁定再拖」状态：_armTimer 为 0.3s 锁定定时器；_armed 为已锁定（其后滑动进入拖拽） */
  _armTimer: null,
  _armed: false,
  _activePointerId: null, // 当前拖拽的指针 id（多指触控时只认起始那根手指）
  dragEndAt: 0,          // 最近一次拖拽松手时间戳：供 click 委托抑制「拖后误触弹窗」

  /** 绑定全局事件（事件委托，不依赖具体关卡数据）。幂等：重复调用不重复绑定。 */
  init() {
    if (this._onPointerDown) return;
    // 触屏设备检测：有 touch 事件 + 视口 ≤ 1024 视为移动端
    this._isTouch = (("ontouchstart" in window) || (navigator.maxTouchPoints > 0))
      && window.matchMedia("(max-width: 1024px)").matches;
    this._onPointerDown = (e) => this._handlePointerDown(e);
    // 防止个别环境（图片区等）触发 HTML5 原生拖拽
    this._onDragStart = (e) => {
      if (e.target && e.target.closest && e.target.closest(".clue-card")) e.preventDefault();
    };
    document.addEventListener("pointerdown", this._onPointerDown);
    document.addEventListener("dragstart", this._onDragStart);
  },

  /** 卸载全局事件监听 + 清理进行中的拖拽态/幽灵/定时器/rAF。模块停用或页面销毁时调用。 */
  destroy() {
    if (this._onPointerDown) {
      document.removeEventListener("pointerdown", this._onPointerDown);
      this._onPointerDown = null;
    }
    if (this._onDragStart) {
      document.removeEventListener("dragstart", this._onDragStart);
      this._onDragStart = null;
    }
    this.reset();
  },

  /** 取消进行中的拖拽并清理幽灵/定时器/待处理 rAF（保留全局监听）。关卡切换前调用此清理钩子。 */
  reset() {
    this._abortGesture();
    this._cancelMoveFrame();
  },

  /** 按压起点：记录候选卡片，等待越过移动阈值后再进入拖拽 */
  _handlePointerDown(e) {
    if (this.dragging) return;
    const target = e.target;
    if (!(target instanceof Element)) return;
    // ⊕ 按钮是证据链切换入口，⏱ 按钮是时间轴快捷入口，两者都不应触发拖拽
    if (target.closest && (target.closest(".clue-case-toggle") || target.closest(".clue-tl-toggle"))) return;
    const card = target.closest(".clue-card");
    if (!card) return;
    if (card.dataset.locked === "1") return; // 已锁定线索不可拖动
    this.dragging = true;
    this._activePointerId = e.pointerId;
    this.moving = false;
    this.card = card;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this._onMove = (ev) => this._handlePointerMove(ev);
    this._onUp = (ev) => this._handlePointerUp(ev);
    document.addEventListener("pointermove", this._onMove, { passive: false });
    document.addEventListener("pointerup", this._onUp);
    document.addEventListener("pointercancel", this._onUp);
    if (this._isTouch) {
      // 移动端：滚动优先。先等 0.3s 长按锁定；期间滑动即放弃拖拽、归还页面滚动
      this._armed = false;
      this._armTimer = setTimeout(() => this._armDragLock(), DRAG_HOLD_MS);
    } else {
      // 桌面端：按下即视为已锁定，滑动即拖（不阻塞文本选择）
      this._armed = true;
    }
  },

  /** 移动中：越过阈值则进入拖拽，随后幽灵卡片跟随并高亮目标卡槽。
   *  拖到时间轴上方时启动「长按 0.3 秒」确认；移出时间轴则取消。 */
  _handlePointerMove(e) {
    if (!this.card) return;
    const dx = e.clientX - this.startX;
    const dy = e.clientY - this.startY;
    // 长按锁定前：手指一滑动即放弃本手势，让页面正常滚动（移动端防误拖）
    if (!this._armed) {
      if (Math.hypot(dx, dy) < DRAG_ARM_TOLERANCE) return; // 微小抖动仍在等待锁定
      this._abortGesture();
      return;
    }
    if (!this.moving) {
      if (Math.hypot(dx, dy) < 6) return; // 按压未滑动，视为点击
      this._enterDrag();
    }
    if (e.cancelable) e.preventDefault(); // 已进入拖拽：拦截滚动，保证幽灵跟随稳定
    // 记录最新坐标，交给 rAF 合并渲染，减少高频 pointermove 带来的重复样式写入
    this._pendingMove = { x: e.clientX, y: e.clientY };
    if (this._moveFrame == null) {
      this._moveFrame = requestAnimationFrame(() => this._flushMove());
    }
  },

  /** 在 rAF 内执行坐标→幽灵样式更新 + 落点检测，合并同一帧内的多次 pointermove。 */
  _flushMove() {
    this._moveFrame = null;
    const pt = this._pendingMove;
    this._pendingMove = null;
    if (!pt || !this.card || !this.ghost) return;
    const rect = this.card.getBoundingClientRect();
    this._moveGhost(pt.x - this.offsetX, pt.y - this.offsetY, rect.width, rect.height);
    // 用幽灵卡片的「视觉中心」判定落点：移动端幽灵被放大/上移，若仍用手指坐标会错位
    const c = this._ghostCenter();
    const target = c ? this._getDropTargetAt(c.x, c.y) : null;
    this._highlightSlot(target);
    this._updateGhostValidity(target);
    // 时间轴落点 → 桌面端才需「长按 0.3 秒」确认；移动端松手即时落点
    const overTl = !!(target && target.type === "timeline");
    if (overTl && !this._isTouch) this._startConfirm();
    else this._cancelConfirm();
    this._lastOverTimeline = overTl;
  },

  /** 取消待处理的 move rAF（松手 / 放弃手势 / 销毁时调用），避免松手后再执行一次多余的坐标更新。 */
  _cancelMoveFrame() {
    if (this._moveFrame != null) {
      cancelAnimationFrame(this._moveFrame);
      this._moveFrame = null;
    }
    this._pendingMove = null;
  },

  /** 正式进入拖拽：原件半透明，创建幽灵卡片 */
  _enterDrag() {
    this.moving = true;
    const rect = this.card.getBoundingClientRect();
    this.offsetX = this.startX - rect.left;
    this.offsetY = this.startY - rect.top;
    this.card.classList.add("dragging");
    const ghost = this.card.cloneNode(true);
    ghost.classList.remove("dragging");
    ghost.classList.add("drag-ghost");
    this._moveGhost(rect.left, rect.top, rect.width, rect.height);
    document.body.appendChild(ghost);
    this.ghost = ghost;
  },

  /** 移动端长按 0.3s 锁定卡片：视觉抬起 + 锁定手势；其后滑动进入拖拽（禁止滚动干扰） */
  _armDragLock() {
    this._armTimer = null;
    if (!this.card || !this.dragging) return;
    this._armed = true;
    this.card.classList.add("drag-armed");
    this.card.style.touchAction = "none"; // 手势已锁定为拖拽：阻止浏览器接管滚动
  },

  /** 复位长按锁定态：清理定时器、移除抬起视觉、归还卡片 touch-action（幂等）。 */
  _resetArm() {
    if (this._armTimer) {
      clearTimeout(this._armTimer);
      this._armTimer = null;
    }
    this._armed = false;
    if (this.card) {
      this.card.classList.remove("drag-armed");
      if (this.card.style.touchAction) this.card.style.touchAction = "";
    }
  },

  /** 放弃本次手势（长按锁定前的手指滑动 = 滚动意图）：清理状态，归还页面滚动 */
  _abortGesture() {
    this._activePointerId = null;
    this._cancelMoveFrame();
    this._resetArm();
    this._removeListeners();
    this.card = null;
    this.dragging = false;
    this.moving = false;
    this._resetConfirm();
  },

  /** 移动幽灵卡片到指定坐标 */
  _moveGhost(left, top, width, height) {
    if (!this.ghost) return;
    this.ghost.style.left = left + "px";
    this.ghost.style.top = top + "px";
    this.ghost.style.width = width + "px";
    this.ghost.style.height = height + "px";
  },

  /** 幽灵卡片的视觉中心（含 CSS transform 后的真实渲染矩形中心）。 */
  _ghostCenter() {
    if (!this.ghost) return null;
    const r = this.ghost.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  },

  /** 拖拽经过的目标区域：仅时间轴（磁吸高亮）。居民卡槽机制已移除。 */
  _highlightSlot(target) {
    this._clearSlotHighlight();
    if (!target) return;
    if (target.type === "map") target.el.classList.add("loc-target");
    if (target.type === "timeline") target.el.classList.add("tl-target");
  },
  /** 给幽灵卡片加"无效/有效"视觉态：实时反馈拖放区域是否合法。 */
  _updateGhostValidity(target) {
    if (!this.ghost) return;
    const valid = !!(target && (target.type === "timeline" || target.type === "pool"));
    this.ghost.classList.toggle("drag-invalid", !valid);
  },

  /**
   * 判断拖放目标（以坐标 x/y 命中）：
   * - 命中时间轴区域 → { type:"timeline", el }
   * - 命中线索池区域 → { type:"pool" }
   * - 其余空白 → null（无效区域；居民卡槽已不再作为落点）
   */
  _getDropTargetAt(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el || !(el instanceof Element)) return null;
    const tl = el.closest("#timeline-drop");
    if (tl) return { type: "timeline", el: tl };
    if (el.closest("#clues-pool")) return { type: "pool" };
    return null;
  },

  /** 松手：时间轴落点需「长按 0.3 秒」确认；其他目标即时生效；无效区域抖动反馈。 */
  _handlePointerUp(e) {
    if (e.pointerId !== this._activePointerId) return; // 非起始指针的 up/cancel 不结束本手势
    if (!this.card) return;
    this._activePointerId = null;
    // 若最后一次 pointermove 尚未被 rAF 处理，先同步幽灵到最新坐标再取落点，避免用上一帧的旧位置判定
    if (this._pendingMove && this.card && this.ghost) {
      const r = this.card.getBoundingClientRect();
      this._moveGhost(this._pendingMove.x - this.offsetX, this._pendingMove.y - this.offsetY, r.width, r.height);
    }
    this._cancelMoveFrame();
    this._removeListeners();
    this._resetArm();
    const wasMoving = this.moving;
    const card = this.card;
    const ghost = this.ghost;
    const cardId = card.dataset.clueId;
    const dropPt = this._ghostCenter(); // 移除幽灵前先取视觉中心，保证落点与所见一致
    card.classList.remove("dragging");
    if (ghost) ghost.remove();
    this.card = null;
    this.ghost = null;
    this.moving = false;
    this.dragging = false;
    this._clearSlotHighlight();
    if (!wasMoving) { this._resetConfirm(); return; } // 未滑动，按点击处理
    this.dragEndAt = Date.now(); // 记录拖拽松手时间戳，供 click 委托抑制误触弹窗
    const target = dropPt ? this._getDropTargetAt(dropPt.x, dropPt.y) : null;
    // 触屏设备：时间轴落点直接放（省略 0.3s 长按确认，避免体感卡顿）
    // 桌面端：时间轴落点需「长按 0.3 秒」确认，否则抖动反馈并复位
    if (target && target.type === "timeline" && !this._isTouch && !this._confirmed) {
      this._shakeFail(card);
      this._resetConfirm();
      return;
    }
    if (target) {
      // 干扰/无时间信息线索拖入时间轴：即时抖动 + 轻提示（不再静默忽略）
      if (target.type === "timeline") {
        const clue = App.clueMap[cardId];
        if (!clue || typeof clue.timeMin !== "number") {
          this._shakeFail(card);
          this._showInvalidTimelineTip();
          this._resetConfirm();
          return;
        }
      }
      const wasTimeline = target.type === "timeline";
      this._moveCard(cardId, target);
      GameFlow.commitLayout(); // 存档 → 重渲染 → 刷新冲突标红
      // 时间轴落点：自动弹出「时间重叠排查」清单（多人具备作案时间，防单人锁凶）
      if (wasTimeline) GameFlow.notifyTimeOverlap();
    } else {
      this._shakeFail(card);   // 无效区域：CSS 抖动反馈，卡片原地不动
    }
    this._resetConfirm();
  },
  /** 启动「长按 0.3 秒」确认：幂等，已在计时或已完成则直接返回。 */
  _startConfirm() {
    if (this._confirmed) return;
    if (this._confirmTimer) return; // 已经在计时
    if (!this.ghost) return; // ghost 还没创建时（移动阈值未越过）直接返回
    // 首次进入时间轴：创建进度环 + 提示文字
    if (!this._ringEl) {
      this._ringEl = document.createElement("div");
      this._ringEl.className = "confirm-ring";
      this.ghost.appendChild(this._ringEl);
    }
    if (!this._hintEl) {
      this._hintEl = document.createElement("div");
      this._hintEl.className = "confirm-hint";
      this._hintEl.textContent = "按住 0.3 秒确认落点";
      this.ghost.appendChild(this._hintEl);
    }
    // 触发动画（移除后重加，确保连续进入/离开/进入能重新启动）
    this._ringEl.classList.remove("active", "done");
    this._hintEl.classList.remove("active", "done");
    // 双 rAF：保证浏览器重排后再加 class，CSS 动画能从头播放
    const ringEl = this._ringEl, hintEl = this._hintEl;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        ringEl.classList.add("active");
        hintEl.classList.add("active");
      });
    });
    this._confirmTimer = setTimeout(function () {
      this._confirmTimer = null;
      this._confirmed = true;
      if (this._ringEl) {
        this._ringEl.classList.add("done");
        this._ringEl.classList.remove("active");
      }
      if (this._hintEl) {
        this._hintEl.classList.add("done");
        this._hintEl.textContent = "✓ 落点已锁定 · 松手确认";
      }
    }.bind(this), DRAG_CONFIRM_MS);
  },
  /** 取消「长按 0.3 秒」确认：清除计时器 + 重置视觉（用户移出时间轴或松手时调用） */
  _cancelConfirm() {
    if (this._confirmTimer) {
      clearTimeout(this._confirmTimer);
      this._confirmTimer = null;
    }
    // 已经完成确认的 _confirmed 态：保留 _confirmed = true，让用户松手即可生效
    if (this._confirmed) return;
    if (this._ringEl) this._ringEl.classList.remove("active", "done");
    if (this._hintEl) {
      this._hintEl.classList.remove("active", "done");
      this._hintEl.textContent = "按住 0.3 秒确认落点";
    }
  },
  /** 完整重置确认状态机：清空 DOM、计时器、_confirmed 标记。拖拽结束（pointerup / cancel）时调用。 */
  _resetConfirm() {
    if (this._confirmTimer) { clearTimeout(this._confirmTimer); this._confirmTimer = null; }
    this._confirmed = false;
    this._lastOverTimeline = false;
    if (this._ringEl && this._ringEl.parentNode) this._ringEl.parentNode.removeChild(this._ringEl);
    if (this._hintEl && this._hintEl.parentNode) this._hintEl.parentNode.removeChild(this._hintEl);
    this._ringEl = null;
    this._hintEl = null;
  },

  /** 更新布局状态：把线索 id 放入目标（线索池 / 地图地点 / 时间轴）。居民卡槽落点已移除。 */
  _moveCard(cardId, target) {
    const layout = App.layout;
    if (target.type === "map") {
      // 地图副本：从时间轴与其余地点移除后钉入目标地点（不影响 slots/pool）
      layout.timeline = layout.timeline.filter((id) => id !== cardId);
      Object.keys(layout.mapPlace).forEach((locId) => {
        layout.mapPlace[locId] = layout.mapPlace[locId].filter((id) => id !== cardId);
        if (!layout.mapPlace[locId].length) delete layout.mapPlace[locId];
      });
      if (!layout.mapPlace[target.locationId]) layout.mapPlace[target.locationId] = [];
      layout.mapPlace[target.locationId].push(cardId);
      return;
    }
    if (target.type === "timeline") {
      // 时间轴副本：从地图地点移除后按时间排序插入（无时间描述的线索拒绝）
      const clue = App.clueMap[cardId];
      if (!clue || typeof clue.timeMin !== "number") return;
      Object.keys(layout.mapPlace).forEach((locId) => {
        layout.mapPlace[locId] = layout.mapPlace[locId].filter((id) => id !== cardId);
        if (!layout.mapPlace[locId].length) delete layout.mapPlace[locId];
      });
      if (!layout.timeline.includes(cardId)) layout.timeline.push(cardId);
      layout.timeline.sort((a, b) => (App.clueMap[a].timeMin - App.clueMap[b].timeMin));
      return;
    }
    // 线索池：从时间轴 / 地图移除后放回主池
    layout.timeline = layout.timeline.filter((id) => id !== cardId);
    Object.keys(layout.mapPlace).forEach((locId) => {
      layout.mapPlace[locId] = layout.mapPlace[locId].filter((id) => id !== cardId);
      if (!layout.mapPlace[locId].length) delete layout.mapPlace[locId];
    });
    if (!layout.pool.includes(cardId)) layout.pool.push(cardId);
  },

  /** 无效区域落点：触发 CSS shake 动画，结束后移除标记 */
  _shakeFail(card) {
    card.classList.add("drop-fail");
    const clear = () => {
      card.classList.remove("drop-fail");
      card.removeEventListener("animationend", clear);
    };
    card.addEventListener("animationend", clear);
  },

  /** 干扰/无时间线索拖入时间轴的轻提示（复用全局 toast-tip） */
  _showInvalidTimelineTip() {
    const t = document.getElementById("toast-tip");
    if (!t) return;
    t.textContent = "⛔ 这条线索没有时间信息，不能放入时间轴";
    t.classList.add("show");
    clearTimeout(this._invalidToastTimer);
    this._invalidToastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  },

  /** 清理目标卡槽 / 地图地点高亮（slot-target 已无作用，保留调用兼容） */
  _clearSlotHighlight() {
    document.querySelectorAll(".slots.slot-target").forEach((s) => s.classList.remove("slot-target"));
    document.querySelectorAll(".map-loc.loc-target").forEach((s) => s.classList.remove("loc-target"));
    document.querySelectorAll("#timeline-drop.tl-target").forEach((s) => s.classList.remove("tl-target"));
  },

  /** 解绑 document 级监听 */
  _removeListeners() {
    if (this._onMove) {
      document.removeEventListener("pointermove", this._onMove);
      document.removeEventListener("pointerup", this._onUp);
      document.removeEventListener("pointercancel", this._onUp);
      this._onMove = null;
      this._onUp = null;
    }
  },
};

/* ============================================================
   模块五·补：背景音乐（HTML5 Audio，用户首次点击后启动）
   规则：主菜单 / 档案馆 → menu.mp3；其余页面 → gameplay.mp3
   ============================================================ */
