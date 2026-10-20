# 云端导入（云端字卡 / 表情包 / 曲库）

现在的实现在**站点源码里**，不是外部脚本：

- `src/js/cloud-import.js`：识别云端 `.json` 链接 → 拉取 → 展开成现有导入框本来就认的格式
- `src/js/chatcard.js`：字卡「批量导入」、表情/图片「链接导入」两个回调接入
- `src/js/music-player.js`：音乐「批量导入」回调接入
- `build.mjs`：`jsFiles` 清单里登记了 `cloud-import.js`

落库、去重、分组、图片压缩转存/入媒体池、音乐落库刷新，全部复用站点**原有**导入管线。
改完源码必须 `node build.mjs` 重新构建。用法与部署见仓库根目录的 `DEPLOY.md`。

## 自检

```bash
node tools/cloud-sync/smoke-cloud-import.mjs
```

Node 层必跑（链接识别、三份云端数据取回与展开、上次地址记忆）；装了 playwright 会额外跑一次
浏览器端到端（起本地服务打开 index.html，真的点一次「批量导入」验证落库）。

## 备选：油猴脚本（桌面自动同步）

`mochi-cloud-sync.user.js` 是另一条路——不装进站点，靠浏览器扩展在**打开页面时自动同步**
（不用手动点导入）。桌面装 Tampermonkey/Violentmonkey 即可，手机基本用不了。

两条路可以并存：站点内的「云端导入」负责随时手动补内容，脚本负责打开即自动同步。
脚本内部用的是同一套站点接口（`ccReloadGroupsAfterExternalWrite`、`mochiMediaTokenize` 等），
互不冲突——两边都做了内容去重，重复导入不会产生重复字卡。

## 云端仓库

- 字卡 / 表情：`github.com/fcylz/cy-chat` → 走 jsDelivr（带 `Access-Control-Allow-Origin: *`）
- 曲库：`github.com/fcylz/cy-music` → 走 GitHub Pages（同样带 `ACAO:*`）
- `raw.githubusercontent.com` 取不到字卡那两个 json，别换成它

均为**公开**仓库，别放私人内容。
