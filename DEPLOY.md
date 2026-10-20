# 部署到 GitHub Pages + 云端导入怎么用

## 一、这次加的是什么

在**现有三个导入入口**里加了「粘贴云端库链接」的能力，UI 一个字节没动、也没加按钮：

| 位置 | 怎么用 | 云端数据 |
|---|---|---|
| 字卡库 → 公用/专属字卡 → 右上角「批量导入」 | 粘贴 `https://cdn.jsdelivr.net/gh/fcylz/cy-chat@main/Word/word.json`，点确定 | 1521 条，落在「云端·自定义回复」分组 |
| 字卡库 → 表情包/图片分类 →「链接导入」 | 粘贴 `https://cdn.jsdelivr.net/gh/fcylz/cy-chat@main/Meme/meme.json`，点确定 | 78 张，落在「云端·反应表情」分组 |
| 音乐 →「批量导入」 | 粘贴 `https://fcylz.github.io/cy-music/index.json`，点「开始导入」 | 72 首，按歌单落位 |

要点：

- **留空直接点确定＝用上一次成功用过的地址**（按字卡/表情/曲库分别记忆），以后不用每次都粘链接
- 展开后的去重、分组、图片压缩转存/入媒体池、音乐落库与刷新，全部走站点**原有**的导入管线
- 改了源码，所以每次都要 `node build.mjs` 重新生成 `index.html` 与 `js/`（已构建好，见下）
- 只新增了 `src/js/cloud-import.js` 一个模块，并在 `build.mjs` 的 `jsFiles` 清单里登记；三处回调各自只加了几行

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
3. 打开你的站点 → 对应导入入口 → **留空直接点确定** → 新内容增量并入（已有的自动去重，不会重复入库）

## 四、出问题怎么查

- 「云端字卡获取失败 / 网络或跨域问题」：链接不是 `.json`、CDN 还没刷新、或网络不通。先在浏览器地址栏直接打开那个链接确认能返回 JSON
- 「没有可导入的内容」：json 结构不对（应为 `categories.{key}.items[]` 或曲库的数组）
- 表情导入慢/部分失败：走的是原有链接导入管线，图床跨域失败会按链接保存；单张超过 1MB 会自动跳过
- 音乐导入后没出现：音乐页刷新一次即可（导入后已落库）
- 想确认改动有没有进产物：`js/cloud-import.js` 存在、且 `js/chatcard.js`、`js/music-player.js` 里能搜到 `mochiCloudImport`

本地自检（不依赖浏览器）：

```bash
node tools/cloud-sync/smoke-cloud-import.mjs
```

## 五、条款提醒（README 明确要求，照做）

- 自加的云存储/云端导入**不要公开给别人使用**，自己用、私部署没问题
- 公开部署的二改版本**不要把系统内置字卡打包进去**
- 开屏公告与作者署名（`小红书 @言序（1842523578）`）不得删除或修改
- 云端仓库目前是公开的：字卡/表情/曲库内容任何人都能拉到，别放私人内容
