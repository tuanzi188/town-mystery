"use strict";
const Modal = {
  mask: null,
  titleEl: null,
  textEl: null,
  extraEl: null,
  btnsEl: null,
  _init() {
    this.mask = document.getElementById("modal-mask");
    this.titleEl = document.getElementById("modal-title");
    this.textEl = document.getElementById("modal-text");
    this.extraEl = document.getElementById("modal-extra");
    this.btnsEl = document.getElementById("modal-btns");
  },
  /** 关闭弹窗 */
  close() {
    if (this.mask) this.mask.classList.remove("show");
    // 触发 onClose 钩子（仅一次），让弹窗方知道弹窗被关闭（ESC / 遮罩 / 按钮都覆盖到）
    if (typeof this._onClose === "function") {
      const cb = this._onClose;
      this._onClose = null;
      try { cb(); } catch (e) { /* 静默 */ }
    }
  },
  /** 提示弹窗：仅一个「知道了」按钮 */
  alert(title, text, onOk, onClose) {
    this._render(title, text, "", [
      { label: "知道了", primary: true, onClick: () => { this.close(); if (onOk) onOk(); } },
    ], onClose);
  },
  /** 提示弹窗（带番外分段）：extraHtml 为可选的柔和绿色番外内容 */
  alertWithExtra(title, text, extraHtml, onOk, onClose) {
    this._render(title, text, extraHtml, [
      { label: "知道了", primary: true, onClick: () => { this.close(); if (onOk) onOk(); } },
    ], onClose);
  },
  /** 提示弹窗（带可点击额外按钮）：extraHtml 内按钮通过 onExtra 绑定回调 */
  alertExtra(title, text, extraHtml, onExtra, onOk, onClose) {
    this._render(title, text, extraHtml, [
      { label: "知道了", primary: true, onClick: () => { this.close(); if (onOk) onOk(); } },
    ], onClose);
    if (this.extraEl && onExtra) {
      const extraBtn = this.extraEl.querySelector("[data-extra-click]");
      if (extraBtn) extraBtn.addEventListener("click", onExtra);
    }
  },
  /** 就地替换当前弹窗内容（标题/正文/番外区），不重新打开，保留 onClose 与按钮。
   *  用于"提示第二步"等场景，避免新开弹窗覆盖导致原 onClose 丢失。 */
  replaceContent(title, text, extraHtml) {
    this._init();
    this.titleEl.textContent = title;
    this.textEl.textContent = text;
    if (this.extraEl) {
      if (extraHtml) {
        this.extraEl.innerHTML = extraHtml;
        this.extraEl.style.display = "block";
      } else {
        this.extraEl.innerHTML = "";
        this.extraEl.style.display = "none";
      }
    }
  },
  /** 确认弹窗：两个按钮，回调 onOk / onCancel */
  confirm(title, text, onOk, onCancel, onClose) {
    this._render(title, text, "", [
      { label: "取消", primary: false, onClick: () => { this.close(); if (onCancel) onCancel(); } },
      { label: "确定", primary: true, onClick: () => { this.close(); if (onOk) onOk(); } },
    ], onClose);
  },
  /** 通用弹窗：自定义按钮数组（结构 { label, primary, onClick }） */
  show(title, text, btns, onClose) {
    this._render(title, text, "", btns, onClose);
  },
  /** 渲染弹窗内容并显示；extraHtml 为空时隐藏番外分段 */
  _render(title, text, extraHtml, btns, onClose) {
    this._init();
    this.titleEl.textContent = title;
    this.textEl.textContent = text;
    if (this.extraEl) {
      if (extraHtml) {
        this.extraEl.innerHTML = extraHtml;
        this.extraEl.style.display = "block";
      } else {
        this.extraEl.innerHTML = "";
        this.extraEl.style.display = "none";
      }
    }
    this.btnsEl.innerHTML = "";
    btns.forEach((b) => {
      const btn = document.createElement("button");
      btn.className = "modal-btn" + (b.primary ? " primary" : "");
      btn.textContent = b.label;
      btn.addEventListener("click", b.onClick);
      this.btnsEl.appendChild(btn);
    });
    // 注册 onClose 钩子：close() 触发时调用（兼容 ESC / 遮罩点击 / 按钮调 close 三种路径）
    this._onClose = (typeof onClose === "function") ? onClose : null;
    this.mask.classList.add("show");
  },
};

/* ============================================================
   模块三：线索卡片渲染（4 种外观分层：口供 / 目击 / 自白 / 物证）
   ============================================================ */
