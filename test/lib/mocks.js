/**
 * 共享模块：浏览器全局对象的 Node 沙箱 mock
 *
 * 消除 5 个运行时脚本中重复的 makeEl / makeStub / localStorageMock / documentMock 等。
 *
 * 统一策略（超集原则）：
 *   - makeEl 返回的节点拥有所有脚本可能用到的方法（_listeners / cloneNode /
 *     getBoundingClientRect / parentNode / setAttribute 等）。
 *   - 多加方法不会让任何脚本出错（任何脚本不会断言"该方法不存在"）。
 *   - 少加方法可能让某些脚本原本可用的代码路径静默失败，所以默认全开。
 *   - 若未来某个测试需要"某方法必须缺失"，再提供 createMocks({ slim: true })。
 *
 * 暴露的 7 个 mock：
 *   - documentMock        document 全局
 *   - windowMock          window 全局（含 innerWidth/innerHeight/addEventListener）
 *   - localStorageMock    闭包隔离的 storage（带 _dump 调试接口）
 *   - CSSMock             CSS.escape polyfill
 *   - requestAnimationFrame  rAF 占位
 *   - navigatorMock       navigator.userAgent
 *   - makeEl              节点工厂（供高级用例复用）
 */

/** no-op 2D 渲染上下文：覆盖 09.town.js 用到的全部 Canvas API（属性可读写、方法全空） */
function makeCtx() {
  const ctx = {};
  ["save", "restore", "translate", "scale", "rotate", "transform", "setTransform",
   "clearRect", "fillRect", "strokeRect", "beginPath", "closePath", "moveTo", "lineTo",
   "arc", "ellipse", "rect", "clip", "fill", "stroke", "drawImage", "fillText",
   "strokeText", "measureText", "setLineDash", "createLinearGradient",
   "createRadialGradient", "createPattern", "quadraticCurveTo", "bezierCurveTo"]
    .forEach((m) => {
      ctx[m] = function () {
        if (m === "measureText") return { width: 0 };
        if (m === "createLinearGradient" || m === "createRadialGradient") {
          return { addColorStop() {} };
        }
        if (m === "createPattern") return {};
      };
    });
  return ctx;
}

function makeEl() {
  const el = {
    innerHTML: "",
    value: "",
    textContent: "",
    dataset: {},
    style: {},
    _listeners: {},
    width: 0,
    height: 0,
    addEventListener(type, fn) {
      (this._listeners[type] = this._listeners[type] || []).push(fn);
    },
    removeEventListener() {},
    appendChild() {},
    removeChild() {},
    insertBefore() {},
    replaceChild() {},
    getContext() {
      // no-op 2D 上下文：09.town.js 的 canvas 渲染在沙箱里只走逻辑不画图
      return makeCtx();
    },
    toDataURL() {
      return "data:,";
    },
    closest() {
      return null;
    },
    cloneNode() {
      return makeEl();
    },
    classList: {
      add() {},
      remove() {},
      contains() {
        return false;
      },
      toggle() {},
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    setAttribute() {},
    getAttribute() {
      return null;
    },
    hasAttribute() {
      return false;
    },
    removeAttribute() {},
    parentNode: null,
    focus() {},
    blur() {},
    click() {},
  };
  return el;
}

function createLocalStorageMock() {
  const s = {};
  return {
    getItem(k) {
      return k in s ? s[k] : null;
    },
    setItem(k, v) {
      s[k] = String(v);
    },
    removeItem(k) {
      delete s[k];
    },
    clear() {
      Object.keys(s).forEach((k) => delete s[k]);
    },
    _dump() {
      return Object.assign({}, s);
    },
  };
}

function createDocumentMock() {
  return {
    addEventListener() {},
    removeEventListener() {},
    body: makeEl(),
    createElement: makeEl,
    createElementNS: makeEl,
    elementFromPoint: () => null,
    getElementById: makeEl,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

function createWindowMock() {
  return {
    innerWidth: 1024,
    innerHeight: 768,
    addEventListener() {},
    removeEventListener() {},
  };
}

function createCSSMock() {
  return {
    escape: (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&"),
  };
}

function createNavigatorMock(ua) {
  return { userAgent: ua || "node-test" };
}

function createMocks(opts) {
  const ua = (opts && opts.userAgent) || "node-test";
  const localStorageMock = (opts && opts.localStorageMock) || createLocalStorageMock();
  return {
    makeEl,
    documentMock: createDocumentMock(),
    windowMock: createWindowMock(),
    localStorageMock,
    CSSMock: createCSSMock(),
    requestAnimationFrame: () => {},
    navigatorMock: createNavigatorMock(ua),
  };
}

module.exports = {
  makeEl,
  makeCtx,
  createLocalStorageMock,
  createDocumentMock,
  createWindowMock,
  createCSSMock,
  createNavigatorMock,
  createMocks,
};
