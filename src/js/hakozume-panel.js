(function() {
'use strict';

// ===== 依赖检查 =====
if (typeof THREE === 'undefined') {
  console.error('hakozume-panel: THREE.js not loaded');
  return;
}
if (!window.createMannequin || !window.FAMILIES) {
  console.error('hakozume-panel: engine not loaded');
  return;
}

// ===== DOM 创建 =====
// panel.js 原始代码假设 DOM 已存在（document.getElementById('nameA') 等）
// 我们需要先构建 DOM 再执行原始代码
const _panelHTML = `
<div id="hakozume-root" style="display:none;position:fixed;inset:0;z-index:9999;background:white;">
  <div id="canvas-container"></div>
  <div id="ui-panel">
    <div class="panel-header" onclick="togglePanel()">
      <h1 class="app-title">📦装箱模拟器</h1>
      <span id="toggle-text">收起</span>
    </div>
    <div id="ui-content">
      <p class="app-description">可以模拟装箱的场景。姿势会自动优化。</p>
      <div class="input-group group-a">
        <div class="section-header"><strong>A</strong></div>
        <div class="input-row">
          <div class="input-item"><span class="hint">名字</span><input type="text" id="nameA" placeholder="名字A" oninput="updateScene()"></div>
          <div class="input-item" style="flex: 0.6;"><span class="hint">性别</span><select id="genderA" onchange="updateScene()"><option value="male">男</option><option value="female" selected>女</option></select></div>
        </div>
        <div class="input-row">
          <div class="input-item"><span class="hint">身高 (cm)</span><input type="number" id="heightA" value="158.0" step="0.1" oninput="updateScene()"></div>
          <div class="input-item" style="flex: 0.35;"><span class="hint">颜色</span><input type="color" id="colorA" class="color-picker" value="#ffcc99" oninput="updateScene()"></div>
        </div>
        <div class="input-row">
          <button class="switch-btn hz-save-ta" id="hz-save-ta" onclick="saveTaProfile()">💾 记住 TA 的身体数据</button>
        </div>
      </div>
      <div class="input-group group-b">
        <div class="section-header"><strong>B</strong></div>
        <div class="input-row">
          <div class="input-item"><span class="hint">名字</span><input type="text" id="nameB" placeholder="名字B" oninput="updateScene()"></div>
          <div class="input-item" style="flex: 0.6;"><span class="hint">性别</span><select id="genderB" onchange="updateScene()"><option value="male" selected>男</option><option value="female">女</option></select></div>
        </div>
        <div class="input-row">
          <div class="input-item"><span class="hint">身高 (cm)</span><input type="number" id="heightB" value="171.5" step="0.1" oninput="updateScene()"></div>
          <div class="input-item" style="flex: 0.35;"><span class="hint">颜色</span><input type="color" id="colorB" class="color-picker" value="#ffad60" oninput="updateScene()"></div>
        </div>
      </div>
      <div class="input-group group-layout">
        <div class="section-header"><strong>📦 箱子</strong></div>
        <div class="input-item">
          <span class="hint">箱子类型</span>
          <div class="radio-switch">
            <input type="radio" name="boxType" id="boxTypeBox" value="box" checked onchange="onBoxTypeChange()"><label for="boxTypeBox">📦 箱子</label>
            <input type="radio" name="boxType" id="boxTypeLocker" value="locker" onchange="onBoxTypeChange()"><label for="boxTypeLocker">🧹 清洁柜</label>
          </div>
        </div>
        <div class="input-item">
          <span class="hint">箱子尺寸</span>
          <div class="radio-switch">
            <input type="radio" name="boxMode" id="boxModeAuto" value="auto" checked onchange="updateScene()"><label for="boxModeAuto">自动</label>
            <input type="radio" name="boxMode" id="boxModeManual" value="manual" onchange="updateScene()"><label for="boxModeManual">手动</label>
          </div>
        </div>
        <div class="input-row" id="boxManual" style="display:none;">
          <div class="input-item"><span class="hint">幅 (cm)</span><input type="number" id="boxW" value="90" step="1" oninput="updateScene()"></div>
          <div class="input-item"><span class="hint">奥行 (cm)</span><input type="number" id="boxD" value="90" step="1" oninput="updateScene()"></div>
          <div class="input-item"><span class="hint">高度 (cm)</span><input type="number" id="boxH" value="100" step="1" oninput="updateScene()"></div>
        </div>
        <div class="input-item">
          <span class="hint">盖子</span>
          <div class="radio-switch">
            <input type="radio" name="lidMode" id="lidOff" value="off" checked onchange="updateScene()"><label for="lidOff">不加盖</label>
            <input type="radio" name="lidMode" id="lidOn" value="on" onchange="updateScene()"><label for="lidOn">加盖</label>
          </div>
        </div>
        <div class="input-item">
          <span class="hint">姿势</span>
          <select id="poseFamily" onchange="onPoseSelect()">
            <option value="auto" selected>自动推荐</option>
          </select>
        </div>
        <button class="switch-btn" onclick="reroll()">🎲 换个姿势</button>
      </div>
      <div style="padding: 0 5px;">
        <button class="switch-btn swap-btn" onclick="swapAB()">⇄ 交换 A 与 B</button>
        <button class="switch-btn" onclick="switchView()">🔄 切换视角</button>
      </div>
      <div id="info-container"><div class="info-box" id="info"></div></div>
    </div>
  </div>
  <button id="hz-close-btn" style="position:absolute;top:10px;right:10px;z-index:1000;width:36px;height:36px;border-radius:50%;border:none;background:rgba(0,0,0,0.7);color:white;font-size:20px;cursor:pointer;line-height:1;">✕</button>
  <div id="view-label">第三人称视角</div>
  <div id="crosshair" style="display:none;"></div>
</div>
`;

// 把 DOM 插入 body
function _ensureDOM() {
  if (document.getElementById('hakozume-root')) return;
  const div = document.createElement('div');
  div.innerHTML = _panelHTML;
  document.body.appendChild(div.firstElementChild);
  document.getElementById('hz-close-btn').addEventListener('click', () => window.hzPanel.close());
}

_ensureDOM();

// ===== 包装 togglePanel (原始代码里定义) =====
function togglePanel() {
  const panel = document.getElementById('ui-panel');
  if (!panel) return;
  panel.classList.toggle('collapsed');
  const text = document.getElementById('toggle-text');
  if (text) text.textContent = panel.classList.contains('collapsed') ? '展开' : '收起';
}

// ===== 跨文件导出 =====
// engine.js 是另一个独立 IIFE，init() 里只能经由 window 调这些函数；
// 面板 HTML 的内联 oninput/onchange/onclick 同样在全局作用域求值。
// 必须放顶层导出（而不是等 init() 里挂），这样 init 失败时控件也不会全哑。
Object.assign(window, {
  togglePanel: togglePanel,
  setupControls: setupControls,
  updateScene: updateScene,
  switchView: switchView,
  shareToX: shareToX,
  reroll: reroll,
  onPoseSelect: onPoseSelect,
  onBoxTypeChange: onBoxTypeChange,
  animate: animate,
  stepSolver: stepSolver,
  stepScan: stepScan,
  renderInfo: renderInfo,
  saveTaProfile: saveTaProfile
});

// ===== 记住 TA 的身体数据 =====
// A 组语义就是 TA：写入当前联系人的 ta-body-profile（与 loader 的 readTaBodyProfile
// 同一存储键），下次进入自动带出；按联系人隔离，不碰联系人姓名/称呼键。
function taProfileStore() {
  try {
    if (typeof window.activeStore === 'function') {
      const s = window.activeStore();
      if (s && typeof s.set === 'function') return s;
    }
    if (typeof window.xyStore === 'function') {
      const s = window.xyStore('xy-home-v2');
      if (s && typeof s.set === 'function') return s;
    }
  } catch (e) {}
  return null;
}

function markTaSaved(saved) {
  const btn = document.getElementById('hz-save-ta');
  if (!btn) return;
  btn.textContent = saved ? '✅ 已记住 TA 的身体数据' : '💾 记住 TA 的身体数据';
  btn.classList.toggle('is-saved', !!saved);
}

function saveTaProfile() {
  try {
    const s = taProfileStore();
    if (!s) { if (window.toast) window.toast('当前环境无法保存'); return; }
    // xyStore 按字符串存取（localStorage.setItem(key, v) 不做序列化）——直接传对象
    // 会存成 "[object Object]"，刷新后读回来解析不出来，档案等于没保存。
    s.set('ta-body-profile', JSON.stringify({
      name: document.getElementById('nameA').value || 'TA',
      gender: document.getElementById('genderA').value || 'male',
      height: parseFloat(document.getElementById('heightA').value) || 175,
      color: document.getElementById('colorA').value || '#FF6B6B'
    }));
    markTaSaved(true);
    if (window.toast) window.toast('已记住 TA 的身体数据');
  } catch (e) {
    console.error('保存 TA 身体数据失败:', e);
    if (window.toast) window.toast('保存失败，请重试');
  }
}

// ===== 原始 panel 代码 =====
function addJoint(anchor) {
    const mesh = anchor.children[0];
    const half = mesh.geometry.parameters.height / 2;
    mesh.scale.y = 0.5;
    mesh.position.y = -half / 2;
    const joint = new THREE.Group();
    joint.position.y = -half;
    const lower = new THREE.Mesh(mesh.geometry, mesh.material);
    lower.scale.y = 0.5;
    lower.position.y = -half / 2;
    joint.add(lower);
    anchor.add(joint);
    anchor.joint = joint;
    anchor.half = half;
}

// 把朝正下方的棍子转向 dir 的方向（旋转顺序 XYZ）
function aim(node, dir) {
    const d = dir.clone().normalize();
    node.rotation.z = Math.asin(Math.max(-1, Math.min(1, d.x)));
    node.rotation.x = Math.atan2(-d.z, -d.y);
}

// dirUpper/dirLower 为 anchor 父级坐标系中的朝向
function aimLimb(anchor, dirUpper, dirLower) {
    aim(anchor, dirUpper);
    const inv = anchor.quaternion.clone().invert();
    aim(anchor.joint, dirLower.clone().applyQuaternion(inv));
}

// 让上半身（头・颈・躯干・手臂）能以腰为轴自由弯曲（不含名字标签）
function setupPivot(p) {
    const pivot = new THREE.Group();
    pivot.position.y = p.userData.legH;
    const upper = p.children.filter(c => !p.legs.includes(c) && c !== p.nameTag);
    upper.forEach(c => { p.remove(c); c.position.y -= p.userData.legH; pivot.add(c); });
    p.add(pivot);
    p.pivot = pivot;
    p.headParts.rotation.order = 'YXZ';
}

// 把求解器的结果（身体角度）反映到人偶上
function applyPose(p, g, arm, ana) {
    const Rr = rootQ(g), Rs = spineQ(g);
    p.quaternion.set(Rr[0], Rr[1], Rr[2], Rr[3]);
    const off = qRot(Rr, [0, p.userData.legH, 0]);
    p.position.set(g[0] - off[0], g[1] - off[1], g[2] - off[2]);
    p.pivot.quaternion.set(Rs[0], Rs[1], Rs[2], Rs[3]);
    for (let i = 0; i < 2; i++) {
        const dl = limbDirsLeg(g, i, ana);
        aimLimb(p.legs[i], new THREE.Vector3(dl.dU[0], dl.dU[1], dl.dU[2]), new THREE.Vector3(dl.dL[0], dl.dL[1], dl.dL[2]));
        const da = limbDirsArm(arm, i);
        aimLimb(p.arms[i], new THREE.Vector3(da.dU[0], da.dU[1], da.dU[2]), new THREE.Vector3(da.dL[0], da.dL[1], da.dL[2]));
    }
}

// 颈部朝向：看向对方的脸。但限于颈部可转动范围（左右约 70°・下约 50°・上约 45°）
function aimHead(p, targetWorld) {
    const head = p.headParts;
    p.pivot.updateWorldMatrix(true, false);
    const v = p.pivot.worldToLocal(targetWorld.clone()).sub(head.position);
    const l = v.length() || 1;
    const yaw = Math.max(-1.2, Math.min(1.2, Math.atan2(v.x, v.z)));
    const pitch = Math.max(-0.9, Math.min(0.8, Math.asin(Math.max(-1, Math.min(1, v.y / l)))));
    head.rotation.set(-pitch, yaw, 0, 'YXZ');
}

// 创建透明箱子（第一人称视角时把墙壁・地面・盖子设为不透明，避免透视到外面）
function buildBox(b, lid) {
    while (boxGroup.children.length) {
        const c = boxGroup.children[0];
        boxGroup.remove(c);
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
    }
    const opaque = currentView !== '3rd';
    const W = b.W, D = b.D, H = b.H;
    const locker = !!b.locker;
    // 普通箱子为浅蓝色，清洁柜为偏灰的薄荷绿
    const pal = locker
        ? { base: 0x8fb5a0, floor: 0xa9c9b8, front: 0xd3e6db, side: 0xc2dccd, lid: 0xe2f0e8, edge: 0x4f8a6c }
        : { base: 0x8fc1ee, floor: 0xa9cdee, front: 0xd3e6f8, side: 0xc2daf3, lid: 0xe2effb, edge: 0x4a90d9 };
    const face = (w, h, op, solidColor) => new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        opaque
            ? new THREE.MeshBasicMaterial({ color: solidColor, side: THREE.DoubleSide })
            : new THREE.MeshBasicMaterial({ color: pal.base, transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false })
    );
    const floor = face(W, D, 0.2, pal.floor); floor.rotation.x = -Math.PI / 2; floor.position.y = 0.002; boxGroup.add(floor);
    const wallF = face(W, H, 0.1, pal.front); wallF.position.set(0, H / 2, D / 2); boxGroup.add(wallF);
    const wallB = face(W, H, 0.1, pal.front); wallB.position.set(0, H / 2, -D / 2); boxGroup.add(wallB);
    const wallL = face(D, H, 0.1, pal.side); wallL.rotation.y = Math.PI / 2; wallL.position.set(-W / 2, H / 2, 0); boxGroup.add(wallL);
    const wallR = face(D, H, 0.1, pal.side); wallR.rotation.y = Math.PI / 2; wallR.position.set(W / 2, H / 2, 0); boxGroup.add(wallR);
    if (lid) { const top = face(W, D, 0.1, pal.lid); top.rotation.x = -Math.PI / 2; top.position.y = H; boxGroup.add(top); }
    const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(W, H, D)),
        new THREE.LineBasicMaterial({ color: pal.edge })
    );
    edges.position.y = H / 2;
    boxGroup.add(edges);
}

