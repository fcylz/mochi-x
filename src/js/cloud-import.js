// ===== 功能：云端库导入（在现有导入框里粘贴云端 json 链接） =====
// 本模块只做一件事：把云端 json「取回来 + 展开成现有导入框本来就认的格式」，
// 之后的去重、分组、压缩、入池、落库、刷新、toast 全部复用 chatcard.js / music-player.js
// 的既有导入管线，不另起一套写入逻辑（避免踩「防覆盖守卫」「大库未就绪」这些坑）。
//
// 三个落点（每个落点除了弹窗里粘贴链接，还有一个就地的一键按钮，不用输链接）：
//   · 字卡（文字分类）批量导入 +「云端字卡」按钮 → 展开成「【分组名】+ 一行一条」
//   · 表情包/图片「链接导入」+「云端表情」按钮   → 展开成「【分组名】+ 一行一个图片直链」
//   · 音乐「批量导入」+「云端曲库」按钮          → 展开成「歌曲名称/歌手/音乐直链URL」分块
//
// 地址不用记、不用填：每类内置一串镜像（DEFAULTS），按顺序回退、单个 8s 超时，
// 命中即记住该镜像。按钮只负责「取回文本 + 交给该库自己的导入管线」，不碰存储格式。
(function () {
  'use strict';

  var LAST_PREFIX = 'xy-home-v2:cloud-import-last:'; // 按用途分记，互不覆盖
  var MAX_MEME_BYTES = 1024 * 1024;                  // 单张表情体积上限，超限跳过
  var TRY_TIMEOUT = 8000;                            // 单个镜像的等待上限（超时即换下一个）

  // ---- 内置默认地址（免输入链接的来源，按实测可用性排序，逐个回退）----
  // 2026-10-22 实测：字卡/表情原来写死的 cdn.jsdelivr.net 在本机网络直接连不上（curl 000），
  // 而 fastly.jsdelivr.net / gcore.jsdelivr.net 两个镜像同目录同文件 200 正常返回；
  // 曲库走的 fcylz.github.io 一直可用。「APP 拉不到字卡和表情、曲库却能拉」的根因就在这里，
  // 与 APP 无关（APP 是 WebView 远程加载站点，与浏览器同源同策略）。
  // 顺序回退而非并发竞速：多数情况第一个就命中、零额外代价；并发会同时打三个 CDN，
  // 弱网下反而被最慢的那个拖长总耗时。命中后写进 LAST_PREFIX，下次直接从命中镜像开始。
  var DEFAULTS = {
    word: [
      'https://fastly.jsdelivr.net/gh/fcylz/cy-chat@main/Word/word.json',
      'https://gcore.jsdelivr.net/gh/fcylz/cy-chat@main/Word/word.json',
      'https://cdn.jsdelivr.net/gh/fcylz/cy-chat@main/Word/word.json'
    ],
    meme: [
      'https://fastly.jsdelivr.net/gh/fcylz/cy-chat@main/Meme/meme.json',
      'https://gcore.jsdelivr.net/gh/fcylz/cy-chat@main/Meme/meme.json',
      'https://cdn.jsdelivr.net/gh/fcylz/cy-chat@main/Meme/meme.json'
    ],
    music: [
      'https://fcylz.github.io/cy-music/index.json',
      'https://fastly.jsdelivr.net/gh/fcylz/cy-music@main/index.json',
      'https://gcore.jsdelivr.net/gh/fcylz/cy-music@main/index.json'
    ]
  };

  var KIND_LABEL = { word: '字卡', meme: '表情', music: '曲库' };

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

  // 单个镜像：带超时地取回并展开。超时/非 2xx/JSON 解析失败/展开为空 都算这个镜像没成
  // 功，交给 fetchAny 换下一个——过去没有超时，请求挂在连不上的 CDN 上时界面会一直没反馈。
  function fetchOne(url, kind) {
    var ac = (typeof AbortController === 'function') ? new AbortController() : null;
    var timer = null;
    var opts = { cache: 'no-store' };
    if (ac) { opts.signal = ac.signal; timer = setTimeout(function () { try { ac.abort(); } catch (e) {} }, TRY_TIMEOUT); }
    return fetch(url, opts).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (data) {
      var text = expand(kind, data, url);
      if (!text) throw new Error('云端数据里没有可导入的内容');
      return text;
    }).then(function (text) {
      if (timer) clearTimeout(timer);
      return text;
    }, function (e) {
      if (timer) clearTimeout(timer);
      var aborted = !!(e && e.name === 'AbortError');
      throw new Error(aborted ? ('超时（>' + (TRY_TIMEOUT / 1000) + 's）') : ((e && e.message) || '网络失败'));
    });
  }

  // 取值顺序：手填/自定义 > 上次成功命中过的地址 > 内置默认镜像列表（去重）
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

  // 顺序回退：第一个拿到的就是答案，成功即记住该镜像（写进与站点导入框共用的 LAST_PREFIX，
  // 所以「在导入框里手填过的地址」和「按钮自动命中的镜像」是同一份记忆，互相接得上）
  function fetchAny(kind, custom) {
    var urls = resolveUrls(kind, custom);
    if (!urls.length) return Promise.reject(new Error('没有可用的云端地址'));
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
      return fetchOne(url, kind).then(function (text) {
        remember(kind, url);
        return { text: text, url: url, tried: tried.length + 1 };
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
        // 按钮是「<svg> + 文字」，整段 innerHTML 存回，避免把图标抹掉
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
  // 兜底：字卡库/音乐页的模板可能晚于本文件就绪，再试两次
  setTimeout(bindCloudButtons, 300);
  setTimeout(bindCloudButtons, 1500);
})();
