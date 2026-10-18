# 蓝鲸搜索 · 新标签页

一个替代新标签页的搜索起始页：中间是大时钟和一枚胶囊搜索框，右上角一颗齿轮，点开是设置。
搜索走后端是 DeepSeek 官方的 Search / Fetch 接口，一套源码同时打 Chrome 和 Firefox 两个包。

## 界面

```
┌──────────────────────────────────────────────────────────┐
│  ◉ 蓝鲸                                              ⚙   │
│                                                          │
│                       11:27                              │
│                  2026年10月18日 星期日                    │
│                                                          │
│              ⌕  搜索网页                        Enter    │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

- **输入即搜**：回车后时钟退场，搜索框滑到顶部，结果在下方展开
- **键盘全程可用**：`/` 或 `⌘K` 聚焦，`↑↓` 选结果，`Esc` 回到首页，`Enter` 打开
- **结果**：站点 / 日期 / 两行摘要；悬停出现「查看正文」「复制引用」
- **官网优先**：搜 `bilibili`、`zhihu` 这类短导航词时，把该站首页钉在第一位并标「官网」
- **阅读更多**：一次取满 50 条，先显示一页，点底部按钮逐页展开，不额外花钱
- **查看正文**：走 Fetch 接口把网页正文内联展开，不用跳走
- **复制全部**：把所有结果导成 Markdown 列表，直接丢给模型
- **设置**：右上角齿轮 → 菜单里放 API Key、每页条数、是否附带正文、缓存清空

## 构建

```powershell
pwsh -File build.ps1
```

产物：

```
dist/
  chrome/                            # 可直接加载的目录
  firefox/                           # 可直接加载的目录
  bluewhale-search-chrome-1.3.0.zip
  bluewhale-search-firefox-1.3.0.xpi  # 未签名，用于临时加载或送签
```

## 安装

### Chrome / Edge

1. `chrome://extensions` → 打开「开发者模式」
2. 「加载已解压的扩展程序」→ 选 `dist/chrome`
3. 新开一个标签页，右上角齿轮 → 填 API Key

### Firefox：临时加载（开发用，重启失效）

`about:debugging#/runtime/this-firefox` → 「临时载入附加组件」→ 选 `dist/firefox/manifest.json`

### Firefox：正式签名

Firefox Release 强制验签，签名只能由 Mozilla 的 AMO 完成，不能自己生成证书。

1. 到 <https://addons.mozilla.org/developers/addon/api/key/> 生成 JWT issuer / secret
2. 跑：

```powershell
pwsh -File sign-firefox.ps1 -ApiKey 'user:12345:67' -ApiSecret 'xxxxxxxx'
```

3. 签好的 `.xpi` 在 `dist/signed/`，`about:addons` → 齿轮 → 「从文件安装附加组件」

或者网页上传：<https://addons.mozilla.org/developers/addon/submit/> 选 **On your own**（unlisted）。

两个坑：**每次重签必须先改 version**；`gecko.id`（现在 `bluewhale-search@local.dev`）要换成你自己的域名，否则后续升级覆盖不了。

## 自检

```powershell
node tools/selftest.mjs
```

用假的 `chrome.*` 和 `fetch` 加载真实的 `background.js`，14 项覆盖请求体、鉴权头、缓存、401/402/429、Fetch 链路、节流间隔、以及三种入口（工具栏、地址栏 `ds`、首次安装）打开的 URL。不需要 Key，不产生费用。

## 只想看看界面？

```powershell
pwsh -File preview.ps1
```

生成 `dist/preview/preview.html`，用任何浏览器直接打开即可，不需要装扩展、不联网、不花钱。加参数可以看不同状态：

- `preview.html?q=deepseek` — 结果态
- `preview.html?setup=1` — 设置菜单展开的样子

## 设计取舍

**为什么一次取 50 条。** 接口按请求次数计费、与条数无关，也没有 offset / 分页参数。所以拉取永远是 50 条，前端只显示一页（默认 10 条），底部「阅读更多」逐页追加。翻到底不增加成本——因为压根没有第二次请求。

**「第一个要是官网」怎么判。** 不改写 query、不额外发请求，只用结果里的证据：查询 ≤2 个词且 ≤18 字符才算导航型；找域名标签（`bilibili.com` → `bilibili`）或站点名与查询对得上的结果，按命中条数挑出最可信的站点；把它的首页地址提到第一位并打「官网」标记（结果里已有根路径就复用，否则用 `https://域名/`）。结果里没出现这个站点就不动——不猜域名，避免把第一条变成错的。

