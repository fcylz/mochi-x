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
/* ==========================================================================
 * 云端同步面板（fcylz 定制补丁）
 * --------------------------------------------------------------------------
 * 目的：给「云端字卡 / 云端表情包 / 云端曲库」加一个显式的一键拉取入口，
 *       不用每次钻进导入对话框里粘贴地址。
 *
 * 设计原则：
 *  1. 不改动本文件原有逻辑，只在末尾追加独立模块（原 mochiCloudImport 照常可用）。
 *  2. 地址与站点原生的「上次地址」共用同一个 localStorage 键
 *     （xy-home-v2:cloud-import-last:<kind>），所以在站点里导入过一次的地址，
 *     这里会自动带出来；反过来在这里填的，站点导入对话框留空也能用。
 *  3. 拉取用的是本文件已有的 fetchCloud（走站点同一条解析逻辑，格式不会跑偏）。
 *  4. 写入不自己造轮子：把文本填进站点自己的导入框里，让站点原有流程去入库。
 *     —— 站点没有暴露 media / 曲库的写入接口，自造格式必然出错。
 *  5. 不自动点「确定」：最后一步留给用户，既少一处 DOM 依赖，也让人能先看一眼。
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__mochiCloudSync) { return; }
  window.__mochiCloudSync = '1';

  var SITE_LAST = 'xy-home-v2:cloud-import-last:';   // 与站点原生共用
  var LS_URL = 'mochi:cloud-sync:url:';
  var LS_LAST = 'mochi:cloud-sync:last:';
  var LS_AUTO = 'mochi:cloud-sync:auto';

  var KINDS = [
    { key: 'word',  label: '云端字卡',   ph: 'https://…/words.json' },
    { key: 'meme',  label: '云端表情包', ph: 'https://…/memes.json' },
    { key: 'music', label: '云端曲库',   ph: 'https://…/music.json' }
  ];

  function getLS(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function setLS(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function delLS(k) { try { localStorage.removeItem(k); } catch (e) {} }

  function urlOf(kind) {
    return getLS(LS_URL + kind) || getLS(SITE_LAST + kind) || '';
  }
  function saveUrl(kind, url) {
    setLS(LS_URL + kind, url);
    setLS(SITE_LAST + kind, url);   // 双向同步，站点的「留空＝上次地址」立刻可用
  }

  function lastInfo(kind) {
    try { return JSON.parse(getLS(LS_LAST + kind) || 'null'); } catch (e) { return null; }
  }
  function saveLast(kind, obj) {
    setLS(LS_LAST + kind, JSON.stringify(obj));
  }

  function fmtTime(ts) {
    try {
      var d = new Date(ts);
      var p = function (n) { return (n < 10 ? '0' : '') + n; };
      return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    } catch (e) { return ''; }
  }

  /* ----------------------------- 样式 ----------------------------- */
  var CSS = [
    '.mcs-fab{position:fixed;right:14px;bottom:calc(86px + env(safe-area-inset-bottom,0px));z-index:9998;',
    'width:46px;height:46px;border-radius:50%;border:0;padding:0;display:flex;align-items:center;justify-content:center;',
    'background:#111;color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.18);cursor:pointer;',
    'transition:transform .15s ease,opacity .15s ease;opacity:.92;}',
    '.mcs-fab:active{transform:scale(.92);}',
    '.mcs-fab svg{width:23px;height:23px;display:block;}',
    '.mcs-fab.mcs-busy{animation:mcs-pulse 1s infinite;}',
    '@keyframes mcs-pulse{0%,100%{opacity:.45}50%{opacity:1}}',

    '.mcs-mask{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.38);',
    'display:flex;align-items:center;justify-content:center;padding:18px;}',
    '.mcs-card{width:100%;max-width:420px;max-height:82vh;overflow:auto;border-radius:20px;',
    'background:#fff;color:#111;box-shadow:0 18px 50px rgba(0,0,0,.24);',
    'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;}',
    '.mcs-hd{padding:18px 20px 10px;font-size:16px;font-weight:600;letter-spacing:.3px;',
    'display:flex;align-items:center;justify-content:space-between;}',
    '.mcs-x{border:0;background:transparent;font-size:20px;line-height:1;color:#9a9a9a;cursor:pointer;padding:4px 6px;}',
    '.mcs-body{padding:0 20px 6px;}',
    '.mcs-row{padding:13px 0;border-top:1px solid #ededed;}',
    '.mcs-row:first-child{border-top:0;}',
    '.mcs-lab{font-size:13.5px;font-weight:500;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;}',
    '.mcs-st{font-size:11.5px;font-weight:400;color:#8f8f8f;max-width:58%;text-align:right;}',
    '.mcs-st.ok{color:#1a7f37;}.mcs-st.err{color:#c0392b;}',
    '.mcs-in{width:100%;box-sizing:border-box;border:1px solid #e2e2e2;border-radius:11px;',
    'padding:10px 12px;font-size:12.5px;color:#111;background:#fafafa;outline:none;',
    'font-family:inherit;-webkit-appearance:none;}',
    '.mcs-in:focus{border-color:#111;background:#fff;}',
    '.mcs-acts{display:flex;gap:8px;margin-top:9px;}',
    '.mcs-b{flex:1;border:1px solid #111;background:#111;color:#fff;border-radius:11px;',
    'padding:9px 0;font-size:13px;font-weight:500;cursor:pointer;font-family:inherit;}',
    '.mcs-b:active{opacity:.75;}',
    '.mcs-b.ghost{background:#fff;color:#111;}',
    '.mcs-b[disabled]{opacity:.42;pointer-events:none;}',
    '.mcs-ft{padding:12px 20px 18px;border-top:1px solid #ededed;display:flex;align-items:center;',
    'justify-content:space-between;font-size:12.5px;color:#666;}',
    '.mcs-tip{padding:0 20px 14px;font-size:11.5px;line-height:1.65;color:#9a9a9a;}',
    '.mcs-sw{position:relative;width:40px;height:23px;border-radius:12px;background:#ddd;',
    'border:0;padding:0;cursor:pointer;transition:background .2s;flex:none;}',
    '.mcs-sw.on{background:#111;}',
    '.mcs-sw i{position:absolute;top:2.5px;left:2.5px;width:18px;height:18px;border-radius:50%;',
    'background:#fff;transition:transform .2s;display:block;}',
    '.mcs-sw.on i{transform:translateX(17px);}',

    '[data-theme="dark"] .mcs-card{background:#1b1b1b;color:#f2f2f2;}',
    '[data-theme="dark"] .mcs-row{border-top-color:#2c2c2c;}',
    '[data-theme="dark"] .mcs-ft{border-top-color:#2c2c2c;}',
    '[data-theme="dark"] .mcs-in{background:#242424;border-color:#333;color:#f2f2f2;}',
    '[data-theme="dark"] .mcs-in:focus{border-color:#f2f2f2;background:#1b1b1b;}',
    '[data-theme="dark"] .mcs-b{background:#f2f2f2;color:#111;border-color:#f2f2f2;}',
    '[data-theme="dark"] .mcs-b.ghost{background:transparent;color:#f2f2f2;}',
    '[data-theme="dark"] .mcs-sw{background:#3a3a3a;}',
    '[data-theme="dark"] .mcs-sw.on{background:#f2f2f2;}',
    '[data-theme="dark"] .mcs-sw.on i{background:#111;}',
    '[data-theme="dark"] .mcs-fab{background:#f2f2f2;color:#111;}',
    '[data-theme="dark"] .mcs-x{color:#8a8a8a;}'
  ].join('');

  function injectCss() {
    if (document.getElementById('mcs-style')) { return; }
    var s = document.createElement('style');
    s.id = 'mcs-style';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  /* --------------------------- DOM 小工具 --------------------------- */
  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (text != null) { e.textContent = text; }
    return e;
  }

  function waitFor(sel, timeout, cb) {
    var t0 = Date.now();
    (function tick() {
      var el = null;
      try { el = document.querySelector(sel); } catch (e) {}
      if (el) { cb(el); return; }
      if (Date.now() - t0 > timeout) { cb(null); return; }
      setTimeout(tick, 130);
    })();
  }

  function setValue(el, v) {
    try {
      el.focus();
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('keyup', { bubbles: true }));
    } catch (e) {}
  }

  function toast(msg) {
    // 优先用站点自己的 toast，没有就自建一个
    try {
      if (typeof window.toast === 'function') { window.toast(msg); return; }
    } catch (e) {}
    var t = h('div', '', msg);
    t.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:10001;' +
      'background:rgba(0,0,0,.82);color:#fff;font-size:13px;line-height:1.6;padding:11px 18px;' +
      'border-radius:12px;max-width:78vw;text-align:center;pointer-events:none;' +
      'font-family:-apple-system,"PingFang SC",sans-serif;';
    document.body.appendChild(t);
    setTimeout(function () { try { t.remove(); } catch (e) {} }, 2600);
  }

  /* ------------------------- 拉取与投递 ------------------------- */
  function pullOneKind(kind, cb) {
    var cfg = null;
    for (var i = 0; i < KINDS.length; i++) { if (KINDS[i].key === kind) { cfg = KINDS[i]; } }
    var url = (urlOf(kind) || '').trim();
    if (!url) {
      if (cb) { cb(false, '还没填地址'); }
      return;
    }
    if (!/^https?:\/\//i.test(url) || !/\.json(\?|#|$)/i.test(url)) {
      if (cb) { cb(false, '地址要是指向 .json 的链接'); }
      return;
    }

    var CI = window.mochiCloudImport;
    if (!CI || typeof CI.fetch !== 'function') {
      if (cb) { cb(false, '云端模块未就绪'); }
      return;
    }

    var started = Date.now();
    CI.fetch(url, kind).then(function (text) {
      var count = String(text || '').split('\n').filter(function (l) { return l && l.trim(); }).length;
      saveUrl(kind, url);
      saveLast(kind, { ok: true, at: Date.now(), count: count, msg: '约 ' + count + ' 行' });
      refreshRow(kind);
      if (cb) { cb(true, '', text); }
    })['catch'](function (e) {
      var msg = (e && e.message) ? e.message : '网络或跨域问题';
      saveLast(kind, { ok: false, at: Date.now(), count: 0, msg: msg, cost: Date.now() - started });
      refreshRow(kind);
      if (cb) { cb(false, msg); }
    });
  }

  /** 把文本投进站点自己的导入框，最后一步留给用户点确定。 */
  function feedSite(kind, text) {
    if (kind === 'music') { feedMusic(text); return; }
    feedCard(text);
  }

  function feedCard(text, retry) {
    retry = retry || 0;
    var btn = document.getElementById('cc-import');
    if (!btn) {
      if (retry >= 3) {
        copyFallback(text, '没找到字卡库的导入入口');
        return;
      }
      // 不在字卡库页：先试着切过去，最多等 3 轮
      var tab = document.querySelector('[data-tab="cards"]')
        || document.querySelector('#tab-cards')
        || document.querySelector('.tab[data-tab="cards"]');
      if (tab) {
        try { tab.click(); } catch (e) {}
      }
      setTimeout(function () { feedCard(text, retry + 1); }, 460);
      return;
    }
    try { btn.click(); } catch (e) {}

    waitFor('#modal-input', 3200, function (el) {
      if (!el) {
        copyFallback(text, '没能自动打开导入框');
        return;
      }
      setValue(el, text);
      toast('已填入导入框，点下面的「确定」即可入库');
      closePanel();
    });
  }

  function feedMusic(text) {
    var btn = document.getElementById('music-batch');
    if (!btn) {
      copyFallback(text, '请先打开音乐播放器，再点一次拉取');
      return;
    }
    try { btn.click(); } catch (e) {}

    waitFor('#sm-batch-input', 3200, function (el) {
      if (!el) {
        copyFallback(text, '没能自动打开批量导入面板');
        return;
      }
      setValue(el, text);
      toast('已填入，点「开始导入」即可');
      closePanel();
    });
  }

  /** 兜底：自动投递失败时，把内容摆出来让其手动复制。 */
  function copyFallback(text, why) {
    var ta = document.getElementById('mcs-fallback-ta');
    if (!ta) {
      closePanel();
      buildPanel();
      setTimeout(function () { copyFallback(text, why); }, 60);
      return;
    }
    ta.value = text;
    ta.hidden = false;
    try { ta.focus(); ta.select(); } catch (e) {}
    var note = document.getElementById('mcs-fallback-note');
    if (note) {
      note.hidden = false;
      note.textContent = why + '。内容已放在下面，全选手动粘贴到导入框里即可。';
    }
  }

  /* ----------------------------- UI ----------------------------- */
  var panelEl = null;
  var rowRefs = {};

  function refreshRow(kind) {
    var st = rowRefs[kind];
    if (!st) { return; }
    var info = lastInfo(kind);
    if (!info) {
      st.className = 'mcs-st';
      st.textContent = '未同步';
      return;
    }
    if (info.ok) {
      st.className = 'mcs-st ok';
      st.textContent = fmtTime(info.at) + ' 已拉取 ' + info.msg;
    } else {
      st.className = 'mcs-st err';
      st.textContent = fmtTime(info.at) + ' ' + info.msg;
    }
  }

  function closePanel() {
    if (panelEl && panelEl.parentNode) {
      panelEl.parentNode.removeChild(panelEl);
    }
    panelEl = null;
  }

  function buildPanel() {
    injectCss();
    closePanel();

    var mask = h('div', 'mcs-mask');
    mask.id = 'mcs-mask';
    var card = h('div', 'mcs-card');

    var hd = h('div', 'mcs-hd');
    hd.appendChild(h('div', '', '云端同步'));
    var x = h('button', 'mcs-x', '×');
    x.type = 'button';
    x.addEventListener('click', closePanel);
    hd.appendChild(x);
    card.appendChild(hd);

    var body = h('div', 'mcs-body');
    rowRefs = {};

    KINDS.forEach(function (k) {
      var row = h('div', 'mcs-row');
      var lab = h('div', 'mcs-lab');
      lab.appendChild(h('span', '', k.label));
      var st = h('span', 'mcs-st', '');
      st.id = 'mcs-st-' + k.key;
      rowRefs[k.key] = st;
      lab.appendChild(st);
      row.appendChild(lab);

      var inp = h('input', 'mcs-in');
      inp.type = 'url';
      inp.inputMode = 'url';
      inp.autocapitalize = 'off';
      inp.autocorrect = 'off';
      inp.spellcheck = false;
      inp.placeholder = k.ph;
      inp.value = urlOf(k.key);
      inp.id = 'mcs-url-' + k.key;
      row.appendChild(inp);

      var acts = h('div', 'mcs-acts');
      var go = h('button', 'mcs-b', '拉取并导入');
      go.type = 'button';
      go.id = 'mcs-go-' + k.key;
      var save = h('button', 'mcs-b ghost', '只保存地址');
      save.type = 'button';
      save.addEventListener('click', function () {
        var v = (inp.value || '').trim();
        saveUrl(k.key, v);
        var li = lastInfo(k.key) || {};
        li.msg = v ? (li.msg || '地址已保存') : '地址已清空';
        saveLast(k.key, li);
        refreshRow(k.key);
        toast(v ? '地址已保存' : '地址已清空');
      });
      go.addEventListener('click', function () {
        var v = (inp.value || '').trim();
        if (!v) { toast('先填云端 json 地址'); return; }
        saveUrl(k.key, v);
        go.disabled = true;
        go.textContent = '拉取中…';
        pullOneKind(k.key, function (ok, msg, text) {
          go.disabled = false;
          go.textContent = '拉取并导入';
          if (!ok) { toast(k.label + ' 拉取失败：' + msg); return; }
          feedSite(k.key, text);
        });
      });
      acts.appendChild(go);
      acts.appendChild(save);
      row.appendChild(acts);
      body.appendChild(row);
    });

    card.appendChild(body);

    var fb = h('div', '', '');
    fb.style.cssText = 'padding:0 20px;';
    var fbNote = h('div', 'mcs-tip', '');
    fbNote.id = 'mcs-fallback-note';
    fbNote.hidden = true;
    var fbTa = document.createElement('textarea');
    fbTa.id = 'mcs-fallback-ta';
    fbTa.className = 'mcs-in';
    fbTa.rows = 5;
    fbTa.hidden = true;
    fbTa.style.marginBottom = '10px';
    fb.appendChild(fbNote);
    fb.appendChild(fbTa);
    card.appendChild(fb);

    var tip = h('div', 'mcs-tip',
      '只填写指向 JSON 的地址（https 开头）。拉取成功后会自动填进站点自己的导入框，' +
      '最后点一下「确定」就入库了。地址会记住，下次不用再填。');
    card.appendChild(tip);

    var ft = h('div', 'mcs-ft');
    var swWrap = h('div', '', '');
    swWrap.style.cssText = 'display:flex;align-items:center;gap:9px;';
    swWrap.appendChild(h('span', '', '打开时自动拉取'));
    var sw = h('button', 'mcs-sw' + (getLS(LS_AUTO) === '1' ? ' on' : ''));
    sw.type = 'button';
    sw.id = 'mcs-auto';
    sw.appendChild(h('i'));
    sw.addEventListener('click', function () {
      var on = getLS(LS_AUTO) === '1';
      setLS(LS_AUTO, on ? '0' : '1');
      sw.className = 'mcs-sw' + (on ? '' : ' on');
      toast(on ? '已关闭自动拉取' : '已开启：每次打开自动拉一次');
    });
    swWrap.appendChild(sw);
    ft.appendChild(swWrap);

    var all = h('button', 'mcs-b', '全部拉取');
    all.type = 'button';
    all.style.cssText = 'flex:none;padding:8px 14px;';
    all.addEventListener('click', function () {
      var keys = KINDS.map(function (k) { return k.key; }).filter(function (k) {
        return !!urlOf(k);
      });
      if (!keys.length) { toast('至少先填一个地址'); return; }
      all.disabled = true;
      all.textContent = '拉取中…';
      var i = 0;
      (function next() {
        if (i >= keys.length) {
          all.disabled = false;
          all.textContent = '全部拉取';
          toast('全部拉取完成，请在导入框里确认');
          return;
        }
        var k = keys[i++];
        pullOneKind(k, function (ok, msg, text) {
          if (ok) { feedSite(k, text); }
          next();
        });
      })();
    });
    ft.appendChild(all);
    card.appendChild(ft);

    mask.appendChild(card);
    mask.addEventListener('click', function (e) {
      if (e.target === mask) { closePanel(); }
    });
    document.body.appendChild(mask);
    panelEl = mask;

    KINDS.forEach(function (k) { refreshRow(k.key); });
  }

  /* --------------------------- 启动 --------------------------- */
  function mount() {
    injectCss();
    if (document.getElementById('mcs-fab')) { return; }

    var fab = document.createElement('button');
    fab.id = 'mcs-fab';
    fab.className = 'mcs-fab';
    fab.type = 'button';
    fab.setAttribute('aria-label', '云端同步');
    fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M17.5 19a4.5 4.5 0 0 0 .5-8.97A6.5 6.5 0 0 0 5.6 9.4 4.5 4.5 0 0 0 6.5 19z"/>' +
      '<path d="M12 12.4v4.4M10.2 14.6 12 12.4l1.8 2.2"/></svg>';
    fab.addEventListener('click', function () {
      if (panelEl) { closePanel(); } else { buildPanel(); }
    });
    document.body.appendChild(fab);

    // 「打开时自动拉取」：只拉已经存过地址的，且延后到页面空闲
    if (getLS(LS_AUTO) === '1') {
      setTimeout(function () {
        KINDS.forEach(function (k) {
          if (!urlOf(k.key)) { return; }
          var info = lastInfo(k.key);
          // 同一天内已经拉过就跳过，避免每次开都刷
          if (info && info.ok && info.at && (Date.now() - info.at) < 12 * 3600 * 1000) { return; }
          pullOneKind(k.key, function () {});
        });
      }, 3500);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
    // 兜底：若 DOMContentLoaded 已经错过（脚本被动态注入时很常见），1.2s 后强挂一次。
    // mount 内部有 #mcs-fab 幂等判断，重复调用安全。
    setTimeout(mount, 1200);
  } else {
    mount();
  }

  window.mochiCloudSync = {
    open: buildPanel,
    pull: pullOneKind,
    urlOf: urlOf
  };
})();
