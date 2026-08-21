"use strict";

/* ============================================================
   模块八：游戏流程（关卡渲染 + 提示 + 通关校验 + 进度管理）
   说明：复用 B1 的 DragManager / ValidateUtil / StorageUtil / ClueCards / Modal
   ============================================================ */
const GameFlow = {
  /**
   * 关卡配置：从 LevelData 读取并规范化。
   * 将 conflictPairs 转为线索上的 conflictGroup 字段（供 detectTimelineConflict 使用）。
   * @returns {Object|null} 配置结构：{ title, difficulty, background, goal,
   *   residents, clues, solution, hints, truth }
   */
  getLevelConfig() {
    const raw = LevelData[App.currentLevel - 1];
    if (!raw) return null;
    // 浅拷贝一层：阻止 future 启用 conflictPairs 时对 LevelData 数组的字段赋值污染
    // （关卡数据本身只读，没有更深层 mutate，无需深拷贝）
    const cfg = { ...raw };
    (cfg.conflictPairs || []).forEach((pair, idx) => {
      const group = "auto_" + idx;
      pair.forEach((cid) => {
        const clue = cfg.clues.find((c) => c.id === cid);
        if (clue) clue.conflictGroup = group;
      });
    });
    return cfg;
  },

  /** 加载当前关卡：读取配置 → 恢复存档布局与提示次数 → 渲染全页面 */
  loadLevelPlaceholder() {
    const cfg = this.getLevelConfig();
    this.renderLevel(cfg);
    const titleEl = document.getElementById("case-title");
    const diffEl = document.getElementById("case-difficulty");
    titleEl.textContent = "第 " + App.currentLevel + " 关" + (cfg ? " · " + cfg.title : "");
    if (cfg && diffEl) {
      diffEl.textContent = cfg.difficulty || "";
      diffEl.style.display = "";
    } else if (diffEl) {
      diffEl.style.display = "none";
    }
    if (cfg) {
      document.getElementById("case-bg").textContent = cfg.background || "";
      document.getElementById("case-goal").textContent = cfg.goal || "";
    }
    this._syncHintButton();
    // 新手引导：首次玩任一关时弹（任意未通关关卡），老玩家不再打扰
    this.maybeShowTutorial();
  },
  /**
   * 新手引导（分步文字卡，首次弹窗 / 常驻按钮共用）。
   * 触发条件：玩家未看过教程 **且** 本关未通关。任一关卡首次进入都弹，
   * 避免"跳过 L1 直接进 L4 看不到引导"。
   * 界面右上角常驻「新手指引」按钮可随时重新打开。
   * 共 3 张，支持「上一步 / 跳过 / 下一步」：
   *   1) 欢迎与目标：你扮演调解员，找出说谎者并与物证一并摆入卡槽
   *   2) 四条核心操作：走访 / 追问 / 时间轴 / 指认 / 物证
   *   3) 求助渠道：起步顺序建议 + 提示按钮限次 + 重置机制
   * 首次自动弹窗时，任意退出（跳过 / 看完）都会写入 tutorialSeen=true；
   * 主动点击按钮重看时不写标记，不影响首次弹窗逻辑。
   */
  maybeShowTutorial() {
    if (StorageUtil.readTutorialSeen()) return;
    // 仅"本关首次进入"才弹：layout 的 pool/timeline 都为空，说明玩家还没动过这一关
    const layout = StorageUtil.readLevelState(App.currentLevel);
    const hasTouched = layout && (((layout.pool || []).length > 0) || ((layout.timeline || []).length > 0));
    if (hasTouched) return;
    this.showTutorialCards(true);
  },

  /**
   * 渲染新手指引卡片。markSeen=true 时退出会写入 tutorialSeen（首次自动弹窗用）；
   * markSeen=false 时不写标记（界面常驻按钮主动重看用）。
   */
  showTutorialCards(markSeen) {
    const cards = [
      {
        title: "🌸 欢迎来到小镇疑云",
        text:
          "你是镇上新来的调解员。你很快会发现，这里的人不是不会说谎——他们只是更擅长用沉默代替解释。你不需要逮捕谁，只需要听完每个人的故事，然后问自己一句：『他为什么这么说？』\n\n💡 小提示：右上角「❓ 新手指引」可随时重看本卡。",
      },
      {
        title: "🎮 四条核心操作",
        text:
          "① 走访：点居民头像与其对话，线索随交谈逐步解锁。\n" +
          "② 追问：点「继续询问」可让 TA 说出更多细节（含关键物证）。\n" +
          "③ 时间轴：把带时间的证词拖到下方时间轴排序；说谎者的时间线会露出破绽。\n" +
          "④ 指认：点右下角「指认凶手」，先挑人、再选决定性证据。\n\n" +
          "提示：浅米色为有效线索；灰色「干扰」线索请留在线索池中。",
      },
      {
        title: "💡 卡壳了怎么办",
        text:
          "起步建议：先走访全部居民 → 再整理时间轴 → 最后才指认。\n\n" +
          "求助渠道：\n" +
          "· 底部「获取提示」按钮：方向 / 直指两档，每关限 2 次。\n" +
          "· 「重置本局」按钮：随时清空重来，不影响通关进度。\n\n" +
          "准备就绪，开始破案吧！",
      },
    ];
    // markSeen=true（首次自动弹窗用）：弹窗关闭时写 tutorialSeen 标记，兼容 ESC / 遮罩 / 按钮三种关闭路径
    // markSeen=false（主动按钮重看用）：不写标记
    // 通过 Modal.show 的 onClose 钩子统一触发，避免 ESC 跳过回调导致反复弹窗
    const seenHandler = () => { if (markSeen) StorageUtil.writeTutorialSeen(); };
    const render = (i) => {
      const btns = [];
      if (i > 0) btns.push({ label: "上一步", primary: false, onClick: () => render(i - 1) });
      btns.push({ label: "跳过", primary: false, onClick: () => Modal.close() });
      btns.push(
        i === cards.length - 1
          ? { label: "开始探索", primary: true, onClick: () => Modal.close() }
          : { label: "下一步", primary: true, onClick: () => render(i + 1) }
      );
      Modal.show(cards[i].title, cards[i].text, btns, seenHandler);
    };
    render(0);
  },

  /** 全量渲染当前关卡（居民卡槽 + 线索池），恢复存档并刷新冲突标红
   *  opts.newCids?: 本次新解锁的线索 id 列表；renderPool 收到后会触发「入卷」飞入动画 */
  renderLevel(cfg, opts) {
    App.levelData = cfg;
    App.residents = (cfg && cfg.residents) || [];
    App.clueMap = {};
    (cfg && cfg.clues || []).forEach((c) => { App.clueMap[c.id] = c; });
    // 线索 → 所属居民名映射（供卡片说话人角标使用；物证走 isEvidence 分支不引用人名）
    App.clueOwner = {};
    (cfg && cfg.solution ? Object.keys(cfg.solution) : []).forEach((rid) => {
      const r = (cfg.residents || []).find((x) => x.id === rid);
      if (!r) return;
      ((cfg.solution || {})[rid] || []).forEach((cid) => { App.clueOwner[cid] = r.name; });
    });
    App.layout = StorageUtil.readLevelState(App.currentLevel);
    this._sanitizeLayout();
    // 混合模式：线索池与「已交谈居民」严格对应，避免切换模式后泄露未走访线索
    this._reconcileMixPool(cfg);
    this.renderResidents();
    this.renderPool((opts && opts.newCids) || []);
    this.renderTimeline();
    this._syncHintButton();
    ValidateUtil.syncConflictMarks();
    this.renderProgress();
    // 证据链：渲染底部计数条 + 同步所有已收卡片的 in-case 态
    CaseFile.render();
  },

  /** 渲染底部调查进度条（走访 / 证词矛盾 / 关键物证），帮玩家确认"是否已具备指认条件"。
   *  走访按已交谈居民计数；矛盾汇总卡槽冲突 + 时序冲突；物证统计凶手卡槽中的关键物证。
   *  无任何关联证据的关卡不显示物证项。 */
  renderProgress() {
    const el = document.getElementById("case-progress");
    if (!el) return;
    const cfg = App.levelData;
    if (!cfg) return;
    const talked = StorageUtil.readDialogRecord(App.currentLevel);
    const total = (cfg.residents || []).length;
    // D3：矛盾计数只统计「主动撒谎(lie)」，剔除「误会(misunderstand)」——与指认门槛口径一致
    const conflictIds = ValidateUtil.syncConflictMarks();
    const conflicts = conflictIds.filter((id) => {
      const c = App.clueMap[id];
      return !c || c.conflictType !== "misunderstand";
    }).length;
    // 关键物证集合：isEvidence 线索 ∪ ext.evidenceKeys 显式配置
    const evIds = [];
    (cfg.clues || []).forEach((c) => {
      if (c.type === "fake") return;
      const inKeys = cfg.ext && Array.isArray(cfg.ext.evidenceKeys) && cfg.ext.evidenceKeys.indexOf(c.id) !== -1;
      if (c.isEvidence || inKeys) evIds.push(c.id);
    });
    const pill = (cls, inner) => '<span class="cp-pill ' + cls + '">' + inner + "</span>";
    const interview = pill(talked.length >= total ? "done" : "warn",
      '<span>🚶</span>走访 <span class="cp-num">' + talked.length + "/" + total + "</span>");
    const conflict = pill(conflicts ? "warn" : "done",
      '<span>⚖</span>' + (conflicts ? conflicts + " 处矛盾" : "无矛盾"));
    // 关键物证进度：已纳入时间轴/线索池的占总数
    const seenIds = new Set([].concat(App.layout.timeline || [], App.layout.pool || []));
    const evHave = evIds.filter((id) => seenIds.has(id)).length;
    const ev = evIds.length
      ? pill(evHave >= evIds.length ? "done" : "warn",
          '<span>🔍</span>关键物证 <span class="cp-num">' + evHave + "/" + evIds.length + "</span>")
      : "";
    // 本局失败次数：只在本局失败 ≥1 时显示，让玩家清楚剩余机会
    const fails = Number(App.layout.accuseFails || 0);
    const failPill = fails > 0
      ? pill(fails >= 3 ? "danger" : "warn",
          '<span>💔</span>本局失败 <span class="cp-num">' + fails + "/3</span>")
      : "";
    el.innerHTML = interview + conflict + ev + failPill;
  },

  /** 混合模式：重建线索池 = 已交谈居民绑定线索的并集（含已入槽线索） */
  _reconcileMixPool(cfg) {
    const talked = StorageUtil.readDialogRecord(App.currentLevel);
    const allowed = new Set();
    (cfg.residents || []).forEach((r) => {
      if (talked.indexOf(r.id) === -1 || !r.bindClue) return;
      if (Array.isArray(r.bindClue)) r.bindClue.forEach((c) => allowed.add(c));
      else allowed.add(r.bindClue);
      // 该居民的所有追问分支解锁的线索也属于"已走访获得"，允许留在池中
      // 这是为了支持"无用追问"的设计：玩家问出看似有用但实际是补完/假线索的追问，
      // 这些线索也应在池中可见（玩家自己判断是否有用），而不是被默默丢弃
      const fups = DialogSystem._followupsOf(r);
      if (Array.isArray(fups)) {
        fups.forEach((fu) => {
          (fu.cids || []).forEach((cid) => allowed.add(cid));
        });
      }
    });
    App.layout.pool = App.layout.pool.filter((id) => allowed.has(id));
    StorageUtil.writeLevelState(App.currentLevel, App.layout);
  },

  /** 布局数据完整性清洗：剔除无效 id（slot 字段保留为兼容字段，不再用于判定） */
  _sanitizeLayout() {
    App.layout.pool = App.layout.pool.filter((id) => !!App.clueMap[id]);
    // 清洗地图 / 时间轴 / 锁定副本数据
    Object.keys(App.layout.mapPlace).forEach((locId) => {
      const clean = App.layout.mapPlace[locId].filter((id) => !!App.clueMap[id]);
      if (clean.length) App.layout.mapPlace[locId] = clean; else delete App.layout.mapPlace[locId];
    });
    App.layout.timeline = App.layout.timeline.filter((id) => !!App.clueMap[id]);
    App.layout.locked = App.layout.locked.filter((id) => !!App.clueMap[id]);
    // 证据链：清洗悬空 id（关卡换了/线索被剔除）；与 _showCulpritPicker 联动，必须用去重后的数组
    if (Array.isArray(App.layout.caseFile)) {
      const seen = new Set();
      App.layout.caseFile = App.layout.caseFile.filter((id) => {
        if (typeof id !== "string" || seen.has(id) || !App.clueMap[id]) return false;
        seen.add(id);
        return true;
      });
    } else {
      App.layout.caseFile = [];
    }
    // 线索池由走访解锁驱动，不自动补全，保持「未交谈不泄露线索」
  },

  /** 渲染左侧居民列表（仅展示身份信息，不再承载卡槽） */
  renderResidents() {
    const panel = document.getElementById("residents-panel");
    panel.innerHTML = "";
    const title = document.createElement("h3");
    title.className = "panel-title";
    title.textContent = "小镇居民";
    panel.appendChild(title);
    if (!App.levelData) {
      const tip = document.createElement("p");
      tip.className = "panel-title";
      tip.textContent = "（关卡数据尚未加载）";
      panel.appendChild(tip);
      return;
    }
    // 收集当前线索池中已解锁物证的归属身份标签，用于居民面板高亮匹配
    const evOwnerTags = new Set();
    (App.layout.pool || []).forEach((cid) => {
      const c = App.clueMap[cid];
      if (c && c.isEvidence && c.evidenceOwnerTag) evOwnerTags.add(c.evidenceOwnerTag);
    });
    // 已走访/已获取线索的累计集合（pool + timeline）
    const collectedIds = new Set([].concat(App.layout.pool || [], App.layout.timeline || []));
    App.residents.forEach((r) => {
      const block = document.createElement("div");
      block.className = "resident-block";
      const spoke = StorageUtil.readDialogRecord(App.currentLevel).indexOf(r.id) !== -1;
      const tagMatch = r.tagShort && evOwnerTags.has(r.tagShort);
      // 替罪羊判定：isScapegoat 显式字段优先，否则看是否无 bindClue（仅档案/口供，无线索入池）
      const isScapegoat = r.isScapegoat === true || !r.bindClue || (Array.isArray(r.bindClue) && !r.bindClue.length) || (typeof r.bindClue === "string" && !r.bindClue);
      // 线索获取进度：bindClue 中有多少条已被收集（pool + timeline）
      const bindList = Array.isArray(r.bindClue) ? r.bindClue : (r.bindClue ? [r.bindClue] : []);
      const totalClues = bindList.length;
      const gotClues = bindList.filter((cid) => collectedIds.has(cid)).length;
      // 提示行：根据「是否替罪羊 / 是否已走访 / 已获取比例」生成不同文案
      let hintHtml = "";
      if (isScapegoat) {
        // 替罪羊：可能带 1 条自辩线索（如 L4 老李），与走访弹窗"只留下一条自辩线索"口径一致
        const bindList2 = Array.isArray(r.bindClue) ? r.bindClue : (r.bindClue ? [r.bindClue] : []);
        hintHtml = bindList2.length
          ? '<div class="resident-hint hint-scapegoat">次要人物 · 自辩线索</div>'
          : '<div class="resident-hint hint-scapegoat">次要人物 · 无线索</div>';
      } else if (!spoke) {
        // 未走访：显眼地告诉玩家"点我获取线索"
        hintHtml = '<div class="resident-hint hint-unvisited">💬 点击交谈获取线索</div>';
      } else if (totalClues > 0) {
        // 已走访：显示进度
        const ratio = gotClues / totalClues;
        const ratioCls = ratio >= 1 ? "hint-done" : (ratio >= 0.5 ? "hint-half" : "hint-low");
        hintHtml = '<div class="resident-hint ' + ratioCls + '">✓ 已获取 <b>' + gotClues + '</b> / ' + totalClues + ' 条线索' +
          (ratio < 1 ? ' · <span class="hint-tap">可追问更多</span>' : ' · 全部到手') + '</div>';
      }
      block.innerHTML =
        '<div class="resident-head' + (isScapegoat ? " resident-scapegoat" : "") + '" data-resident="' + ClueCards.escapeHtml(r.id) + '"' +
        (isScapegoat ? ' title="次要人物，仅自辩线索"' : ' title="查看人物档案"') + '>' +
          '<span class="avatar">' + AvatarFactory.buildWithPortrait(r, { size: 34 }) + "</span>" +
          (spoke ? '<span class="speak-badge" title="已交谈"></span>' : "") +
          '<span class="resident-name">' + ClueCards.escapeHtml(r.name) + "</span>" +
          (r.tagShort
            ? '<span class="resident-tag' + (tagMatch ? " tag-match" : "") + '"' +
                (tagMatch ? ' title="有物证指向该身份"' : "") + ">" +
                ClueCards.escapeHtml(r.tagShort) + "</span>"
            : "") +
          (isScapegoat ? '<span class="scapegoat-mark" title="次要人物（无可解锁线索）">次要</span>' : "") +
        "</div>" +
        hintHtml;
      panel.appendChild(block);
    });
  },

  /** 渲染右侧线索池（有效线索 / 干扰线索两组）
   *  newCids?: 本轮新加入的线索 id 列表，命中后会触发「入卷」飞入动画。 */
  renderPool(newCids) {
    const validList = document.getElementById("valid-clue-list");
    const fakeList = document.getElementById("fake-clue-list");
    validList.innerHTML = "";
    fakeList.innerHTML = "";
    if (!App.levelData) {
      const vTip = document.createElement("p");
      vTip.className = "slot-empty";
      vTip.textContent = "（暂无线索）";
      const fTip = document.createElement("p");
      fTip.className = "slot-empty";
      fTip.textContent = "（暂无线索）";
      validList.appendChild(vTip);
      fakeList.appendChild(fTip);
      return;
    }
    const allEls = [];
    App.layout.pool.forEach((id) => {
      const c = App.clueMap[id];
      if (!c) return;
      const card = ClueCards.buildCard(c, App.layout.locked);
      (c.type === "fake" ? fakeList : validList).appendChild(card);
      allEls.push(card);
    });
    // 给本轮新解锁的线索触发「入卷」飞入动画
    if (newCids && newCids.length) ClueCards.markEntering(allEls, newCids);
    // 线索池为空时给出走访引导，避免玩家困惑
    if (!App.layout.pool.length) {
      const vTip = document.createElement("p");
      vTip.className = "slot-empty";
      vTip.textContent = "点击左侧居民头像交谈，解锁口供线索。";
      validList.appendChild(vTip);
    }
  },

  /** 渲染时间轴推理区（副本式展示：不影响主布局 slots/pool，来源卡片仍留在原处）。
   *  无时间描述的线索不显示时间标签；时序冲突的卡片自动标红。 */
  renderTimeline() {
    const track = document.getElementById("timeline-drop");
    if (!track) return;
    const ids = App.layout.timeline || [];
    if (!ids.length) {
      track.innerHTML = '<p class="timeline-empty">把带时间的目击 / 自白线索拖到这里，按先后顺序摆放</p>';
      return;
    }
    const conflictAll = ValidateUtil.detectTimelineConflict();
    // 误解对（misunderstand）只作参考提示，与「时序矛盾」拦截语义区分，避免误导玩家
    const conflictSet = new Set();
    const misunderstandSet = new Set();
    conflictAll.forEach((id) => {
      const cc = App.clueMap[id];
      if (cc && cc.conflictType === "misunderstand") misunderstandSet.add(id); else conflictSet.add(id);
    });
    // 缺陷 A：时间区间配对软提示（不阻断），收集需在卡片上加角标
    const pairing = ValidateUtil.detectTimeRangePairing(App.levelData);
    const overlapIds = new Set();
    const mutexIds = new Set();
    pairing.overlap.forEach((p) => { overlapIds.add(p.a); overlapIds.add(p.b); });
    pairing.mutex.forEach((p) => { mutexIds.add(p.a); mutexIds.add(p.b); });
    track.innerHTML = ids.map((id) => {
      const c = App.clueMap[id];
      if (!c) return "";
      const locked = App.layout.locked && App.layout.locked.indexOf(id) !== -1;
      const inConflict = conflictSet.has(id);
      const inMis = misunderstandSet.has(id);
      const inOverlap = overlapIds.has(id);
      const inMutex = mutexIds.has(id);
      const pairCls = inMutex ? " time-mutex" : (inOverlap ? " time-overlap" : "");
      const pairTag = inMutex
        ? ' · <span class="tl-pair-tag mutex">时间互斥</span>'
        : (inOverlap ? ' · <span class="tl-pair-tag overlap">同时窗</span>' : "");
      return '<div class="clue-card timeline-card' + (c.type === "fake" ? " fake" : " valid") +
        (locked ? " locked" : "") + (inConflict ? " conflict" : "") + pairCls + '" data-clue-id="' +
        ClueCards.escapeHtml(id) + '"' + (locked ? ' data-locked="1"' : "") + ">" +
        '<p class="clue-text">' + ClueCards.escapeHtml(c.text) + "</p>" +
        '<span class="clue-type"><i class="tl-flag"></i>' + ClueCards.escapeHtml(c.timeText || "时间未知") +
        (inConflict ? " · 时序矛盾" : (inMis ? ' · <span class="tl-pair-tag mis">误会对</span>' : "")) +
        pairTag + "</span></div>";
    }).join("");
  },

  /** 摆放变更后的统一收尾：存档 → 重渲染 → 刷新冲突标红 → 可选即时弹窗 */
  commitLayout(opts) {
    const opt = opts || {};
    StorageUtil.writeLevelState(App.currentLevel, App.layout);
    GameFlow.renderLevel(GameFlow.getLevelConfig());
    const conflictIds = ValidateUtil.syncConflictMarks();
    if (opt.alertOnConflict && conflictIds.length) {
      Modal.alert("时间轴矛盾", "时间轴上「" + ValidateUtil.conflictResidents(conflictIds).join("、") +
        "」相关证词互相矛盾。");
    }
  },

  /** 绑定底层拖拽交互（Pointer Events，鼠标 / 触屏通用） */
  setupDrag() {
    DragManager.init();
  },

  /** 指认凶手：先按关卡梯度门槛校验（干扰/走访/冲突/卡槽/时序/证据链），全部满足后进入指认 */
  accuseCulprit() {
    const cfg = this.getLevelConfig();
    if (!cfg) return;
    // D1：证据链 ≥3 真实门槛（与 index.html「至少 3 条才能指认」文案对齐）
    if (CaseFile.get().length < 3) {
      Modal.alert("证据链不足", "当前证据链 " + CaseFile.get().length +
        " 条。请先在卡片上点 ⊕ 收集至少 3 条、并重点收集与凶手相关的证据。");
      return;
    }
    this._checkMix(cfg, { onPass: () => this._showCulpritPicker(cfg) });
  },

  /** 弹出「指认凶手」二次确认弹窗：第一步选凶手，第二步选决定性证据。
   *  @param {Object} [opts] { lockedRid }：证据重选模式，锁定凶手人选，仅可换证据 */
  _showCulpritPicker(cfg, opts) {
    const opt = opts || {};
    const lockedRid = opt.lockedRid || null;
    const isRetry = !!lockedRid;
    const title = document.getElementById("modal-title");
    const text = document.getElementById("modal-text");
    const extra = document.getElementById("modal-extra");
    const btns = document.getElementById("modal-btns");
    const mask = document.getElementById("modal-mask");
    if (!title || !text || !extra || !btns || !mask) return;
    const esc = ClueCards.escapeHtml;
    const isHard = App.currentLevel >= 9;
    // 被排除居民集合：exclude 字段指向的居民在弹窗中置灰标注（仍可选，用于教学）
    const excludedIds = new Set((cfg.clues || [])
      .filter((c) => c.exclude).map((c) => c.exclude));
    // 区块一：凶手按钮网格（证据重选模式：仅高亮锁定者，其余禁用）
    let grid = '<div class="pick-sec-title">' + (isRetry ? "凶手人选 · 已锁定" : "第一步 · 谁是凶手？") +
      '</div><div class="culprit-pick-grid">';
    (cfg.residents || []).forEach((r) => {
      const ex = excludedIds.has(r.id);
      const locked = isRetry && r.id === lockedRid;
      grid += '<button type="button" class="modal-btn pk-resident' + (ex ? " excluded" : "") +
        (locked ? " picked" : "") + '" data-rid="' + esc(r.id) + '"' +
        (isRetry ? " disabled" : "") + ">" + esc(r.name) +
        (ex ? '<span class="pk-x">✗ 线索已排除</span>' : "") + "</button>";
    });
    grid += "</div>";
    // 区块二：决定性证据按钮（凶手关键线索 + 干扰项，最多 4 条）
    grid += '<div class="pick-sec-title">' + (isRetry ? "重选决定性证据 · 请一次找对" : "第二步 · 哪条证据最能证明 TA？") +
      '</div>';
    // 困难关(L9-11)：加分类筛选条，让玩家快速定位物证/自白/目击
    if (isHard) {
      grid += '<div class="pk-filter-bar">' +
        '<button type="button" class="pk-filter active" data-kind="all">全部</button>' +
        '<button type="button" class="pk-filter" data-kind="evidence">🔑 物证</button>' +
        '<button type="button" class="pk-filter" data-kind="statement">🗣 自白</button>' +
        '<button type="button" class="pk-filter" data-kind="witness">👁 目击</button>' +
        '<button type="button" class="pk-filter" data-kind="decoy">⚠ 干扰</button>' +
        "</div>";
    }
    grid += '<div class="culprit-pick-grid pk-evidence-grid">';
    // 预计算每条证据的 kind（便于筛选）
    const clueById = {};
    (cfg.clues || []).forEach((c) => { clueById[c.id] = c; });
    const kindOf = (evOpt) => {
      if (evOpt.isDecoy) return "decoy";
      const c = clueById[evOpt.id];
      if (!c) return "other";
      if (c.isEvidence) return "evidence";
      if (c.isSuspectStatement) return "statement";
      if (c.isWitness) return "witness";
      return "other";
    };
    this._evidenceOptions(cfg).forEach((c) => {
      const decoyTag = c.isDecoy ? ' <span class="pk-decoy-tag">⚠ 干扰</span>' : "";
      const kind = kindOf(c);
      grid += '<button type="button" class="modal-btn pk-evidence' + (c.isDecoy ? " decoy" : "") +
        '" data-evid="' + esc(c.id) + '" data-kind="' + kind + '">' + esc(c.text) + decoyTag + "</button>";
    });
    grid += "</div>";
    const lockedName = ((cfg.residents || []).find((r) => r.id === lockedRid) || {}).name || "此人";
    title.textContent = isRetry ? "🔍 最后机会 · 重选证据" : "🔍 指认凶手";
    text.textContent = isRetry
      ? "「" + esc(lockedName) + "」确实是凶手。请重新选择能定罪的决定性证据——若再选错，本章将判定失败。"
      : "请选出「凶手 + 决定性证据」组合。\n凶手选错将判定失败；选对凶手但证据（或证据链）不对，可以重选，不另算失败。";
    extra.style.display = "block";
    extra.innerHTML = grid;
    btns.innerHTML =
      '<button type="button" class="modal-btn" id="picker-ok" disabled>确认指认</button>' +
      '<button type="button" class="modal-btn" id="picker-cancel">取消</button>';
    mask.classList.add("show");
    let selRid = lockedRid, selEv = null;
    const okBtn = document.getElementById("picker-ok");
    const refreshOk = () => { okBtn.disabled = !(selRid && selEv); };
    // 选中态切换：同组单选（证据重选模式居民按钮 disabled，不响应点击）
    extra.querySelectorAll(".pk-resident").forEach((btn) => {
      if (isRetry) return;
      btn.addEventListener("click", () => {
        extra.querySelectorAll(".pk-resident").forEach((b) => b.classList.remove("picked"));
        btn.classList.add("picked");
        selRid = btn.dataset.rid;
        refreshOk();
      });
    });
    extra.querySelectorAll(".pk-evidence").forEach((btn) => {
      btn.addEventListener("click", () => {
        extra.querySelectorAll(".pk-evidence").forEach((b) => b.classList.remove("picked"));
        btn.classList.add("picked");
        selEv = btn.dataset.evid;
        refreshOk();
      });
    });
    // 困难关：分类筛选条（全部 / 物证 / 自白 / 目击 / 干扰）
    extra.querySelectorAll(".pk-filter").forEach((btn) => {
      btn.addEventListener("click", () => {
        extra.querySelectorAll(".pk-filter").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const kind = btn.dataset.kind;
        extra.querySelectorAll(".pk-evidence").forEach((ev) => {
          const match = kind === "all" || ev.dataset.kind === kind;
          ev.style.display = match ? "" : "none";
        });
        // 筛选后若当前选中的证据被隐藏，清除选择
        if (selEv) {
          const selBtn = extra.querySelector('.pk-evidence[data-evid="' + CSS.escape(selEv) + '"]');
          if (selBtn && selBtn.style.display === "none") {
            selBtn.classList.remove("picked");
            selEv = null;
            refreshOk();
          }
        }
      });
    });
    okBtn.addEventListener("click", () => {
      Modal.close();
      this._handleAccusation(cfg, selRid, selEv, { retry: isRetry });
    });
    const cancel = document.getElementById("picker-cancel");
    if (cancel) cancel.addEventListener("click", () => Modal.close());
  },

  /**
   * 决定性证据正确项集合：仅取凶手的"物证 isEvidence=true" + pointsTo 凶手的物证。
   * 之前误用"凶手所有 solution 线索 + 所有目击"，导致 7+ 条全是正确选项，玩家瞎选都对 80%+
   * 现在限定为"物证"维度（每个案件通常 1-4 条物证）—— 弹窗构成合理（1-4 正确 + 3-4 干扰）
   * 玩家必须真的"识别铁证"才能通关 */
  _killerKeyIds(cfg) {
    const key = new Set();
    (cfg.solution && cfg.solution[cfg.culpritId] || []).forEach((cid) => {
      const c = (cfg.clues || []).find((x) => x.id === cid);
      if (c && c.isEvidence === true) key.add(cid);
    });
    (cfg.clues || []).forEach((c) => {
      if (c.pointsTo === cfg.culpritId && c.isEvidence === true) key.add(c.id);
    });
    return key;
  },

  /** 指认弹窗「决定性证据」候选（picker 第二步选项来源）。
   *  正确项 = 凶手铁证（_killerKeyIds，isEvidence）；干扰项 = 凶手自白（实为撒谎，非定罪铁证）、
   *  指向他人的物证、ext.decoyEvidence 文本。无对应 clue 的干扰项用虚拟 id。 */
  _evidenceOptions(cfg) {
    const options = [];
    const seen = new Set();
    const push = (id, text, isDecoy) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      options.push(isDecoy ? { id, text, isDecoy: true } : { id, text });
    };
    // 1) 正确项：凶手铁证
    this._killerKeyIds(cfg).forEach((cid) => {
      const c = (cfg.clues || []).find((x) => x.id === cid);
      if (c) push(cid, c.text);
    });
    // 2) 干扰：凶手自白（谎言本身不能作为定罪物证）
    ((cfg.solution && cfg.solution[cfg.culpritId]) || []).forEach((cid) => {
      const c = (cfg.clues || []).find((x) => x.id === cid);
      if (c && c.isSuspectStatement === true) push(cid, c.text);
    });
    // 3) 干扰：指向其他居民的物证
    (cfg.clues || []).forEach((c) => {
      if (c && c.isEvidence === true && c.type !== "fake" && c.pointsTo && c.pointsTo !== cfg.culpritId) {
        push(c.id, c.text);
      }
    });
    // 4) 干扰：ext.decoyEvidence 文本（无对应 clue id，虚拟 id = decoy-i）
    ((cfg.ext && cfg.ext.decoyEvidence) || []).forEach((txt, i) => {
      push("decoy-" + i, txt, true);
    });
    return options;
  },

  /** 指认结果判定（v2 证据链版）：
   *  - 凶手错 → 整局失败（重置）
   *  - 凶手对 + verdict = perfect/standard → 通关（弹标准结局 + verdict 徽标）
   *  - 凶手对 + verdict = flawed/insufficient → _promptCaseFileRetry（让玩家调整证据链，不算失败）
   *  - 证据重选模式（retry）下，verdict 必须 perfect/standard 才通关；否则整局失败
   *  @param {Object} [opts] { retry }：true 表示处于证据重选二次机会 */
  _handleAccusation(cfg, selectedId, evId, opts) {
    const opt = opts || {};
    if (selectedId !== cfg.culpritId) {
      this._onAccuseFail(cfg, selectedId);
      return;
    }
    // 凶手人选正确 → 先校验「决定性证据」是否真能定罪（P0-2 修复：evId 参与判定）
    const key = this._killerKeyIds(cfg);
    if (!evId || !key.has(evId)) {
      if (opt.retry) { this._onAccuseFail(cfg, selectedId); return; }
      this._promptEvidenceRetry(cfg, selectedId);
      return;
    }
    // 决定性证据同时也必须在证据链内（picker 与 ⊕ 同源，规则一致）
    if (!CaseFile.has(evId)) {
      this._promptCaseFileRetry(cfg, selectedId, { verdict: "insufficient", counts: { core: 0, aux: 0, red: 0, amb: 0 } });
      return;
    }
    // 凶手人选正确——评估证据链
    const lvId = "L" + App.currentLevel;
    const submitted = CaseFile.get();
    const result = (typeof evaluateCase === "function")
      ? evaluateCase(lvId, submitted)
      : { verdict: "insufficient", counts: { core: 0, aux: 0, red: 0, amb: 0 } };
    const v = result.verdict;
    if (v === "perfect" || v === "standard") {
      this._onLevelClear(cfg, result);
      return;
    }
    if (opt.retry) {
      this._onAccuseFail(cfg, selectedId);
      return;
    }
    this._promptCaseFileRetry(cfg, selectedId, result);
  },

  /** 决定性证据选错的轻提示：凶手已对，但所选证据不是「决定性铁证」→ 给一次重选机会（不算失败） */
  _promptEvidenceRetry(cfg, rid) {
    const resident = (cfg.residents || []).find((r) => r.id === rid);
    const name = resident ? resident.name : "此人";
    Modal.confirm("决定性证据不对",
      "「" + name + "」确实是凶手，但你刚才选的那条线索不能直接给 TA 定罪。\n\n再给你一次重选证据的机会；若再选错，本章将判定失败。",
      () => this._showCulpritPicker(cfg, { lockedRid: rid }),
      () => this._onAccuseFail(cfg, rid));
  },

  /** 证据链未达标的轻量提示：凶手已选对，但证据链有瑕疵或缺铁证。
   *  玩家可选择「返回调整」关闭弹窗回主界面，或「忽略瑕疵」直接结案（拿 standard 结局）。 */
  _promptCaseFileRetry(cfg, rid, result) {
    const resident = (cfg.residents || []).find((r) => r.id === rid);
    const name = resident ? resident.name : "此人";
    const v = result.verdict;
    const c = result.counts;
    const VERDICT_MSG = {
      flawed: {
        title: "证据有杂质",
        text: "凶手人选对了，但你的证据链里混入了「干扰」——再翻翻每条线索的来源。\n\n" +
              "当前：🔴 铁证 " + c.core + " 条 · 🟢 旁证 " + c.aux + " 条 · 🟡 干扰 " + c.red + " 条",
      },
      insufficient: {
        title: "铁证不足",
        text: "凶手人选对了，但证据链里缺少直接定罪的「铁证」——凶手通常会有自白撒谎或被目击。\n\n" +
              "当前：🔴 铁证 " + c.core + " 条 · 🟢 旁证 " + c.aux + " 条 · 🟡 干扰 " + c.red + " 条",
      },
    };
    const msg = VERDICT_MSG[v] || VERDICT_MSG.insufficient;
    const titleEl = document.getElementById("modal-title");
    const textEl = document.getElementById("modal-text");
    const extraEl = document.getElementById("modal-extra");
    const btnsEl = document.getElementById("modal-btns");
    const mask = document.getElementById("modal-mask");
    if (!titleEl || !textEl || !extraEl || !btnsEl || !mask) return;
    titleEl.textContent = "⚠️ " + msg.title;
    textEl.textContent = "「" + name + "」确实是凶手。" + msg.text + "\n\n返回主界面调整证据链，或忽略瑕疵直接结案。";
    extraEl.style.display = "none";
    extraEl.innerHTML = "";
    btnsEl.innerHTML =
      '<button type="button" class="modal-btn" id="casefile-back">返回调整</button>' +
      '<button type="button" class="modal-btn" id="casefile-retry">重选证据</button>' +
      '<button type="button" class="modal-btn primary" id="casefile-accept">忽略瑕疵 · 直接结案</button>';
    mask.classList.add("show");
    const back = document.getElementById("casefile-back");
    const retry = document.getElementById("casefile-retry");
    const accept = document.getElementById("casefile-accept");
    if (back) back.addEventListener("click", () => Modal.close());
    if (retry) retry.addEventListener("click", () => {
      Modal.close();
      this._showCulpritPicker(cfg, { lockedRid: rid });
    });
    if (accept) accept.addEventListener("click", () => {
      Modal.close();
      this._onLevelClear(cfg, result);
    });
  },

  /** 指认失败：本局累计失败次数（重置时清零）→ 渐进提示 / 排除法专属提示 / 高亮关键证据。
   *  进度反馈：把"本局失败 X / 3"渲染到底部调查进度条，让玩家清楚剩余机会。 */
  _onAccuseFail(cfg, selectedId) {
    const fails = (App.layout.accuseFails || 0) + 1;
    App.layout.accuseFails = fails;
    StorageUtil.writeLevelState(App.currentLevel, App.layout);
    this.renderProgress();
    const resident = (cfg.residents || []).find((r) => r.id === selectedId);
    const name = resident ? resident.name : "此人";
    // 优先级1：选中被排除居民 → 排除法专属提示（漏洞5）
    const byClue = (cfg.clues || []).find((c) => c.exclude === selectedId);
    let msg;
    if (byClue) {
      msg = "你指认「" + name + "」，却忽略了「" + this._clueSpeaker(cfg, byClue.id) +
        "」的说法：「" + byClue.text + "」\n\n这条证词表明「" + name + "」不可能是凶手。";
    } else if (fails >= 3) {
      const killer = (cfg.residents || []).find((r) => r.id === cfg.culpritId);
      const kTexts = Array.from(this._killerKeyIds(cfg)).map((cid) => {
        const c = (cfg.clues || []).find((x) => x.id === cid);
        return c ? c.text : cid;
      });
      msg = "已连续多次失利，给你关键提示：决定性证据【" + kTexts.join("；") +
        "】应指向「" + (killer ? killer.name : "凶手") + "」。";
      this._highlightKeyClues(cfg);
    } else if (fails === 2) {
      msg = "留意证词之间的先后顺序与互相矛盾之处——谁的说法经不起推敲，谁就越可疑。";
    } else {
      msg = "「" + name + "」的不在场证明其实很完整，再想想谁的说法漏洞更多。";
    }
    Modal.alert("指认失败", msg + "\n\n本次推理已结束，本局将重置，请重新推理。",
      () => this._restartLevel());
  },

  /** 高亮关键时刻线索卡：第 3 次及以上失败时，脉冲提示凶手决定证据所在 */
  _highlightKeyClues(cfg) {
    this._killerKeyIds(cfg).forEach((cid) => {
      const card = document.querySelector('.clue-card[data-clue-id="' + CSS.escape(cid) + '"]');
      if (card) card.classList.add("key-hint");
    });
  },

  /** 由线索 id 反查说话者姓名（失败提示文案用） */
  _clueSpeaker(cfg, cid) {
    const sol = cfg.solution || {};
    for (const rid of Object.keys(sol)) {
      if (sol[rid].indexOf(cid) !== -1) {
        const r = (cfg.residents || []).find((x) => x.id === rid);
        return r ? r.name : "某人";
      }
    }
    return "某人";
  },

  /** 失败后重开本局：保留走访记录（dialog 状态）+ 仅清布局与本局失败计数。
   *  玩家不会因为"指认失败"而失去已收集的口供证据；只清空时间轴/线索池/锁定/本局失败数/证据链。 */
  _restartLevel() {
    // 保留 StorageUtil.readDialogRecord 的内容（走访已交谈的人）；只清布局相关字段
    const prev = StorageUtil.readLevelState(App.currentLevel);
    StorageUtil.writeLevelState(App.currentLevel, {
      pool: [], mapPlace: {}, timeline: [], locked: [], caseFile: [],
      hintCount: prev && typeof prev.hintCount === "number" ? prev.hintCount : 0,
      accuseFails: 0,
    });
    // 走访记录天然保留在独立 key（townMystery_dialog_L{n}）中，无需在此重写
    this.loadLevelPlaceholder();
  },

  /** 标准混合模式：按关卡 ext 梯度逐层校验，缺哪条精准提示哪条
   *  @param {Object} [opts] { onPass }：全部门槛通过后执行的动作（缺省通关） */
  _checkMix(cfg, opts) {
    const opt = opts || {};
    const onPass = opt.onPass || (() => this._onLevelClear(cfg));
    const rule = this.getLevelRule(cfg);
    // 步骤0：全局前置 - 干扰线索入时间轴检测（fake 占位不属于案发时间线）
    // 注：旧版卡槽机制下的 checkFakeClueInSlot 已下线，统一改读时间轴真实检测
    const fakeIds = (App.layout.timeline || []).filter((id) => {
      const c = App.clueMap[id];
      return !!(c && c.type === "fake");
    });
    if (fakeIds.length) {
      Modal.alert("干扰线索", "有 " + fakeIds.length +
        " 条灰色干扰线索被放入了时间轴。干扰线索不会构成案发时间线，应留在下方线索池中，请先移出再提交推理。");
      return;
    }
    // 步骤1：走访取证 - 未交谈居民提供「去走访 / 直接校验」双选择（不静默绕过）
    const unTalk = this._getUnInterviewResident(cfg);
    if (unTalk.length && rule.needInterview) {
      const names = unTalk.map((r) => r.name).join("、");
      Modal.confirm("还有居民未走访",
        "「" + names + "」你还没有交谈。走访可获得更多口供线索，建议先走访再提交推理。\n\n若确认已足够，可直接校验。",
        () => this._continueMixCheck(cfg, rule, onPass),
        null);
      return;
    }
    this._continueMixCheck(cfg, rule, onPass);
  },

  /** 混合模式继续校验（卡槽机制已移除，仅保留时间轴 + 物证两道门槛）
   *  门槛顺序：时间轴冲突(区分撒谎/误会) → 物证锁死（已退化为 no-op）
   *  @param {Function} [onPass] 全部门槛通过后的动作（缺省：通关） */
  _continueMixCheck(cfg, rule, onPass) {
    const pass = onPass || (() => this._onLevelClear(cfg));
    // 步骤1：时间轴矛盾检测（组内多条 > 1 且非误解则拦截；误解对只作参考，不构成拦截）
    // 注：L1-L3（checkTimeline=false）完全放行时间轴，对应新手宽松档；L4-L11 只拦主动撒谎（lie）冲突。
    if (rule.checkTimeline) {
      const conflictIds = ValidateUtil.detectTimelineConflict().filter((id) => {
        const c = App.clueMap[id];
        return !c || c.conflictType !== "misunderstand";
      });
      if (conflictIds.length) {
        let tip = "";
        const lieTip = App.currentLevel <= 3
          ? "存在人物主动撒谎，重点排查其时间描述与在场证明。"
          : (App.currentLevel <= 8 ? "有人说的话对不上，你觉得是谁？" : "");
        conflictIds.forEach((id) => {
          const c = App.clueMap[id];
          if (c && c.conflictType === "lie" && lieTip) {
            if (tip.indexOf(lieTip) === -1) tip += (tip ? "\n" : "") + lieTip;
          }
        });
        if (!tip) tip = "请重新梳理时间轴上的证词。";
        Modal.alert("证词互相矛盾", "时间轴上「" + ValidateUtil.conflictResidents(conflictIds).join("、") +
          "」相关证词互相矛盾。\n\n" + tip);
        return;
      }
    }
    // 步骤2：物证闭环校验（evidenceKeys 中的物证 id 必须已纳入时间轴/线索池）
    if (rule.checkEvidence && rule.evidenceKeys && rule.evidenceKeys.length) {
      const missing = this._getMissingEvidence(cfg, rule.evidenceKeys);
      if (missing.length) {
        const isHard = App.currentLevel >= 9;
        const parts = missing.map((m) => {
          if (m && m.tag && !isHard) return "【" + m.id + "】（对应身份：\u201c" + m.tag + "\u201d）";
          return "【" + (m && m.id ? m.id : m) + "】";
        }).join("、");
        Modal.alert("缺少关键佐证", "还缺少关键物证 " + parts +
          "。\n\n该物证对应特殊身份，请结合居民身份标签继续排查。");
        return;
      }
    }
    // 全部门槛通过 → 执行成功动作（进入指认弹窗）
    pass();
  },

  /** 解析当前关卡的推理规则（读 ext，缺省兜底原始梯度）：
   *  { needInterview, checkTimeline, checkEvidence, evidenceKeys } */
  getLevelRule(cfg) {
    const ext = (cfg && cfg.ext) || {};
    // 难度档位：优先 ext.diffLevel，兜底按关卡序号 1~3 / 4~8 / 9~11
    const diffLevel = Number(ext.diffLevel) ||
      (App.currentLevel <= 3 ? 1 : (App.currentLevel <= 8 ? 2 : 3));
    return {
      needInterview: ext.needInterview !== false, // 走访软提醒默认开启
      checkTimeline: ext.checkTimeline !== undefined ? !!ext.checkTimeline : diffLevel >= 2,
      checkEvidence: ext.checkEvidence !== undefined ? !!ext.checkEvidence : diffLevel >= 3,
      evidenceKeys: Array.isArray(ext.evidenceKeys) ? ext.evidenceKeys : [],
    };
  },

  /** 获取未走访居民列表（混合模式门槛 1 用） */
  _getUnInterviewResident(cfg) {
    const talked = StorageUtil.readDialogRecord(App.currentLevel);
    return (cfg.residents || []).filter((r) => talked.indexOf(r.id) === -1);
  },

  /** 检测缺失的关键物证（证据链闭环门槛）。
   *  卡槽机制下线后，判定"玩家是否已把关键物证纳入推理视野"：
   *  关键物证必须出现在 App.layout.timeline（已在时间轴上被审视）
   *  或 App.layout.pool（已在下方线索池中可见）之一，即视为「已采纳」。
   *  困难关（diffLevel=3）不展示物证对应身份标签，避免直接剧透。
   *  @param {Object} cfg 当前关卡配置
   *  @param {string[]} evKeys 关键物证 id 列表（来自 ext.evidenceKeys）
   *  @returns {Array<{id:string,tag:string}>} 缺失的关键物证（含身份标签用于文案） */
  _getMissingEvidence(cfg, evKeys) {
    if (!cfg || !Array.isArray(evKeys) || !evKeys.length) return [];
    const seen = new Set([].concat(App.layout.timeline || [], App.layout.pool || []));
    const diffLevel = Number((cfg.ext || {}).diffLevel) ||
      (App.currentLevel <= 3 ? 1 : (App.currentLevel <= 8 ? 2 : 3));
    const isHard = diffLevel >= 3;
    const missing = [];
    evKeys.forEach((eid) => {
      if (seen.has(eid)) return;
      const c = (cfg.clues || []).find((x) => x.id === eid);
      if (!c) return;
      // 困难关不外泄 evidenceOwnerTag，避免直接剧透身份
      missing.push({ id: eid, tag: isHard ? "" : (c.evidenceOwnerTag || "") });
    });
    return missing;
  },

  /** 时间重叠排查弹窗：时间轴拖入新目击证词后，
   *  列出「同时在场人数最多的时段」与全部在场者姓名（同局仅弹一次，避免打扰）。
   *  用于强制玩家意识到多人具备作案时间，防止单人锁凶。 */
  notifyTimeOverlap() {
    const cfg = this.getLevelConfig();
    if (!cfg) return;
    if (App.layout.overlapWarned) return;
    const res = ValidateUtil.detectTimeOverlap(cfg);
    if (!res) return;
    App.layout.overlapWarned = true;
    StorageUtil.writeLevelState(App.currentLevel, App.layout);
    Modal.alert("时间重叠排查",
      "【" + GameFlow._fmtMin(res.lo) + " ~ " + GameFlow._fmtMin(res.hi) + "】时段内，以下人都有在场证明：\n" +
      "「" + res.names.join("、") + "」\n\n" +
      "他们都具备作案时间——不能仅凭「谁有空」锁凶。请结合证词矛盾与物证归属进一步筛选。");
  },

  /** 分钟数（0~1439）格式化为 HH:MM 时间字符串 */
  _fmtMin(m) {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return (h < 10 ? "0" + h : h) + ":" + (mm < 10 ? "0" + mm : mm);
  },

  /** 通关处理：真相弹窗 + 更新解锁进度 + 解锁本关居民档案
   *  v2：可选 result 参数（来自 evaluateCase），用于在通关弹窗里显示 verdict 徽标。 */
  _onLevelClear(cfg, result) {
    // E4：通关后清空本局布局与失败计数（重进已通关关卡是干净开局；走访/档案记录保留）
    StorageUtil.writeLevelState(App.currentLevel, {
      pool: [], mapPlace: {}, timeline: [], locked: [], caseFile: [], hintCount: 0, accuseFails: 0,
    });
    const progress = StorageUtil.readProgress();
    // 增量：通关自动解锁本关居民档案（首次解锁时弹出轻提示）
    const newlyUnlocked = BioArchive.unlockLevel(cfg);
    if (newlyUnlocked.length) BioArchive.showUnlockToast(newlyUnlocked);
    if (App.currentLevel >= progress.unlocked && App.currentLevel < App.totalLevels) {
      StorageUtil.writeProgress(progress.unlocked + 1);
    }
    // 增量：全收集检测（延迟至轻提示之后，避免与通关弹窗叠加）
    setTimeout(() => Achievement.check(), 3000);
    const isLast = App.currentLevel >= App.totalLevels;
    // 番外：每关 ext.endingStory 温情小故事，最后一关展示小镇终章总结
    const story = cfg.ext && cfg.ext.endingStory;
    let extraHtml = "";
    if (result && result.verdict) {
      const v = result.verdict;
      const VERDICT_TEXT = {
        perfect: "🔴 铁案",
        standard: "🟢 标准结案",
        flawed: "🟡 证据有瑕疵",
        insufficient: "⚪ 铁证不足",
      };
      const badge = '<div class="verdict-badge ' + v + '">' + (VERDICT_TEXT[v] || v) + '</div>';
      const c = result.counts || { core: 0, aux: 0, red: 0, amb: 0 };
      const breakdown = '<p style="font-size:12px;color:var(--text-sub);margin:0 0 6px;">' +
        '本次证据链：🔴 铁证 ' + c.core + ' 条 · 🟢 旁证 ' + c.aux + ' 条 · 🟡 干扰 ' + c.red + ' 条' +
        (c.amb ? ' · ⚪ 中立 ' + c.amb + ' 条' : '') + '</p>';
      extraHtml += badge + breakdown;
    }
    if (story) {
      extraHtml = '<span class="modal-extra-title">· ' + (isLast ? "小镇终章" : "小镇小番外") + "</span>" +
        "<p>" + ClueCards.escapeHtml(story) + "</p>";
    }
    // 关键证据 + decoy 清单：玩家通关后回看本关推理路径
    const review = this._buildClueReview(cfg);
    if (review) extraHtml += review;
    Modal.alertWithExtra(
      "案件告破",
      cfg.truth + (isLast ? "\n\n恭喜你通关全部 11 关！" : "\n\n已解锁下一关。"),
      extraHtml,
      () => {
        if (isLast) {
          Menu.showPage("page-menu");
        } else {
          Menu.showPage("page-levels");
          Menu.renderLevels();
        }
      }
    );
  },

  /**
   * 构造"本关线索角色复盘"清单（仅在通关时展示）。
   * - 优先使用 town_data.js 的 TOWN_CLUE_ROLES，把所有线索按 4 种 role 分组展示：
   *     🔴 致命铁证 core / 🟢 旁证 aux / 🟡 干扰 red / ⚪ 中立 amb
   * - 若 TOWN_CLUE_ROLES 不可用（数据缺失），回退到旧的"关键 + decoy"两栏布局。
   * 让玩家通关后能"复盘"——哪些线索是真正定罪的、哪些是陷阱、哪些是旁证。
   * @returns {string} HTML 字符串
   */
  _buildClueReview(cfg) {
    const esc = ClueCards.escapeHtml;
    const stripPrefix = (text) => String(text || "").replace(/^[^：:]*[：:]\s*/, "");
    const lvId = "L" + App.currentLevel;
    const roles = (typeof TOWN_CLUE_ROLES !== "undefined") ? TOWN_CLUE_ROLES[lvId] : null;

    if (roles) {
      const ROLE_META = {
        core: { icon: "🔴", name: "致命铁证" },
        aux:  { icon: "🟢", name: "旁证 / 自证" },
        red:  { icon: "🟡", name: "干扰 / 陷阱" },
        amb:  { icon: "⚪", name: "中立线索" },
      };
      const sections = [];
      ["core", "aux", "red", "amb"].forEach((role) => {
        const cids = roles[role] || [];
        if (!cids.length) return;
        const items = cids.map((cid) => {
          const c = (cfg.clues || []).find((x) => x.id === cid);
          if (!c) return "";
          return '<li><span class="review-icon role-' + role + '">' + ROLE_META[role].icon + '</span>' + esc(stripPrefix(c.text)) + '</li>';
        }).join("");
        if (!items) return;
        sections.push(
          '<span class="modal-extra-title">· ' + ROLE_META[role].name + ' (' + cids.length + ')</span>' +
          '<ul class="clue-review-list ' + role + '-list">' + items + '</ul>'
        );
      });
      if (sections.length) return sections.join("");
    }

    const keySet = this._killerKeyIds(cfg);
    const decoys = (cfg.ext && cfg.ext.decoyEvidence) || [];
    if (!keySet.size && !decoys.length) return "";
    const classify = (c) => {
      if (!c) return "📁";
      if (c.isEvidence) return "🔑";
      if (c.isSuspectStatement) return "🗣";
      if (c.isWitness) return "👁";
      return "📁";
    };
    const keysHtml = Array.from(keySet).map((cid) => {
      const c = (cfg.clues || []).find((x) => x.id === cid);
      if (!c) return "";
      return '<li><span class="review-icon">' + classify(c) + "</span>" + esc(stripPrefix(c.text)) + "</li>";
    }).join("");
    const decoysHtml = decoys.map((d) => {
      return '<li><span class="review-icon decoy">⚠</span>' + esc(d) + "</li>";
    }).join("");
    return '<span class="modal-extra-title">· 关键证据回顾</span>' +
      (keysHtml ? '<ul class="clue-review-list">' + keysHtml + "</ul>" : "<p>（无）</p>") +
      (decoysHtml
        ? '<span class="modal-extra-title">· 干扰证据（陷阱）</span><ul class="clue-review-list decoy-list">' + decoysHtml + "</ul>"
        : "");
  },

  /**
   * 获取提示：单档 + 两步递进。
   * 第一次点击给「方向」提示，第二次点击给「直指凶手」提示；
   * 第二次必须先走访全部居民才会解锁。最多 2 次，用完按钮置灰。
   */
  getHint() {
    const used = App.layout.hintCount || 0;
    if (used >= 2) return;
    const cfg = this.getLevelConfig();
    if (!cfg) return;
    const hg = cfg.ext && cfg.ext.hintGroup;
    let text, step2;
    if (hg) {
      text = hg.step1 || (cfg.hintsBlur || cfg.hints || [])[0] || "暂无更多提示。";
      step2 = hg.step2 || (cfg.hintsBlur || cfg.hints || [])[1] || "";
    } else {
      const arr = cfg.hintsBlur || cfg.hints || [];
      text = arr[used] || "暂无更多提示。";
      step2 = "";
    }
    const allTalked = !this._getUnInterviewResident(cfg).length;
    const isFirst = used === 0;
    // E2：第二步「直指凶手」门槛——未走访全部居民时不允许升级，且不消耗次数
    if (!isFirst && (!allTalked || !step2)) {
      Modal.alert("提示", "请先走访全部居民，再获取「直指凶手」提示（本次不消耗提示次数）。");
      return;
    }
    App.layout.hintCount = used + 1;
    StorageUtil.writeLevelState(App.currentLevel, App.layout);
    this._syncHintButton();
    const label = isFirst ? "提示 方向" : "提示 直指";
    const displayText = isFirst ? text : step2 || text;
    const extraHtml = isFirst && step2
      ? (allTalked
          ? '<button type="button" class="action-btn hint-step2" id="hint-step2-btn" data-extra-click>直指凶手</button>'
          : '<p class="hint-locked" style="font-size:12px;color:#a00;margin-top:8px;">走访全部居民后解锁「直指凶手」</p>')
      : "";
    Modal.alertExtra(label + " " + App.layout.hintCount + " / 2", displayText, extraHtml, () => {
      if (isFirst && allTalked && step2) {
        // 就地替换为「直指凶手」提示（不再新开弹窗覆盖，避免原 onClose 丢失）
        Modal.replaceContent("提示 直指", step2);
      }
    });
  },

  /** 同步提示按钮状态（按剩余次数 + 用完置灰） */
  _syncHintButton() {
    const btn = document.getElementById("btn-hint");
    if (!btn) return;
    const used = App.layout.hintCount || 0;
    btn.disabled = used >= 2;
    btn.textContent = used >= 2
      ? "提示已用完"
      : "获取提示 (" + (2 - used) + " / 2)";
  },

  /** 重置本局：带二次确认，避免误触清空布局；确认后复用 _restartLevel（跨局失败次数保留） */
  resetLevel() {
    Modal.confirm("确认重置本局？", "当前的时间轴与线索池将被清空，已走访的居民记录会保留——你不用重新跑口供。确定要重新开始吗？", () => {
      this._restartLevel();
      Modal.alert("已重置", "本局时间轴与线索池已清空；走访记录保留，请重新推理。");
    });
  },

  };

