# 装箱模拟器（hakozume-simulator）完全内嵌 + TA 集成 实施计划

## 源码位置（你不需要手动下载）

我已自动 clone 到本地：`c:\Users\86176\.trae-cn\work\hakozume-simulator\index.html`（2115 行，105KB 单文件）。移植时直接从这里读取内容。

---

## 源码研究结论

### hakozume-simulator 仓库

- **来源**：`https://github.com/fcylz/hakozume-simulator`（forked from qwertyaz111）
- **结构**：**单文件 `index.html`**，HTML+CSS+JS 全内联
- **依赖**：仅 `three.js r145`（CDN 加载）

### 源码三大块

| 块 | 行数 | 内容 |
|---|---|---|
| **3D 渲染层** | ~170 行 | `createMannequin()` 参数化 3D 身体、`buildBox()`、`applyPose()`、`addJoint()`、`preparePerson()`，依赖 THREE.js 基础几何体拼装 |
| **姿势求解引擎** | **~940 行** | 四元数、`makeDims()`、`buildBody()` OBB 碰撞体、碰撞检测、`evalPose()` 能量评估、`familySeeds()` 15+ 姿势族种子、`solveGen()` generator 模拟退火 + 手臂搜索 |
| **UI 驱动层** | ~550 行 | `reroll()`/`updateScene()`/`startSolve()`/`stepScan()`、Canvas 相机控制、A/B 参数、箱子参数、姿势选择、localStorage 自动保存 |

### 15 个姿势族
`between` / `betweenF` / `laplap` / `laplapF` / `facingKnees` / `facingWrap` / `cradle` / `side` / `lying` / `overAllFours` / `overAllFoursWide` / `overAllFoursOff` / `reverseStack` / `reverseStackWide`（坐姿）+ `standFace` / `standBack` / `standSide`（清洁柜站立）

### mochi-x 已有模式

- **Room TA 行为**：`room.js decideAction()` 加权选 idle/walk/sit/lie/read/plant/near/use
- **TA 主动弹窗**：`ta-ask.js _enqueuePop()` 队列 + `window.openModal()`
- **功能入口**：`feature-hub.js` 的 HUB 常量
- **脚本加载**：传统 `<script defer src="...">`，全部写死在 index.html 里，**没有动态加载模式**
- **构建流程**：`build.mjs` 从 `js/` → `src/js/`，CSS 同理，自动复制

---

## 核心设计决策

### 关键变化：动态按需加载（规避首屏 1.3MB 负担）

**不**在 index.html 头部写死 `<script>` 标签加载 three.js 和 hakozume。

而是：

```
mochi-x 启动 → 加载一个 轻量 loader 文件 (~1KB, 纯同步无依赖)
               ↓ （loader 文件定义 hakozumeApi 的空壳 + loadSequentialScripts 工具）
               ↓
用户第一次点击 hakozumeApi.open()
               ↓
动态创建 <script> 标签按顺序加载：
  1. vendor/three.min.js   (~1.3MB)
  2. js/hakozume-engine.js (~45KB)
  3. js/hakozume-render.js (~20KB)
  4. js/hakozume-panel.js  (~30KB)
               ↓
loader 的 open() 从空壳变成真正调 hzPanel.open()
               ↓
动态创建 <div id="hakozume-root"> 全屏遮罩层 DOM
               ↓
Canvas 初始化 + 参数面板渲染
```

**关闭后不卸载**：three.js 和 hakozume 模块保持在 window 上（避免下次 open 再加载 1.3MB），只 dispose WebGL context + 隐藏 DOM。

### 其他设计决策

1. **文件拆分**：原 105KB 单文件拆成 3 个 IIFE 模块（保持全局变量引用模式，最小改动）。
2. **TA 自动填充 A 参数**：从 mochi-x TA 档案读 → 自动填到 hakozume A 组。B 组默认用户自己。
3. **"切换姿势"实现**：`hakozumeApi.reroll()`（variantSeed++）→ 求解器自动选新姿势。
4. **TA 主动触发**：room.js decideAction() 加 `propose_hakozume` 分支 → 说话 → 弹窗确认 → open。
5. **内嵌方式**：不 iframe。Canvas 渲染在动态创建的 `<div id="hakozume-root">` 全屏遮罩里。

---

## Files and Modules

### 新增文件（7 个）

