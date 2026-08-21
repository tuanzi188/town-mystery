"use strict";
const DialogSystem = {
  /** 逐句揭幕定时器：close 或 _finishReveal 时清理，避免内存泄漏 */
  _revealTimer: null,
  _skipRequested: false,
  /** 取某居民追问分支：resident 自带 followups 优先；其次查 TOWN_FOLLOWUPS（外部数据用 typeof 防御）。
   *  无任何分支（如替罪羊）返回 null，走"一键全给"兼容逻辑。 */
  _followupsOf(resident) {
    if (!resident) return null;
    if (Array.isArray(resident.followups) && resident.followups.length) return resident.followups;
    if (typeof TOWN_FOLLOWUPS !== "undefined" && TOWN_FOLLOWUPS) {
      const list = TOWN_FOLLOWUPS["L" + App.currentLevel + "_" + resident.id];
      if (Array.isArray(list) && list.length) return list;
    }
    return null;
  },
  /** 问题键：居民id#问题序号（跨关唯一，用于记录已追问） */
  _askKey(rid, idx) {
    return rid + "#" + idx;
  },
  /** 话题文案：剥离「追问王婶：」「问老张：」这类前缀，只留问题正文
   *  按钮旁已有「追问」标签与弹窗头部姓名，避免「追问 追问王婶：…」叠词 */
  _topicOf(q) {
    if (!q) return "";
    return String(q).replace(/^(追问|问)\s*[^：:]*[：:]\s*/, "");
  },
  /** 读取某关已追问键数组 */
  _readAsked() {
    return StorageUtil.readAskedFollowups(App.currentLevel);
  },
  /** 走访次数独立存储键（去重走访档案无法表达次数，必须单独计数；不受 _restartLevel 清布局影响） */
  _visitKey() { return "visits_L" + App.currentLevel; },
  /** 读取走访计数器映射 {居民id: 次数}（脏值兜底为 {}） */
  _readVisits() {
    const raw = StorageUtil.read(this._visitKey(), null);
    if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
    return {};
  },
  /** 每次打开走访弹窗前，给该居民次数 +1 */
  _bumpVisit(resident) {
    const map = this._readVisits();
    map[resident.id] = (map[resident.id] || 0) + 1;
    StorageUtil.write(this._visitKey(), map);
  },
  /** 走访次数（本次打开后的真实 1-based 计数，用于决定开场白与标签） */
  _getVisitCount(resident) {
    return this._readVisits()[resident.id] || 1;
  },
  /** 走访次数小标签文字 */
  _visitTagText(count) {
    if (count <= 1) return "首次走访";
    if (count === 2) return "再次造访";
    if (count === 3) return "第三次走访";
    return "熟客 · 第" + count + "次";
  },
  /** 场景化开场白（首次不渲染开场块） */
  _openingFor(resident, count) {
    const name = (resident && resident.name) || "对方";
    if (count <= 1) return "";
    if (count === 2) return "你又来到 " + name + " 家。TA 抬头看了你一眼，像是认出了你——但没先开口。";
    if (count === 3) return "你第三次推门进来。" + name + " 似乎已经习惯了你这位访客，朝你点点头，目光闪了一下。";
    return "你再次上门。" + name + " 见到你，表情复杂，沉默片刻才开了腔。";
  },
  /** 切分句子：按句末标点 。！？!?…；; 拆分，保留原标点，过滤空白 */
  _splitSentences(text) {
    if (!text) return [];
    // 不依赖 ES2018 行后断言（?<=），兼容微信内置浏览器等旧版 WebView
    return String(text)
      .replace(/([。！？!?…；;])/g, "$1\u0001")
      .split("\u0001")
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  },
  /** 渲染内嵌线索 chip：贴在对白末尾，hover 显示完整线索文本 */
  _renderEmbeddedClueChips(cids) {
    if (!cids || !cids.length) return "";
    const esc = ClueCards.escapeHtml;
    const chips = cids.map(function (cid) {
      const c = App.clueMap[cid];
      if (!c) return "";
      let label, extra = "";
      if (c.type === "fake") { label = "🤥 " + esc(c.text); extra = " fake"; }
      else if (c.isEvidence) { label = "🔑 " + esc(c.text); extra = " evidence"; }
      else { label = "💡 " + esc(c.text); }
      return '<span class="dl-clue-chip' + extra + '" title="' + esc(c.text) + '">' + label + '</span>';
    }).join("");
    return chips ? '<div class="dl-clue-row">' + chips + '</div>' : "";
  },
  /** 渲染已问对白（dl-dialog 整段），不显示未问的 */
  _renderFollowupDialog(resident, followups, asked) {
    if (!followups) return "";
    const esc = ClueCards.escapeHtml;
    const items = [];
    for (let i = 0; i < followups.length; i++) {
      if (!asked.has(this._askKey(resident.id, i))) continue;
      const fu = followups[i];
      if (!fu) continue;
      const topic = this._topicOf(fu.q) || "继续追问";
      const a = fu.a || "";
      items.push(
        '<p class="dl-q">' + esc(topic) + '</p>' +
        '<div class="dl-a">' + esc(a) + this._renderEmbeddedClueChips(fu.cids) + '</div>'
      );
    }
    return items.length ? '<div class="dl-dialog">' + items.join("") + '</div>' : "";
  },
  /** 渲染「继续询问」入口：展开所有未问过的追问让玩家选择；
   *  顶部显示"已问 X / Y"进度；全部问完则渲染结束行。 */
  _renderNextFollowupPrompt(resident, followups, asked) {
    if (!followups) return "";
    const esc = ClueCards.escapeHtml;
    const total = followups.length;
    let askedCount = 0;
    for (let i = 0; i < followups.length; i++) {
      if (asked.has(this._askKey(resident.id, i))) askedCount++;
    }
    if (askedCount >= total) {
      const name = (resident && resident.name) || "TA";
      return '<p class="dl-done">' + esc(name) + " 似乎没再多说（" + total + " / " + total + "）</p>";
    }
    // 构建未问列表 + 进度条
    const pendingIdx = [];
    for (let i = 0; i < followups.length; i++) {
      if (!asked.has(this._askKey(resident.id, i))) pendingIdx.push(i);
    }
    const progressPill = '<span class="dl-fu-progress">' + askedCount + " / " + total + "</span>";
    const listHtml = pendingIdx.map((idx) => {
      const fu = followups[idx];
      const topic = this._topicOf(fu.q) || "继续追问";
      return '<button type="button" class="dl-next-fu" data-fu="' + idx + '">' +
        '<span class="fu-tag">追问</span>' + esc(topic) + "</button>";
    }).join("");
    return '<div class="dl-fu-block">' +
      '<div class="dl-fu-head">继续询问 ' + progressPill + "</div>" +
      '<div class="dl-fu-list">' + listHtml + "</div>" +
      "</div>";
  },
  /** 口供全显后挂的"对话 / 引导 / 继续询问 / 隐藏心事"区 */
  _renderAfterStatement(resident, followups, asked) {
    const esc = ClueCards.escapeHtml;
    const secretHtml = this._renderSecretHtml(resident);
    if (followups) {
      const dialogHtml = this._renderFollowupDialog(resident, followups, asked);
      const promptHtml = this._renderNextFollowupPrompt(resident, followups, asked);
      return dialogHtml +
        '<p class="dl-prompt">你看着 ' + esc(resident.name || "TA") + '，试探着往下问……</p>' +
        promptHtml + secretHtml;
    }
    // 无追问分支的居民（如替罪羊）：保留原"一键线索" + 提示行
    const walkHtml = this._renderWalkCluesHtml(resident);
    // 替罪羊明确提示：仅一条自辩线索（与左侧列表"次要人物 · 自辩线索"口径一致）
    const isScapegoat = this._isScapegoat(resident);
    const scapegoatTip = isScapegoat
      ? '<p class="bio-lock-sub walk-tip-scapegoat">这位是次要人物，只留下一条自辩线索；你可以在「档案」里查看 TA 的生平。</p>'
      : "";
    return walkHtml + scapegoatTip +
      '<p class="bio-lock-sub walk-tip">以上线索已加入下方线索池：浅米色为有效线索，可拖入下方时间轴排序；灰色「干扰」线索请留在池中。</p>' +
      secretHtml;
  },
  /** 替罪羊判定：优先用 isScapegoat 显式字段，否则回退到 bindClue 是否为空 */
  _isScapegoat(resident) {
    if (!resident) return false;
    if (resident.isScapegoat === true) return true;
    if (resident.isScapegoat === false) return false;
    const b = resident.bindClue;
    if (!b) return true;
    if (Array.isArray(b)) return b.length === 0;
    if (typeof b === "string") return !b;
    return false;
  },
  /** 已通关本关才显示 secret（避免剧透） */
  _renderSecretHtml(resident) {
    if (!BioArchive.isLevelCleared() || !resident.secret) return "";
    const esc = ClueCards.escapeHtml;
    return '<div class="bio-secret-box"><p class="bio-sec-title">· 隐藏心事</p>' +
      '<p class="bio-text bio-secret">' + esc(resident.secret) + '</p></div>';
  },
  /** 线索条目标签：按类型标注（干扰/物证/目击/自白/口供）——仅无追问分支时使用 */
  _walkClueItemHtml(c) {
    const esc = ClueCards.escapeHtml;
    let tag, extraCls = "";
    if (c.type === "fake") { tag = "干扰"; extraCls = " fake"; }
    else if (c.isEvidence) tag = "物证";
    else if (c.isWitness) tag = "目击";
    else if (c.isSuspectStatement) tag = "自白";
    else tag = "口供";
    return '<div class="walk-clue-item"><span class="walk-clue-tag' + extraCls + '">' + tag +
      '</span><span class="walk-clue-text">' + esc(c.text) + "</span></div>";
  },
  /** 启动口供逐字揭幕：每个字 50ms 出现，句末标点处停顿 500ms；
   *  点"跳过"则一次性补齐并露出追问区；元素缺失时降级为一次性渲染 */
  _startStatementReveal(box, sentences, followups, asked, resident) {
    const esc = ClueCards.escapeHtml;
    const stmt = box.querySelector("#dl-statement");
    const after = box.querySelector("#dl-after-statement");
    const progress = box.querySelector("#dl-progress");
    const progressLabel = box.querySelector(".dl-progress-label");
    const progressFill = box.querySelector("#dl-progress-fill");
    // 拼接完整口供：句子之间无空格（按句末标点切分时已经保留了标点）
    const fullText = sentences.join("");
    const total = fullText.length;
    // 预扫描：找出所有"句末标点"位置（这些字之后停顿 500ms 再继续）
    const pausePoints = new Set();
    for (let i = 0; i < total; i++) {
      if (/[。！？!?…；;]/.test(fullText[i])) pausePoints.add(i);
    }
    // 进度更新：done = 已显示字符数
    const updateProgress = (done) => {
      if (!progress || !progressLabel) return;
      const ratio = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 100;
      if (progressFill) progressFill.style.width = ratio + "%";
      if (done < total) {
        progressLabel.innerHTML = "TA 正在说话 · <b>" + done + "</b> / " + total + " 字";
        progress.setAttribute("data-state", "reveal");
      } else {
        progressLabel.innerHTML = "✅ 全部说完（共 " + total + " 字）";
        progress.setAttribute("data-state", "done");
      }
    };
    if (!stmt || !after) {
      updateProgress(total);
      this._finishReveal(box, followups, asked, resident);
      return;
    }
    this._clearRevealTimer();
    this._skipRequested = false;
    if (!fullText) {
      stmt.innerHTML = '<span class="dl-line">（TA 沉默着，没接话。）</span>';
      updateProgress(0);
      this._finishReveal(box, followups, asked, resident);
      return;
    }
    // 写入光标 span 容器（打字机模式），初始为空
    stmt.innerHTML = '<span class="dl-line"></span><span class="dl-cursor" aria-hidden="true">▍</span>';
    updateProgress(0);
    const skipBtn = box.querySelector("#dl-skip");
    if (skipBtn) skipBtn.hidden = false;
    let charIdx = 0;
    const self = this;
    const tick = function () {
      if (self._skipRequested) {
        // skip：一次性显示全部 + 移除光标
        const lineEl = stmt.querySelector(".dl-line");
        if (lineEl) lineEl.textContent = fullText;
        const cursor = stmt.querySelector(".dl-cursor");
        if (cursor) cursor.remove();
        updateProgress(total);
        self._finishReveal(box, followups, asked, resident);
        return;
      }
      if (charIdx >= total) {
        const cursor = stmt.querySelector(".dl-cursor");
        if (cursor) cursor.remove();
        self._finishReveal(box, followups, asked, resident);
        return;
      }
      // 追加一个字符
      const lineEl = stmt.querySelector(".dl-line");
      if (lineEl) lineEl.appendChild(document.createTextNode(fullText[charIdx]));
      charIdx++;
      updateProgress(charIdx);
      // 计算下一个延迟：句末标点后停 500ms，普通字符 50ms
      const justTypedIsPunctuation = pausePoints.has(charIdx - 1);
      const nextDelay = justTypedIsPunctuation ? 500 : 50;
      self._revealTimer = setTimeout(tick, nextDelay);
    };
    self._revealTimer = setTimeout(tick, 50);
  },
  /** 立即完成揭幕：补齐剩余句子 + 露出追问区 + 绑定事件 */
  _finishReveal(box, followups, asked, resident) {
    this._clearRevealTimer();
    const after = box.querySelector("#dl-after-statement");
    if (after && after.hidden) {
      after.hidden = false;
      after.innerHTML = this._renderAfterStatement(resident, followups, asked);
      this._bindAfterEvents(after, resident, followups);
    }
    const skipBtn = box.querySelector("#dl-skip");
    if (skipBtn) skipBtn.hidden = true;
    // 口供揭完后：标记进度为完成（"✅ 全部听完"），不再隐藏（玩家能看到"听完了"的视觉确认）
    const progress = box.querySelector("#dl-progress");
    if (progress) progress.setAttribute("data-state", "done");
  },
  /** 绑定 after-statement 区域的事件（继续询问） */
  _bindAfterEvents(after, resident, followups) {
    const self = this;
    after.querySelectorAll(".dl-next-fu").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const idx = Number(btn.dataset.fu);
        if (Number.isNaN(idx)) return;
        self._askFollowup(resident, followups, idx);
      });
    });
  },
  /** 清理逐句揭幕定时器 */
  _clearRevealTimer() {
    if (this._revealTimer) { clearTimeout(this._revealTimer); this._revealTimer = null; }
  },
  /** 打开走访弹窗：开场白 + 口供逐句 + 引导 + 继续询问 */
  open(resident) {
    if (!resident) return;
    const esc = ClueCards.escapeHtml;
    const box = document.getElementById("bio-box");
    const mask = document.getElementById("bio-mask");
    if (!box || !mask) return;
    const followups = this._followupsOf(resident);
    const asked = new Set(this._readAsked());
    this._bumpVisit(resident);
    const visitCount = this._getVisitCount(resident);
    const visitTag = this._visitTagText(visitCount);
    const talkText = resident.talk || resident.bio || (resident.name || "TA") + " 不愿多说，像是在隐瞒什么。";
    const sentences = this._splitSentences(talkText);
    const opening = this._openingFor(resident, visitCount);
    const openingHtml = opening ? '<p class="dl-opening">' + esc(opening) + '</p>' : "";
    // 首次进入引导：仅当本次是该居民首次走访时显示（避免老玩家反复被骚扰）
    const isFirstVisit = visitCount <= 1;
    const introTip = isFirstVisit
      ? '<p class="dl-intro-tip">💡 <b>TA 正在回忆</b>，听完口供后可点下方「追问」让 TA 说更多 — 追问能解锁新线索（💡/🔑/🤥 标识）</p>'
      : "";
    box.innerHTML =
      '<div class="bio-head">' +
        '<span class="bio-avatar">' + AvatarFactory.buildWithPortrait(resident, { size: 80 }) + "</span>" +
        '<div class="bio-id">' +
          '<h3 class="bio-name">' + esc(resident.name || "无名居民") +
            '<span class="bio-visit-tag">' + visitTag + '</span></h3>' +
          '<span class="bio-tag">' + esc(resident.tagShort || "身份未知") + "</span>" +
        "</div>" +
        '<button type="button" class="bio-close" aria-label="关闭" id="bio-close">×</button>' +
      "</div>" +
      '<div class="bio-body">' +
        openingHtml +
        introTip +
        '<p class="bio-sec-title">· 口供</p>' +
        '<div class="dl-statement" id="dl-statement" data-total="' + sentences.length + '"></div>' +
        '<div class="dl-progress" id="dl-progress" data-state="reveal">' +
          '<span class="dl-progress-label">TA 正在回忆…</span>' +
          '<div class="dl-progress-bar"><div class="dl-progress-fill" id="dl-progress-fill" style="width:0%"></div></div>' +
        '</div>' +
        '<button type="button" class="walk-skip" id="dl-skip" hidden>跳过揭幕</button>' +
        '<div class="dl-after-statement" id="dl-after-statement" hidden></div>' +
      "</div>";
    const self = this;
    const closeBtn = box.querySelector("#bio-close");
    if (closeBtn) closeBtn.addEventListener("click", function () { self.close(); });
    const skipBtn = box.querySelector("#dl-skip");
    if (skipBtn) skipBtn.addEventListener("click", function () { self._skipRequested = true; });
    mask.classList.add("show");
    this._markSpoken(resident);
    // 一打开居民就解锁 bindClue（无论有无追问分支）—— bindClue 是"打开就拿"的，
    // 之前只对替罪羊（旧逻辑"!followups"）调用，导致正常居民 bindClue 永远进不了 pool
    this._unlockBoundClue(resident);
    this._startStatementReveal(box, sentences, followups, asked, resident);
  },
  /** 回答某条追问：解锁对应线索 + 记录已追问 + 局部刷新 after-statement */
  _askFollowup(resident, followups, idx) {
    const fu = followups[idx];
    if (!fu || !Array.isArray(fu.cids)) return;
    this._unlockBoundClue(resident, fu.cids);
    const asked = this._readAsked();
    const key = this._askKey(resident.id, idx);
    if (asked.indexOf(key) === -1) {
      asked.push(key);
      StorageUtil.writeAskedFollowups(App.currentLevel, asked);
    }
    const box = document.getElementById("bio-box");
    if (box) {
      const after = box.querySelector("#dl-after-statement");
      if (after) {
        after.innerHTML = this._renderAfterStatement(resident, followups, new Set(asked));
        this._bindAfterEvents(after, resident, followups);
      }
    }
  },
  /** 渲染一键线索区：无追问分支的居民一次解锁全部绑定线索（原逻辑）
   *  替罪羊除外：其自辩线索已在口供对白中呈现，不重复展示列表（避免"· 走访所得线索"空标题） */
  _renderWalkCluesHtml(resident) {
    if (this._isScapegoat(resident)) return "";
    const walkCids = Array.isArray(resident.bindClue)
      ? resident.bindClue
      : (resident.bindClue ? [resident.bindClue] : []);
    const items = walkCids.map((cid) => {
      const c = App.clueMap[cid];
      return c ? this._walkClueItemHtml(c) : "";
    }).join("");
    return items
      ? '<p class="bio-sec-title">· 走访所得线索</p><div class="walk-clue-list">' + items + "</div>"
      : "";
  },
  /** 标记该居民已交谈并写档 */
  _markSpoken(resident) {
    const talked = StorageUtil.readDialogRecord(App.currentLevel);
    if (talked.indexOf(resident.id) === -1) {
      talked.push(resident.id);
      StorageUtil.writeDialogRecord(App.currentLevel, talked);
      // 走访人次变化，刷新底部进度条（无绑定线索的居民不会触发 renderLevel，需在此兜底）
      if (GameFlow && GameFlow.renderProgress) GameFlow.renderProgress();
    }
  },
  /** 解锁指定线索集合（未给集合时默认全 bindClue）：加入线索池并重渲染。
   *  防重：线索若已在池子中，视为已解锁，不再加回池子。
   *  附带效果：
   *  - 本次新解锁的每条线索都会在右上角弹「📁 入卷」气泡（物证/自白/目击/普通/干扰 各有视觉）
   *  - 线索池中对应的卡片会触发 fly-in 入卷动画（由 renderLevel 的 newCids 触发） */
  _unlockBoundClue(resident, cids) {
    const list = Array.isArray(cids) ? cids
      : (Array.isArray(resident.bindClue) ? resident.bindClue : (resident.bindClue ? [resident.bindClue] : []));
    if (!list.length) return;
    let changed = false;
    const newCids = []; // 本轮新加入的线索 id，用于 fly-in 动画
    list.forEach((cid) => {
      if (!cid || !App.clueMap[cid]) return;
      if (App.layout.pool.indexOf(cid) === -1) {
        App.layout.pool.push(cid);
        changed = true;
        newCids.push(cid);
      }
    });
    if (changed) {
      StorageUtil.writeLevelState(App.currentLevel, App.layout);
      // 把 newCids 透传给 renderLevel，让新卡片在池子里"飞入"
      GameFlow.renderLevel(GameFlow.getLevelConfig(), { newCids: newCids });
    }
    // 逐条弹「入卷」气泡：物证优先、其他线索次之、干扰最后
    newCids.forEach((cid) => this._showClueIngestToast(cid));
  },
  /** 「入卷」气泡：根据线索类型选样式（evidence / statement / witness / 普通 / fake），
   *  在右上角浮出 ~1.6s 后淡出。多个气泡垂直错开，最多同时 4 个。 */
  _showClueIngestToast(cid) {
    const c = App.clueMap[cid];
    if (!c) return;
    const cls = ClueCards.classify(c);
    const isFake = c.type === "fake";
    const host = document.body;
    if (!host) return;
    const toast = document.createElement("div");
    let typeCls = cls.typeCls || (isFake ? "fake" : "");
    toast.className = "clue-toast " + typeCls;
    // 同一时刻最多 4 个气泡，第 5 个起复用第 1 个的位置（旋转队列）
    const existing = host.querySelectorAll(".clue-toast:not(.removing)").length;
    const stack = existing % 4;
    // 兼容测试环境（无 setAttribute 的 plain object）
    if (typeof toast.setAttribute === "function") {
      toast.setAttribute("data-stack", String(stack));
    } else {
      toast.dataset = toast.dataset || {};
      toast.dataset.stack = String(stack);
    }
    const title = isFake
      ? "📁 已记录 干扰线索"
      : "📁 新线索入卷";
    toast.innerHTML =
      '<div class="clue-toast-title">' + title +
      (isFake || !cls.badgeText ? "" : " · " + cls.badgeText) + '</div>' +
      '<div class="clue-toast-text">' + ClueCards.escapeHtml(c.text) + '</div>';
    host.appendChild(toast);
    // 双 rAF 确保 transition 触发
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { toast.classList.add("show"); });
    });
    clearTimeout(this._clueToastTimers && this._clueToastTimers[cid]);
    this._clueToastTimers = this._clueToastTimers || {};
    this._clueToastTimers[cid] = setTimeout(function () {
      toast.classList.add("removing");
      toast.classList.remove("show");
      setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 320);
    }, 1600);
  },
  /** 关键物证解锁轻提示（保留兼容：仍由其他模块触发此轻量 toast） */
  _showEvidenceToast(evidenceTags) {
    const toast = document.getElementById("toast-tip");
    if (!toast) return;
    const text = evidenceTags.length === 1
      ? "🔑 解锁了一条关键物证：" + evidenceTags[0]
      : "🔑 解锁了 " + evidenceTags.length + " 条关键物证";
    toast.textContent = text;
    toast.classList.add("show");
    clearTimeout(this._evidenceToastTimer);
    this._evidenceToastTimer = setTimeout(() => {
      toast.classList.remove("show");
    }, 2400);
  },
  /** 关闭走访弹窗：清理揭幕定时器，避免内存泄漏与状态错乱 */
  close() {
    this._clearRevealTimer();
    this._skipRequested = false;
    const mask = document.getElementById("bio-mask");
    if (mask) mask.classList.remove("show");
  },
};

/* ============================================================
   模块二：通用弹窗组件（提示 / 确认）
   ============================================================ */
