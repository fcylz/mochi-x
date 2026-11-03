(function () { try {
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
function loadCssOnce(url) {
if (document.querySelector(`link[data-hz="${url}"]`)) return;
const l = document.createElement('link');
l.rel = 'stylesheet';
l.href = url;
l.setAttribute('data-hz', url);
document.head.appendChild(l);
}
let _loadedPromise = null;
async function ensureLoaded() {
if (window.hzPanel) return true;            // 已加载完成
if (_loadedPromise) return _loadedPromise;  // 正在加载
_loadedPromise = (async () => {
try {
await loadSequentialScripts([
'vendor/three.min.js',
'js/hakozume-engine.js',
'js/hakozume-panel.js',
]);
loadCssOnce('css/hakozume.css');
return true;
} catch (e) {
console.error('hakozume 加载失败:', e);
_loadedPromise = null;
throw e;
}
})();
return _loadedPromise;
}
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
window.hakozumeApi = {
get loaded() { return !!window.hzPanel; },
async open(taProfile) {
try {
await ensureLoaded();
} catch (e) {
showLoadError();
return;
}
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
let raw = s.get('ta-body-profile');
if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (e) { raw = null; } }
const p = (raw && typeof raw === 'object') ? raw : {};
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
if (window.__mochiLoaded) window.__mochiLoaded.push("hakozume-loader.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("hakozume-loader.js"); try { console.error("[JS] hakozume-loader.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[hakozume-loader.js] " + String(__e && __e.message || __e)); } })();