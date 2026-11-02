# 体型差模拟器内嵌 + TA 身体档案 实施计划

## Repository Research 结论

### 外部站点 my-site-hub 分析
- 已 fork 到 `fcylz/my-site-hub`，部署在 `https://fcylz.github.io/my-site-hub/`
- 纯前端（HTML + CSS + JS），每个模拟器是独立页面（如 `/eye-level-simulator/`）
- 合集包含 **25+ 模拟器**：手掌/脚掌/视线差/男友衬衫/散步约会/地咚/3D身高对比/拥抱/陪睡/双人自拍/接吻/同撑一把伞/大头贴/对坐/壁咚/居家约会/膝枕/共用围巾/背人/哄睡/书架/公主抱/膝上抱坐/装箱/跨坐/床咚/求婚/骑肩膀/听觉差
- 每个模拟器内置 A/B 角色档案（名字/性别/身高/颜色），修改后页面内即时保存到 localStorage
- **跨域 iframe 限制**：mochi-x 无法通过 JS 直接操控 iframe 内部 DOM（改姿势/改身高）

### mochi-x 现有架构

| 模块 | 文件 | 关键能力 |
|---|---|---|
| TA 行为 | `js/room.js` | `decideAction()` 概率决策 `idle/walk/sit/lie/read/plant/near/use`，`taMenu()` 弹菜单，`sayLine()` 对话生成 |
| TA 弹窗 | `js/ta-ask.js` | `askPopupProb()` 概率门，`_enqueuePop()` 弹窗队列，`cardPopupBusy()` 冲突检测 |
| TA 邀请 | `js/ta-invite.js` | 猜拳/Pong/贪吃蛇/贴贴等邀请类型，概率抽取 |
| 功能枢纽 | `js/feature-hub.js` | `HUB` 常量，按分类注册功能入口 |
| 弹窗系统 | `window.openModal()` | 统一的 Modal 打开方式，带标题/内容/按钮 |
| 存储 | `idb.js` + `localStorage` | 双写持久化，`store.get()/store.set()` 模式 |
| 头像/档案 | `js/avatar-lib.js` | TA 头像上传/切换，档案保存 |

## 核心设计决策

1. **内嵌方式**：iframe 嵌入 my-site-hub 各模拟器页面。mochi-x 侧维护模拟器列表（名称 + emoji + URL），hub 主页作为完整合集入口。
2. **TA 身体档案**：新增 `ta-body-profile` 存储 key，保存 TA 性别/身高/颜色（用户在设置里配置）。不尝试与 iframe 内部联动（跨域）。
3. **"切换姿势"实际实现**：因为 iframe 跨域无法操控内部按钮，定义为 **切换模拟器**（每次从 25+ 个里选一个新的打开）。
4. **TA 行为弹窗**：复用 `ta-ask.js` 的 `_enqueuePop` 队列 + `window.openModal`，让 TA 先说话提议 → 用户确认 → 打开 iframe 弹窗。
5. **TA 主动触发模拟器**：扩展 `room.js` 的 `decideAction()`，新增 `propose_simulator` 行为，与 `idle/walk/sit` 等并列参与加权。

## Files and Modules

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `js/ta-body.js` | **新建** | 模拟器列表、TA 身体档案管理、模拟器弹窗打开逻辑、TA 提议行为生成 |
| `src/js/ta-body.js` | **新建** | 对应构建产物（build.mjs 会从 js/ 目录复制） |
| `js/feature-hub.js` | 修改 | 在"互动与心意"分类下注册"体型差模拟器合集"入口 |
| `js/room.js` | 修改 | `decideAction()` 新增 `propose_simulator` 分支；TA 菜单增加"和TA玩体型差"选项 |
| `index.html` | 修改 | 新增 `<iframe>` 弹窗容器（默认 hidden，按需显示） |
| `src/template.html` | 修改 | 同上（构建源） |
| `src/css/setting.css` | 修改 | 新增 TA 身体档案设置区样式 |
| 可选：设置页入口 | 待定 | 通过 feature-hub 或 room taMenu 进入 |

## Implementation Steps

### Step 1：新建 `js/ta-body.js` — 数据层与核心逻辑

```js
// 模拟器目录（name, emoji, url）
const SIMULATORS = [
  { name: '手掌大小对比',      emoji: '✋', url: 'https://fcylz.github.io/hand-size-comparison/' },
  { name: '视线差模拟器',      emoji: '👀', url: 'https://fcylz.github.io/eye-level-simulator/' },
  { name: '3D身高对比工具',    emoji: '📏', url: 'https://fcylz.github.io/3d-height-comparison/' },
  { name: '拥抱模拟器',        emoji: '🫂', url: 'https://fcylz.github.io/hug-simulator/' },
  { name: '壁咚模拟器',        emoji: '🧱', url: 'https://fcylz.github.io/kabedon-simulator/' },
  // ... 共 25+ 条，从 my-site-hub 完整拷贝
  // 合集入口：
  { name: '全部模拟器合集',    emoji: '🎮', url: 'https://fcylz.github.io/my-site-hub/', isHub: true },
];
```

功能清单：
- `taBodyProfile` 对象：读取/保存 `{ gender: 'male', height: 175, color: '#FF6B6B' }`
- `openSimulator(simulator)` — 打开 iframe 弹窗
- `randomSimulator(excludeHub)` — 随机选一个
- `proposeLine(simulator, taName)` — TA 提议时说的话（从词库选）
- `switchPose(currentUrl)` — 关闭当前 → 随机开新的

