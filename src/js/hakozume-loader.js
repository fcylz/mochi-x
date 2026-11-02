// ===== 装箱模拟器动态加载基础设施 =====
// 这个文件是唯一写死在 mochi-x index.html 里的脚本（<script defer src="js/hakozume-loader.js">）
// ~1KB，同步 defer 加载，不依赖 three.js 或 hakozume 任何模块

// ===== 按序加载 JS 工具 =====
async function loadSequentialScripts(urls) {
  for (const url of urls) {
    // 已加载的跳过
    const existing = document.querySelector(`script[data-hz="${url}"]`);
    if (existing) continue;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.setAttribute('data-hz', url);
      s.onerror = () => reject(new Error('Failed to load ' + url));
      s.onload = resolve;
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

// ===== mochi-x 暴露的唯一接口（同步存在，即使 hakozume 还没加载） =====
window.hakozumeApi = {
  get loaded() { return !!window.hzPanel; },

  async open(taProfile) {
    try {
      await ensureLoaded();
    } catch (e) {
      window.openModal({
        title: '📦 加载失败',
        content: '<p>three.js 或装箱模拟器模块加载失败，请检查网络或刷新页面后重试。</p>',
        buttons: [{ text: '好的', primary: true }]
      });
      return;
    }
    if (taProfile && window.hzPanel.setParams) {
      hzPanel.setParams({
        nameA: taProfile.name || 'TA',
        genderA: taProfile.gender || 'male',
        heightA: taProfile.height || 175,
        colorA: taProfile.color || '#FF6B6B',
      });
    }
    hzPanel.open();
  },

  close() {
    if (window.hzPanel) hzPanel.close();
  },

  async reroll() {
    await ensureLoaded();
    hzPanel.reroll();
  },

  async refresh() {
    await ensureLoaded();
    hzPanel.refresh();
  },
};

// ===== TA 身体档案读取 =====
// room.js / feature-hub.js 会用这个函数
window.readTaBodyProfile = function() {
  try {
    if (typeof store !== 'undefined' && typeof store.get === 'function') {
      const p = store.get('ta-body-profile') || {};
      return {
        name: p.name || 'TA',
        gender: p.gender || 'male',
        height: p.height || 175,
        color: p.color || '#FF6B6B',
      };
    }
  } catch (e) {}
  return { name: 'TA', gender: 'male', height: 175, color: '#FF6B6B' };
};
