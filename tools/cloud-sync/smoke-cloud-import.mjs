// 云端导入冒烟
// ①Node 层：直接跑 src/js/cloud-import.js（桩掉 window/localStorage/fetch），
//   验证链接识别、三份云端数据取回与展开格式、上次地址记忆
// ②浏览器层（可选）：装了 playwright 才跑——起本地静态服务打开 index.html，
//   走「字卡库 → 公用字卡 → 点工具栏【云端字卡】」，验证真的一键落库（不输入链接）
// 用法：node tools/cloud-sync/smoke-cloud-import.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'd:/mochi-x';
const SRC = path.join(ROOT, 'src', 'js', 'cloud-import.js');
// 2026-10-22 起地址不再写死在脚本里：模块内置多镜像（fastly/gcore/cdn.jsdelivr.net），
// fetchAny() 按顺序回退。这里直接用模块自己的 defaults 做烟囱，改镜像不用同步改脚本。
const WORD = 'https://fastly.jsdelivr.net/gh/fcylz/cy-chat@main/Word/word.json';
const MEME = 'https://fastly.jsdelivr.net/gh/fcylz/cy-chat@main/Meme/meme.json';
const MUSIC = 'https://fcylz.github.io/cy-music/index.json';

// ---------- ① Node 层 ----------
const store = new Map();
const fakeLS = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v))
};
// 模块末尾会绑按钮，需要最小 DOM 桩；getElementById 返回 null＝按钮不存在，直接跳过绑定
const fakeDoc = {
  readyState: 'complete',
  addEventListener() {},
  getElementById() { return null; },
  createElement() { return {}; },
  head: {}
};
const win = {};
new Function('window', 'localStorage', 'fetch', 'URL', 'document', fs.readFileSync(SRC, 'utf8'))(win, fakeLS, fetch, URL, fakeDoc);
const CI = win.mochiCloudImport;

const assert = (name, ok, extra) => console.log((ok ? '✅ ' : '❌ ') + name + (extra ? ' — ' + extra : ''));
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function retry(fn, n = 4) { // CDN/网络偶发 ECONNRESET，重试几次再判定
  let last;
  for (let i = 0; i < n; i++) {
    try { return await fn(); } catch (e) { last = e; await sleep(1200); }
  }
  throw last;
}
assert('模块挂载 window.mochiCloudImport', !!CI);
assert('识别云端 json 链接', CI.isCloudUrl(WORD) && CI.isCloudUrl(MUSIC));
assert('不放行多行文本/图片直链',
  !CI.isCloudUrl('https://a.png\nhttps://b.png') && !CI.isCloudUrl('https://x.com/a.jpg') && !CI.isCloudUrl('【日常】\n你好'));
assert('内置默认地址：三库都有且不止一个镜像',
  ['word', 'meme', 'music'].every(k => Array.isArray(CI.defaults[k]) && CI.defaults[k].length >= 2));
assert('取址顺序：上次成功 > 自定义 > 默认镜像', (() => {
  const u = CI.resolveUrls('word', '');
  return u.length >= 3 && /\.json$/.test(u[0]);
})());
// 全部镜像不可达时：必须报「已试 N 个」而不是挂住（单个镜像 8s 超时）。
// 放在真正拉取之前：此时还没记住任何地址，resolveUrls 只会返回被换成坏地址的默认列表。
const badBefore = CI.defaults.word.slice();
CI.defaults.word = ['https://127.0.0.1:1/a.json', 'https://127.0.0.1:1/b.json'];
try {
  await CI.fetchAny('word', '');
  assert('全镜像失败时抛出错误', false, '竟然成功了');
} catch (e) {
  assert('全镜像失败：错误带已试数量', /已试 2 个/.test(e.message || ''), e.message);
}
CI.defaults.word = badBefore;

// 用 fetchAny 走真实网络：验证「多镜像顺序回退」这条主线真的能拿到数据
const wordRes = await retry(() => CI.fetchAny('word', ''));
const wordText = wordRes.text;
const wordLines = wordText.split('\n');
assert('字卡一键拉取（fetchAny 命中镜像）', !!wordText, '命中 ' + wordRes.url + '，试了 ' + wordRes.tried + ' 个');
// 字卡已从「一个 customReplies」拆成七分类，分组头不再固定是「云端·自定义回复」；
// 只校验「有【云端·<label>】形式的头」，具体有哪些分类由云端数据决定
const wordHeads = wordLines.filter(l => /^【云端·.+】$/.test(l));
assert('字卡展开：分组头带「云端·」前缀', wordHeads.length > 0, wordHeads.slice(0, 4).join(' ') + (wordHeads.length > 4 ? ' …共 ' + wordHeads.length + ' 个' : ''));
assert('字卡展开：条数 > 1000', wordLines.length > 1000, wordLines.length + ' 行');

const memeRes = await retry(() => CI.fetchAny('meme', ''));
const memeText = memeRes.text;
const memeLines = memeText.split('\n');
assert('表情一键拉取（fetchAny 命中镜像）', !!memeText, '命中 ' + memeRes.url + '，试了 ' + memeRes.tried + ' 个');
assert('表情展开：分组头 + 绝对直链',
  memeLines[0] === '【云端·反应表情】' && /^https:\/\/.+\.(jpg|png|gif|jpeg)$/i.test(memeLines[1]),
  memeLines[1]);