| 文件 | 大小估计 | 加载方式 | 内容 |
|---|---|---|---|
| `vendor/three.min.js` | ~1.3MB | **动态按需** | three.js r145 UMD 版本 |
| `js/hakozume-engine.js` | ~45KB | **动态按需** | 求解引擎：四元数、碰撞、评估、familySeeds、solveGen 模拟退火（源 L521-L1458） |
| `js/hakozume-render.js` | ~20KB | **动态按需** | THREE.js 初始化、createMannequin、buildBox、applyPose、animate、camera（源 L346-L520 + L1461-L1610 + L1836-L1950） |
| `js/hakozume-panel.js` | ~30KB | **动态按需** | UI 面板 DOM、参数同步、updateScene、startSolve、reroll、renderInfo、相机控制（源 L1566-L1835 + L1950-L2035） |
| `js/hakozume-loader.js` | ~1KB | **同步 defer** | 唯一写死的同步依赖：定义 `hakozumeApi` 空壳接口 + `loadSequentialScripts()` 按序加载工具 |
| `css/hakozume.css` | ~6KB | 动态按需（或 loader 里插入） | 从源文件 L7-L186 提取，加 mochi-x 深色模式适配 |
| `src/js/hakozume-*.js` + `src/vendor/three.min.js` | 构建产物 | — | build.mjs 自动从 js/ 和 vendor/ 复制 |

### 修改文件（3 个）

| 文件 | 变更 |
|---|---|
| `index.html` / `src/template.html` | 只加一行：`<script defer src="js/hakozume-loader.js">`（~1KB 极小）；**不加** three.js / hakozume 其他 script；**不加** hakozume-root DOM（动态创建） |
| `js/feature-hub.js` | HUB 加"📦 装箱模拟器"入口 → `hakozumeApi.open()`（此时 hakozumeApi 是 loader 定义的空壳） |
| `js/room.js` | decideAction() 加 `propose_hakozume` 分支；taMenu() 加"和 TA 玩装箱"选项 |

**不需要修改 build.mjs**（它已经 glob 复制 js/ 和 vendor/ 目录下所有文件）。

---

## Implementation Steps

### Step 1：下载 three.min.js r145 到 vendor/

从 CDN `https://cdn.jsdelivr.net/npm/three@0.145.0/build/three.min.js` 下载到 `d:\mochi-x-main\vendor\three.min.js`（1.3MB，UMD 版本，自动暴露全局 `THREE`）。

### Step 2：拆分源码 — hakozume-engine.js（IIFE，纯函数，依赖全局 THREE）

从源文件 L521-L1458 提取，保持原样，用 IIFE 包一层暴露全局：

```js
(function() {
  // ... 全部四元数、向量、makeDims、limbDirs、buildBody、碰撞、自碰撞、
  //     权重、evalPose/evalParts/boxViol、种子生成 familySeeds/sitGene/rotateSeed/recenterPair、
  //     solveGen generator + anneal + settleDown + solveArms + makeCtx + famRoleSeeds
  
  window.FAMILIES = FAMILIES;
  window.STAND_FAMS = STAND_FAMS;
  window.SYM_FAMS = SYM_FAMS;
  window.solveGen = solveGen;
  window.makeDims = makeDims;
})();
```

### Step 3：拆分源码 — hakozume-render.js（IIFE，依赖 THREE + engine 全局）

从源文件 L346-L520 + L1461-L1610 + animate（L1836-L1950）提取：

```js
(function() {
  // ... initThree() / createMannequin() / preparePerson() / buildBox() / applyPose()
  //     addJoint() / setupPivot() / aimLimb() / aimHead()
  //     animate() / disposeThree() + 鼠标拖动 / 滚轮缩放
  
  window.hzRenderer = { /* scene/camera/renderer/walkGroup/boxGroup/clock/personA/personB */ };
})();
```

### Step 4：拆分源码 — hakozume-panel.js（IIFE，依赖 THREE + render + engine 全局）

从源文件 L1566-L1835 + L1950-L2035 提取：