// 准备人偶（做出可弯曲上半身的轴和肘・膝关节）
function preparePerson(p) {
    setupPivot(p);
    p.arms.forEach(arm => addJoint(arm));
    p.legs.forEach(leg => addJoint(leg));
}

function readBoxSettings() {
    const auto = document.getElementById('boxModeAuto').checked;
    const num = (id, def) => Math.max(30, parseFloat(document.getElementById(id).value) || def) * 0.01;
    return {
        auto: auto,
        W: num('boxW', 90), D: num('boxD', 90), H: num('boxH', 100),
        lid: document.getElementById('lidOn').checked,
        locker: document.getElementById('boxTypeLocker').checked,
        family: diceAuto ? 'auto' : document.getElementById('poseFamily').value
    };
}

// 把解应用到人偶与箱子上
function applyResult(res) {
    applyPose(personA, res.gA, res.aA, res.ana);
    applyPose(personB, res.gB, res.aB, res.ana);
    currentBox = res.box;
}

// 解算出之前的临时姿势
function applyProvisional(hA, gA, hB, gB, bs) {
    if (lastResult) { applyResult(lastResult); return; }
    const dA = makeDims(hA, gA), dB = makeDims(hB, gB);
    const seed = familySeeds(dA, dB, 'between')[0];
    applyPose(personA, seed[0], Float64Array.from(ARM_NEUTRAL), true);
    applyPose(personB, seed[1], Float64Array.from(ARM_NEUTRAL), true);
    currentBox = bs.auto ? (bs.locker ? { W: 0.5, D: 0.5, H: 1.9, locker: true } : { W: 0.9, D: 0.9, H: 1.1, locker: false })
                         : { W: bs.W, D: bs.D, H: bs.H, locker: bs.locker };
}