const AvatarFactory = {
  /* -------- 配置层：调色板 / 主题 / 基底色 / 脸型 / 表情 / 配件 / 微特征 -------- */

  /** 肤色 6 档（base/light/shadow 三阶，供 skinIdx 索引） */
  SKIN_PALETTE: [
    { base: "#fde0c4", light: "#ffe8d4", shadow: "#e8c4a4" }, // 0 瓷白
    { base: "#f4d4b0", light: "#fbe0c4", shadow: "#d8b48e" }, // 1 暖白
    { base: "#e8b58a", light: "#f0c89e", shadow: "#cc9a6e" }, // 2 自然
    { base: "#d4a078", light: "#deb28c", shadow: "#b88458" }, // 3 蜜色
    { base: "#c08862", light: "#cc9a72", shadow: "#a06c48" }, // 4 健康
    { base: "#eac098", light: "#f0cea8", shadow: "#cca078" }, // 5 老人
  ],
  /** 发色 8 档（base/highlight/shadow，供 hairIdx 索引） */
  HAIR_PALETTE: [
    { base: "#1a1a1a", highlight: "#3a3a3a", shadow: "#000000" }, // 0 纯黑
    { base: "#2a1d12", highlight: "#4a2e1a", shadow: "#180e08" }, // 1 深棕
    { base: "#4a2e1a", highlight: "#6a4423", shadow: "#2e1a0a" }, // 2 棕
    { base: "#6a4423", highlight: "#8b6b3a", shadow: "#4a2a12" }, // 3 浅棕
    { base: "#8b6b3a", highlight: "#a8824a", shadow: "#5a3e1e" }, // 4 金棕
    { base: "#c8a47a", highlight: "#dcc094", shadow: "#9a7a4a" }, // 5 浅金
    { base: "#e0d0b0", highlight: "#f0e0c0", shadow: "#a89870" }, // 6 银白
    { base: "#5a5040", highlight: "#7a6a50", shadow: "#3a3020" }, // 7 花白
  ],

  /** 固定基底肤色/发色：未显式配置时的默认值（确定性，非随机） */
  BASE_SKIN: "#f4d4b0",
  BASE_HAIR: "#4a2e1a",

  /** 主题色体系：配饰/微特征统一取色，整体换色只改这一处 */
  THEMES: {
    retro: { accent: "#c8364b", accentDark: "#8a2030", ink: "#222222", wood: "#7a5a32", metal: "#8a8a8a", light: "#f3e7c1", sunburn: "#e07a5a", freckle: "#a06030", callus: "#b89878", tear: "#7a9ec4", wrinkle: "#a08060" },
  },

  /** 三种脸型：下颌/鼻型绘制函数（拓展脸型只需新增一项） */
  FACE_TYPES: {
    male: {
      jaw(shade) { return '<rect x="34" y="56" width="32" height="6" fill="' + shade + '" opacity="0.25"/>'; },
      nose(shade) { return '<path d="M 48.5 45 L 51.5 45 L 51 50 Q 50 51 49 50 Z" fill="' + shade + '" opacity="0.35"/>'; },
    },
    female: {
      jaw(shade) { return '<ellipse cx="50" cy="58" rx="14" ry="3" fill="' + shade + '" opacity="0.2"/>'; },
      nose(shade) { return '<path d="M 48.8 46 L 51.2 46 L 50.6 49.5 Q 50 50.2 49.4 49.6 Z" fill="' + shade + '" opacity="0.3"/>'; },
    },
    elderly: {
      jaw(shade) { return '<path d="M 36 60 Q 50 64 64 60" stroke="' + shade + '" stroke-width="0.8" fill="none" opacity="0.5"/>'; },
      nose(shade) { return '<path d="M 48.5 45 L 51.5 45 L 51 51 Q 50 52 49 51 Z" fill="' + shade + '" opacity="0.4"/>'; },
    },
  },

  /** 5 套表情：眼 + 嘴 + 眉（每个返回 SVG 片段） */
  EXPRESSIONS: {
    smile: {
      eyes: '<path d="M 39 41 Q 43 39 47 41" stroke="#222" stroke-width="1.4" fill="none" stroke-linecap="round"/>' +
            '<path d="M 53 41 Q 57 39 61 41" stroke="#222" stroke-width="1.4" fill="none" stroke-linecap="round"/>',
      mouth: '<path d="M 44 50 Q 50 55 56 50" stroke="#5a3a3a" stroke-width="1.4" fill="none" stroke-linecap="round"/>',
      brow: 'M 38 33 Q 43 31 48 33 M 52 33 Q 57 31 62 33',
    },
    calm: {
      eyes: '<path d="M 40 41 L 46 41" stroke="#222" stroke-width="1.4" fill="none" stroke-linecap="round"/>' +
            '<path d="M 54 41 L 60 41" stroke="#222" stroke-width="1.4" fill="none" stroke-linecap="round"/>',
      mouth: '<path d="M 45 50 L 55 50" stroke="#5a3a3a" stroke-width="1.4" fill="none" stroke-linecap="round"/>',
      brow: 'M 38 33 L 48 33 M 52 33 L 62 33',
    },
    curious: {
      eyes: '<circle cx="43" cy="41" r="2" fill="#222"/>' +
            '<circle cx="57" cy="41" r="2" fill="#222"/>' +
            '<circle cx="43.5" cy="40.4" r="0.6" fill="#fff"/>' +
            '<circle cx="57.5" cy="40.4" r="0.6" fill="#fff"/>',
      mouth: '<path d="M 45 51 Q 50 53 55 51" stroke="#5a3a3a" stroke-width="1.4" fill="none" stroke-linecap="round"/>',
      brow: 'M 38 32 Q 43 30 48 32 M 52 32 Q 57 30 62 32',
    },
    shy: {
      eyes: '<path d="M 39 41 Q 43 43 47 41" stroke="#222" stroke-width="1.4" fill="none" stroke-linecap="round"/>' +
            '<path d="M 53 41 Q 57 43 61 41" stroke="#222" stroke-width="1.4" fill="none" stroke-linecap="round"/>',
      mouth: '<path d="M 46 51 Q 50 53 54 51" stroke="#5a3a3a" stroke-width="1.4" fill="none" stroke-linecap="round"/>',
      brow: 'M 38 34 L 48 33 M 52 33 L 62 34',
    },
    serious: {
      eyes: '<path d="M 40 41 L 46 41" stroke="#222" stroke-width="1.6" fill="none" stroke-linecap="round"/>' +
            '<path d="M 54 41 L 60 41" stroke="#222" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
      mouth: '<path d="M 44 51 L 56 51" stroke="#5a3a3a" stroke-width="1.4" fill="none" stroke-linecap="round"/>',
      brow: 'M 38 32 L 48 34 M 52 34 L 62 32',
    },
  },

  /** secret / tag 关键词 → 表情（命中首个即返回；缺省 calm） */
  EXPR_RULES: [
    { keys: ["羞", "脸", "偷看", "暗恋", "心"], expr: "shy" },
    { keys: ["焦", "虑", "担", "愁", "紧", "心"], expr: "curious" },
    { keys: ["怒", "气", "怨", "恨", "争", "吵"], expr: "serious" },
    { keys: ["笑", "乐", "高", "开", "喜", "甜"], expr: "smile" },
    { keys: ["思", "念", "回", "怀", "想"], expr: "calm" },
  ],

  /** 身份专属 accessory：draw(theme, cloth) 统一取主题色；layer=body 绘制于衣服后脸前，其余为前景层；miniOk 供小头像保留 */
  ACCESSORY_POOL: [
    { id: "apron", layer: "body", miniOk: true, keys: ["摊主", "花艺", "花店", "主理", "店老板", "清洁"],
      draw: function (theme, cloth) { return '<path d="M 28 64 L 72 64 L 76 96 L 24 96 Z" fill="' + cloth + '"/><path d="M 38 64 L 50 78 L 62 64 Z" fill="#ffffff" opacity="0.3"/>'; } },
    { id: "broom", keys: ["清洁"],
      draw: function (theme) { return '<line x1="86" y1="68" x2="96" y2="40" stroke="' + theme.wood + '" stroke-width="2"/><path d="M 92 38 L 98 38 L 96 46 L 90 46 Z" fill="#5a3e1e"/>'; } },
    { id: "mop", keys: ["水电", "维修"],
      draw: function (theme) { return '<line x1="86" y1="70" x2="94" y2="44" stroke="' + theme.metal + '" stroke-width="2"/><circle cx="94" cy="42" r="3" fill="#666"/>'; } },
    { id: "cat", miniOk: false, keys: ["猫", "养猫"],
      draw: function (theme) { return '<path d="M 78 78 Q 86 76 88 84 L 92 90 L 86 92 L 82 86 Z" fill="#a07050"/><circle cx="86" cy="80" r="1" fill="' + theme.ink + '"/><path d="M 78 78 L 76 74 M 78 78 L 74 80" stroke="#a07050" stroke-width="1.2" fill="none"/>'; } },
    { id: "plant", miniOk: false, keys: ["养花"],
      draw: function (theme) { return '<circle cx="84" cy="88" r="5" fill="' + theme.wood + '"/><path d="M 84 84 Q 80 76 84 72 Q 88 76 84 84" fill="#5a7e44"/>'; } },
    { id: "cane", keys: ["太极", "晨练", "退休"],
      draw: function (theme) { return '<line x1="14" y1="60" x2="20" y2="98" stroke="' + theme.wood + '" stroke-width="2"/><path d="M 12 58 Q 14 54 18 56" stroke="' + theme.wood + '" stroke-width="2" fill="none"/>'; } },
    { id: "book", keys: ["学生", "大学", "高中", "初中", "小学", "备考"],
      draw: function (theme) { return '<rect x="22" y="80" width="14" height="18" fill="' + theme.accent + '" stroke="' + theme.accentDark + '" stroke-width="0.5"/><line x1="29" y1="80" x2="29" y2="98" stroke="' + theme.light + '" stroke-width="0.6"/>'; } },
    { id: "lanyard", keys: ["保安", "门卫", "驿站", "快递", "外卖"],
      draw: function (theme) { return '<path d="M 36 50 L 30 62 M 64 50 L 70 62" stroke="' + theme.ink + '" stroke-width="1.2" fill="none"/><rect x="44" y="60" width="12" height="8" fill="#ffffff" stroke="' + theme.ink + '" stroke-width="0.6"/>'; } },
    { id: "headphone", keys: ["程序", "文员", "会计"],
      draw: function (theme) { return '<path d="M 24 32 Q 50 16 76 32" stroke="' + theme.ink + '" stroke-width="2.5" fill="none"/><rect x="20" y="32" width="8" height="12" rx="3" fill="' + theme.ink + '"/><rect x="72" y="32" width="8" height="12" rx="3" fill="' + theme.ink + '"/>'; } },
  ],

  /** tag 关键词 → 微特征（叠加于脸，mini 尺寸不画）；apply(skin, theme) 统一取主题色 */
  MICRO_FEATURES: [
    { id: "sunburn",  keys: ["摊主", "外卖", "快递", "晨练", "太极", "跑外", "货运", "汽修", "水电"],
      apply: function (skin, theme) { return '<ellipse cx="50" cy="44" rx="14" ry="3" fill="' + theme.sunburn + '" opacity="0.35"/>'; } },
    { id: "wrinkle",  keys: ["退休", "奶奶", "老教师", "钳工", "木匠", "职工", "阿姨", "队长", "门卫"],
      apply: function (skin, theme) { return '<path d="M 30 44 Q 33 46 30 48 M 70 44 Q 67 46 70 48" stroke="' + theme.wrinkle + '" stroke-width="0.5" fill="none"/><path d="M 36 56 Q 50 58 64 56" stroke="' + theme.wrinkle + '" stroke-width="0.5" fill="none" opacity="0.6"/>'; } },
    { id: "freckle",  keys: ["小学生", "初中生", "高中生", "小学生", "备考生", "学生", "大学生"],
      apply: function (skin, theme) { return '<circle cx="38" cy="46" r="0.7" fill="' + theme.freckle + '"/><circle cx="42" cy="48" r="0.6" fill="' + theme.freckle + '"/><circle cx="58" cy="47" r="0.7" fill="' + theme.freckle + '"/><circle cx="62" cy="46" r="0.6" fill="' + theme.freckle + '"/>'; } },
    { id: "callus",   keys: ["木匠", "钳工", "维修", "汽修", "水电", "清洁"],
      apply: function (skin, theme) { return '<ellipse cx="20" cy="92" rx="5" ry="3" fill="' + theme.callus + '" opacity="0.6"/>'; } },
    { id: "tearline", keys: ["哭", "泪", "念", "回"],
      apply: function (skin, theme) { return '<path d="M 43 43 L 43 47" stroke="' + theme.tear + '" stroke-width="0.6" fill="none" opacity="0.7"/>'; } },
  ],

  /* -------- 工具与索引（Map + 联合正则，直击命中） -------- */

  /** 颜色 hex 白名单校验（进入 SVG 的颜色必经此门） */
  _hex(v, fb) { return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v) ? v : fb; },
  /** 文本转义（预留：未来若有文本进入 SVG 使用） */
  _esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); },
  /** 两色混合，t∈[0,1]：0 → c1，1 → c2 */
  _mix(c1, c2, t) {
    const p = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const [r1, g1, b1] = p(c1), [r2, g2, b2] = p(c2);
    const v = (a, b) => Math.round(a + (b - a) * t);
    const hx = (n) => ("0" + n.toString(16)).slice(-2);
    return "#" + hx(v(r1, r2)) + hx(v(g1, g2)) + hx(v(b1, b2));
  },
  /** 任意基础色 → 三阶（肤色：light 提白，shadow 压深棕）缓存 */
  _tripleCache: new Map(),
  _skinTriple(hex) {
    const k = "s" + hex;
    if (this._tripleCache.has(k)) return this._tripleCache.get(k);
    const t = { base: hex, light: this._mix(hex, "#ffffff", 0.28), shadow: this._mix(hex, "#5a4636", 0.25) };
    this._tripleCache.set(k, t);
    return t;
  },
  /** 任意基础色 → 三阶（发色：highlight 提亮，shadow 压黑）缓存 */
  _hairTriple(hex) {
    const k = "h" + hex;
    if (this._tripleCache.has(k)) return this._tripleCache.get(k);
    const t = { base: hex, highlight: this._mix(hex, "#e0d0b0", 0.35), shadow: this._mix(hex, "#000000", 0.3) };
    this._tripleCache.set(k, t);
    return t;
  },
  /** 编译关键字池 → Map + 联合正则（长词优先，避免子串误命中） */
  _compile(defs) {
    const map = new Map();
    const words = [];
    defs.forEach((it) => it.keys.forEach((k) => {
      if (!map.has(k)) { map.set(k, it); words.push(k); }
    }));
    words.sort((x, y) => y.length - x.length);
    const re = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
    return { map, re };
  },
  /** 返回文本中命中的配置列表（去重，按字符串出现顺序） */
  _matchAll(text, index) {
    const out = [];
    const seen = new Set();
    if (!text) return out;
    text.replace(index.re, (kw) => {
      const it = index.map.get(kw);
      if (it && !seen.has(it)) { seen.add(it); out.push(it); }
      return kw;
    });
    return out;
  },

  /* -------- 全局渐变 defs（v3：头像间复用，避免重复 DOM） -------- */

  _gradIds: new Map(),
  _gradSeq: 0,
  _defsRoot: null,
  _defsReady: false,
  /** 首次 build 时注入全局隐藏 svg（无 DOM 环境自动回退内联 defs） */
  _initDefs() {
    if (this._defsReady) return;
    this._defsReady = true;
    if (typeof document === "undefined") return;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("id", "__avatarDefs");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.style.position = "absolute";
    svg.style.pointerEvents = "none";
    document.body.appendChild(svg);
    this._defsRoot = svg;
  },
  /** 注册渐变到全局 defs，返回复用 id */
  _gradId(type, stops) {
    const key = type + "|" + stops.map((s) => s[1]).join("|");
    if (this._gradIds.has(key)) return this._gradIds.get(key);
    const id = "ag" + (this._gradSeq++);
    this._gradIds.set(key, id);
    const root = this._defsRoot;
    if (root) {
      const ns = "http://www.w3.org/2000/svg";
      const g = document.createElementNS(ns, type === "radial" ? "radialGradient" : "linearGradient");
      g.setAttribute("id", id);
      if (type === "radial") { g.setAttribute("cx", "50%"); g.setAttribute("cy", "40%"); g.setAttribute("r", "60%"); }
      else { g.setAttribute("x1", "0"); g.setAttribute("y1", "0"); g.setAttribute("x2", "0"); g.setAttribute("y2", "1"); }
      stops.forEach((s) => {
        const st = document.createElementNS(ns, "stop");
        st.setAttribute("offset", String(s[0]));
        st.setAttribute("stop-color", s[1]);
        g.appendChild(st);
      });
      root.appendChild(g);
    }
    return id;
  },
  /** 无 DOM 回退：生成内联 defs 片段 */
  _gradDefsInline(type, id, stops) {
    const attrs = type === "radial" ? ' cx="50%" cy="40%" r="60%"' : ' x1="0" y1="0" x2="0" y2="1"';
    const tag = type === "radial" ? "radialGradient" : "linearGradient";
    return "<" + tag + attrs + ' id="' + id + '">' +
      stops.map((s) => '<stop offset="' + s[0] + '" stop-color="' + s[1] + '"/>').join("") +
      "</" + tag + ">";
  },

  /* -------- 颜色解析（固定基底优先，randomize 仅兜底开关） -------- */

  /** 按 resident.id 末位数字取 idx（randomize 开关专用） */
  _idxFromId(id) {
    if (!id) return 0;
    const m = String(id).match(/(\d+)/);
    const n = m ? parseInt(m[1], 10) : 0;
    return n % 100;
  },
  /** 肤色：avatar.skin hex > skinIdx > 固定基底色；randomize 仅当显式开启 */
  _skinOf(r, a, opts) {
    if (a.skin) return this._skinTriple(this._hex(a.skin, this.BASE_SKIN));
    if (typeof a.skinIdx === "number") return this.SKIN_PALETTE[((a.skinIdx % 6) + 6) % 6];
    if (opts && opts.randomize) return this.SKIN_PALETTE[(this._idxFromId(r.id) + 1) % 6];
    return this._skinTriple(this.BASE_SKIN);
  },
  /** 发色：avatar.hair hex > hairIdx > 固定基底色；randomize 仅当显式开启 */
  _hairOf(r, a, opts) {
    if (a.hair) return this._hairTriple(this._hex(a.hair, this.BASE_HAIR));
    if (typeof a.hairIdx === "number") return this.HAIR_PALETTE[((a.hairIdx % 8) + 8) % 8];
    if (opts && opts.randomize) return this.HAIR_PALETTE[(this._idxFromId(r.id) + 3) % 8];
    return this._hairTriple(this.BASE_HAIR);
  },
  /** 脸型：tag 含 退休/奶奶/老教师/阿姨/钳工/木匠 → elderly；含 女生/姐/芳/琳/妹/妈 → female；其他 male */
  _faceType(r) {
    const t = (r && r.tagShort) || "";
    if (/退休|奶奶|老教师|钳工|木匠|阿姨|姨$|队长|职工/.test(t)) return "elderly";
    if (/女生|姐|芳|琳|妹|妈|嫂|主妇|老板娘|主理|护士|花店|花艺|养花|管理员|老师$|志愿者|大学生|高中生|初中生|小学生|备考生|学生|小彤|小蕊|小红|小敏|小柯|丁丁|阿琳|苏姐|林姐|阿芳/.test(t)) return "female";
    return "male";
  },
  /** 表情：先看 secret 命中，再看 tag，缺省 smile（小孩） / calm（成人） */
  _expression(r) {
    const sec = (r && r.secret) || "";
    const tag = (r && r.tagShort) || "";
    const secHits = this._matchAll(sec, this.EXPR_INDEX);
    if (secHits.length) return secHits[0].expr;
    const tagHits = this._matchAll(tag, this.EXPR_INDEX);
    if (tagHits.length) return tagHits[0].expr;
    return /学生|小学|备考生/.test(tag) ? "smile" : "calm";
  },
  /** 身份 accessory 列表（按 tag 一次正则命中，可多个） */
  _accessories(r) {
    return this._matchAll((r && r.tagShort) || "", this.ACC_INDEX);
  },
  /** 微特征列表（按 tag 一次正则命中） */
  _microFeatures(r) {
    return this._matchAll((r && r.tagShort) || "", this.MICRO_INDEX);
  },
  /** 详情等级：size<30 → mini（省微特征/配件），30-65 → mid（保留配件），>=65 → full（含微特征） */
  _detail(size) {
    if (!size || size >= 65) return "full";
    if (size >= 30) return "mid";
    return "mini";
  },
  /**
   * 自适应描边粗细（基于 viewBox 100）
   * 容器越小，SVG 描边需要越粗（保持视觉 1px 左右）
   * size=100 → scale 1.0；size=50 → scale 2.0；size=34 → scale 2.94
   */
  _stroke(size, base) {
    const px = size || 100;
    const scale = 100 / px;
    return Math.max(0.65, +(base * scale).toFixed(2));
  },

  /* -------- 旧字段映射层（向后兼容） -------- */

  /** 旧 avatar.hat 值 → accessory 对象（draw 统一收 theme） */
  _hatLegacy(hat) {
    if (!hat) return [];
    const map = {
      straw: { id: "straw", keys: [], draw: function (theme) {
        return '<ellipse cx="50" cy="28" rx="34" ry="5" fill="#c9a05a" stroke="#a07a3a" stroke-width="0.6"/>' +
               '<path d="M 34 28 Q 34 12 50 10 Q 66 12 66 28 Z" fill="#e2c285"/>';
      } },
      cap: { id: "cap", keys: [], draw: function (theme) {
        return '<path d="M 24 32 Q 30 16 50 14 Q 70 16 76 32 Z" fill="' + theme.ink + '"/>' +
               '<path d="M 22 32 Q 36 28 56 30 L 56 35 Q 36 34 22 36 Z" fill="' + theme.ink + '"/>' +
               '<circle cx="50" cy="22" r="2" fill="#cfaa55"/>';
      } },
      nurse: { id: "nurse", keys: [], draw: function (theme) {
        return '<rect x="36" y="16" width="28" height="6" fill="#ffffff" stroke="#b0b8c0" stroke-width="0.6"/>' +
               '<rect x="48" y="10" width="4" height="6" fill="' + theme.accent + '"/>';
      } },
      helmet: { id: "helmet", keys: [], draw: function (theme) {
        return '<path d="M 18 38 Q 20 10 50 8 Q 80 10 82 38 L 82 44 L 18 44 Z" fill="#f0a830"/>' +
               '<rect x="22" y="20" width="56" height="6" fill="' + theme.ink + '" opacity="0.55"/>' +
               '<rect x="44" y="32" width="12" height="3" fill="#ffffff" opacity="0.7"/>';
      } },
      ribbon: { id: "ribbon", keys: [], draw: function (theme) {
        return '<path d="M 30 22 L 38 12 L 44 22 L 38 28 Z" fill="' + theme.accent + '"/>' +
               '<path d="M 70 22 L 62 12 L 56 22 L 62 28 Z" fill="' + theme.accent + '"/>' +
               '<circle cx="50" cy="20" r="3" fill="' + theme.accent + '"/>';
      } },
      headband: { id: "headband", keys: [], draw: function (theme) {
        return '<path d="M 28 28 Q 50 18 72 28 L 72 32 L 28 32 Z" fill="' + theme.ink + '"/>';
      } },
      glasses: { id: "glasses", keys: [], draw: function (theme) {
        return '<circle cx="42" cy="41" r="5" fill="#ffffff" fill-opacity="0.25" stroke="' + theme.ink + '" stroke-width="1.2"/>' +
               '<circle cx="58" cy="41" r="5" fill="#ffffff" fill-opacity="0.25" stroke="' + theme.ink + '" stroke-width="1.2"/>' +
               '<line x1="47" y1="41" x2="53" y2="41" stroke="' + theme.ink + '" stroke-width="1.2"/>';
      } },
    };
    return map[hat] ? [map[hat]] : [];
  },

  /* -------- 绘制层：每个函数仅输出 SVG 片段 -------- */

  _drawBackground(bg, size) {
    return '<circle cx="50" cy="50" r="50" fill="' + bg + '"/>';
  },
  _drawCloth(cloth, cloth2, size) {
    const detail = this._detail(size);
    const gid = "g" + Math.random().toString(36).slice(2, 8);
    const grad = (detail === "mini") ? "" :
      '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + cloth2 + '"/>' +
      '<stop offset="1" stop-color="' + cloth + '"/></linearGradient></defs>';
    const fill = (detail === "mini") ? cloth : ('url(#' + gid + ')');
    return grad +
      '<path d="M 8 100 Q 12 70 30 60 L 70 60 Q 88 70 92 100 Z" fill="' + fill + '"/>' +
      '<path d="M 38 60 L 50 75 L 62 60 Z" fill="' + cloth2 + '" opacity="0.55"/>';
  },
  _drawFace(faceType, skinColor, lightColor, shadowColor, size) {
    const f = this.FACE_TYPES[faceType];
    const detail = this._detail(size);
    const gid = "g" + Math.random().toString(36).slice(2, 8);
    const grad = (detail === "mini") ? "" :
      '<defs><radialGradient id="' + gid + '" cx="50%" cy="40%" r="60%">' +
      '<stop offset="0" stop-color="' + lightColor + '"/>' +
      '<stop offset="1" stop-color="' + skinColor + '"/></radialGradient></defs>';
    const fill = (detail === "mini") ? skinColor : ('url(#' + gid + ')');
    // 脸型差异：调用对应脸型的 jaw/nose 绘制函数（male 方下颌 / female 圆润 / elderly 皱纹 + 各自鼻影）
    let faceParts = "";
    if (f && typeof f.jaw === "function") faceParts += f.jaw(shadowColor) || "";
    if (f && typeof f.nose === "function") faceParts += f.nose(shadowColor) || "";
    return grad +
      '<rect x="44" y="50" width="12" height="14" fill="' + skinColor + '"/>' +
      '<circle cx="50" cy="40" r="20" fill="' + fill + '"/>' +
      faceParts;
  },
  _drawHair(style, base, highlight, shadow, size) {
    const detail = this._detail(size);
    const sw = this._stroke(size, 0.6);
    const hairShadow = '<path d="M 30 48 Q 50 52 70 48" stroke="' + shadow + '" stroke-width="' + sw + '" fill="none" opacity="0.4"/>';
    const hairHigh = '<path d="M 32 32 Q 38 26 50 25" stroke="' + highlight + '" stroke-width="' + sw + '" fill="none" opacity="0.6"/>';
    const basePath = this._legacyHairPath(style, base);
    if (detail === "mini") return basePath;
    return basePath + hairHigh + hairShadow;
  },
  /** 旧 hairStyle → 基础发型 SVG 路径（short/bun/curly/long/bald，兜底 short） */
  _legacyHairPath(style, base) {
    const s = style || "short";
    if (s === "bald") return '<ellipse cx="50" cy="26" rx="16" ry="4" fill="' + base + '" opacity="0.35"/>';
    if (s === "bun") {
      return '<path d="M 30 34 Q 30 16 50 14 Q 70 16 70 34 Q 64 40 36 40 Z" fill="' + base + '"/>' +
             '<circle cx="50" cy="14" r="7" fill="' + base + '"/>';
    }
    if (s === "curly") {
      return '<path d="M 28 34 Q 26 18 40 14 Q 50 11 60 14 Q 74 18 72 34 Q 68 42 50 43 Q 32 42 28 34 Z" fill="' + base + '"/>' +
             '<circle cx="34" cy="22" r="5" fill="' + base + '"/><circle cx="50" cy="18" r="6" fill="' + base + '"/><circle cx="66" cy="22" r="5" fill="' + base + '"/>';
    }
    if (s === "long") {
      return '<path d="M 30 34 Q 30 14 50 13 Q 70 14 70 34 L 66 58 Q 60 62 56 58 L 54 40 L 46 40 L 44 58 Q 40 62 34 58 Z" fill="' + base + '"/>';
    }
    // short 兜底
    return '<path d="M 30 34 Q 30 16 50 14 Q 70 16 70 34 Q 64 40 36 40 Z" fill="' + base + '"/>';
  },
  _drawExpression(expr, size) {
    const e = this.EXPRESSIONS[expr] || this.EXPRESSIONS.calm;
    const sw = this._stroke(size, 1.4);
    const swBold = this._stroke(size, 1.6);
    const swBrow = this._stroke(size, 0.8);
    // 表情眼睛/嘴/眉都使用 SVG 描边，size 越小 SVG 单位越粗（保持视觉 1px）
    const eyes = e.eyes
      .replace(/stroke-width="1\.4"/g, 'stroke-width="' + sw + '"')
      .replace(/stroke-width="1\.6"/g, 'stroke-width="' + swBold + '"');
    const mouth = e.mouth.replace(/stroke-width="1\.4"/g, 'stroke-width="' + sw + '"');
    const brow = e.brow
      ? '<path d="' + e.brow + '" stroke="#3a2a1a" stroke-width="' + swBrow + '" fill="none" stroke-linecap="round"/>'
      : "";
    return brow + eyes + mouth;
  },
  _drawAccessories(list, cloth, size) {
    const detail = this._detail(size);
    const theme = this.THEMES.retro;
    let out = "";
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      // mini 模式：仅删装饰性小挂件（miniOk=false），职业核心配饰（帽子/工牌/工具等）强制保留
      if (detail === "mini" && a.miniOk === false) continue;
      out += a.draw(theme, cloth);
    }
    return out;
  },
  _drawMicroFeatures(list, skin, size) {
    if (this._detail(size) === "mini") return "";
    const theme = this.THEMES.retro;
    let out = "";
    for (let i = 0; i < list.length; i++) out += list[i].apply(skin, theme);
    return out;
  },

  /* -------- 入口 -------- */

  /**
   * 渲染 inline SVG 字符串
   * @param {object} resident 居民对象（须含 id/name/tagShort，可选 secret/avatar）
   * @param {object} [opts]  { size: 像素尺寸(数字) }，影响线宽与简化判定
   * @returns {string} SVG 字符串
   */
  build(resident, opts) {
    const r = resident || {};
    const o = opts || {};
    const size = o.size || 100;
    const a = r.avatar || {};
    const profile = this._profileOf(r.tagShort);
    const cloth = a.cloth || profile.cloth;
    const cloth2 = a.cloth2 || profile.cloth2;
    const bg = a.bg || profile.bg;
    const skin = this._skinOf(r, a, o);
    const hair = this._hairOf(r, a, o);
    const faceType = this._faceType(r);
    const expr = this._expression(r);
    // 配件：旧 hat 字段优先（向后兼容），否则按 tag 自动匹配
    const legacyHats = (a.hat !== undefined) ? this._hatLegacy(a.hat) : [];
    const tagAccs = this._accessories(r);
    const accs = legacyHats.length ? legacyHats : tagAccs;
    // 发型：旧 hairStyle 优先（向后兼容）
    const hairStyle = a.hairStyle || "short";
    const micros = this._microFeatures(r);
    return '<svg class="avatar-svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      this._drawBackground(bg, size) +
      this._drawCloth(cloth, cloth2, size) +
      this._drawAccessories(accs.filter(function (x) { return x.id === "apron"; }), cloth, size) +
      this._drawFace(faceType, skin.base, skin.light, skin.shadow, size) +
      this._drawHair(hairStyle, hair.base, hair.highlight, hair.shadow, size) +
      this._drawMicroFeatures(micros, skin.base, size) +
      this._drawExpression(expr, size) +
      this._drawAccessories(accs.filter(function (x) { return x.id !== "apron"; }), cloth, size) +
      "</svg>";
  },

  /* -------- 外部立绘（webp）映射：仅前三关角色配图，其余回退 SVG -------- */

  /** key = "L{关卡}_{居民id}"，value = 拼音；文件名 assets/portraits/{key}_{拼音}_normal.webp */
  PORTRAITS: {
    "L1_r1": "wangshen", "L1_r2": "xiaoli", "L1_r3": "laozhang", "L1_r4": "zhaodaye",
    "L2_r1": "zhaonainai", "L2_r2": "xiaopang", "L2_r3": "aming", "L2_r4": "xiaole",
    "L3_r1": "liujie", "L3_r2": "awei", "L3_r3": "xiaorui", "L3_r4": "chenbo",
  },

  /** 立绘资源根目录 */
  PORTRAIT_DIR: "assets/portraits/",

  /** webp 支持检测结果缓存（null=未检测；true/false=已检测），避免每次渲染头像都重复探测 */
  _webpSupported: null,

  /** 检测浏览器是否支持 webp：canvas toDataURL 探测；file:// 双击打开等不支持场景直接回退 SVG，避免立绘翻车 */
  _supportsWebp() {
    if (this._webpSupported !== null) return this._webpSupported;
    let ok = false;
    try {
      const c = (typeof document !== "undefined" && document.createElement) ? document.createElement("canvas") : null;
      if (c && typeof c.toDataURL === "function") {
        c.width = 1; c.height = 1;
        ok = c.toDataURL("image/webp").indexOf("data:image/webp") === 0;
      }
    } catch (e) { ok = false; }
    this._webpSupported = ok;
    return ok;
  },

  /** 取居民立绘 URL：有映射返回 webp 路径，否则 null（无图走 SVG 回退）。
   *  小头像（size < 64，如卡槽/缩略）优先用 thumbs/ 缩略图，大图场景走原图。
   *  @param {object} resident 居民对象（须含 id）
   *  @param {number} [levelIndex] 关卡序号（缺省 App.currentLevel）
   *  @param {number} [size] 期望显示像素尺寸，<64 视为小头像走缩略图 */
  portraitUrl(resident, levelIndex, size) {
    const r = resident || {};
    const lv = levelIndex || (typeof App !== "undefined" ? App.currentLevel : 0);
    if (!lv || !r.id) return null;
    const py = this.PORTRAITS["L" + lv + "_" + r.id];
    if (!py) return null;
    const file = "L" + lv + "_" + r.id + "_" + py + "_normal.webp";
    const small = !!(size && size < 64);
    return this.PORTRAIT_DIR + (small ? "thumbs/" : "") + file;
  },

  /** 大图场景头像：有立绘用 webp（加载失败自动回退 SVG），无映射直接返回 SVG。
   *  小头像（size<64）自动走 thumbs/ 缩略图，减轻微信等弱环境加载压力。
   *  用于对话弹窗 / 档案详情；小头像与缩略网格请继续用 build() 保 SVG 省资源。
   *  @param {object} resident 居民对象
   *  @param {object} [opts] { size: 像素尺寸 }
   *  @param {number} [levelIndex] 关卡序号（缺省 App.currentLevel） */
  buildWithPortrait(resident, opts, levelIndex) {
    const svg = this.build(resident, opts);
    const size = (opts && opts.size) || 0;
    const url = this.portraitUrl(resident, levelIndex, size);
    if (!url || !this._supportsWebp()) return svg;
    const esc = (typeof ClueCards !== "undefined" && ClueCards.escapeHtml)
      ? ClueCards.escapeHtml
      : function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
    const alt = esc((resident && resident.name) || "");
    // fallback 先于 img；img 加载失败时隐藏自身并显示前一兄弟节点（fallback）
    const fallback = svg.replace('class="avatar-svg"', 'class="avatar-svg fallback"');
    return fallback +
      '<img class="avatar-portrait" src="' + url + '" alt="' + alt + '" decoding="async" ' +
      'onerror="this.style.display=\'none\';this.previousElementSibling.style.display=\'block\';" />';
  },

  /* 保留：_profileOf 旧实现（build 内使用，不删除避免破坏依赖） */
  PROFILES: [
    { keys: ["摊主"],                 cloth: "#6e8e58", cloth2: "#f3e7c1", bg: "#e8efd6" },
    { keys: ["护士"],                 cloth: "#f4f6f8", cloth2: "#cfd6dd", bg: "#e6eef0" },
    { keys: ["医生"],                 cloth: "#f4f6f8", cloth2: "#cfd6dd", bg: "#e6eef0" },
    { keys: ["保安", "门卫"],         cloth: "#324a6e", cloth2: "#cfaa55", bg: "#dde2ea" },
    { keys: ["外卖"],                 cloth: "#f0a830", cloth2: "#1c1c1c", bg: "#fbeacd" },
    { keys: ["快递"],                 cloth: "#205081", cloth2: "#1c1c1c", bg: "#dde4ee" },
    { keys: ["货运", "司机"],         cloth: "#5d4527", cloth2: "#222222", bg: "#e8dec8" },
    { keys: ["汽修"],                 cloth: "#2f333a", cloth2: "#a85a1c", bg: "#ece2d2" },
    { keys: ["水电", "维修"],         cloth: "#3f4a3c", cloth2: "#1c1c1c", bg: "#f4e2cb" },
    { keys: ["木匠"],                 cloth: "#7a5a32", cloth2: "#f3e7c1", bg: "#ecdfc2" },
    { keys: ["清洁"],                 cloth: "#3e6b8a", cloth2: "#ffffff", bg: "#dde8ee" },
    { keys: ["志愿者"],               cloth: "#c8364b", cloth2: "#ffffff", bg: "#f4dcde" },
    { keys: ["太极", "晨练"],         cloth: "#3a3a3a", cloth2: "#ffffff", bg: "#e6e6e6" },
    { keys: ["程序", "文员", "会计", "写字楼"], cloth: "#2c2c2c", cloth2: "#ffffff", bg: "#dde2e8" },
    { keys: ["大学生"],               cloth: "#3b3b3b", cloth2: "#ffffff", bg: "#dde2e8" },
    { keys: ["高中生", "初中生", "小学生", "学生", "备考生"], cloth: "#205081", cloth2: "#ffffff", bg: "#dfe7f0" },
    { keys: ["教师", "老教师"],       cloth: "#3a4a66", cloth2: "#ffffff", bg: "#dde2ea" },
    { keys: ["花艺", "花店"],         cloth: "#d98aa2", cloth2: "#f3e7c1", bg: "#f6ebf1" },
    { keys: ["养花"],                 cloth: "#5a7e44", cloth2: "#f3e7c1", bg: "#e2ecd4" },
    { keys: ["主妇"],                 cloth: "#d98aa2", cloth2: "#f3e7c1", bg: "#f6ebf1" },
    { keys: ["管理员"],               cloth: "#7c5e9e", cloth2: "#ffffff", bg: "#e7e0ee" },
    { keys: ["老板", "老板娘", "主理人"], cloth: "#7c5e3a", cloth2: "#f3e7c1", bg: "#ece1c8" },
    { keys: ["上班族"],               cloth: "#2c2c2c", cloth2: "#ffffff", bg: "#dde2e8" },
    { keys: ["跑船", "退休", "钳工"], cloth: "#4a4a4a", cloth2: "#ffffff", bg: "#dfe2e0" },
  ],
  DEFAULT: { cloth: "#8aa896", cloth2: "#f3e7c1", bg: "#eef0e8" },
  _profileOf(tag) {
    if (!tag) return this.DEFAULT;
    for (const p of this.PROFILES) {
      for (const k of p.keys) {
        if (tag.indexOf(k) !== -1) return p;
      }
    }
    return this.DEFAULT;
  },
  /** 编译三组关键字索引（对象定义后立即执行，供 _matchAll 使用） */
  _initIndexes() {
    this.EXPR_INDEX = this._compile(this.EXPR_RULES);
    this.ACC_INDEX = this._compile(this.ACCESSORY_POOL);
    this.MICRO_INDEX = this._compile(this.MICRO_FEATURES);
  },
};
AvatarFactory._initIndexes();