**为什么没有真正的「下一页」。** Search 接口没有 offset，第二次请求只会拿到同样的一批结果。所以这里不做假分页，而是把一次拿到的 50 条分页展示。

**搜索框从中间滑到顶部，是用 FLIP 算出来的。** 切换视图时先记下搜索框当前的屏幕位置，改完布局再记一次，用两者的差做一次 `translateY` 动画。全程只动 `transform`；中途再切换，动画会从当前屏幕位置重新起算，不会跳。

**菜单从齿轮「长」出来。** `transform-origin: top right` + `scale(0.96)→1`，190ms 强 ease-out。进出同一条路径，点外面或按 Esc 收回。

**动效克制的部分。** 结果列表的入场退化为 26ms 的错峰上浮，只做前 7 条；齿轮在展开时转 30°；开关是个滑块。没有弹跳、没有回弹、没有视差——新标签页是每天见几十次的东西，动效只在有信息量时出现。

**小字对比度是调过的。** 灰字在浅色底上按 4.5:1 取的值，不是「看起来还行」的 #999。

**无障碍。** 尊重 `prefers-reduced-motion`（去掉位移与弹簧，保留透明度）、`prefers-reduced-transparency`（菜单退化为不透明）、`prefers-contrast`；完整键盘操作与 `:focus-visible` 焦点环。

## 目录结构

```
deepseek-search-ext/
  assets/portrait.jpg        # 图标源图（改这张，重新构建会自动重生成图标）
  src/
    manifest.chrome.json     # MV3 + service_worker + newtab 覆盖
    manifest.firefox.json    # MV3 + background.scripts + gecko.id
    start.html/css/js        # 新标签页（唯一界面）
    background.js            # 出站请求、节流、缓存、错误映射、omnibox
    icons/                   # 16/32/48/96/128 扩展图标 + mark64 左上角标记
  tools/make_icons.py        # 从 portrait.jpg 裁切生成图标（≤48 用紧构图，≥96 带肩部）
  tools/selftest.mjs         # 后台自检
  build.ps1 / sign-firefox.ps1
  package.json
```

## 成本与限制

| 项目 | 数值 |
| --- | --- |
| Search / Fetch | 5 元 / 1000 次**成功**请求 |
| 计费口径 | 按请求次数，与 `count`、token 无关 |
| 失败是否计费 | 否 |
| 单次上限 | 50 条，无 offset / 分页（取 50 条与取 5 条同价） |
| 限速 | Search、Fetch 各 5 QPS，按账号 |

界面里已经内置：相同搜索词 10 分钟本地缓存（不重复计费）、请求串行节流约 3.8 QPS、429 自动退避一次。

注意：Harness / Claude Code / Codex 里的 Server 端工具调用**目前免计费**，2026-11-01 00:00 起收费；本扩展直连接口，一直按上表计费。

## 排错

| 现象 | 处理 |
| --- | --- |
| 新标签页没变 | 检查扩展是否启用；Chrome 同一时间只能有一个扩展覆盖新标签页 |
| 401 / 提示 Key 无效 | 齿轮菜单里重填，注意别带空格 |
| 402 余额不足 | 充值后重试 |
| 429 | 触发 5 QPS，等几秒；确认没有别的脚本共用同一账号 |
| 网络请求失败 | 断网或代理拦截；若服务端拒绝扩展来源，需要一个极薄的中转（Cloudflare Worker 即可） |
| Firefox 装不上 xpi | 没签名，走上面的签名流程 |

## 许可证

[PolyForm Noncommercial 1.0.0](LICENSE.md) —— 源码公开，可以阅读、修改、分发，
但**仅限非商业用途**。

- 允许：个人使用、学习研究、教学、慈善与公共机构使用、二次开发与分发
- 不允许：任何以商业利益或报酬为目的的使用（包括打包进付费产品、托管成付费服务）
- 商业授权：如需商用，请联系作者单独授权

注意这不是 OSI 认可的开源许可证，而是「源码可用（source-available）」。
如果你要的是真正意义上的开源，需要换成 MIT / Apache-2.0 / GPL 等允许商用的许可证。

图标与人像素材（`assets/portrait.jpg`）不在上述授权范围内，商用或再分发前请自行确认其版权来源。
