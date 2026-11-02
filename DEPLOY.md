# 部署到 GitHub Pages + 云端导入怎么用

## 一、这次加的是什么

**一键拉取云端库：不用输链接，按钮就在对应库自己的工具栏里。**

| 位置（按钮就在那儿） | 怎么用 | 云端数据 |
|---|---|---|
| 字卡库（可定义字卡）工具栏 →「云端字卡」（只在文字类分类显示） | 点一下 | 1521 条，落在「云端·自定义回复」等分组 |
| 字卡库 →【表情包】/【图片】分类 →「云端表情」 | 点一下 | 78 张，落在「云端·反应表情」分组 |
| 音乐页 →「云端曲库」（在「批量导入」旁边） | 点一下 | 72 首，按歌单落位 |

要点：

- **不用输入任何链接**：三库地址内置在 `src/js/cloud-import.js` 的 `DEFAULTS` 里，每库一串镜像，按顺序回退、单个 8 秒超时，命中即记住该镜像，下次直接从它开始
- **只手动点按钮**，不会自动拉取、不会偷偷写库
- 展开后的去重、分组、图片压缩转存/入媒体池、音乐落库与刷新，全部走站点**原有**的导入管线（三个导入管线已提升为模块级函数，弹窗与按钮共用同一条，不另起一套）
- 原来的「批量导入 / 链接导入」弹窗仍然可以粘贴 `.json` 链接自定义地址，粘过一次就记住；**留空直接点确定**＝用上次成功用过的地址（语义未变）
- 改了源码，所以每次都要 `node build.mjs` 重新生成 `index.html` 与 `js/`（已构建好，见下）
- 模块只有 `src/js/cloud-import.js` 一个，入口按钮在 `src/template.html`，管线入口在 `src/js/chatcard.js` / `src/js/music-player.js`

### 内置镜像顺序（改这里换源）

```
字卡 / 表情：fastly.jsdelivr.net → gcore.jsdelivr.net → cdn.jsdelivr.net
曲库：       fcylz.github.io/cy-music/index.json → fastly.jsdelivr.net → gcore.jsdelivr.net
```

> 2026-10-22 实测：`cdn.jsdelivr.net` 在本机网络直接连不上（curl 返回 000），
> `fastly.jsdelivr.net` / `gcore.jsdelivr.net` 正常返回 200。这就是「APP 拉不到字卡和表情、
> 曲库却能拉」的根因——**与 APP 无关**（APP 是 WebView 远程加载站点，与浏览器同源同策略），
> 浏览器里同样会失败。换成可用镜像后三端一致。

## 二、推到 GitHub 并开启 Pages

仓库目前还没初始化，**按顺序执行**（最后一条 `git push` 需要你的 GitHub 账号）：

```bash
cd d:/mochi
git init
git add -A
git commit -m "部署：Mochi + 云端字卡/表情/曲库导入"

# 在 GitHub 上新建一个空仓库（不要勾 README / .gitignore），然后：
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git branch -M main
git push -u origin main
```

然后到仓库 **Settings → Pages**：

- Source：**Deploy from a branch**
- Branch：**main** / 目录 **/(root)** → Save

等 1–2 分钟，访问：

```
https://<你的用户名>.github.io/<仓库名>/
```

> `index.html` 本身就是构建产物（`build.mjs` 输出），不需要在云端构建。
> 以后只要改了 `src/`，本地跑一次 `node build.mjs` 再提交推送即可。

## 三、云端内容怎么更新、多久生效

1. 往 `cy-chat` / `cy-music` 仓库里加内容并 push
2. 生效时间：
   - **曲库**（GitHub Pages）：1–2 分钟
   - **字卡/表情**（jsDelivr CDN）：一般几分钟，最坏约 12 小时；想立刻生效就清一次缓存：
     ```
     https://purge.jsdelivr.net/gh/fcylz/cy-chat@main/Word/word.json
     https://purge.jsdelivr.net/gh/fcylz/cy-chat@main/Meme/meme.json
     ```