/* ============================================================
   模块四：基础校验工具（只依赖 App 状态，不内置任何关卡数据）
   ============================================================ */
const Bgm = {
  started: false,  // 是否已获得首次用户点击（浏览器禁止自动播放）
  menu: null,      // 主菜单 / 档案馆 曲目
  gameplay: null,  // 其余页面曲目（关卡选择 / 游戏全程）
  current: null,   // 当前播放中的 Audio 对象

  /** 初始化：创建两路音频对象，并注册首次点击解锁 */
  init() {
    if (typeof Audio !== "function") return; // 非浏览器环境（测试 / 受限容器）跳过音乐
    this.menu = new Audio("audio/menu.mp3");
    this.menu.loop = true;
    this.menu.preload = "auto";
    this.gameplay = new Audio("audio/gameplay.mp3");
    this.gameplay.loop = true;
    this.gameplay.preload = "auto";
    // 从 localStorage 恢复静音状态
    try {
      const saved = localStorage.getItem("townMystery_bgmMuted");
      this.muted = saved === "1";
    } catch (e) { /* localStorage 不可用时静默忽略 */ }
    this._applyMute();
    // 资源加载/解码失败时给出控制台提示（部署到无音频资源的子路径时便于排查）
    const warnOnErr = (label) => (e) => console.warn(`[Bgm] ${label} 音频加载失败：`, e && e.message || e);
    this.menu.addEventListener("error", warnOnErr("menu.mp3"));
    this.gameplay.addEventListener("error", warnOnErr("gameplay.mp3"));
    // 任何位置的首次点击都作为启动信号（只触发一次）
    document.addEventListener("click", () => Bgm.unlock(), { once: true });
  },

  /** 首次点击解锁：启动当前应播曲目（失败静默，例如文件缺失） */
  unlock() {
    if (this.started) return;
    this.started = true;
    if (this.muted) return; // 静音状态不启动
    const target = this.current || this.menu;
    target.play().catch((e) => console.warn("[Bgm] 解锁播放失败（用户尚未交互或被浏览器拦截）：", e && e.message || e));
  },

  /** 按页面切换曲目：menu/archive 播 menu.mp3，其余播 gameplay.mp3 */
  playForPage(pageId) {
    const isMenuPage = pageId === "page-menu" || pageId === "page-archive";
    const target = isMenuPage ? this.menu : this.gameplay;
    if (this.current === target) return; // 同一曲目内跳转保持连贯，不重播
    if (this.current) this.current.pause();
    this.current = target;
    if (this.started && !this.muted) target.play().catch((e) => console.warn("[Bgm] 切换曲目播放失败：", e && e.message || e));
  },
  /** 切换静音状态：暂停/恢复当前曲目 + 持久化 + 触发 UI 刷新 */
  toggleMute() {
    this.muted = !this.muted;
    try { localStorage.setItem("townMystery_bgmMuted", this.muted ? "1" : "0"); } catch (e) { /* ignore */ }
    this._applyMute();
    this._refreshMuteButton();
  },
  /** 把 muted 状态同步到两路 Audio 对象 */
  _applyMute() {
    if (this.menu) this.menu.muted = this.muted;
    if (this.gameplay) this.gameplay.muted = this.muted;
    if (this.muted && this.current && !this.current.paused) this.current.pause();
    if (!this.muted && this.started && this.current && this.current.paused) {
      this.current.play().catch((e) => { /* 静默 */ });
    }
  },
  /** 刷新顶栏静音按钮的图标 */
  _refreshMuteButton() {
    const btn = document.getElementById("btn-mute");
    if (!btn) return;
    btn.textContent = this.muted ? "🔇" : "🔊";
    btn.title = this.muted ? "点击开启背景音乐" : "点击静音";
    if (typeof btn.setAttribute === "function") {
      btn.setAttribute("aria-pressed", this.muted ? "true" : "false");
    } else {
      btn["aria-pressed"] = this.muted ? "true" : "false";
    }
  },
};

