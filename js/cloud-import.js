(function () { try {
(function () {
'use strict';
var LAST_PREFIX = 'xy-home-v2:cloud-import-last:'; // 按用途分记，互不覆盖
var MAX_MEME_BYTES = 1024 * 1024;                  // 单张表情体积上限，超限跳过
var TRY_TIMEOUT = 8000;                            // 单个镜像的等待上限（超时即换下一个）
var DEFAULTS = {
word: [
'https://gcore.jsdelivr.net/gh/fcylz/cy-chat@main/Word/word.json',
'https://fastly.jsdelivr.net/gh/fcylz/cy-chat@main/Word/word.json',
'https://cdn.jsdelivr.net/gh/fcylz/cy-chat@main/Word/word.json'
],
meme: [
'https://gcore.jsdelivr.net/gh/fcylz/cy-chat@main/Meme/meme.json',
'https://fastly.jsdelivr.net/gh/fcylz/cy-chat@main/Meme/meme.json',
'https://cdn.jsdelivr.net/gh/fcylz/cy-chat@main/Meme/meme.json'
],
music: [
'https://fcylz.github.io/cy-music/index.json',
'https://fastly.jsdelivr.net/gh/fcylz/cy-music@main/index.json',
'https://gcore.jsdelivr.net/gh/fcylz/cy-music@main/index.json'
]
};
var KIND_LABEL = { word: '字卡', meme: '表情', music: '曲库' };
var IMG_HOST = 'gcore.jsdelivr.net';
function toImgHost(u) {
try {
var p = new URL(u);
if (/\.jsdelivr\.net$/i.test(p.hostname) && p.hostname.toLowerCase() !== IMG_HOST) {
p.hostname = IMG_HOST;
return p.href;
}
} catch (e) {}
return u;
}
function isCloudUrl(raw) {
var s = String(raw || '').trim();
if (!s || /[\r\n]/.test(s)) return false;
if (!/^https?:\/\//i.test(s)) return false;
if (/\.(png|jpe?g|gif|webp|bmp|mp3|m4a|wav|ogg|amr)(\?|#|$)/i.test(s)) return false;
return /\.json(\?|#|$)/i.test(s);
}
function lastUrl(kind) {
try { return localStorage.getItem(LAST_PREFIX + kind) || ''; } catch (e) { return ''; }
}
function remember(kind, url) {
try { localStorage.setItem(LAST_PREFIX + kind, url); } catch (e) {}
}
function pickUrl(raw, kind, allowLast) {
var s = String(raw || '').trim();
if (isCloudUrl(s)) return s;
if (!s && allowLast) {
var l = lastUrl(kind);
if (isCloudUrl(l)) return l;
}
return '';
}
function dirOf(url) {
try { return new URL(url).href.replace(/[^/]*$/, ''); } catch (e) { return url; }
}
function absUrl(rel, jsonUrl) {
try {
var base = dirOf(jsonUrl).replace(/\/+$/, '');
var segs = base.split('/');
var first = String(rel).split('/')[0];
if (first && segs.length > 3 && segs[segs.length - 1] === first) segs.pop();
return new URL(rel, segs.join('/') + '/').href;
} catch (e) { return ''; }
}
function toWordText(data) {
var cats = (data && data.categories) || {};
var out = [];
Object.keys(cats).forEach(function (k) {
var c = cats[k] || {};
var lines = [];
(c.items || []).forEach(function (it) {
var t = String((it && (it.text || it.content)) || '').trim();
if (t && t.charAt(0) !== '#') lines.push(t); // 空行与注释不入库
});
if (!lines.length) return;
out.push('【云端·' + (c.label || k) + '】');
Array.prototype.push.apply(out, lines);
});
return out.join('\n');
}
function toMemeText(data, jsonUrl) {
var cats = (data && data.categories) || {};
var out = [];
Object.keys(cats).forEach(function (k) {
var c = cats[k] || {};
var urls = [];
(c.items || []).forEach(function (it) {
if (!it || !it.url) return;
if (it.bytes && it.bytes > MAX_MEME_BYTES) return;
var u = toImgHost(absUrl(it.url, jsonUrl)); // 图片直出源钉到 gcore，见 IMG_HOST
if (u) urls.push(u);
});
if (!urls.length) return;
out.push('【云端·' + (c.label || k) + '】');
Array.prototype.push.apply(out, urls);
});
return out.join('\n');
}
function toMusicText(list, jsonUrl) {
var out = [];
(Array.isArray(list) ? list : []).forEach(function (it) {
var nm = String((it && it.name) || '').trim();
var url = String((it && (it.mp3 || it.url)) || '').trim();
if (!url) return;
if (!/^https?:\/\//i.test(url)) url = dirOf(jsonUrl) ? new URL(url, dirOf(jsonUrl)).href : url;
if (/\s/.test(url)) url = url.replace(/\s/g, '%20'); // 直链里的空格（歌名带空格）先编码
if (!/^https?:\/\//i.test(url)) return;
var title = nm, artist = '';
var i = nm.lastIndexOf('-');
if (i > 0) { title = nm.slice(0, i).trim(); artist = nm.slice(i + 1).trim(); }
out.push('歌曲名称：' + (title || '链接音乐'));
if (artist) out.push('歌手：' + artist);
out.push('音乐直链URL：' + url);
out.push(''); // 空行分隔，与「批量导入」的分块写法一致
});
return out.join('\n');
}
function expand(kind, data, jsonUrl) {
if (kind === 'word') return toWordText(data);
if (kind === 'meme') return toMemeText(data, jsonUrl);
return toMusicText(data, jsonUrl);
}
function fetchCloud(url, kind) {
return fetch(url, { cache: 'no-store' }).then(function (r) {
if (!r.ok) throw new Error('HTTP ' + r.status);
return r.json();
}).then(function (data) {
var text = expand(kind, data, url);
if (!text) throw new Error('云端数据里没有可导入的内容');
remember(kind, url);
return text;
});
}
function fetchOne(url, kind, timeoutMs) {
var ms = timeoutMs || TRY_TIMEOUT;
var ac = (typeof AbortController === 'function') ? new AbortController() : null;
var timer = null;
var opts = { cache: 'no-store' };
if (ac) { opts.signal = ac.signal; timer = setTimeout(function () { try { ac.abort(); } catch (e) {} }, ms); }
return fetch(url, opts).then(function (r) {
if (!r.ok) throw new Error('HTTP ' + r.status);
return r.json();
}).then(function (data) {
var text = expand(kind, data, url);
if (!text) throw new Error('云端数据里没有可导入的内容');
return { text: text, version: String((data && data.version) || '') };
}).then(function (r) {
if (timer) clearTimeout(timer);
return r;
}, function (e) {
if (timer) clearTimeout(timer);
var aborted = !!(e && e.name === 'AbortError');
throw new Error(aborted ? ('超时（>' + (ms / 1000) + 's）') : ((e && e.message) || '网络失败'));
});
}
function cmpVersion(a, b) {
var pa = String(a || '0').split('.');
var pb = String(b || '0').split('.');
var n = Math.max(pa.length, pb.length);
for (var i = 0; i < n; i++) {
var x = parseInt(pa[i], 10) || 0;
var y = parseInt(pb[i], 10) || 0;
if (x !== y) return x - y;
}
return 0;
}
var WORD_MIRROR_TIMEOUT = 4000;
function fetchWordFreshest(urls) {
var jobs = urls.map(function (url) {
return fetchOne(url, 'word', WORD_MIRROR_TIMEOUT).then(function (r) {
return { url: url, text: r.text, version: r.version };
}, function (err) {
return { url: url, err: (err && err.message) || '网络失败' };
});
});
return Promise.all(jobs).then(function (list) {
var okList = list.filter(function (x) { return x && x.text; });
if (!okList.length) {
var e = new Error('已试 ' + list.length + ' 个地址都失败：'
+ list.map(function (t) { return (t && t.err) || '网络失败'; }).join('；'));
e.tried = list;
throw e;
}
var best = okList[0];
for (var i = 1; i < okList.length; i++) {
if (cmpVersion(okList[i].version, best.version) > 0) best = okList[i];
}
remember('word', best.url);
return { text: best.text, url: best.url, version: best.version, tried: okList.length };
});
}
function resolveUrls(kind, custom) {
var out = [];
var push = function (u) {
u = String(u || '').trim();
if (u && out.indexOf(u) < 0) out.push(u);
};
if (isCloudUrl(custom)) push(custom);
push(lastUrl(kind));
(DEFAULTS[kind] || []).forEach(push);
return out;
}
function fetchAny(kind, custom) {
var urls = resolveUrls(kind, custom);
if (!urls.length) return Promise.reject(new Error('没有可用的云端地址'));
if (kind === 'word' && !isCloudUrl(custom) && urls.length > 1) return fetchWordFreshest(urls);
var tried = [];
var i = 0;
function attempt() {
if (i >= urls.length) {
var detail = tried.map(function (t) { return t.err; }).join('；');
var e = new Error('已试 ' + tried.length + ' 个地址都失败：' + detail);
e.tried = tried;
throw e;
}
var url = urls[i++];
return fetchOne(url, kind).then(function (r) {
remember(kind, url);
return { text: r.text, url: url, version: r.version, tried: tried.length + 1 };
}, function (err) {
tried.push({ url: url, err: (err && err.message) || '网络失败' });
return attempt();
});
}
return Promise.resolve().then(attempt);
}
window.mochiCloudImport = {
isCloudUrl: isCloudUrl,
pickUrl: pickUrl,
lastUrl: lastUrl,
fetch: fetchCloud,
expand: expand,
defaults: DEFAULTS,
resolveUrls: resolveUrls,
fetchAny: fetchAny
};
/* ==========================================================================
* 就地一键拉取按钮（字卡库「云端字卡」/「云端表情」、音乐页「云端曲库」）
* --------------------------------------------------------------------------
* 只做三件事：点按钮 → 取回云端文本 → 交给该库自己的既有导入管线。
* 去重/分组/压缩转存/入池/落库/刷新/结果 toast 全部由管线自己完成，这里不碰任何
* 存储格式（沿用本模块开头「不另起一套写入逻辑」的既定原则）。
* 三个管线由 chatcard.js / music-player.js 提升到模块级后挂在 window 上，
* 点击时才求值，与本文件的加载先后无关。
* ========================================================================== */
var BTN_CONF = [
{ id: 'cc-cloud-word',  kind: 'word',  run: 'ccCloudImportText'  },
{ id: 'cc-cloud-meme',  kind: 'meme',  run: 'ccCloudImportLinks' },
{ id: 'music-cloud',    kind: 'music', run: 'smCloudImportBatch' }
];
function toastMsg(msg) {
try { if (typeof window.toast === 'function') { window.toast(msg); return; } } catch (e) {}
}
function hostOf(url) {
try { return new URL(url).host; } catch (e) { return url; }
}
function bindCloudButtons() {
BTN_CONF.forEach(function (cfg) {
var btn = document.getElementById(cfg.id);
if (!btn || btn.__cloudBound) return;
btn.__cloudBound = '1';
btn.addEventListener('click', function () {
if (btn.__cloudBusy) return;
var run = window[cfg.run];
if (typeof run !== 'function') { toastMsg('云端' + (KIND_LABEL[cfg.kind] || '库') + '功能未就绪，请刷新页面重试'); return; }
btn.__cloudBusy = '1';
btn.disabled = true;
var oldHtml = btn.innerHTML;
btn.innerHTML = '拉取中…';
var restore = function () {
btn.__cloudBusy = '';
btn.disabled = false;
btn.innerHTML = oldHtml;
};
toastMsg('正在从云端获取' + (KIND_LABEL[cfg.kind] || '库') + '…');
fetchAny(cfg.kind, '').then(function (res) {
restore();
try {
run(res.text);
} catch (e) {
toastMsg('云端' + (KIND_LABEL[cfg.kind] || '库') + '入库失败：' + ((e && e.message) || '未知错误'));
}
}, function (e) {
restore();
var msg = (e && e.message) || '网络失败';
if (e && e.tried && e.tried.length) {
msg += '（最后尝试 ' + hostOf(e.tried[e.tried.length - 1].url) + '）';
}
toastMsg('云端' + (KIND_LABEL[cfg.kind] || '库') + '获取失败：' + msg);
});
});
});
}
if (document.readyState === 'loading') {
document.addEventListener('DOMContentLoaded', bindCloudButtons);
} else {
bindCloudButtons();
}
setTimeout(bindCloudButtons, 300);
setTimeout(bindCloudButtons, 1500);
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("cloud-import.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("cloud-import.js"); try { console.error("[JS] cloud-import.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[cloud-import.js] " + String(__e && __e.message || __e)); } })();