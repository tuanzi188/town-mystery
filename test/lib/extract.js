/**
 * 共享模块：index.html / town_data.js 加载 + LevelData 抽取 + 沙箱注入
 *
 * 消除 9 个独立脚本中重复的 HTML 解析、LevelData 切片、mock 注入模板。
 * 任何脚本需要访问 LevelData / town_data.js / 真实运行沙箱，
 * 统一通过本模块的 3 个入口函数：
 *
 *   1) loadHtml()             → 读 index.html 原文
 *   2) loadScriptCode()       → 抽 <script>...</script> 之间的 JS 源码
 *   3) loadTownData()         → 读 town_data.js 原文
 *   4) extractLevelData()     → 从 index.html 里切出 const LevelData = [...] 数组
 *   5) loadRuntime({...})     → 把 town_data.js + 真实脚本 + 沙箱 mock 装进 new Function，
 *                                返回运行时上下文 { ctx, mocks }
 *
 * 设计原则（遵循 6A / 三大禁令）：
 *   - 一个模块只做「加载+注入」一件事，断言逻辑全部留在原脚本里
 *   - 不写全局变量（仅 module.exports）
 *   - 错误抛出而非静默失败（fail-fast）
 *   - 路径与解析策略对所有调用方完全一致，避免漂移
 */
const fs = require("fs");
const path = require("path");

const HTML_PATH = path.join(__dirname, "..", "..", "index.html");
const TOWN_PATH = path.join(__dirname, "..", "..", "src", "town_data.js");

const MARKER_LEVELDATA_START = "const LevelData = ";
const MARKER_NEXT_CONST = "const GameFlow";

function loadHtml() {
  return fs.readFileSync(HTML_PATH, "utf8");
}

function loadScriptCode() {
  // 拆分后：按 index.html 中 <script src="src/xxx.js"> 的出现顺序拼接各文件
  // （与浏览器实际加载顺序一致；town_data.js 单独由 loadTownData 提供）
  const html = loadHtml();
  const refRe = /<script\s+src="(src\/[^"]+\.js)">/g;
  const jsRefs = [];
  let refMatch;
  while ((refMatch = refRe.exec(html)) !== null) {
    if (refMatch[1] === "src/town_data.js") continue; // 数据模块由 loadTownData 单独加载
    jsRefs.push(refMatch[1]);
  }
  if (!jsRefs.length) {
    throw new Error("index.html 未找到 src/ 目录下的脚本引用");
  }
  return jsRefs.map((rel) => {
    const file = path.join(__dirname, "..", "..", rel);
    return fs.readFileSync(file, "utf8");
  }).join("\n");
}

function loadTownData() {
  if (!fs.existsSync(TOWN_PATH)) {
    throw new Error("缺少 town_data.js（走访追问 / 跨关暗线数据模块）");
  }
  return fs.readFileSync(TOWN_PATH, "utf8");
}

function extractLevelData() {
  // LevelData 已拆入 src/00.levels.js：从拼接脚本源码（按 index.html 顺序）中定位。
  // 数组闭合以独占一行的 `];` 为界（不再依赖 const GameFlow 相邻位置）。
  const code = loadScriptCode();
  const startIdx = code.indexOf(MARKER_LEVELDATA_START);
  if (startIdx < 0) {
    throw new Error("未找到 LevelData 起点（" + MARKER_LEVELDATA_START + "）");
  }
  const arrayHead = code.indexOf("[", startIdx);
  const tailMatch = /\n\s*\];/.exec(code.slice(arrayHead));
  if (!tailMatch) {
    throw new Error("未找到 LevelData 数组闭合的独占行 ];");
  }
  // 取到闭合的 `];`（含分号，独立行），整体作为数组字面量返回
  const dataJson = code.slice(arrayHead, arrayHead + tailMatch.index + tailMatch[0].length);
  try {
    return (new Function("return " + dataJson))();
  } catch (e) {
    const dumpPath = path.join(__dirname, "..", "debug_leveldata.js");
    fs.writeFileSync(dumpPath, dataJson);
    throw new Error("解析 LevelData 失败：" + e.message + "（已落盘到 debug_leveldata.js）");
  }
}

function loadRuntime(opts) {
  const expose = (opts && opts.expose) || [];
  const includeTownData = !opts || opts.includeTownData !== false;
  const mocks = (opts && opts.mocks) || null;
  const onError = (opts && opts.onError) || null;

  const scriptCode = loadScriptCode();
  const townSrc = includeTownData ? loadTownData() : "";
  const exposedNames = expose.join(", ");
  const wrapped = [
    '"use strict";',
    'const document = arguments[0];',
    'const window = arguments[1];',
    'const localStorage = arguments[2];',
    'const CSS = arguments[3];',
    'const requestAnimationFrame = arguments[4];',
    'const navigator = arguments[5];',
    townSrc,
    scriptCode,
    'return { ' + exposedNames + ' };',
  ].join("\n");

  const usedMocks = mocks || require("./mocks").createMocks();
  const fn = new Function(wrapped);
  let ctx;
  try {
    ctx = fn(
      usedMocks.documentMock,
      usedMocks.windowMock,
      usedMocks.localStorageMock,
      usedMocks.CSSMock,
      usedMocks.requestAnimationFrame,
      usedMocks.navigatorMock
    );
  } catch (e) {
    if (onError) {
      onError(e, fn);
      return { ctx: null, mocks: usedMocks };
    }
    throw e;
  }
  return { ctx, mocks: usedMocks };
}

module.exports = {
  HTML_PATH,
  TOWN_PATH,
  MARKER_LEVELDATA_START,
  MARKER_NEXT_CONST,
  loadHtml,
  loadScriptCode,
  loadTownData,
  extractLevelData,
  loadRuntime,
};
