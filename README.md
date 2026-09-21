# 小镇疑云 · town-mystery

一款纯前端的推理小游戏：在小镇证词与物证之间找矛盾、组证据链，推理出每起案件的真凶。共 **11 个关卡**（新手 → 普通 → 困难），难度逐级增加干扰线索。

**[在线试玩](https://tuanzi188.github.io/town-mystery/)**

## 玩法

- 每关一起案件：走访居民收集证词与物证，把线索拖拽分配给对应居民
- 时间轴矛盾检测：证词与物证的时间点互相冲突时会提示
- 互斥线索对（conflictPairs）：同一关键线索存在干扰项，需甄别
- 推理提示引擎：非强制的轻提示层，帮你发现线索间的印证关系，不阻断推理
- 通关后揭晓完整真相（truth）与正确证据链

## 快速开始

用浏览器打开 `index.html` 即可游玩，无需构建、无需依赖。

## 项目结构

```text
index.html              主入口（页面骨架与模块加载）
src/                    游戏逻辑（按模块编号分层）
  00.levels.js            关卡数据（11 关 JSON）
  01.core.js              核心状态
  03.cards.js             卡牌/线索组件
  04.dialog.js            对话系统
  05.drag.js              拖拽分配交互
  06.archive.js           案件档案
  07.gameflow.js          游戏流程
  08.insight.js           推理提示引擎
  town_data.js            小镇居民数据
audio/                  BGM（菜单/游戏内）
assets/                 立绘等静态资源
feature_smoke.js        冒烟测试脚本
```

## 验证

```sh
node feature_smoke.js
```

## 技术栈

- 原生 HTML + CSS + JavaScript（零依赖、无构建）
- 零后端：浏览器打开即玩

## License

MIT