function startSolve(key, o) {
    const token = ++solveToken;
    pendingKey = key;
    solving = true;
    solverRun = null;
    clearTimeout(solverTimer);
    solverTimer = setTimeout(() => {
        if (token !== solveToken) return;
        solverRun = { gen: solveGen(o), key: key, token: token };
    }, 220);
}

// 在主计算结束后，于后台调查各姿势在此身高・箱子下是否成立
function stepScan() {
    if (!scanRun && scanParams && !solving) {
        scanRun = { gen: solveGen(Object.assign({}, scanParams, { scanOnly: true, family: 'auto', evals: 900, seed: 1 })), key: scanParams.key };
    }
    if (!scanRun) return;
    const t0 = performance.now();
    try {
        while (performance.now() - t0 < 6) {
            const st = scanRun.gen.next();
            if (st.done) {
                const run = scanRun;
                scanRun = null;
                if (scanParams && run.key === scanParams.key) {
                    scanDoneKey = run.key;
                    scanParams = null;
                    applyFamilyAvailability(st.value.scan);
                }
                break;
            }
        }
    } catch (err) {
        console.error(err);
        scanRun = null; scanParams = null;
    }
}

// 根据箱子类型（箱子／储物柜）以及“此身高是否成立”来分别展示姿势选项
function refreshPoseOptions(scan) {
    const sel = document.getElementById('poseFamily');
    const kind = document.getElementById('boxTypeLocker').checked ? 'locker' : 'box';
    let lost = false;
    for (const opt of sel.options) {
        if (opt.value === 'auto') continue;
        const optKind = opt.dataset.kind || 'box';
        if (optKind !== kind) {
            opt.disabled = true; opt.hidden = true;
            if (sel.value === opt.value) lost = true;
            continue;
        }
        const shown = diceAuto && lastResult && lastResult.fam === opt.value;   // 保留 🎲 抽出来的姿势
        const ok = shown || !scan || !scan[opt.value] || scan[opt.value].ok;
        opt.disabled = !ok;
        opt.hidden = !ok;
        opt.textContent = FAMILY_NAMES[opt.value] + (ok ? '' : '（这个身高不可行）');
        if (!ok && sel.value === opt.value) lost = true;
    }
    return lost;
}

