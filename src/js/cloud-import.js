// ===== 功能：云端库导入（在现有导入框里粘贴云端 json 链接） =====
// 本模块只做一件事：把云端 json「取回来 + 展开成现有导入框本来就认的格式」，
// 之后的去重、分组、压缩、入池、落库、刷新、toast 全部复用 chatcard.js / music-player.js
// 的既有导入管线，不另起一套写入逻辑（避免踩「防覆盖守卫」「大库未就绪」这些坑）。
//
// 三个落点：
//   · 字卡（文字分类）批量导入 → 展开成「【分组名】+ 一行一条」
//   · 表情包/图片「链接导入」   → 展开成「【分组名】+ 一行一个图片直链」
//   · 音乐「批量导入」          → 展开成「歌曲名称/歌手/音乐直链URL」分块
(function () {
  'use strict';

  var LAST_PREFIX = 'xy-home-v2:cloud-import-last:'; // 按用途分记，互不覆盖
  var MAX_MEME_BYTES = 1024 * 1024;                  // 单张表情体积上限，超限跳过

  // 只认「单行 http(s) 的 .json 链接」：多行文本、图片/音频直链一律交回原导入逻辑
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

  // 取值：输入框里是云端链接 → 用它；输入框为空且允许 → 用上次用过的地址
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

  // meme.json 里 item.url 是「相对仓库根」的（Meme/images/xx.jpg），而 json 自己躺在
  // 仓库的 Meme/ 目录下 → 直接按 json 所在目录解析会得到 .../Meme/Meme/images/xx.jpg。
  // 这里统一处理：根目录末段与相对路径首段同名时再退一级（jsDelivr / GitHub Pages
  // 项目站 / 自建域名三种托管形态都落在同一条规则上）。
  function absUrl(rel, jsonUrl) {
    try {
      var base = dirOf(jsonUrl).replace(/\/+$/, '');
      var segs = base.split('/');
      var first = String(rel).split('/')[0];
      if (first && segs.length > 3 && segs[segs.length - 1] === first) segs.pop();
      return new URL(rel, segs.join('/') + '/').href;
    } catch (e) { return ''; }
  }

  // word.json：{ categories: { key: { label, items: [{text}] } } }
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

  // meme.json：{ categories: { key: { label, items: [{url,bytes}] } } }（url 为仓库内相对路径）
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

  // cy-music/index.json：[{ name:"歌名-歌手", mp3, lrc }]
  function toMusicText(list, jsonUrl) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (it) {
      var nm = String((it && it.name) || '').trim();
      var url = String((it && (it.mp3 || it.url)) || '').trim();
      if (!url) return;
      // 相对路径（如 songs/xx.mp3）按 json 所在目录解析，绝对直链原样使用
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