assert('表情展开：路径不重复（无 /Meme/Meme/）', memeText.indexOf('/Meme/Meme/') < 0 && /\/Meme\/images\/reactions\//.test(memeLines[1]));
// 回归（2026-10-22 第二个坑）：jsDelivr 只缓存文本资源，图片一律 301 跳
// raw.githubusercontent.com（国内不通）→ 报「非图片地址、导入失败」且时好时坏。
// 所以展开出的图片直链必须钉在直出源 gcore，且真要能取到 image/*。
assert('表情图片钉在直出源（不跟随 301）', new URL(memeLines[1]).hostname === 'gcore.jsdelivr.net', new URL(memeLines[1]).hostname);
{
  const imgUrls = memeText.split('\n').filter(l => /^https:/i.test(l));
  const probe = [imgUrls[0], imgUrls[Math.floor(imgUrls.length / 2)], imgUrls[imgUrls.length - 1]];
  let imgOk = 0;
  for (const u of probe) {
    try {
      const r = await fetch(u);
      if (r.ok && /^image\//i.test(r.headers.get('content-type') || '')) imgOk++;
    } catch (e) { /* 记为失败 */ }
  }
  assert('表情图片抽样真取得到 image/*', imgOk === probe.length, imgOk + '/' + probe.length);
}

const musicRes = await retry(() => CI.fetchAny('music', ''));
const musicText = musicRes.text;
const musicBlocks = musicText.split(/\n\s*\n/).filter(Boolean);
assert('曲库一键拉取（fetchAny 命中镜像）', !!musicText, '命中 ' + musicRes.url + '，试了 ' + musicRes.tried + ' 个');
assert('曲库展开：分块且含 歌曲名称/歌手/音乐直链URL',
  musicBlocks.length > 50 && /^歌曲名称：.+/.test(musicBlocks[0]) && /音乐直链URL：https:\/\//.test(musicBlocks[0]),
  musicBlocks.length + ' 首');

assert('记住命中镜像（按用途分记）',
  !!CI.lastUrl('word') && !!CI.lastUrl('music') && CI.pickUrl('', 'word', true) === CI.lastUrl('word'));
assert('留空且不记住时不会误用', CI.pickUrl('', 'meme', false) === '' || !CI.lastUrl('meme'));

console.log('\n曲库首块：\n' + musicBlocks[0]);
console.log('字卡前 2 行：\n' + wordLines.slice(0, 2).join('\n'));
console.log('表情前 2 行：\n' + memeLines.slice(0, 2).join('\n'));

// ---------- ② 浏览器层（装了 playwright 才跑） ----------
let chromium = null;
try { ({ chromium } = await import('playwright')); } catch (e) { chromium = null; }
if (!chromium) {
  console.log('\n（未安装 playwright，跳过浏览器端到端；装了之后重跑本脚本即可）');
  process.exit(0);
}

const PORT = 8123;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };
const server = (await import('node:http')).createServer((req, res) => {
  const u = decodeURIComponent((req.url || '/').split('?')[0]);
  const f = path.join(ROOT, u === '/' ? 'index.html' : u.replace(/^\/+/, ''));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded' });
try { await page.waitForFunction('window.__mochiDataReady === true', null, { timeout: 90000 }); } catch (e) { console.log('⚠ 数据未在 90s 内就绪'); }
console.log('\n模块随包加载：', JSON.stringify(await page.evaluate(() => ({
  loaded: (window.__mochiLoaded || []).indexOf('cloud-import.js') >= 0,
  jsErrors: window.__jsErrors || []
}))));
try {
  await page.click('.tab[data-page="page-chatcard"]', { timeout: 5000 });
  await page.waitForTimeout(600);
  await page.click('#li-custom-cards-public', { timeout: 5000 });
  await page.waitForTimeout(2000);
  // 一键拉取：直接点工具栏「云端字卡」，不弹输入框、不粘链接
  await page.click('#cc-cloud-word', { timeout: 5000 });
  await page.waitForTimeout(25000);
  console.log('字卡落库：', JSON.stringify(await page.evaluate(() => {
    const raw = localStorage.getItem('xy-home-v2:cc-groups-public') || '';
    let o = {}; try { o = JSON.parse(raw); } catch (e) {}
    // 云端正文字卡落主字卡、颜文字/emoji 各自落到自己的分类，这里三个分类一起看
    const dump = (t) => (o[t] || []).map(x => x[0] + '(' + (x[1] || []).length + ')');
    const total = ['text', 'kaomoji', 'emoji']
      .reduce((n, t) => n + (o[t] || []).reduce((s, x) => s + (x[1] || []).length, 0), 0);
    return { total, text: dump('text'), kaomoji: dump('kaomoji'), emoji: dump('emoji'), bytes: raw.length };
  })));
} catch (e) { console.log('⚠ UI 端到端跳过：' + e.message); }
console.log('页面错误：', JSON.stringify(errs.slice(0, 10), null, 2));
await browser.close();
server.close();
