(function () { try {
async function loadSequentialScripts(urls) {
for (const url of urls) {
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
if (window.__mochiLoaded) window.__mochiLoaded.push("hakozume-loader.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("hakozume-loader.js"); try { console.error("[JS] hakozume-loader.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[hakozume-loader.js] " + String(__e && __e.message || __e)); } })();