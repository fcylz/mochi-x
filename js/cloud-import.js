(function () { try {
(function () {
'use strict';
var LAST_PREFIX = 'xy-home-v2:cloud-import-last:'; // 按用途分记，互不覆盖
var MAX_MEME_BYTES = 1024 * 1024;                  // 单张表情体积上限，超限跳过
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
var u = absUrl(it.url, jsonUrl);
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
window.mochiCloudImport = {
isCloudUrl: isCloudUrl,
pickUrl: pickUrl,
lastUrl: lastUrl,
fetch: fetchCloud,
expand: expand
};
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("cloud-import.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("cloud-import.js"); try { console.error("[JS] cloud-import.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[cloud-import.js] " + String(__e && __e.message || __e)); } })();