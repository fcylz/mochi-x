// ==UserScript==
// @name         Mochi 云端字卡 / 表情包 / 曲库 自动同步
// @namespace    mochi-cloud-sync
// @version      1.3.0
// @description  打开页面即自动把你的云端字卡库、表情包库、曲库合并进本机 mochi 字卡。不改动站点任何代码，仅在浏览器里以用户脚本运行。
// @match        *://*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==
//
// 说明：@match 故意放宽，脚本靠运行时探测（window.xyStore / mochi 全局标记）判断是不是
// mochi 页面，非目标页面几毫秒内退出、不做任何网络请求、不写任何数据。
// 想更保险可以把 @match 改成你自己的站点，例如：
//   @match https://你的域名/*
//
// 云端仓库（改成你自己的）：
//   字卡/表情：https://github.com/fcylz/cy-chat   → 走 jsDelivr（带 CORS 头）
//   曲库：    https://github.com/fcylz/cy-music   → 走 GitHub Pages（实测带 ACAO:*）
//
// 站点侧用到的既有接口（全部是 mochi 自己暴露的，本脚本不新增任何站点代码）：
//   window.xyStore(prefix).get/set            idb.js:927     prefix 不带尾冒号
//   window.ccFlushSave()                      chatcard.js:1126
//   window.ccReloadGroupsAfterExternalWrite() chatcard.js:1130（官方为「外部写回」预留）
//   window.hydrateLibScopes(scopes, done)     chatcard.js:5340
//   window.libScopesDeferred(scopes)          chatcard.js:5347
//   window.idbEnsureBigKey(fullKey)           idb.js         'ok' | 'absent' | 'unknown'
//   window.mochiMediaTokenize(dataUrl)        media-pool.js:389
//   window.mochiMediaFlush()                  media-pool.js:370
//   音乐库键：xy-home-v2:default:music-library（music-player.js:1078）