### Step 2：新建 iframe 弹窗容器

在 `index.html` / `src/template.html` 底部（modal 区域附近）新增：

```html
<div id="ta-body-modal" hidden>
  <div class="ta-body-header">
    <span id="ta-body-title">体型差模拟器</span>
    <button id="ta-body-close">✕</button>
  </div>
  <iframe id="ta-body-iframe" allow="fullscreen" sandbox="allow-same-origin allow-scripts allow-forms allow-popups"></iframe>
</div>
```

CSS（写到 `src/css/setting.css` 或新建 `src/css/ta-body.css`）：全屏/半屏可选，默认半屏 800×600 居中，深色模式适配。

### Step 3：Feature Hub 注册入口

在 `js/feature-hub.js` 的 HUB 常量中，"互动与心意"分类下新增：

```js
{ name: '体型差模拟器合集', emoji: '🎮', 
  desc: '25+ 体型差互动工具，TA 可以提议一起玩',
  keywords: ['体型', '身高差', '模拟器', '对比'],
  action: () => taBody.openSimulator(taBody.SIMULATORS.find(s => s.isHub)) }
```

### Step 4：Room TA 行为扩展

修改 `js/room.js` 的 `decideAction()`（约 L413-L451）：
- 新增 `propose_simulator` 行为，权重 5-10（低于 idle/walk/sit，高于 rare 行为）
- 触发条件：TA 心情非负面、用户不在忙碌状态、有过一段时间没触发
- 执行流程：
  1. `sayLine()` 输出提议台词（"要不要一起看看我们的身高差？"）
  2. `taBody.proposePopup(simulator, taName)` → `window.openModal` 弹窗
  3. 用户点"好啊" → 打开 iframe；点"下次吧" → 忽略

修改 `taMenu()`（L539）：增加菜单项"和 TA 玩体型差" → 直接开 Hub 入口。

### Step 5：TA 身体档案设置

两种入口（都实现）：
- **Room 里**：`taMenu()` → "TA 的身体档案" → 设置弹窗
- **Feature Hub**：个人化设置区增加"TA 身体档案"

设置内容：
- TA 性别（男/女/跟随默认）
- TA 身高（cm，number input）
- TA 颜色（color picker）
- 说明文字："设置后 TA 会用这个数据来提议合适的模拟器"

保存用 `store.set('ta-body-profile', profile)`。

### Step 6：TA 行为弹窗串联

完整的 TA 主动触发流程：

```
room.decideAction()
  → 选中 propose_simulator
  → taBody.randomSimulator()
  → taBody.proposeLine() 
  → taBody.proposePopup()  // window.openModal
  → 用户点"一起玩"
  → taBody.openSimulator()  // 打开 iframe modal
  → 模拟器打开
  → 一段时间后 TA 可能再次 propose → 触发 switchPose()
  → 关闭 iframe modal
```

台词词库（示例）：
- "今天我想看看我们的身高差…"
- "来玩个模拟器吧？"
- "这个姿势怎么样？想换换吗？"
- "看，我们的手比起来好有意思！"

## Dependencies and Considerations

- **跨域 iframe 限制**：无法从 mochi-x 操控 my-site-hub iframe 内部 DOM。切换姿势 = 切换模拟器页面，而不是控制内部按钮。TA 身高/颜色仅在 mochi-x 本地存档，不写入 iframe。
- **沙箱安全**：iframe 用 `sandbox` 属性但需 `allow-scripts`（否则 my-site-hub 的 canvas 渲染失效）。
- **网络依赖**：my-site-hub 部署在 GitHub Pages，需要用户有网。考虑在 iframe 加载失败时显示占位提示。
- **深色模式**：mochi-x 有 dark.css，需确保 iframe 容器本身适配深浅色背景（iframe 内部由 my-site-hub 自己的样式决定，无法影响）。
- **构建流程**：`build.mjs` 从 `js/` 复制到 `src/js/`，新文件自动包含。CSS 同理。
- **与现有 TA 邀请系统的关系**：ta-invite.js 是"邀请用户玩小游戏"，ta-body.js 是"提议玩体型差模拟器"，两者并列，互不干扰。

## Validation

- 打开 feature hub → 能看到新入口 → 点击能打开 iframe 加载 Hub 主页
- Room 里 TA 菜单 → "和 TA 玩体型差" → 正常打开
- Room 里 TA 身体档案 → 能设置身高/颜色 → 保存后刷新保留
- TA 随机行为 → 等几分钟观察是否能触发 propose_simulator
- 弹窗不冲突 → 同时打开聊天 modal 和 iframe 时表现正常
- 深色模式 → iframe 容器背景正确

## Risks and Handling

| 风险 | 处理 |
|---|---|
| my-site-hub 改版 URL 变动 | 维护本地模拟器列表，URL 失效时自动跳过并提示；Hub 主页 URL 稳定作为兜底 |
| GitHub Pages 加载慢/失败 | iframe `onerror` 监听，显示"加载失败，请检查网络"占位 |
| iframe sandbox 过严导致模拟器无法渲染 | 先用 `allow-same-origin allow-scripts allow-forms allow-popups`，实测后裁剪 |
| TA 主动弹窗过于频繁/打扰 | propose_simulator 行为加冷却（如 30min 内最多 1 次），权重调低 |
| 用户点弹窗关闭后 iframe 没清理 | modal hidden 时把 iframe src 设为 'about:blank' 释放内存 |
| 25+ 模拟器列表维护 | 首次手动整理，后续在代码里加注释标明来源 URL |
