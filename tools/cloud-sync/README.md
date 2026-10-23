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

### 分类落位与分组合并（脚本 1.2.0 起，站点同步）

云端七分类 → mochi 字卡分类：

| 云端分类 | 落到 mochi 的 | 说明 |
|---|---|---|
| `kaomoji` 颜文字 | **颜文字** tab | 有独立分类 |
| `emoji` emoji | **emoji** tab | 有独立分类 |
| `daily` 日常 / `connect` 连接 / `address` 称呼 / `quotes` 官方语录 / `sweet` 情话 | **主字卡** tab | 都是文本类，各成一组建在同一个 tab 下 |

刻意不映射表情包/图片/语音：云端字卡是纯文本，塞进媒体分类只会得到破图与坏语音。

**组与组怎么匹配**——目标分类下按顺序找同名分组，命中即并入，不再并排建第二个：

1. 先找「云端·日常」这类**上一轮云端导入建的组** → 复用，重复导入不会分裂成两个同名组；
2. 再找**你自己建的完全同名分组**「日常」→ 并进去（`CFG.mergeSameNameGroup = false` 可关掉）；
3. 都没有，才新建「云端·日常」。

并入时你自己的字卡排在前面，云端内容追加在后面，组内仍然逐条去重。脚本日志会打印
`字卡新增 N 条，并入已有分组 日常/颜文字`。

站点内导入走同一套规则：`【云端·<label>】` 开头的数据块按 label 分流到对应分类，分组名同样
先并同名、再新建。普通手动粘贴（行首 `【组名】` 不带「云端·」前缀）行为不变，仍然落在当前 tab。

### 旧结构迁移清理（脚本 1.1.0 起）

cy-chat 的字卡在 2026-10 从「一个 `customReplies` 装 1521 条」拆成了七个分类
（`daily` / `connect` / `address` / `quotes` / `sweet` / `kaomoji` / `emoji`）。

旧结构时期，本脚本把这 1521 条写进「云端·自定义回复」一个组。拆分类之后，七个新分类
会各自建组，旧组没人清，于是同一批字卡在库里出现两遍（1521 + 1521）。

1.1.0 起同步时会顺手清理，规则很保守：

- 只有云端**已经是新结构**（出现了 `CFG.legacyWordKeys` 之外的分类）且旧分类已从云端消失，
  才动手；云端若退回旧结构，直接跳过，不会误删。
- 逐条比对内容：组内每一条都能在云端找到 → 判定为旧结构的完整副本，整组删除。
- 只要有一条对不上（你自己往这组里加过东西）→ 保留该组，只摘掉能对上的那些。
- 清理只在「这一版云端数据」上做一次（`mirror.purgeSig`），不会每次开页面都扫库。

日志会打印 `迁移清理：移除旧结构重复字卡 N 条`。如果没看到任何清理日志、但库里确实有
两份，先确认 `CFG.wordMap` 里配的组名和库里旧组的名字是否一致。

> 1.2.0 把七分类都配进了 `wordMap`（为了给它们指定分类和组名），所以「是否已换新结构」的
> 判据改成了 `legacyWordKeys` 白名单——继续用「`wordMap` 里没配的 key」判断会永远判成旧结构，
> 旧组就再也清不掉了。

## 云端仓库

- 字卡 / 表情：`github.com/fcylz/cy-chat` → 走 jsDelivr（带 `Access-Control-Allow-Origin: *`）
- 曲库：`github.com/fcylz/cy-music` → 走 GitHub Pages（同样带 `ACAO:*`）
- `raw.githubusercontent.com` 取不到字卡那两个 json，别换成它
- ⚠️ **jsDelivr 要用可用镜像**：2026-10-22 实测 `cdn.jsdelivr.net` 在本机网络直接连不上
  （curl 返回 000），`fastly.jsdelivr.net` / `gcore.jsdelivr.net` 正常返回 200。
  站点内置顺序为 `fastly → gcore → cdn`，本脚本的 `CFG.wordUrl / memeUrl / memeBase`
  已同步改成 `fastly.jsdelivr.net`。

均为**公开**仓库，别放私人内容。
