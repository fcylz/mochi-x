// ===== 装箱模拟器动态加载基础设施 =====
// 这个文件是唯一写死在 mochi-x index.html 里的脚本（<script defer src="js/hakozume-loader.js">）
// ~1KB，同步 defer 加载，不依赖 three.js 或 hakozume 任何模块

// ===== 按序加载 JS 工具 =====
// 只认「加载成功过」的 URL：以前用 script[data-hz] 节点存在即跳过，而失败的 script
// 节点会留在 DOM 里 → 点「重试」时全被当成已加载跳过，永远加载不回来（重试形同虚设）。
const _loadedUrls = new Set();
async function loadSequentialScripts(urls) {
  for (const url of urls) {
    if (_loadedUrls.has(url)) continue;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.setAttribute('data-hz', url);
      s.onerror = () => { try { s.remove(); } catch (e) {} reject(new Error('Failed to load ' + url)); };
      s.onload = () => { _loadedUrls.add(url); resolve(); };
      document.head.appendChild(s);
    });
  }
}

// ===== 轻量 CSS 按需加载 =====
function loadCssOnce(url) {
  if (document.querySelector(`link[data-hz="${url}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = url;
  l.setAttribute('data-hz', url);
  document.head.appendChild(l);
}

// ===== 加载状态（单例 Promise 防重复加载） =====
let _loadedPromise = null;
async function ensureLoaded() {
  if (window.hzPanel) return true;            // 已加载完成
  if (_loadedPromise) return _loadedPromise;  // 正在加载

  _loadedPromise = (async () => {
    try {
      // 顺序严格重要：three.js → engine → panel
      await loadSequentialScripts([
        'vendor/three.min.js',
        'js/hakozume-engine.js',
        'js/hakozume-panel.js',
      ]);
      loadCssOnce('css/hakozume.css');
      return true;
    } catch (e) {
      console.error('hakozume 加载失败:', e);
      // 清除 Promise，允许重试
      _loadedPromise = null;
      throw e;
    }
  })();
  return _loadedPromise;
}

// ===== 加载失败提示 =====
// openModal 的签名是 (标题, 正文, 回调, 选项)——这里以前传的是对象，
// 结果标题渲染成 [object Object]、正文为空、按钮配置也全部无效。
function showLoadError(detail) {
  const retry = function () {
    _loadedPromise = null;   // 清掉失败标记，允许重新加载
    try {
      window.hakozumeApi.open(window.readTaBodyProfile ? window.readTaBodyProfile() : null);
    } catch (e) {
      console.error('hakozume 重试失败:', e);   // 不再静默：失败原因要能查到
    }
  };
  const html = '<p>' + (detail || 'three.js 或装箱模拟器模块加载失败，请检查网络后重试。') + '</p>';
  try {
    if (typeof window.openModal !== 'function') throw new Error('openModal 不可用');
    window.openModal('📦 加载失败', html, function (v) {
      if (v === 'retry') retry();
    }, {
      noInput: true,
      // pillSubmit：点「重试」即提交（否则只是选中，还得再点一次确定，用户以为点了没反应）
      pillSubmit: true,
      pills: [
        { label: '重试', value: 'retry' },
        { label: '先不玩', value: 'cancel' }
      ]
    });
  } catch (e) {
    console.error('hakozume 加载失败（提示弹窗也不可用）:', e);
  }
}

// ===== mochi-x 暴露的唯一接口（同步存在，即使 hakozume 还没加载） =====
window.hakozumeApi = {
  get loaded() { return !!window.hzPanel; },

  async open(taProfile) {
    try {
      await ensureLoaded();
    } catch (e) {
      showLoadError();
      return;
    }
    // 脚本 200 但依赖缺失时（THREE 未就绪 / engine 提前 return），hzPanel 不会存在，
    // 直接调 open() 会抛 TypeError 且没人接 → 用户点了没反应，必须显式兜底。
    if (!window.hzPanel || typeof window.hzPanel.open !== 'function') {
      showLoadError('模拟器模块已下载但初始化失败，请重试或刷新页面。');
      return;
    }
    try {
      if (taProfile && typeof window.hzPanel.setParams === 'function') {
        window.hzPanel.setParams({
          nameA: taProfile.name || 'TA',
          genderA: taProfile.gender || 'male',
          heightA: taProfile.height || 175,
          colorA: taProfile.color || '#FF6B6B',
        });
      }
      window.hzPanel.open();
    } catch (e) {
      console.error('hakozume 打开失败:', e);
      showLoadError();
    }
  },

  close() {
    try { if (window.hzPanel) window.hzPanel.close(); } catch (e) { console.error(e); }
  },

  async reroll() {
    try {
      await ensureLoaded();
      if (window.hzPanel) window.hzPanel.reroll();
    } catch (e) { showLoadError(); }
  },

  async refresh() {
    try {
      await ensureLoaded();
      if (window.hzPanel) window.hzPanel.refresh();
    } catch (e) { showLoadError(); }
  },
};

// ===== TA 身体档案读取 =====
// room.js / feature-hub.js 会用这个函数
// 注意：`store` 是各模块 IIFE 内的局部量，全局取不到（以前 typeof store 恒为
// undefined → 永远返回兜底值，TA 身高/颜色设置形同虚设）。必须走 activeStore。
const TA_PROFILE_DEFAULT = { name: 'TA', gender: 'male', height: 175, color: '#FF6B6B' };

function taProfileStore() {
  try {
    if (typeof window.activeStore === 'function') {
      const s = window.activeStore();
      if (s && typeof s.get === 'function') return s;
    }
    if (typeof window.xyStore === 'function') {
      const s = window.xyStore('xy-home-v2');
      if (s && typeof s.get === 'function') return s;
    }
  } catch (e) {}
  return null;
}

window.readTaBodyProfile = function () {
  try {
    const s = taProfileStore();
    if (!s) return Object.assign({}, TA_PROFILE_DEFAULT);

    // xyStore 按字符串存取：读回来的是 JSON 文本（也可能是被旧版写坏的 "[object Object]"）
    let raw = s.get('ta-body-profile');
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (e) { raw = null; } }
    const p = (raw && typeof raw === 'object') ? raw : {};
    // 性别值域映射：联系人资料存的是 he/she（见 contacts.js 的 partner-gender），
    // 而面板 select 的 value 是 male/female，直接透传会让下拉框回落成默认项。
    let gender = p.gender;
    if (gender !== 'male' && gender !== 'female') {
      gender = s.get('partner-gender') === 'she' ? 'female' : 'male';
    }
    const name = p.name || s.get('lbl-partner') || s.get('cs-lbl-partner') || TA_PROFILE_DEFAULT.name;
    const height = Number(p.height) > 0 ? Number(p.height) : TA_PROFILE_DEFAULT.height;
    const color = /^#[0-9a-f]{6}$/i.test(String(p.color || '')) ? p.color : TA_PROFILE_DEFAULT.color;

    return { name: name, gender: gender, height: height, color: color };
  } catch (e) {
    return Object.assign({}, TA_PROFILE_DEFAULT);
  }
};