```js
(function() {
  // ... updateScene() / startSolve() / stepScan() / reroll() / swapAB()
  //     switchView() / onPoseSelect() / onBoxTypeChange() / togglePanel()
  //     readBoxSettings() / renderInfo() / refreshPoseOptions() / syncPoseSelect()
  //     localStorage 自动保存逻辑
  //
  // 动态创建 hakozume-root DOM + 参数面板 HTML + Canvas 容器 + 关闭按钮
  // （面板 HTML 从源 L188-L314 提取，改为 JS 动态 insert）
  
  window.hzPanel = {
    visible: false,
    open: function(params) { /* 创建 DOM + initThree + updateScene */ },
    close: function() { /* disposeThree + 隐藏 DOM */ },
    reroll: function() { variantSeed++; updateScene(); },
    refresh: function() { updateScene(); },
    setParams: function(p) { /* 同步 A/B 参数到 panel DOM 输入框 + updateScene */ }
  };
})();
```

hakozume 参数面板 HTML **不写死**在 template.html，而是在 `hzPanel.open()` 里用 `innerHTML` 动态插入（从源 L188-L314 提取的 HTML 字符串）。

### Step 5：构建动态加载基础设施 — hakozume-loader.js（唯一同步脚本，~1KB）

```js
// ===== 按序加载 JS 工具 =====
async function loadSequentialScripts(urls) {
  for (const url of urls) {
    if (document.querySelector(`script[src="${url}"]`)) continue; // 已加载跳过
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.onerror = reject;
      s.onload = resolve;
      document.head.appendChild(s);
    });
  }
}

// ===== 轻量 CSS 按需加载 =====
function loadCssOnce(url) {
  if (document.querySelector(`link[href="${url}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = url;
  document.head.appendChild(l);
}

// ===== 加载状态（单例 Promise 防重复加载） =====
let _loadedPromise = null;
async function ensureLoaded() {
  if (window.hzPanel) return true;          // 已加载
  if (_loadedPromise) return _loadedPromise; // 加载中
  
  _loadedPromise = (async () => {
    // 顺序很重要：three → engine → render → panel
    await loadSequentialScripts([
      'vendor/three.min.js',
      'js/hakozume-engine.js',
      'js/hakozume-render.js',
      'js/hakozume-panel.js',
    ]);
    loadCssOnce('css/hakozume.css');
    return true;
  })();
  return _loadedPromise;
}

// ===== mochi-x 暴露的唯一接口 =====
window.hakozumeApi = {
  async open(taProfile) {
    await ensureLoaded();
    // 从 mochi-x TA 档案填充 A 组（如果提供）
    if (taProfile) hzPanel.setParams({ nameA: taProfile.name, genderA: taProfile.gender, heightA: taProfile.height, colorA: taProfile.color });
    hzPanel.open();
  },
  close() { window.hzPanel && hzPanel.close(); },
  async reroll() { await ensureLoaded(); hzPanel.reroll(); },
  async refresh() { await ensureLoaded(); hzPanel.refresh(); },
  get loaded() { return !!window.hzPanel; }
};
```

**这个文件只有 ~1KB，写死在 index.html 尾部 defer 加载**，但本身不依赖 three.js 或 hakozume 任何模块。

### Step 6：在 index.html / src/template.html 里只加一行

```html
<script defer src="js/hakozume-loader.js" onerror="window.__mochiExtFail=(window.__mochiExtFail||[]).concat('hakozume-loader.js')"></script>
```

**不加** three.min.js / engine / render / panel 的 script 标签。
**不加** hakozume-root DOM（hzPanel.open() 里动态创建）。

### Step 7：Room.js 集成 — TA 主动提议

在 `js/room.js` 的 `decideAction()` 里加新行为（和其他权重并列）：

```js
// 新增权重项
{ type: 'propose_hakozume', weight: 3 }  // 最低档，低于 idle=20/walk=15/sit=15

// 新增动作执行分支
case 'propose_hakozume':
  if (!window.hakozumeApi || hakozumeApi.loaded === false) break;  // 还没加载过就跳过
  if (taBusy() || modalBusy()) break;
  if (Date.now() - lastHakozumeProposal < 10 * 60 * 1000) break;   // 10 分钟冷却
  
  // 1. TA 说话提议
  const line = pickLine(['要不要一起玩装箱模拟器？', '来玩体型差模拟器吧？', '想看我们装在箱子里的样子…']);
  sayLine(line);
  // 2. 弹出确认弹窗
  setTimeout(() => {
    window.openModal({
      title: '📦 ' + taName + ' 想玩装箱模拟器',
      content: `<p>${taName} 提议玩装箱模拟器，一起看看你们在箱子里的姿势吧！</p>`,
      buttons: [
        { text: '好啊 ✨', primary: true, onClick: () => {
          const ta = readTaBodyProfile();
          hakozumeApi.open(ta);
        }},
        { text: '下次吧' }
      ]
    });
  }, 1500);
  lastHakozumeProposal = Date.now();
  break;