// 移除不成立的姿势选项（若当前选中项被移除，则回到“自动推荐”）
function applyFamilyAvailability(scan) {
    lastScan = scan;
    const lost = refreshPoseOptions(scan);
    if (lost) { diceAuto = false; document.getElementById('poseFamily').value = 'auto'; updateScene(); }
}

function stepSolver() {
    if (!solverRun) { stepScan(); return; }
    const t0 = performance.now();
    try {
        while (performance.now() - t0 < 10) {
            const s = solverRun.gen.next();
            if (s.done) {
                const run = solverRun;
                solverRun = null;
                if (run.token === solveToken) {
                    lastResult = s.value;
                    lastKey = run.key;
                    pendingKey = '';
                    solving = false;
                    applyResult(lastResult);
                    buildBox(currentBox, readBoxSettings().lid);
                    syncPoseSelect();
                    renderInfo();
                }
                break;
            }
        }
    } catch (err) {
        console.error(err);
        solverRun = null;
        solving = false;
        renderInfo();
    }
}

function reroll() {
    variantSeed++;
    diceAuto = true;        // 无视当前选中的姿势，从全部姿势中另找一个
    rerollPending = true;   // 只有 🎲 时才更容易选中与当前不同的模板
    updateScene();
}

// 切换箱子类型（箱子／清洁柜）时：切换尺寸初始值・相机距离・姿势候选
function onBoxTypeChange() {
    const locker = document.getElementById('boxTypeLocker').checked;
    const from = locker ? BOX_DEFAULT : LOCKER_DEFAULT, to = locker ? LOCKER_DEFAULT : BOX_DEFAULT;
    // 若手动尺寸仍是旧类型的初始值，则替换为新类型的初始值（用户自行修改的值会保留）
    const ids = [['boxW', 'W'], ['boxD', 'D'], ['boxH', 'H']];
    const untouched = ids.every(([id, k]) => parseFloat(document.getElementById(id).value) === from[k]);
    if (untouched) ids.forEach(([id, k]) => { document.getElementById(id).value = to[k]; });
    camDist = locker ? 3.6 : 2.4;
    diceAuto = false;
    document.getElementById('poseFamily').value = 'auto';
    lastScan = null;
    updateScene();
}

// 手动选择姿势栏时：固定为该模板并重新搜索
function onPoseSelect() {
    diceAuto = false;
    updateScene();
}

