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

  // ---- 权威源与版本探针 ----
  // jsDelivr 的 @main 是「分支」引用，边缘缓存 s-maxage=12h：仓库同步了索引，客户端
  // 可能半天还在读旧快照；而且旧快照可能与最新那份 version 完全相同（改造前 version
  // 从不自增），光比版本号区分不出来。所以：
  //   · latest.json 放在仓库根，raw 读取缓存约 5 分钟、体积几 KB —— 只用来问「现在权威的
  //     word/meme 各多少条、版本号是多少」；
  //   · 索引 JSON 优先从 raw 取（新鲜），失败再退回原有 jsDelivr 多镜像；
  //   · 图片仍钉 gcore（见 toImgHost）：raw 图片在国内不可达。
  var RAW_BASE = 'https://raw.githubusercontent.com/fcylz/cy-chat/main/';
  var LATEST_URL = RAW_BASE + 'latest.json';
  var LATEST_TIMEOUT = 3500;                         // 探针失败就算了，不拖慢正常拉取

  // ---- 内置默认地址（免输入链接的来源，按实测可用性排序，逐个回退）----
  // 2026-10-22 实测：字卡/表情原来写死的 cdn.jsdelivr.net 在本机网络直接连不上（curl 000），
  // 而 fastly.jsdelivr.net / gcore.jsdelivr.net 两个镜像同目录同文件 200 正常返回；
  // 曲库走的 fcylz.github.io 一直可用。「APP 拉不到字卡和表情、曲库却能拉」的根因就在这里，
  // 与 APP 无关（APP 是 WebView 远程加载站点，与浏览器同源同策略）。
  // 顺序回退而非并发竞速：多数情况第一个就命中、零额外代价；并发会同时打三个 CDN，
  // 弱网下反而被最慢的那个拖长总耗时。命中后写进 LAST_PREFIX，下次直接从命中镜像开始。
  var DEFAULTS = {
    // 字卡 / 表情都把 raw 排最前：raw 是仓库原文，缓存只有几分钟，比 jsDelivr 的
    // @main 分支缓存（12 小时）新鲜得多；raw 不通时自动落到后面的 jsDelivr 镜像，
    // 命中镜像依旧写进 LAST_PREFIX（下次从命中的那个开始）。
    word: [
      'https://raw.githubusercontent.com/fcylz/cy-chat/main/Word/word.json',
      'https://gcore.jsdelivr.net/gh/fcylz/cy-chat@main/Word/word.json',
      'https://fastly.jsdelivr.net/gh/fcylz/cy-chat@main/Word/word.json',
      'https://cdn.jsdelivr.net/gh/fcylz/cy-chat@main/Word/word.json'
    ],
    // 表情同上；图片直链会在 toImgHost 里改写回 gcore，与 JSON 从哪取无关
    meme: [
      'https://raw.githubusercontent.com/fcylz/cy-chat/main/Meme/meme.json',
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

  // ---- 图片直出源（2026-10-22 第二个坑，与上面第一个坑无关）----
  // jsDelivr 只缓存文本资源（json/js/css），图片一律 301 跳 raw.githubusercontent.com。
  // 实测：meme.json 在 fastly/gcore 都是 200，但同样的目录取图片时——
  //   fastly.jsdelivr.net/.../xxx.jpg → 301 → raw.githubusercontent.com（国内网络不通）→ 0/78
  //   gcore.jsdelivr.net/.../xxx.jpg  → 200 直出 image/jpeg|gif|png                    → 78/78
  // 于是出现「云端表情拉取报非图片地址、导入失败」，且时好时坏（网络偶尔能连 raw 就成了）。
  // 对策：展开出的图片直链，host 一律钉到 gcore，与 JSON 是从哪个镜像拉回来的无关——
  // 老用户 localStorage 里记的 fastly 地址照样能救回来。
  var IMG_HOST = 'gcore.jsdelivr.net';
  function toImgHost(u) {
    try {
      var p = new URL(u);
      var h = p.hostname.toLowerCase();
      if (h === 'raw.githubusercontent.com') {
        // raw 的图片直链 → gcore 直出：/owner/repo/ref/path → /gh/owner/repo@ref/path
        var m = p.pathname.match(/^\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
        if (m) return 'https://' + IMG_HOST + '/gh/' + m[1] + '/' + m[2] + '@' + m[3] + '/' + m[4];
      }
      if (/\.jsdelivr\.net$/i.test(h) && h !== IMG_HOST) {
        p.hostname = IMG_HOST;
        return p.href;
      }
    } catch (e) {}
    return u;
  }

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
        var u = toImgHost(absUrl(it.url, jsonUrl)); // 图片直出源钉到 gcore，见 IMG_HOST
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

  // 索引条目总数：word / meme 都是 { categories: { key: { items: [] } } } 这一层结构。
  // 用来和 latest.json 的权威条数对齐 —— 这是「同版本号、不同内容」时唯一可靠的判据。
  function itemCount(data) {
    var cats = (data && data.categories) || {};
    var n = 0;
    Object.keys(cats).forEach(function (k) {
      n += ((cats[k] && cats[k].items) || []).length;
    });
    return n;
  }

  // 单个镜像：带超时地取回并展开。超时/非 2xx/JSON 解析失败/展开为空 都算这个镜像没成
  // 功，交给 fetchAny 换下一个——过去没有超时，请求挂在连不上的 CDN 上时界面会一直没反馈。
  // 返回 { text, version, items }：version / items 只用于在多镜像间挑「最新的那份」。
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
      return { text: text, version: String((data && data.version) || ''), items: itemCount(data) };
    }).then(function (r) {
      if (timer) clearTimeout(timer);
      return r;
    }, function (e) {
      if (timer) clearTimeout(timer);
      var aborted = !!(e && e.name === 'AbortError');
      throw new Error(aborted ? ('超时（>' + (ms / 1000) + 's）') : ((e && e.message) || '网络失败'));
    });
  }

  // latest.json 探针：只回答「权威版本是什么」，失败一律返回 null（raw 在国内可能不可达，
  // 不能让探针失败拖垮正常拉取）。raw 缓存约 5 分钟，比 jsDelivr @main 的 12 小时新鲜得多。
  function fetchLatest(timeoutMs) {
    var ms = timeoutMs || LATEST_TIMEOUT;
    var ac = (typeof AbortController === 'function') ? new AbortController() : null;
    var timer = null;
    var opts = { cache: 'no-store' };
    if (ac) { opts.signal = ac.signal; timer = setTimeout(function () { try { ac.abort(); } catch (e) {} }, ms); }
    return fetch(LATEST_URL + '?t=' + Date.now(), opts).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      if (timer) clearTimeout(timer);
      return d && typeof d === 'object' ? d : null;
    }, function () {
      if (timer) clearTimeout(timer);
      return null;
    });
  }

  // '2.2.0' > '2.1.0'；缺失/非数字段按 0 处理
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

  // 字卡 / 表情专用取源：并发问所有镜像 + 并发问 latest.json，挑「最像当前权威内容」的那份。
  //
  // 为什么不能顺序回退：jsDelivr 各边缘节点的缓存进度不一致（2026-10-26 实测 fastly 停在
  // v2.1.0 / 20 类，gcore 与 cdn 已是 v2.2.0 / 21 类），而加 ?v= / ?t= 这类查询参数
  // 打在 jsDelivr 上完全无效、还是命中同一份旧缓存。顺序回退「第一个成功就返回」，
  // 于是永远选中那个滞后的镜像——表现就是同一份云端数据，手机拉得到拍一拍、电脑拉不到。
  //
  // 为什么还要 latest.json：旧快照可能与最新那份 version 完全相同（改造前 version 从不
  // 自增，2026-10-30 实测 cdn / gcore 的 2126 条旧快照和 raw 的 2783 条都写 2.2.0），
  // 只比版本号照样挑不出来。latest.json 给出权威条目数，条目数对齐的那份直接胜出；
  // 探针拿不到时退化为「版本号高者优先，同版本取条目更多者」——同样能避开旧快照。
  //
  // 代价：字卡百来 KB、表情几十 KB，多打几个源；必须等所有源结算完才定案——
  // 「第一个回来就先返回」的问题在于，滞后的那个镜像往往更早响应（缓存命中快），
  // 真正新鲜的节点反而要回源、慢一步，先返回就等于每次都选中旧数据。
  // 单源超时收到 4s：挂住的节点最多拖 4s，不会把「点一下按钮」变成 8s 空转。
  var MIRROR_TIMEOUT = 4000;
  function fetchFreshest(kind, urls) {
    var latestP = fetchLatest();
    var jobs = urls.map(function (url) {
      return fetchOne(url, kind, MIRROR_TIMEOUT).then(function (r) {
        return { url: url, text: r.text, version: r.version, items: r.items };
      }, function (err) {
        return { url: url, err: (err && err.message) || '网络失败' };
      });
    });
    return Promise.all([latestP, Promise.all(jobs)]).then(function (res) {
      var latest = res[0];
      var list = res[1];
      var okList = list.filter(function (x) { return x && x.text; });
      if (!okList.length) {
        var e = new Error('已试 ' + list.length + ' 个地址都失败：'
          + list.map(function (t) { return (t && t.err) || '网络失败'; }).join('；'));
        e.tried = list;
        throw e;
      }
      var want = latest && latest[kind];
      var wantItems = (want && Number(want.items)) || 0;
      // ① 条目数与 latest.json 对齐的优先（同版本号下区分新旧快照的唯一依据）
      var exact = wantItems ? okList.filter(function (x) { return x.items === wantItems; }) : [];
      var pool = exact.length ? exact : okList;
      var best = pool[0];
      for (var i = 1; i < pool.length; i++) {
        var c = cmpVersion(pool[i].version, best.version);
        // ② 版本高者优先；③ 同版本取条目更多的（追加式索引下，多的那份才是新的）
        if (c > 0 || (c === 0 && pool[i].items > best.items)) best = pool[i];
      }
      remember(kind, best.url);
      return { text: best.text, url: best.url, version: best.version, items: best.items, tried: okList.length };
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
  //
  // 例外：字卡/表情不走顺序回退，改成并发挑最新（fetchFreshest）——镜像之间可能各自
  // 缓存着不同版本，谁先回来谁被选中就会拿到旧数据。用户手填了自己的地址时仍按顺序
  // 回退（那是他指定的源，不拿别的镜像去盖他）。
  function fetchAny(kind, custom) {
    var urls = resolveUrls(kind, custom);
    if (!urls.length) return Promise.reject(new Error('没有可用的云端地址'));
    if ((kind === 'word' || kind === 'meme') && !isCloudUrl(custom) && urls.length > 1) return fetchFreshest(kind, urls);
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
        return { text: r.text, url: url, version: r.version, items: r.items, tried: tried.length + 1 };
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
    fetchAny: fetchAny,
    latest: fetchLatest
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