/* ============================================================
   模块七·补二：居民档案收集（BioArchive，叙事收集增量）
   说明：
   - 解锁进度存于 unlockedBioList（由 StorageUtil.readBioRecord 管理）
   - 关卡内点击居民头像 / 姓名 → 打开人物档案弹窗
   - 本关已通关 → 展示完整 bio 生平 + secret 彩蛋；未通关 → 上锁蒙版
   - 通关时自动解锁本关全部居民，首次解锁弹轻提示
   仅增量；不触碰 DragManager / ValidateUtil / 推理校验逻辑。
   ============================================================ */
const Achievement = {
  KEY: "townMystery_achievementAllCollect",

  isShown() { return StorageUtil.read(this.KEY, "0") === "1"; },
  _markShown() { StorageUtil.write(this.KEY, "1"); },

  /** 检测是否全收集，未展示过则弹窗 */
  check() {
    const total = Archive.totalResidents();
    const unlocked = BioArchive.getUnlocked().length;
    if (total > 0 && unlocked >= total && !this.isShown()) {
      this._markShown();
      this.open();
    }
  },
  open() { document.getElementById("achievement-mask").classList.add("show"); },
  close() { document.getElementById("achievement-mask").classList.remove("show"); },
};
(function init() {
  // 数据/机制升级时一次性清档：旧版关卡进度会与新谜题冲突
  StorageUtil.migrateIfNeeded();
  // 刷新主菜单按钮文案（首次玩 →"开始游戏"，老玩家 →"继续推理（当前第 N 关）"）
  Menu.refreshStartButton();
  // 刷新主菜单脚注与档案馆按钮的实时统计
  Menu.refreshMenuStats();
  // 刷新今日提示 / 印章进度环
  Menu.refreshMenuTipAndRing();
  // 主菜单入口：开始游戏 → 关卡选择页（让玩家自选关卡；首次玩则 highlight 当前已解锁关）
  document.getElementById("btn-start").addEventListener("click", () => {
    Menu.showPage("page-levels");
    Menu.renderLevels();
  });
  // 主菜单"先看新手指引"按钮：主动打开教程（不写已看标记，但会自动弹窗）
  document.getElementById("btn-tutorial-menu").addEventListener("click", () => {
    GameFlow.showTutorialCards(false);
  });
  // 居民档案馆入口
  document.getElementById("btn-archive").addEventListener("click", () => {
    Archive.render();
    Menu.showPage("page-archive");
  });
  // 返回按钮
  document.getElementById("btn-back-menu").addEventListener("click", () => Menu.showPage("page-menu"));
  document.getElementById("btn-back-archive").addEventListener("click", () => Menu.showPage("page-menu"));
  document.getElementById("btn-back-game").addEventListener("click", () => {
    // 返回前二次确认：本局摆放 / 走访记录将被清空，点「取消」则留在本关
    Modal.confirm(
      "确认返回主菜单？",
      "返回将清空当前的时间轴与线索池（已走访的居民记录会保留）。确定离开吗？",
      () => {
        GameFlow._restartLevel(); // 清空本局布局，避免再进入时残留
        Menu.showPage("page-menu");
      }
    );
  });
  // 底部按钮
  document.getElementById("btn-accuse").addEventListener("click", () => GameFlow.accuseCulprit());
  document.getElementById("btn-hint").addEventListener("click", () => GameFlow.getHint());
  document.getElementById("btn-reset").addEventListener("click", () => GameFlow.resetLevel());
  // 证据链 UI：清空按钮 + 卡片 ⊕ 按钮事件委托
  const clearBtn = document.getElementById("cfb-clear");
  if (clearBtn) clearBtn.addEventListener("click", () => {
    if (CaseFile.get().length === 0) return;
    Modal.confirm("清空证据链", "确定要清空已收集的 " + CaseFile.get().length + " 条证据吗？",
      () => CaseFile.clear(), null);
  });
  // 证据链 ⊕ + 时间轴 ⏱ 统一事件委托（挂 document；旧代码挂不存在的 #page-case，导致全链失效）
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!t || !(t instanceof Element)) return;
    const caseBtn = t.closest(".clue-case-toggle");
    const tlBtn = t.closest(".clue-tl-toggle");
    if (!caseBtn && !tlBtn) return;
    e.stopPropagation();
    e.preventDefault();
    const cid = (caseBtn || tlBtn).dataset.cid;
    if (!cid) return;
    if (caseBtn) CaseFile.toggle(cid);
    else ClueCards.toggleTimeline(cid);
  });
  // 常驻「新手指引」：随时重看引导，不写已看标记
  document.getElementById("btn-tutorial").addEventListener("click", () => GameFlow.showTutorialCards(false));
  // 弹窗遮罩点击空白处关闭
  document.getElementById("modal-mask").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) Modal.close();
  });
  // 人物档案弹窗：点击遮罩空白处关闭
  document.getElementById("bio-mask").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) BioArchive.close();
  });
  // 居民头像 / 姓名区点击 → 打开人物档案（事件委托）
  document.addEventListener("click", (e) => {
    if (!(e.target instanceof Element)) return;
    const head = e.target.closest(".resident-head");
    if (!head || !head.dataset.resident) return;
    const resident = (App.residents || []).find((r) => r.id === head.dataset.resident);
    if (!resident) return;
    // 走访系统：mix 模式交谈解锁线索入池；drag 模式走访为「指认凶手」前置门槛
    DialogSystem.open(resident);
  });

  // —— 增量：跨关人物关系 / 小镇大事记 ——
  document.getElementById("btn-lore").addEventListener("click", () => LorePanel.open());
  document.getElementById("lore-mask").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) LorePanel.close();
  });
  document.getElementById("btn-chronicle").addEventListener("click", () => ChroniclePanel.open());
  document.getElementById("chronicle-mask").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) ChroniclePanel.close();
  });

  // —— 增量：小镇群像总图 ——
  // 档案馆「小镇群像总图」按钮
  document.getElementById("btn-town-map").addEventListener("click", () => TownMap.render());
  // 群像总图遮罩空白处关闭
  document.getElementById("town-map-mask").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) TownMap.close();
  });

  // —— 增量：全收集成就纪念弹窗 ——
  document.getElementById("achievement-close").addEventListener("click", () => Achievement.close());
  document.getElementById("achievement-view-map").addEventListener("click", () => {
    Achievement.close();
    TownMap.render();
  });
  document.getElementById("achievement-mask").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) Achievement.close();
  });

  // 首次进入展示主菜单
  Menu.showPage("page-menu");
  // 静音按钮：点击切换 BGM 静音状态
  document.getElementById("btn-mute").addEventListener("click", () => Bgm.toggleMute());
  // 启动背景音乐（两路 Audio + 首次点击解锁）
  Bgm.init();
  Bgm._refreshMuteButton();
  // 监听 mask 打开顺序：class 出现 .show 时打时间戳，供 ESC 关闭"真正最后打开"的弹窗
  // （多个 mask 的 z-index 相同，DOM 顺序 ≠ 打开顺序，必须按打开先后关闭；无 MutationObserver 的环境退化按原顺序）
  const maskOrderSeq = { n: 0 };
  if (typeof MutationObserver === "function") {
    const maskOrderWatcher = new MutationObserver((muts) => {
      muts.forEach((m) => {
        if (m.type === "attributes" && m.attributeName === "class" && m.target.classList.contains("show")) {
          m.target.dataset.openOrder = String(++maskOrderSeq.n);
        }
      });
    });
    ["modal-mask", "bio-mask", "lore-mask", "chronicle-mask", "town-map-mask", "achievement-mask"]
      .forEach((id) => {
        const el = document.getElementById(id);
        if (el) maskOrderWatcher.observe(el, { attributes: true, attributeFilter: ["class"] });
      });
  }
  // 全局快捷键：ESC 关闭"最后打开"的遮罩弹窗（按打开顺序倒序取第一个 .show 的 mask）
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const maskClosers = [
      { id: "achievement-mask", close: () => Achievement.close() },
      { id: "modal-mask", close: () => Modal.close() },
      { id: "bio-mask", close: () => BioArchive.close() },
      { id: "lore-mask", close: () => LorePanel.close() },
      { id: "chronicle-mask", close: () => ChroniclePanel.close() },
      { id: "town-map-mask", close: () => TownMap.close() },
    ];
    const visible = maskClosers
      .map((m) => {
        const el = document.getElementById(m.id);
        if (!el || !el.classList.contains("show")) return null;
        const order = parseInt(el.dataset.openOrder || "0", 10) || 0;
        return { ...m, order };
      })
      .filter(Boolean)
      .sort((a, b) => b.order - a.order);
    if (visible.length) visible[0].close();
  });
  // 接入底层拖拽交互（Pointer Events 统一方案，鼠标 / 触屏通用）
  GameFlow.setupDrag();
})();