3. 打开你的站点 → 对应库的工具栏 → **点「云端字卡 / 云端表情 / 云端曲库」** → 新内容增量并入（已有的自动去重，不会重复入库）

## 四、出问题怎么查

- 按钮点了没反应/一直「拉取中…」：单个镜像 8 秒超时，最多试 3 个，最长 ~24 秒一定出结果，不会无限挂住
- 「云端字卡获取失败：已试 N 个地址都失败：…」：看括号里的明细逐个排查
  - `超时（>8s）`＝该镜像连不上或太慢（会自动换下一个）
  - `HTTP 404/403`＝仓库路径变了或仓库不存在
  - `云端数据里没有可导入的内容`＝json 结构不对（应为 `categories.{key}.items[]` 或曲库的数组）
  - 末尾会附上最后尝试的域名，方便直接判断是哪个源挂了
- 想手动确认某个地址通不通：`curl.exe -s -o NUL -w "%{http_code} %{size_download}\n" <地址>`
- 「没有可导入的内容」：json 结构不对（应为 `categories.{key}.items[]` 或曲库的数组）
- 表情导入慢/部分失败：走的是原有链接导入管线，图床跨域失败会按链接保存；单张超过 1MB 会自动跳过

### 「云端表情报非图片地址 / 导入失败」——已修，原因在这

**jsDelivr 只缓存文本资源，图片一律 301 跳 `raw.githubusercontent.com`。** 所以「json 能取到」不代表「图片能取到」：

| 源 | `meme.json` | 图片 `Meme/images/...` |
|---|---|---|
| `fastly.jsdelivr.net` | 200 ✅ | **301 → raw.githubusercontent.com**（国内不通）→ **0/78** ❌ |
| `gcore.jsdelivr.net` | 200 ✅ | **200 直出 image/jpeg·gif·png** → **78/78** ✅ |

表现为**时好时坏**：网络恰好连得上 `raw.githubusercontent.com` 的那次就成功了，连不上就整批报「非图片地址」。

处理办法（已在代码里）：

1. `src/js/cloud-import.js` 新增 `IMG_HOST`：**展开出的图片直链 host 一律钉到 `gcore.jsdelivr.net`**，与 json 是从哪个镜像拉回来的无关（老用户早先记住的 fastly 地址照样能救回来）
2. 表情的默认地址顺序改成 `gcore → fastly → cdn`，json 也从直出源取，两头一致
3. `src/js/chatcard.js` 的 `fetchLinkImage` 加一层换源兜底：jsDelivr 图片判失败时自动换 `gcore` 重试一次（`st==='url'` 的超大 GIF 不重试，免得白等 12s）
4. `tools/cloud-sync/smoke-cloud-import.mjs` 加了两条回归断言：图片 host 必须是 gcore + 抽样真取必须是 `image/*`
- 音乐导入后没出现：音乐页刷新一次即可（导入后已落库）
- 按钮不见了：【云端字卡】只在文字类分类显示、【云端表情】只在【表情包】【图片】显示，切一下分类即可
- 想确认改动有没有进产物：`js/cloud-import.js` 里能搜到 `fastly.jsdelivr.net` 与 `fetchAny`，且 `index.html` 里能搜到 `cc-cloud-word` / `cc-cloud-meme` / `music-cloud`

本地自检（不依赖浏览器，会真发请求验证三个库都能拉到、并验证全镜像失败时的报错）：

```bash
node tools/cloud-sync/smoke-cloud-import.mjs
```

## 五、条款提醒（README 明确要求，照做）

- 自加的云存储/云端导入**不要公开给别人使用**，自己用、私部署没问题
- 公开部署的二改版本**不要把系统内置字卡打包进去**
- 开屏公告与作者署名（`小红书 @言序（1842523578）`）不得删除或修改
- 云端仓库目前是公开的：字卡/表情/曲库内容任何人都能拉到，别放私人内容