(function () {
  'use strict';

  // ============================ 配置 ============================
  var CFG = {
    debug: true,                    // 打开控制台日志（排查完可设 false）

    // —— 云端端点 ——
    // 2026-10-22：cdn.jsdelivr.net 实测连不上（curl 000），换 fastly 镜像
    // （同目录同文件，200 正常返回；gcore.jsdelivr.net 也可用）。站点内置同理。
    wordUrl: 'https://fastly.jsdelivr.net/gh/fcylz/cy-chat@main/Word/word.json',
    memeUrl: 'https://fastly.jsdelivr.net/gh/fcylz/cy-chat@main/Meme/meme.json',
    memeBase: 'https://fastly.jsdelivr.net/gh/fcylz/cy-chat@main/',
    musicUrl: 'https://fcylz.github.io/cy-music/index.json',

    // —— 同步目标 ——
    // 'public' = 公用字卡库（xy-home-v2:cc-groups-public，所有桌面可用）
    // 'own'    = 当前联系人的专属库（xy-home-v2:<cid>:cc-groups）
    cardScope: 'public',
    // 云端分类 → mochi 字卡分类 + 分组名。未列出的分类按 defaultWordType 落到「云端·<label>」
    // 七分类于 2026-10 上线：只有颜文字 / emoji 在 mochi 有独立分类 tab，
    // 另外五个（日常/连接/称呼/官方语录/情话）是文本类，统一进主字卡。
    // 2026-10 追加的 13 个功能分类（cy-chat v2.1.0）落到同名功能池：key 即分类，
    // 与站点 chatcard.js 的 CC_FUNC_KEYS / card-audit.js 的 CC_LABEL 保持一致。
    // 刻意不映射表情包/图片/语音：云端字卡是纯文本，写进媒体分类只会得到破图与坏语音。
    wordMap: {
      customReplies: { type: 'text', group: '云端·自定义回复' },
      pokes: { type: 'poke', group: '云端·戳一戳' },
      statuses: { type: 'text', group: '云端·状态' },
      daily: { type: 'text', group: '云端·日常' },
      connect: { type: 'text', group: '云端·连接' },
      address: { type: 'text', group: '云端·称呼' },
      quotes: { type: 'text', group: '云端·官方语录' },
      sweet: { type: 'text', group: '云端·情话' },
      kaomoji: { type: 'kaomoji', group: '云端·颜文字' },
      emoji: { type: 'emoji', group: '云端·emoji' },
      // —— 功能分类（各功能页专属池，不进聊天通用回复）——
      fish: { type: 'fish', group: '云端·摸鱼' },
      eat: { type: 'eat', group: '云端·吃饭' },
      period: { type: 'period', group: '云端·经期' },
      water: { type: 'water', group: '云端·喝水' },
      garden: { type: 'garden', group: '云端·花园' },
      sync: { type: 'sync', group: '云端·同频' },
      reach: { type: 'reach', group: '云端·伸手' },
      cjian: { type: 'cjian', group: '云端·此间' },
      room: { type: 'room', group: '云端·房间' },
      piggy: { type: 'piggy', group: '云端·存钱罐' },
      drift: { type: 'drift', group: '云端·漂流瓶' },
      interact: { type: 'interact', group: '云端·互动回应' },
      music: { type: 'music', group: '云端·音乐' }
    },
    // 旧结构时期的三分类。单列一份是因为 wordMap 现在配满了七分类，
    // 若仍用「wordMap 里没有的 key」判断云端是否已换新结构，会永远判成旧结构，
    // 旧组清理就再也不会触发。
    legacyWordKeys: ['customReplies', 'pokes', 'statuses'],
    // true = 目标分类下若已有用户自己建的同名分组（去掉「云端·」前缀后相同），
    // 就把卡片并进去，而不是并排再建一个「云端·X」
    mergeSameNameGroup: true,
    defaultWordType: 'text',
    stickerGroupPrefix: '云端·',
    musicPlaylistId: 'default',     // 'default' = 未分类；'spl_default' = 内置默认歌单
    musicReloadOnChange: false,     // 曲库在页面启动后有更新时，是否自动刷新一次让它立刻生效

    // —— 体积 / 批次 / 节流 ——
    stickerMaxBytes: 400 * 1024,    // 单张表情原始体积上限，超过则跳过
    stickerInlineMaxChars: 32 * 1024, // 令牌化不可用时，允许内联 dataURL 的最大字符数
    stickerPerRun: 150,             // 每次打开最多新增多少张（剩下的下次继续）
    stickerConcurrency: 3,
    stickerFlushEvery: 25,          // 每攒够多少张写回一次字卡库
    musicPerRun: 600,
    startDelayMs: 8000,             // 页面就绪后再等多久才拉取（避开开屏/启动回填）
    refetchThrottleMs: 10 * 60 * 1000  // 同一份云端数据 10 分钟内不重复下载（曲库缓存仍会每次预写）
  };

  var MIRROR_KEY = 'mochi-cloud-sync:v1';
  var CC_TYPES = ['text', 'kaomoji', 'emoji', 'sticker', 'image', 'poke', 'voice'];
  // 「其它互动功能字卡」分类（同站点 chatcard.js 的 CC_FUNC_KEYS）。
  // 这些 key 不是载体类型，而是各功能页自己的抽卡池；写进去的卡只在该功能里被抽到。
  // 云端的 13 个功能分类（cy-chat v2.1.0）要落到这里，不能落到 text——否则
  // 「该吃饭了」这类话术会被聊天通用回复抽出来。
  var CC_FUNC_TYPES = ['fish', 'eat', 'period', 'water', 'garden', 'sync', 'reach', 'cjian', 'room', 'piggy', 'drift', 'interact', 'music'];
  // 可写分类 = 7 个载体 + 13 个功能池。CC_TYPES 仍只用于「库骨架」归一化（parsePack），
  // 不把 13 个功能 key 塞进每个用户的空库，避免无谓膨胀。
  var CC_WRITE_TYPES = CC_TYPES.concat(CC_FUNC_TYPES);

  function log() {
    if (!CFG.debug) return;
    try { console.log.apply(console, ['[cloud-sync]'].concat([].slice.call(arguments))); } catch (e) {}
  }
  var mirror = loadMirror();

  function loadMirror() {
    try { return JSON.parse(localStorage.getItem(MIRROR_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function saveMirror() {
    try { localStorage.setItem(MIRROR_KEY, JSON.stringify(mirror)); } catch (e) {}
  }
  function hash32(s) {
    var h = 5381;
    s = String(s || '');
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return ('00000000' + h.toString(16)).slice(-8);
  }

  // ============================ 存储定位 ============================
  function cardTarget() {
    if (CFG.cardScope === 'public') {
      return { prefix: 'xy-home-v2', key: 'cc-groups-public' };
    }
    var p = (typeof window.activePrefix === 'function' && window.activePrefix()) || 'xy-home-v2:default';
    return { prefix: p, key: 'cc-groups' };
  }

  // 等页面数据就绪；就绪前写大键会撞「防覆盖守卫」/启动回填
  function waitDataReady(maxMs) {
    return new Promise(function (res) {
      if (window.__mochiDataReady) return res(true);
      var waited = 0;
      var iv = setInterval(function () {
        waited += 400;
        if (window.__mochiDataReady || waited >= (maxMs || 60000)) { clearInterval(iv); res(!!window.__mochiDataReady); }
      }, 400);
    });
  }

  // 取回「权威」字卡包：读不到时问 IndexedDB，状态 unknown 一律放弃本轮（绝不拿空树覆盖）
  function readCardPack() {
    var t = cardTarget();
    var st = window.xyStore(t.prefix);
    var full = t.prefix + ':' + t.key;
    var scope = CFG.cardScope === 'public' ? 'public' : 'own';

    return Promise.resolve()
      .then(function () { return waitDataReady(); })
      .then(function () {
        if (window.hydrateLibScopes) { try { return window.hydrateLibScopes([scope]); } catch (e) {} }
      })
      .then(function () {
        if (window.libScopesDeferred && window.libScopesDeferred([scope])) {
          log('字卡大键仍在延迟清单，本轮不写');
          return null;
        }
        var raw = st.get(t.key);
        if (raw !== null && raw !== undefined) return raw;
        if (!window.idbEnsureBigKey) { log('无 idbEnsureBigKey 且同步读空，本轮不写'); return null; }
        return Promise.resolve(window.idbEnsureBigKey(full)).then(function (state) {
          if (state === 'ok') { var r2 = st.get(t.key); return (r2 === null || r2 === undefined) ? '' : r2; }
          if (state === 'absent') return '';           // 库确实还不存在 → 可以建库
          log('idbEnsureBigKey=' + state + '，本轮不写'); return null;
        });
      })
      .catch(function (e) { log('读取字卡包失败', e); return null; });
  }

  function writeCardPack(obj) {
    var t = cardTarget();
    try { if (window.ccFlushSave) window.ccFlushSave(); } catch (e) {}  // 先清掉管理页待保存的旧编辑树
    window.xyStore(t.prefix).set(t.key, JSON.stringify(obj));
    try { if (window.ccReloadGroupsAfterExternalWrite) window.ccReloadGroupsAfterExternalWrite(); } catch (e2) {}
  }

  function parsePack(raw) {
    var o = {};
    try { o = JSON.parse(raw || '{}') || {}; } catch (e) { o = {}; }
    if (!o || typeof o !== 'object') o = {};
    CC_TYPES.forEach(function (k) { if (!Array.isArray(o[k])) o[k] = []; });
    return o;
  }

  function ensureGroup(pack, type, name) {
    if (!Array.isArray(pack[type])) pack[type] = [];
    for (var i = 0; i < pack[type].length; i++) {
      if (pack[type][i] && pack[type][i][0] === name) return pack[type][i][1];
    }
    var g = [name, []];
    pack[type].push(g);
    return g[1];
  }

  /**
   * 云端分类落组：组与组之间能不能匹配，就看这里。
   *
   * 目标分类 type 下按顺序找：
   *   ① 「云端·<label>」——上一轮云端导入建的组，重复导入不会分裂成两个同名组
   *   ② 「<label>」——用户自己建的同名分组（mergeSameNameGroup 开启时）→ 并进去，
   *      不再并排建一个「云端·<label>」，避免同一类字卡在库里出现两份组织
   *   ③ 都没有，才新建「云端·<label>」
   *
   * @returns {{arr: Array, merged: boolean}}
   */
  function resolveWordGroup(pack, type, bare) {
    if (!Array.isArray(pack[type])) pack[type] = [];
    var prefixed = CFG.stickerGroupPrefix + bare;
    var i;
    for (i = 0; i < pack[type].length; i++) {
      if (pack[type][i] && pack[type][i][0] === prefixed) return { arr: pack[type][i][1], merged: false };
    }
    if (CFG.mergeSameNameGroup !== false) {
      for (i = 0; i < pack[type].length; i++) {
        if (pack[type][i] && pack[type][i][0] === bare) return { arr: pack[type][i][1], merged: true };
      }
    }
    return { arr: ensureGroup(pack, type, prefixed), merged: false };
  }

  // ============================ 字卡 ============================
  /**
   * 旧结构迁移清理。
   *
   * cy-chat 的字卡在 2026-10 从「一个 customReplies 装 1521 条」拆成了七个分类
   * （daily / connect / address / quotes / sweet / kaomoji / emoji）。旧结构时期本脚本
   * 把这 1521 条写进「云端·自定义回复」一个组，升级后新分类会各自建组，旧组没人清，
   * 于是同一批字卡在库里出现两遍（1521 + 1521）。
   *
   * 清理条件严格：只有在「云端已经是新结构（出现了 legacyWordKeys 之外的分类）」且
   * 「该旧分类已经从云端消失」时才动，并且逐条比对内容——
   *   · 组内每一条都能在云端找到 → 说明这组就是旧结构的完整副本，整组删除；
   *   · 只要有一条对不上（用户自己往这组里加过东西）→ 保留这组，只摘掉能对上的。
   * 云端若退回旧结构，本函数直接返回 0，绝不误删。
   *
   * @returns {number} 被移除的条目数
   */
  function purgeLegacyGroups(pack, cats) {
    var LEGACY = CFG.legacyWordKeys || ['customReplies', 'pokes', 'statuses'];
    // 「云端已换新结构」的判据：出现了旧三分类之外的分类。
    // 不能写成「出现了 wordMap 里没配的分类」——七分类现已全部配进 wordMap，
    // 那样会永远判成旧结构，旧组再也清不掉。
    var hasNewShape = Object.keys(cats).some(function (k) { return LEGACY.indexOf(k) < 0; });
    if (!hasNewShape) return 0;

    var cloud = Object.create(null);
    var cloudCount = 0;
    Object.keys(cats).forEach(function (k) {
      (cats[k].items || []).forEach(function (it) {
        var t = String((it && it.text) || '').trim();
        if (t) { cloud[t] = 1; cloudCount++; }
      });
    });
    if (!cloudCount) return 0;

    // 旧组名 = legacyWordKeys 里配过、但云端已经没有这个分类的那些
    var legacy = [];
    LEGACY.forEach(function (k) {
      if (cats[k]) return;
      var g = CFG.wordMap[k] && CFG.wordMap[k].group;
      if (g && legacy.indexOf(g) < 0) legacy.push(g);
    });
    if (!legacy.length) return 0;

    var removed = 0;
    CC_TYPES.forEach(function (type) {
      var groups = pack[type];
      if (!Array.isArray(groups)) return;
      for (var i = groups.length - 1; i >= 0; i--) {
        var g = groups[i];
        if (!g || legacy.indexOf(g[0]) < 0 || !Array.isArray(g[1])) continue;
        var keep = [];
        g[1].forEach(function (x) {
          if (cloud[String(x).trim()]) removed++; else keep.push(x);
        });
        if (!keep.length) {
          groups.splice(i, 1);
          log('迁移清理：删除旧组「' + g[0] + '」');
        } else if (keep.length !== g[1].length) {
          g[1] = keep;
          log('迁移清理：旧组「' + g[0] + '」保留 ' + keep.length + ' 条自有内容');
        }
      }
    });
    return removed;
  }

  function syncWord() {
    if (!window.xyStore) return Promise.resolve(0);
    return fetchJson(CFG.wordUrl).then(function (data) {
      var sig = (data && (data.updatedAt || '') + '|' + (data.version || '')) || '';
      /* 旧版脚本没有 purgeSig：升级后必须放行一次清理检查，
         否则云端内容没变（sig 相同）会直接跳过，孤立的旧组永远清不掉。 */
      var purgePending = !!sig && mirror.purgeSig !== sig;
      if (sig && mirror.wordSig === sig && !purgePending) { log('字卡无更新，跳过'); return 0; }
      var cats = (data && data.categories) || {};
      var keys = Object.keys(cats);
      if (!keys.length) return 0;

      return readCardPack().then(function (raw) {
        if (raw === null) return 0;                 // 权威库没问到 → 本轮放弃
        var pack = parsePack(raw);
        var added = 0;
        var mergedNames = [];

        /* 先清理再新增：新增只会往新组里写，顺序不影响正确性，
           但先清可以让「只清不增」的情况也走到下面的写回。 */
        var purged = purgeLegacyGroups(pack, cats);
        if (purged) log('迁移清理：移除旧结构重复字卡 ' + purged + ' 条');
        if (purgePending) mirror.purgeSig = sig;    // 这一版数据检查过了，下次不必重查

        keys.forEach(function (ck) {
          var c = cats[ck] || {};
          var items = c.items || [];
          if (!items.length) return;
          var m = CFG.wordMap[ck];
          var type = (m && m.type) || CFG.defaultWordType;
          if (CC_WRITE_TYPES.indexOf(type) < 0) type = CFG.defaultWordType;
          var group = (m && m.group) || (CFG.stickerGroupPrefix + (c.label || ck));
          // 组名去掉「云端·」就是裸名：拿它去和用户自己建的分组比对，同名则并入
          var bare = group.indexOf(CFG.stickerGroupPrefix) === 0 ? group.slice(CFG.stickerGroupPrefix.length) : group;
          var hit = ((CFG.legacyWordKeys || []).indexOf(ck) >= 0)
            ? { arr: ensureGroup(pack, type, group), merged: false }   // 旧分类不参与同名合并，免得清错组
            : resolveWordGroup(pack, type, bare);
          if (hit.merged && mergedNames.indexOf(bare) < 0) mergedNames.push(bare);
          var arr = hit.arr;
          var seen = {};
          arr.forEach(function (x) { seen[String(x)] = 1; });
          items.forEach(function (it) {
            var txt = String((it && it.text) || '').trim();
            if (!txt || txt.charAt(0) === '#') return;   // 空行与注释不入库
            if (seen[txt]) return;                        // 同分组内容去重
            seen[txt] = 1;
            arr.push(txt);
            added++;
          });
        });
        if (!added && !purged) { mirror.wordSig = sig; return 0; }
        writeCardPack(pack);
        mirror.wordSig = sig;
        log('字卡新增 ' + added + ' 条' + (mergedNames.length ? '，并入已有分组 ' + mergedNames.join('/') : '')
          + (purged ? '，清理旧结构 ' + purged + ' 条' : ''));
        return added;
      });
    }).catch(function (e) { log('字卡同步失败（静默）', e && e.message); return 0; });
  }

  // ============================ 表情包 ============================
  // 表情卡在库里存的是「媒体池令牌 @@m:<hash>」（拿不到令牌才退内联 dataURL），
  // 所以云端图片必须下载 → 转 dataURL → 令牌化 → 入池，再写回字卡库。
  function syncMeme() {
    if (!window.xyStore || !window.mochiMediaTokenize) { log('媒体池不可用，跳过表情同步'); return Promise.resolve(0); }
    return fetchJson(CFG.memeUrl).then(function (data) {
      var sig = (data && (data.updatedAt || '') + '|' + (data.version || '')) || '';
      var cats = (data && data.categories) || {};
      var applied = mirror.memeIds || {};
      var todo = [];
      Object.keys(cats).forEach(function (ck) {
        var c = cats[ck] || {};
        var group = CFG.stickerGroupPrefix + (c.label || ck);
        (c.items || []).forEach(function (it) {
          if (!it || !it.url || applied[it.id]) return;
          if (it.bytes && it.bytes > CFG.stickerMaxBytes) return;
          todo.push({ id: it.id, url: it.url, group: group });
        });
      });
      if (!todo.length) { log('表情无新增'); return 0; }
      todo = todo.slice(0, CFG.stickerPerRun);

      var pack = null, added = 0, pending = 0;
      var queue = todo.slice();

      function flush(force) {
        if (!pack || (!added && !force)) return Promise.resolve();
        writeCardPack(pack);
        added = 0;
        return Promise.resolve();
      }

      function loadPack() {
        if (pack) return Promise.resolve(pack);
        return readCardPack().then(function (raw) {
          if (raw === null) return null;
          pack = parsePack(raw);
          return pack;
        });
      }

      function one(task) {
        return fetchDataUrl(CFG.memeBase + encodeURI(task.url)).then(function (dataUrl) {
          if (!dataUrl) return;
          var card = null;
          return Promise.resolve(window.mochiMediaTokenize(dataUrl, { noCache: true }))
            .then(function (tok) {
              if (tok) {
                return Promise.resolve(window.mochiMediaFlush()).then(function () { card = tok; });
              }
              if (dataUrl.length <= CFG.stickerInlineMaxChars) card = dataUrl;  // 令牌化不可用：小图内联
            })
            .then(function () {
              if (!card) return;
              return loadPack().then(function (p) {
                if (!p) return;                       // 读不到权威库 → 不写
                var arr = ensureGroup(p, 'sticker', task.group);
                if (arr.indexOf(card) < 0) { arr.push(card); added++; pending++; }
                applied[task.id] = 1;                 // 幂等：已处理过的云端 id 不再重复下载
                if (added >= CFG.stickerFlushEvery) return flush(false);
              });
            });
        }).catch(function () { /* 单张失败不影响整批 */ });
      }

      var idx = 0;
      function step() {
        if (idx >= queue.length) return Promise.resolve();
        var batch = queue.slice(idx, idx + CFG.stickerConcurrency);
        idx += CFG.stickerConcurrency;
        return Promise.all(batch.map(one)).then(step);
      }

      return step()
        .then(function () { return flush(true); })
        .then(function () {
          mirror.memeIds = applied;
          mirror.memeSig = sig;
          log('表情新增 ' + pending + ' 张');
          return pending;
        });
    }).catch(function (e) { log('表情同步失败（静默）', e && e.message); return 0; });
  }

  // ============================ 曲库 ============================
  function toTrack(it) {
    var nm = String((it && it.name) || '').trim();
    var title = nm, artist = '';
    var i = nm.lastIndexOf('-');
    if (i > 0) { title = nm.slice(0, i).trim(); artist = nm.slice(i + 1).trim(); }
    var url = String(it.mp3 || it.url || '');
    return {
      id: 'cloud_' + hash32(url || nm),
      neteaseId: '',
      name: title || '链接音乐',
      artist: artist,
      url: url,
      source: 'url',
      duration: 0,
      playlistId: CFG.musicPlaylistId || 'default',
      addedAt: Date.now(),
      lrc: it.lrc || ''
    };
  }

  // 写音乐库：merge by id（幂等）。页面已 boot 音乐模块时改动要下次打开才生效（或按配置刷新）。
  function mergeMusic(tracks) {
    if (!tracks || !tracks.length || !window.xyStore) return 0;
    var st = window.xyStore('xy-home-v2:default');
    var lib = [];
    try { lib = JSON.parse(st.get('music-library') || '[]'); } catch (e) { lib = []; }
    if (!Array.isArray(lib)) lib = [];
    var have = {};
    lib.forEach(function (m) { if (m && m.id) have[m.id] = 1; });
    var add = [];
    tracks.forEach(function (t) { if (t && t.url && !have[t.id]) { have[t.id] = 1; add.push(t); } });
    if (!add.length) return 0;
    st.set('music-library', JSON.stringify(lib.concat(add)));
    return add.length;
  }

  // 同步、无网络：把上次缓存的曲库先写进去，让音乐模块 boot 时直接读到
  function applyMusicCache() {
    try {
      var n = mergeMusic(mirror.musicCache || []);
      if (n) log('曲库（本地缓存）补入 ' + n + ' 首');
    } catch (e) {}
  }

  function syncMusic() {
    if (!window.xyStore) return Promise.resolve(0);
    return fetchJson(CFG.musicUrl).then(function (list) {
      if (!Array.isArray(list) || !list.length) return 0;
      var tracks = list.slice(0, CFG.musicPerRun).map(toTrack);
      var sig = list.length + '|' + hash32(String(list[list.length - 1] && list[list.length - 1].mp3));
      mirror.musicCache = tracks;                 // 供下次冷启动同步预写
      var n = mergeMusic(tracks);
      mirror.musicSig = sig;
      if (n) {
        log('曲库新增 ' + n + ' 首');
        // 音乐库在模块 boot 时一次性读入内存，运行中改存储不会重读（music-player.js:5012）
        if (CFG.musicReloadOnChange && window.__mochiMusic) {
          try {
            if (!sessionStorage.getItem('mochi-cloud-sync:reloaded')) {
              sessionStorage.setItem('mochi-cloud-sync:reloaded', '1');
              setTimeout(function () { location.reload(); }, 1500);
            }
          } catch (e2) {}
        }
      }
      return n;
    }).catch(function (e) { log('曲库同步失败（静默）', e && e.message); return 0; });
  }

  // ============================ 网络 ============================
  function fetchJson(url) {
    return fetch(url + (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  function fetchDataUrl(url) {
    return fetch(url, { mode: 'cors' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
      .then(function (b) {
        if (b.size > CFG.stickerMaxBytes) return null;
        return new Promise(function (res, rej) {
          var fr = new FileReader();
          fr.onload = function () { res(String(fr.result || '')); };
          fr.onerror = rej;
          fr.readAsDataURL(b);
        });
      });
  }

  // ============================ 调度 ============================
  var started = false;
  function runSync() {
    if (started) return;
    started = true;
    var last = Number(mirror.ts || 0);
    // 节流：短时间内反复刷新页面不重复下载（曲库缓存仍会同步预写）
    var fresh = (Date.now() - last) > CFG.refetchThrottleMs;
    setTimeout(function () {
      var chain = Promise.resolve();
      chain = chain.then(function () { return fresh ? syncMusic() : 0; });
      chain = chain.then(function () { return fresh ? syncWord() : 0; });
      chain = chain.then(function () { return fresh ? syncMeme() : 0; });
      chain.then(function () { if (fresh) mirror.ts = Date.now(); saveMirror(); })
        .catch(function () { saveMirror(); });
    }, CFG.startDelayMs);
  }

  function onRestoreDone() {
    try { applyMusicCache(); } catch (e) {}
    runSync();
  }

  // document-start 就注册：我们的监听排在页面自己的监听之前，
  // 因此曲库能在音乐模块 boot（mochi-restore-done → bootMusic）之前写进去。
  document.addEventListener('mochi-restore-done', onRestoreDone, { once: true });

  // 兜底：事件没来（离线/异常）时也要把缓存曲库预写进去
  var guard = 0;
  var iv = setInterval(function () {
    guard += 500;
    if (window.xyStore && window.__mochiDataReady) {
      // 只在回填完成之后写：回填前写的曲库会被 IndexedDB 里的旧值覆盖
      try { applyMusicCache(); } catch (e) {}
      clearInterval(iv);
      runSync();
    }
    if (guard >= 30000) { clearInterval(iv); if (window.xyStore) runSync(); }
  }, 500);
})();