// 把 🎲 找到的姿势反映到姿势栏上
function syncPoseSelect() {
    if (!diceAuto || !lastResult) return;
    const sel = document.getElementById('poseFamily');
    for (const opt of sel.options) {
        if (opt.value === lastResult.fam) {
            opt.hidden = false; opt.disabled = false;
            opt.textContent = FAMILY_NAMES[opt.value];
            sel.value = opt.value;
            break;
        }
    }
}

function renderInfo() {
    const hA = parseFloat(document.getElementById('heightA').value) || 158;
    const hB = parseFloat(document.getElementById('heightB').value) || 171.5;
    let pose = '', size = '';
    if (solving) {
        pose = '🔄 搜索中…';
    } else if (lastResult) {
        pose = FAMILY_NAMES[lastResult.fam] || '';
    }
    if (lastResult) {
        size = `${(currentBox.W * 100).toFixed(0)} × ${(currentBox.D * 100).toFixed(0)} × ${(currentBox.H * 100).toFixed(0)}`;
    }
    document.getElementById('info').innerHTML = `
        <div class="info-row">
            <span class="info-label">📏 身高差</span>
            <span class="info-value">${Math.abs(hA-hB).toFixed(1)}<span class="unit">cm</span></span>
        </div>
        <div class="info-row">
            <span class="info-label">${readBoxSettings().locker ? '🧹 储物柜内尺寸' : '📦 箱子内尺寸'}</span>
            <span class="info-value" style="font-size:15px;">${size || '-'}<span class="unit">cm</span></span>
        </div>
        <div class="info-row">
            <span class="info-label">🧍 姿势</span>
            <span class="info-value" style="font-size:13px;">${pose || '-'}</span>
        </div>
    `;
}

function updateScene() {
    const hA = parseFloat(document.getElementById('heightA').value)||158;
    const hB = parseFloat(document.getElementById('heightB').value)||171.5;
    const gA = document.getElementById('genderA').value;
    const gB = document.getElementById('genderB').value;
    const bs = readBoxSettings();
    document.getElementById('boxManual').style.display = bs.auto ? 'none' : 'flex';
    // 若选中的姿势不适合箱子类型，则回到“自动推荐”，并分别展示选项
    if (refreshPoseOptions(lastScan)) { diceAuto = false; document.getElementById('poseFamily').value = 'auto'; bs.family = 'auto'; }

    [personA, personB].forEach(p => { if (p) { walkGroup.remove(p); walkGroup.remove(p.nameTag); } });
    
    personA = createMannequin(document.getElementById('colorA').value, hA, gA, document.getElementById('nameA').value, 'A', {});
    personB = createMannequin(document.getElementById('colorB').value, hB, gB, document.getElementById('nameB').value, 'B', {});
    
    // 把名字标签从人偶上分离，显示在头顶正上方
    personA.remove(personA.nameTag); personB.remove(personB.nameTag);
    preparePerson(personA);
    preparePerson(personB);

    walkGroup.add(personA, personB, personA.nameTag, personB.nameTag);

    // 身高・性别・箱子条件相同则复用上次的解，仅在变化时重新优化
    const key = [hA, gA, hB, gB, bs.auto, bs.auto ? 0 : bs.W, bs.auto ? 0 : bs.D, bs.auto ? 0 : bs.H, bs.locker, bs.family, variantSeed].join('|');
    if (lastResult && key === lastKey) {
        applyResult(lastResult);
        syncPoseSelect();
    } else if (key === pendingKey) {
        applyProvisional(hA, gA, hB, gB, bs);
    } else {
        applyProvisional(hA, gA, hB, gB, bs);
        startSolve(key, {
            heightA: hA, genderA: gA, heightB: hB, genderB: gB,
            box: { auto: bs.auto, W: bs.W, D: bs.D, H: bs.H, locker: bs.locker },
            family: bs.family, seed: variantSeed, evals: bs.family === 'auto' ? 1500 : 2200,
            avoidFam: (rerollPending && lastResult) ? lastResult.fam : null
        });
    }
    rerollPending = false;
    buildBox(currentBox, bs.lid);

    // 身高・性别・箱子变化时，重新调查可行的姿势
    const scanKey = [hA, gA, hB, gB, bs.auto, bs.auto ? 0 : bs.W, bs.auto ? 0 : bs.D, bs.auto ? 0 : bs.H, bs.locker].join('|');
    if (scanKey !== scanDoneKey && !(scanParams && scanParams.key === scanKey)) {
        scanRun = null;
        scanParams = {
            key: scanKey,
            heightA: hA, genderA: gA, heightB: hB, genderB: gB,
            box: { auto: bs.auto, W: bs.W, D: bs.D, H: bs.H, locker: bs.locker }
        };
    }

    const nA = document.getElementById('nameA').value||'A';
    const nB = document.getElementById('nameB').value||'B';

    if(currentView !== '3rd') {
        const myName = (currentView === 'A') ? nA : nB;
        document.getElementById('view-label').innerText = `${myName} 的视角`;
        if(currentView === 'A') { personA.headParts.visible = false; personA.nameTag.visible = false; }
        if(currentView === 'B') { personB.headParts.visible = false; personB.nameTag.visible = false; }
    }

    renderInfo();
}

// 渲染循环：animate() 只负责【幂等启动】，真正的每帧逻辑在 _tick 里。
// 以前是无条件 requestAnimationFrame 自递归，close() 的停止标志永远不生效 →
// 面板关了仍在满帧渲染（持续发热耗电），反复开关还会叠加多条循环。
let _animateActive = false;
let _rafId = 0;