/* ============================================================
   模块六：菜单渲染（主菜单 / 关卡选择页）
   ============================================================ */
const Menu = {
  /** 页面切换：隐藏所有页面，显示目标页 + 同步背景音乐 */
  showPage(id) {
    document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
    document.getElementById(id).classList.add("active");
    Bgm.playForPage(id);
  },
  /** 渲染关卡选择列表：已解锁可点，未解锁灰色锁定 */
  renderLevels() {
    const progress = StorageUtil.readProgress();
    const grid = document.getElementById("level-grid");
    const tip = document.getElementById("progress-tip");
    grid.innerHTML = "";
    tip.textContent = "解锁进度：" + progress.unlocked + " / " + App.totalLevels;

    for (let i = 1; i <= App.totalLevels; i++) {
      const unlocked = i <= progress.unlocked;
      const lvName = (LevelData[i - 1] && LevelData[i - 1].title) || ("关卡 " + i);
      const lvDiff = (LevelData[i - 1] && LevelData[i - 1].difficulty) || "";
      const card = document.createElement("button");
      card.className = "level-card" + (unlocked ? "" : " locked");
      card.innerHTML =
        '<span class="lv-num">' + i + '</span>' +
        '<span class="lv-name">' + ClueCards.escapeHtml(lvName) +
          (lvDiff ? ' · ' + ClueCards.escapeHtml(lvDiff) : '') + '</span>' +
        '<span class="lv-state">' + (unlocked ? (i < progress.unlocked ? "已通关" : "当前") : "未解锁") + '</span>';
      if (unlocked) {
        card.addEventListener("click", () => {
          // 占位：游戏数据加载后由「加载关卡数据()」填充
          App.currentLevel = i;
          Menu.showPage("page-game");
          GameFlow.loadLevelPlaceholder();
        });
      }
      grid.appendChild(card);
    }
  },
  /** 根据玩家进度刷新主菜单"开始游戏"按钮文案：
   *  - 首次玩（unlocked=1 且未通关过任何一关）→"开 始 游 戏"
   *  - 老玩家（已通关 ≥1 关）→"继 续 推 理" + 副文案显示当前关 */
  refreshStartButton() {
    const btn = document.getElementById("btn-start");
    if (!btn) return;
    const textEl = btn.querySelector(".menu-btn-text");
    const hintEl = document.getElementById("btn-start-hint");
    const progress = StorageUtil.readProgress();
    const clearedAny = progress.unlocked > 1 || StorageUtil.readBioRecord().length > 0;
    if (clearedAny) {
      if (textEl) textEl.textContent = "继 续 推 理";
      if (hintEl) hintEl.textContent = "当前第 " + progress.unlocked + " 关 · 随时可暂停";
    } else {
      if (textEl) textEl.textContent = "开 始 游 戏";
      if (hintEl) hintEl.textContent = "从第 1 关 · 丢失的菜篮 开始";
    }
  },
  /** 刷新主菜单脚注与档案馆按钮的实时统计（不修改数据，只读） */
  refreshMenuStats() {
    const progress = StorageUtil.readProgress();
    const bio = StorageUtil.readBioRecord().length;
    const fp = document.getElementById("foot-progress");
    const fb = document.getElementById("foot-bio");
    const ah = document.getElementById("btn-archive-hint");
    if (fp) fp.textContent = "已解锁 " + progress.unlocked + "/" + App.totalLevels;
    if (fb) fb.textContent = "收集 " + bio + " 位居民";
    if (ah) ah.textContent = "已解锁 " + bio + " 位";
  },
  /** 刷新每日提示（按存档指纹稳定随机） + 印章进度环 */
  refreshMenuTipAndRing() {
    // 进度环：pathLength=100，offset 从 100（空）到 0（满）
    const ring = document.getElementById("menu-mark-ring");
    if (ring) {
      try {
        const p = StorageUtil.readProgress();
        const pct = App.totalLevels > 0 ? Math.min(100, (p.unlocked / App.totalLevels) * 100) : 0;
        ring.style.strokeDashoffset = String(100 - pct);
      } catch (e) { /* 存档异常时保持空环 */ }
    }
    // 每日提示：按"日期 + 存档指纹"稳定选一条（每次进入主菜单都一致，避免文字乱跳）
    const tipText = document.getElementById("menu-tip-text");
    if (tipText) {
      const TIPS = [
        "先走访所有居民，再回头比对证词。",
        "时间轴上的冲突点往往藏关键证据。",
        "⚠ 标记的不一定是凶手，但能缩小范围。",
        "同一时间段的证词如果打架，必有一假。",
        "居民档案里藏着过往来访，别忘了点开。",
        "卡关时点右下角的提示按钮，能拿到关键线索。",
        "小镇群像总图能一眼看到谁还没被问过。",
        "慎用指认——3 次用错就要重开本关。",
        "证物与口供对齐，推理就成功一半。",
        "鼠标拖动线索到时间轴，摆放有误可重置。",
      ];
      let idx = 0;
      try {
        const d = new Date();
        const seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
        const progress = StorageUtil.readProgress();
        const bio = StorageUtil.readBioRecord().length;
        const mix = (seed ^ (progress.unlocked * 31) ^ (bio * 17)) >>> 0;
        idx = mix % TIPS.length;
      } catch (e) { idx = 0; }
      tipText.textContent = TIPS[idx];
    }
  },
};