```

权重分配：`propose_hakozume` 权重 3（idle=20 / walk=15 / sit=15 / propose_hakozume=3 / plant=3 / near=3）。

TA 菜单 `taMenu()` 加一项：
```js
{ label: '📦 和 TA 玩装箱', action: () => {
  const ta = readTaBodyProfile();
  hakozumeApi.open(ta);
}}
```

**注意**：room.js 里 `hakozumeApi` 可能还没加载（因为 loader 只是空壳），但 room.js 不需要等 hakozumeApi.loaded —— `hakozumeApi.open()` 内部会 await ensureLoaded()。

### Step 8：TA 主动触发 "换姿势"

当 `hzPanel.visible === true` 时，TA 可能在 hakozume 打开期间想换姿势：

```js
case 'propose_hakozume_reroll':
  if (!hakozumeApi.loaded || !hzPanel.visible) break;
  if (Math.random() < 0.15) {  // 打开期间有 15% 概率触发
    sayLine(['换个姿势试试？', '这个觉得不太舒服…', '我想动动']);
    setTimeout(() => hzPanel.reroll(), 1000);
    lastHakozumeReroll = Date.now();
  }
  break;
```

### Step 9：Feature Hub 注册

```js
// js/feature-hub.js 在"互动与心意"分类下加
{ name: '📦 装箱模拟器', emoji: '📦', desc: '模拟你们在箱子里的姿势',
  keywords: ['装箱','体型','身高差','姿势'],
  action: () => {
    const ta = typeof readTaBodyProfile === 'function' ? readTaBodyProfile() : null;
    hakozumeApi.open(ta);
  }
}
```

### Step 10：TA 身体档案设置 + readTaBodyProfile() 实现

两种进入方式：
- Room → TA 菜单 → "TA 的身体档案"
- Feature Hub → 个人化设置区

设置内容：TA 名字（默认 room.js TA 称呼）/ 性别（男/女/跟随用户）/ 身高 cm / 颜色 picker。
存储：`store.set('ta-body-profile', profile)`（mochi-x 现有 store）。

`readTaBodyProfile()` 工具函数：
```js
window.readTaBodyProfile = () => {
  const p = store.get('ta-body-profile') || {};
  return {
    name: p.name || 'TA',
    gender: p.gender || 'male',
    height: p.height || 175,
    color: p.color || '#FF6B6B'
  };
};
```

### Step 11：hakozume.css 深色模式适配

从源 L7-L186 提取面板样式，适配 mochi-x：

```css
/* 基础色用 CSS 变量 */
.hz-panel { background: rgba(255,255,255,0.95); }
.group-a { background: #fff5f0; border-color: #ffe0d0; }
.group-b { background: #f0f7ff; border-color: #d0e7ff; }

/* 深色模式 */
[data-theme="dark"] .hz-panel { background: rgba(24,24,28,0.95); }
[data-theme="dark"] .group-a { background: #2a1a15; border-color: #5a3a2a; }
[data-theme="dark"] .group-b { background: #1a2028; border-color: #2a3a50; }
[data-theme="dark"] input, [data-theme="dark"] select { background: #1f1f24; color: #e0e0e0; border-color: #444; }
[data-theme="dark"] .hz-info-box { background: #1a1a1e; border-color: #333; }

/* Canvas 背景跟随深浅 */
[data-theme="dark"] #hakozume-root { background: #12121a; }
```

hakozume 源的场景地面默认白色，深色模式下 canvas 背景改深色，THREE.js scene.background 跟随切换。

---

## Dependencies and Considerations

- **THREE.js 延迟加载**：第一次 open() 才开始加载 ~1.3MB three.min.js。用户第一次等 ~1-3s（浏览器缓存后后续 <100ms）。之后保持 window.THREE 常驻，不重复加载。
- **hakozume 模块加载一次**：engine/render/panel 也只加载一次，之后常驻 window（THREE + 3 个模块 ≈ ~2.1MB 常驻）。
- **room.js / feature-hub.js 与 loader 的依赖**：它们只依赖 loader 暴露的空壳 `hakozumeApi`（同步存在），不依赖 three.js。room.js 里 `hakozumeApi.open()` 内部 await ensureLoaded() 处理真正加载。
- **hakozume 关闭后 WebGL context 释放**：close() 里调 `hzRenderer.disposeThree()`（renderer.dispose + geometry/material/texture dispose + canvas.remove）。再次 open() 时 hzPanel.open() 重新 initThree()。
- **THREE.js 版本**：r145（UMD，全局 THREE），不升级。
- **localStorage 独立存储**：hakozume 的 PAGE_KEY/PROFILE_KEY 保持独立 localStorage，不写入 mochi-x store schema，避免污染。
- **DOM 动态创建的好处**：hakozume-root 和参数面板 HTML 不写死在 template.html，减少主 HTML 体积（hakozume 面板 HTML ~12KB）。
- **模板参数**：source 里的 `variantSeed`、`diceAuto`、`rerollPending` 等全局状态保持原样（IIFE 内部），通过 window.hzPanel.reroll() 等方法对外暴露。

---

## Validation

1. **首屏体积**：index.html 加载后，three.js + hakozume 全部脚本都不加载，首屏 JS 体积不变（只有 ~1KB loader 新增）
2. **首次点击延迟**：第一次点"和 TA 玩装箱" → 显示 loading 状态 → 1-3s 后出现 3D 场景（three.min.js 下载 + 模块执行 + 求解器初始化）
3. **二次打开**：点关闭再打开 → 立即出现（three + hakozume 已在 window 上）
4. **3D 渲染**：两人偶正确显示，箱子 auto/manual 尺寸工作，盖子开关
5. **姿势求解**：auto 模式几秒内出姿势，手动选择 → 正确渲染
6. **🎲 换姿势**：每次都换一个新姿势（variantSeed++ + rerollPending 生效）
7. **TA 主动提议**：room 里等 1-5 分钟 → TA 说话 → openModal 弹窗 → 确认 → open()
8. **TA 换姿势**：hakozume 打开期间有概率触发 TA "换个姿势试试？" → reroll()
9. **关开不崩**：关闭 → WebGL context 释放；打开 → 重新 initThree；无泄漏
10. **深色模式**：面板背景/按钮/info box 正确深色；Canvas 背景跟随
11. **手机竖屏**：面板自动折叠适配（源已有 mobile CSS）
12. **无 CDN 依赖**：断网时 three.js 仍能加载（vendor 本地）
13. **构建产物**：node build.mjs → src/ 目录包含 hakozume-loader.js + vendor/three.min.js + 3 个 hakozume 模块

---

## Risks

| 风险 | 处理 |
|---|---|
| 动态 script 加载顺序错乱导致 THREE undefined | loadSequentialScripts 用 await 严格串行；加载完成才暴露 hzPanel；ensureLoaded Promise 单例防并发 |
| three.min.js 下载失败（离线/网络） | loader 加 onerror → hakozumeApi.open() 弹出"下载 three.js 失败"提示；不影响 mochi-x 其他功能 |
| 三文件拆分后模块全局变量引用丢失 | 每个文件 IIFE 开头 `window.THREE` 检查；拆分前先在源里标记全局依赖（THREE / FAMILIES / solveGen / hzRenderer 等） |
| 模拟退火求解器耗时过长 | 源已用 generator yield 做渐进求解；移植后保持；超时显示"🔄 搜索中…" |
| THREE.js dispose 不彻底 | close() 调 disposeThree()；Chrome devtools 验证 WebGL context 数量 |
| Room.js decideAction() 加 propose_hakozume 打破概率平衡 | 先加权重 3（最低档），支持 store 配置开关 |
| hakozume 面板样式污染 mochi-x | hakozume-root 内部 CSS 全部用 `.hz-` 前缀作用域隔离 |
| hakozume 模块常驻 window 内存 | 模块总体 ~100KB（除 three 1.3MB），常驻可接受；如果要省内存可加 unload() 接口 |
| `readTaBodyProfile()` room.js 里同步调用但 store 可能是 IndexedDB | room.js 已同步使用 store.get()（IDB 已预热），实测是同步返回值 |
