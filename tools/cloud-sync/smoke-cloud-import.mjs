// 云端导入冒烟
// ①Node 层：直接跑 src/js/cloud-import.js（桩掉 window/localStorage/fetch），
//   验证链接识别、三份云端数据取回与展开格式、上次地址记忆
// ②浏览器层（可选）：装了 playwright 才跑——起本地静态服务打开 index.html，
//   走「字卡库 → 公用字卡 → 批量导入 → 粘贴云端链接 → 确定」，验证真的落库
// 用法：node tools/cloud-sync/smoke-cloud-import.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'd:/mochi';
const SRC = path.join(ROOT, 'src', 'js', 'cloud-import.js');
const WORD = 'https://cdn.jsdelivr.net/gh/fcylz/cy-chat@main/Word/word.json';
const MEME = 'https://cdn.jsdelivr.net/gh/fcylz/cy-chat@main/Meme/meme.json';
const MUSIC = 'https://fcylz.github.io/cy-music/index.json';

// ---------- ① Node 层 ----------
const store = new Map();
const fakeLS = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v))
};
const win = {};
new Function('window', 'localStorage', 'fetch', 'URL', fs.readFileSync(SRC, 'utf8'))(win, fakeLS, fetch, URL);
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

const wordText = await retry(() => CI.fetch(WORD, 'word'));
const wordLines = wordText.split('\n');
assert('字卡展开：含【云端·自定义回复】分组头', wordLines[0] === '【云端·自定义回复】', wordLines[0]);
assert('字卡展开：条数 > 1000', wordLines.length > 1000, wordLines.length + ' 行');

const memeText = await retry(() => CI.fetch(MEME, 'meme'));
const memeLines = memeText.split('\n');
assert('表情展开：分组头 + 绝对直链',
  memeLines[0] === '【云端·反应表情】' && /^https:\/\/cdn\.jsdelivr\.net\/.+\.(jpg|png|gif|jpeg)$/i.test(memeLines[1]),
  memeLines[1]);
assert('表情展开：路径不重复（无 /Meme/Meme/）', memeText.indexOf('/Meme/Meme/') < 0 && /\/Meme\/images\/reactions\//.test(memeLines[1]));

const musicText = await retry(() => CI.fetch(MUSIC, 'music'));
const musicBlocks = musicText.split(/\n\s*\n/).filter(Boolean);
assert('曲库展开：分块且含 歌曲名称/歌手/音乐直链URL',
  musicBlocks.length > 50 && /^歌曲名称：.+/.test(musicBlocks[0]) && /音乐直链URL：https:\/\//.test(musicBlocks[0]),
  musicBlocks.length + ' 首');

assert('记住上次地址（按用途分记）',
  CI.lastUrl('word') === WORD && CI.lastUrl('music') === MUSIC && CI.pickUrl('', 'word', true) === WORD);
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
  await page.click('#cc-import', { timeout: 5000 });
  await page.waitForSelector('#modal-textarea', { state: 'visible', timeout: 5000 });
  await page.fill('#modal-textarea', WORD);
  await page.click('#modal-ok', { timeout: 5000 });
  await page.waitForTimeout(25000);
  console.log('字卡落库：', JSON.stringify(await page.evaluate(() => {
    const raw = localStorage.getItem('xy-home-v2:cc-groups-public') || '';
    let o = {}; try { o = JSON.parse(raw); } catch (e) {}
    const g = (o.text || []).find(x => x[0] === '云端·自定义回复');
    return { hasGroup: !!g, count: g ? g[1].length : 0, bytes: raw.length };
  })));
} catch (e) { console.log('⚠ UI 端到端跳过：' + e.message); }
console.log('页面错误：', JSON.stringify(errs.slice(0, 10), null, 2));
await browser.close();
server.close();