function animate() {
    _animateActive = true;
    if (_rafId) return;                       // 已在循环中，不重复启动
    _rafId = requestAnimationFrame(_tick);
}

function stopAnimate() {
    _animateActive = false;
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = 0; }
}

function _tick() {
    _rafId = 0;
    if (!_animateActive) return;              // close() 后立刻停，不再排队
    _rafId = requestAnimationFrame(_tick);

    stepSolver();
    walkGroup.updateMatrixWorld(true);

    // 互相凝视对方的朝向（在颈部可转动范围内）
    const eyeAWorld = personA.headParts.getWorldPosition(new THREE.Vector3());
    const eyeBWorld = personB.headParts.getWorldPosition(new THREE.Vector3());
    aimHead(personB, eyeAWorld);
    aimHead(personA, eyeBWorld);

    // 名字标签放在头顶正上方
    [[personA, eyeAWorld], [personB, eyeBWorld]].forEach(([p, e]) => {
        p.nameTag.position.set(e.x, e.y + p.userData.height * 0.065 + 0.3, e.z);
    });

    const centerPos = new THREE.Vector3(0, currentBox.H * 0.5, 0);

    if (currentView === '3rd') {
        // 沿球面绕注视点旋转（可到正上方・正下方。朝向由旋转角直接指定，因此正上/正下也不会崩坏）
        camera.up.set(0, 1, 0);
        const horiz = Math.cos(rotation.x) * camDist;
        camera.position.set(
            centerPos.x + Math.sin(rotation.y) * horiz,
            centerPos.y + Math.sin(rotation.x) * camDist,
            centerPos.z + Math.cos(rotation.y) * horiz
        );
        camera.rotation.set(-rotation.x, rotation.y, 0);
    } else {
        const self = (currentView === 'A' ? personA : personB);
        camera.up.set(0, 1, 0);
        const other = (currentView === 'A' ? personB : personA);
        self.headParts.getWorldPosition(camera.position);
        // 装箱时，彼此凝视对方脸的朝向即为正面
        camera.lookAt(other.headParts.getWorldPosition(new THREE.Vector3()));

        camera.rotateY(rotation.y);
        camera.rotateX(rotation.x);
        camera.rotation.z = 0; 
    }
    renderer.render(scene, camera);
}

function setupControls() {
    const c = document.getElementById('canvas-container');
    const move = (dx, dy) => {
        rotation.y -= dx * 0.005; rotation.x -= dy * 0.005;
        // 第三人称为正上方(+90°)～正下方(-90°)
        if (currentView === '3rd') rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, rotation.x));
    };
    c.addEventListener('mousedown', () => isDragging = true);
    window.addEventListener('mouseup', () => isDragging = false);
    window.addEventListener('mousemove', e => { if(isDragging) move(e.movementX, e.movementY); });

    c.addEventListener('wheel', e => {
        if (currentView === '3rd') {
            camDist += e.deltaY * 0.002;
            camDist = Math.max(0.5, Math.min(10, camDist));
        }
    }, { passive: true });

    c.addEventListener('touchstart', e => { 
        if (e.touches.length === 1) {
            isDragging = true; 
            previousTouch = e.touches[0]; 
            initialPinchDist = null;
        } else if (e.touches.length === 2 && currentView === '3rd') {
            isDragging = false;
            initialPinchDist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
        }
    }, { passive: false });

    window.addEventListener('touchend', () => { 
        isDragging = false; 
        initialPinchDist = null;
    });

    window.addEventListener('touchmove', e => {
        if (e.touches.length === 1 && isDragging && previousTouch) {
            if (e.cancelable) e.preventDefault();
            const touch = e.touches[0];
            move(touch.clientX - previousTouch.clientX, touch.clientY - previousTouch.clientY);
            previousTouch = touch;
        } else if (e.touches.length === 2 && initialPinchDist !== null && currentView === '3rd') {
            if (e.cancelable) e.preventDefault();
            const currentDist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            const diff = currentDist - initialPinchDist;
            camDist -= diff * 0.005;
            camDist = Math.max(0.5, Math.min(10, camDist));
            initialPinchDist = currentDist;
        }
    }, { passive: false });
}

function switchView() {
    const order = ['3rd', 'A', 'B'];
    currentView = order[(order.indexOf(currentView) + 1) % 3];
    const nA = document.getElementById('nameA').value||'A';
    const nB = document.getElementById('nameB').value||'B';
    
    if (currentView === '3rd') {
        document.getElementById('view-label').innerText = '第三人称视角';
    } else {
        const myName = (currentView === 'A') ? nA : nB;
        document.getElementById('view-label').innerText = `${myName} 的视角`;
    }

    const ch = document.getElementById('crosshair');
    if (ch) ch.style.display = currentView === '3rd' ? 'none' : 'block';
    buildBox(currentBox, readBoxSettings().lid);   // 第一人称时墙壁设为不透明／第三人称时恢复透明
    personA.headParts.visible = true; personA.nameTag.visible = true;
    personB.headParts.visible = true; personB.nameTag.visible = true;
    if (currentView === 'A') { personA.headParts.visible = false; personA.nameTag.visible = false; }
    else if (currentView === 'B') { personB.headParts.visible = false; personB.nameTag.visible = false; }
    if (currentView === '3rd') { rotation.x = DEFAULT_ROT_3RD.x; rotation.y = DEFAULT_ROT_3RD.y * carrySide; }
    else { rotation.x = 0; rotation.y = 0; }
}

