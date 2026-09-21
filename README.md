# 小镇疑云

一个以小镇群像为背景的中文推理小游戏。当前发布版本采用卡片调查模式：走访居民、追问、整理时间轴、收集证据链并完成指认。

## 玩法

1. 从关卡选择进入案件。
2. 走访居民，听完口供并继续追问。
3. 将带时间的证词放入时间轴，检查说法之间的关系。
4. 把线索加入证据链，选择责任人和决定性证据。
5. 结案后查看真相、分支结局、人物档案和跨关暗线。

项目保留 11 个案件、居民档案、走访追问、线索角色分类、时间轴和结局分支。网页主线不依赖 Three.js、Godot、CDN 或后端服务，直接用浏览器打开 `index.html` 即可运行；本地服务器运行时也可以访问 `http://127.0.0.1:8765/`。

## 本地运行

直接双击 `index.html`，或启动任意静态服务器：

```powershell
npx --yes http-server . -p 8765
```

然后打开 `http://127.0.0.1:8765/`。

## 测试

```powershell
node test/verify.js
node test/runtime_sanity.js
node test/feature_smoke.js
node test/test_defect_fix.js
node test/tutorial_smoke.js
node test/audit_flow.js
node test/simulate_solve.js
```

当前回归结果：运行时冒烟 73 项、走访功能 306 项、缺陷回归 24 项、教程 15 项、门槛审查 30 项、11 案正解模拟 129 项通过。`verify.js` 中仍有 3 项旧的 L1 数据校验失败，属于案件数据本身的待修问题。

## 目录

- `index.html`：网页入口和页面结构。
- `src/00.levels.js`：11 个案件数据。
- `src/01.core.js`：存档、判定和基础工具。
- `src/02.ui.js`：菜单、档案和音频控制。
- `src/03.cards.js`：线索卡片和证据链。
- `src/04.dialog.js`：走访、逐句口供和追问。
- `src/05.drag.js`：时间轴与指针交互。
- `src/06.archive.js`：居民档案、关系和大事记。
- `src/07.gameflow.js`：案件流程、指认、结局和复盘。
- `src/08.insight.js`：线索关联分析。
- `test/`：结构、运行时、走访、缺陷和端到端测试。
- `assets/portraits/`：居民立绘及缩略图。

## 素材与许可

居民立绘来自本项目素材目录；各素材的具体来源和授权应随发布包一并保留。Three.js/Godot 等距探索原型曾在本地实验目录中制作，但当前卡片版网页入口不加载这些原型。

## 当前版本边界

当前发布主线专注于卡片调查和推理闭环，不包含联网、账号系统或服务端存档。浏览器存档使用本地 `localStorage`。