function shareToX() {
    const nA = document.getElementById('nameA').value || 'A';
    const nB = document.getElementById('nameB').value || 'B';
    const hA = parseFloat(document.getElementById('heightA').value) || 158.0;
    const hB = parseFloat(document.getElementById('heightB').value) || 171.5;
    const text = `${nB}（${hB.toFixed(1)}cm）和 ${nA}（${hA.toFixed(1)}cm）被装进了箱子里！\n#装箱模拟器\n`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(window.location.href)}`, '_blank');
}

/* 设置持久化 v2：本页控件刷新保留，名字・性别・身高・颜色跨模式通用 */
(function () {
  var PAGE_KEY = 'simSettings:' + location.pathname;
  var PROFILE_KEY = 'simProfileV1';
  var SKIP = { seek: 1, pVol: 1 };
  var restoring = false;
  var dirtyEls = [];
  var timer = null;

  function list() {
    var els = document.querySelectorAll('input,select,textarea'), out = [], i, el;
    for (i = 0; i < els.length; i++) {
      el = els[i];
      if (el.type === 'file' || el.type === 'button' || el.type === 'submit' || el.type === 'reset') continue;
      if (el.id && SKIP[el.id]) continue;
      out.push(el);
    }
    return out;
  }
  function classIndex(el, cn) {
    var sibs = document.querySelectorAll(el.tagName.toLowerCase() + '[class~="' + cn + '"]'), i;
    for (i = 0; i < sibs.length; i++) if (sibs[i] === el) return i;
    return -1;
  }
  function keyOf(el) {
    if (el.id) return 'id:' + el.id;
    var cn = (el.className || '').split(/\s+/)[0];
    if (!cn) return null;
    var idx = classIndex(el, cn);
    return idx < 0 ? null : 'cls:' + cn + ':' + idx;
  }
  /* 名字・性别・身高・角色颜色 → 共享档案的 A / B 槽位 */
  function slotOf(el) {
    var m, cn, idx;
    if (el.id) {
      if (/^name(Input)?A$/i.test(el.id)) return ['A', 'name'];
      if (/^name(Input)?B$/i.test(el.id)) return ['B', 'name'];
      m = /^(gender|height|color)([AB])$/i.exec(el.id);
      if (m) return [m[2].toUpperCase(), m[1].toLowerCase()];
      return null;
    }
    cn = (el.className || '').split(/\s+/)[0];
    m = /^(name|gender|height|color)-input$/.exec(cn);
    if (!m) return null;
    idx = classIndex(el, cn);
    if (idx === 0) return ['A', m[1]];
    if (idx === 1) return ['B', m[1]];
    return null;
  }
  function get(el) {
    return (el.type === 'checkbox' || el.type === 'radio') ? el.checked : el.value;
  }
  function set(el, v) {
    var i, ok;
    if (el.tagName === 'SELECT') {
      ok = false;
      for (i = 0; i < el.options.length; i++) if (el.options[i].value === v) ok = true;
      if (!ok) return;
    }
    if (el.type === 'checkbox' || el.type === 'radio') el.checked = !!v;
    else el.value = v;
  }
  function fire(el, type) {
    try { el.dispatchEvent(new Event(type, { bubbles: true })); } catch (e) {}
  }
  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function writeJSON(key, data) {
    try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) {}
  }

  function applyProfile(prof) {
    if (!prof) return;
    var els = list(), i, s;
    restoring = true;
    for (i = 0; i < els.length; i++) {
      s = slotOf(els[i]);
      if (s && prof[s[0]] && prof[s[0]][s[1]] !== undefined) set(els[i], prof[s[0]][s[1]]);
    }
    for (i = 0; i < els.length; i++) { fire(els[i], 'input'); fire(els[i], 'change'); }
    restoring = false;
    for (i = 0; i < els.length; i++) {
      s = slotOf(els[i]);
      if (s && prof[s[0]] && prof[s[0]][s[1]] !== undefined) set(els[i], prof[s[0]][s[1]]);
    }
  }

  function restore() {
    var els = list(), page = readJSON(PAGE_KEY) || {}, prof = readJSON(PROFILE_KEY) || {}, i, k, s;
    restoring = true;
    for (i = 0; i < els.length; i++) { k = keyOf(els[i]); if (k && page[k] !== undefined) set(els[i], page[k]); }
    for (i = 0; i < els.length; i++) {
      s = slotOf(els[i]);
      if (s && prof[s[0]] && prof[s[0]][s[1]] !== undefined) set(els[i], prof[s[0]][s[1]]);
    }
    for (i = 0; i < els.length; i++) { fire(els[i], 'input'); fire(els[i], 'change'); }
    restoring = false;
    /* 联动控件（如身高→手长、手长→身高）可能在派发事件时改值，这里再校正一次 */
    for (i = 0; i < els.length; i++) { k = keyOf(els[i]); if (k && page[k] !== undefined) set(els[i], page[k]); }
    for (i = 0; i < els.length; i++) {
      s = slotOf(els[i]);
      if (s && prof[s[0]] && prof[s[0]][s[1]] !== undefined) set(els[i], prof[s[0]][s[1]]);
    }
  }

  function flush() {
    var els = list(), page = {}, prof = readJSON(PROFILE_KEY) || {}, i, k, s, changed = false;
    for (i = 0; i < els.length; i++) { k = keyOf(els[i]); if (k) page[k] = get(els[i]); }
    writeJSON(PAGE_KEY, page);
    /* 只把本次真正改过的字段写进共享档案，避免用本页默认值覆盖别处设置 */
    for (i = 0; i < dirtyEls.length; i++) {
      s = slotOf(dirtyEls[i]);
      if (!s || !s[0]) continue;
      prof[s[0]] = prof[s[0]] || {};
      prof[s[0]][s[1]] = get(dirtyEls[i]);
      changed = true;
    }
    dirtyEls = [];
    if (changed) writeJSON(PROFILE_KEY, prof);
  }
  function queueSave(el) {
    if (restoring) return;
    if (el && el.tagName && dirtyEls.indexOf(el) < 0) dirtyEls.push(el);
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 200);
  }

  document.addEventListener('input', function (e) { queueSave(e.target); }, true);
  document.addEventListener('change', function (e) { queueSave(e.target); }, true);
  window.addEventListener('load', restore);
  window.addEventListener('storage', function (e) {
    if (e.key === PROFILE_KEY) applyProfile(readJSON(PROFILE_KEY));
  });
  window.__simSettings = {
    clear: function () { try { localStorage.removeItem(PAGE_KEY); } catch (e) {} },
    clearProfile: function () { try { localStorage.removeItem(PROFILE_KEY); } catch (e) {} }
  };
})();

// ===== hzPanel 对外接口 =====
let _initialized = false;

// 深色模式：3D 画布与面板底色跟随站点主题（data-theme 由 personalize.js 写在 <html>）
function applyTheme() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const root = document.getElementById('hakozume-root');
  if (root) root.style.background = dark ? '#12121a' : '#ffffff';
  if (typeof scene !== 'undefined' && scene) {
    scene.background = new THREE.Color(dark ? 0x12121a : 0xffffff);
  }
}

window.hzPanel = {
  visible: false,
  
  open: function(params) {
    _ensureDOM();
    // 如果有参数，先设置 A 组
    if (params) {
      if (params.nameA !== undefined) document.getElementById('nameA').value = params.nameA;
      if (params.genderA !== undefined) document.getElementById('genderA').value = params.genderA;
      if (params.heightA !== undefined) document.getElementById('heightA').value = params.heightA;
      if (params.colorA !== undefined) document.getElementById('colorA').value = params.colorA;
    }
    
    // 已有档案时把按钮显示成「已记住」
    try {
      const s = taProfileStore();
      markTaSaved(!!(s && typeof s.get === 'function' && s.get('ta-body-profile')));
    } catch (e) {}

    document.getElementById('hakozume-root').style.display = 'block';
    this.visible = true;
    
    if (!_initialized) {
      init();
      _initialized = true;
    } else {
      // 重新设置 canvas 尺寸 + 刷新
      onWindowResize();
      updateScene();
    }

    // 深色背景必须在 init() 之后应用：首帧前 scene 还不存在，提前设会落空
    applyTheme();
    // close() 只是暂停循环，这里幂等恢复
    animate();
  },
  
  close: function() {
    if (!this.visible) return;
    const root = document.getElementById('hakozume-root');
    if (root) root.style.display = 'none';
    this.visible = false;
    // 只暂停渲染循环，保留 renderer/canvas：频繁 dispose 再重建 WebGL 上下文
    // 在 iOS 上极易 context lost；彻底释放统一走 dispose()
    stopAnimate();
  },
  
  reroll: function() {
    if (typeof window.reroll === 'function') window.reroll();
  },
  
  refresh: function() {
    if (typeof window.updateScene === 'function') window.updateScene();
  },
  
  setParams: function(p) {
    _ensureDOM();
    let changed = false;
    if (p.nameA !== undefined && document.getElementById('nameA').value !== p.nameA) { document.getElementById('nameA').value = p.nameA; changed = true; }
    if (p.genderA !== undefined && document.getElementById('genderA').value !== p.genderA) { document.getElementById('genderA').value = p.genderA; changed = true; }
    if (p.heightA !== undefined && document.getElementById('heightA').value != p.heightA) { document.getElementById('heightA').value = p.heightA; changed = true; }
    if (p.colorA !== undefined && document.getElementById('colorA').value !== p.colorA) { document.getElementById('colorA').value = p.colorA; changed = true; }
    // 面板尚未初始化时（scene/walkGroup 还没建）只写 DOM 值，
    // 由随后的 open() → init() 读 DOM 完成首帧，避免 updateScene 崩在 undefined 上
    if (changed && _initialized && typeof window.updateScene === 'function') window.updateScene();
  },
  
  dispose: function() {
    this.close();
    stopAnimate();
    const root = document.getElementById('hakozume-root');
    if (root) root.remove();
    // 真正释放 WebGL 资源（页面卸载/彻底关闭时用；日常开关走 close 的暂停）
    if (typeof renderer !== 'undefined' && renderer) {
      try { renderer.dispose(); } catch (e) {}
      if (renderer.domElement && renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
      try { renderer = null; } catch (e) {}
    }
    _initialized = false;
  }
};

})();
