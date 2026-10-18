# 蓝鲸搜索 · 宣传片

16.5 秒，1920×1080，60fps，H.264。逐帧绘制后用 ffmpeg 编码。

## 生成

```powershell
# 1. 渲染 990 帧（约 5–8 分钟，2 倍超采样）
python render.py --all

# 2. 编码
pwsh -File encode.ps1
# 产物：out/bluewhale-search-promo.mp4
```

只想看某几个瞬间，不用渲全片：

```powershell
python render.py --preview 0.9 4.1 6.9 13.4
# 输出到 build/preview/tXX.XX.png
```

## 封面

```powershell
python cover.py
```

`out/cover.png`（1440×1080，4:3）+ `out/cover-small.png`（360×270，用来检查缩略辨识度）。
立绘是白底，脚本把近白像素压成纯白后直接贴在白背景上，不需要抠图。

## 分镜

| 时间 | 内容 |
| --- | --- |
| 0–1.0 | 淡入：时钟、胶囊搜索框 |
| 1.0–2.2 | 静置，输入框光标闪烁 |
| 2.2–3.4 | 逐字输入 `bilibili` |
| 3.4–3.9 | 回车，时钟退场，搜索框滑到顶部（FLIP） |
| 3.95–5 | 结果逐条错峰浮起，第一条带「官网」徽标 |
| 5.6–6.4 | 光标出现，页面下滚到「阅读更多」 |
| 6.7 | 点击，5 条新结果追加 |
| 7.5–8.6 | 继续下滚看新结果，再滚回顶部 |
| 8.7–10.4 | 点齿轮，菜单展开，输入 API Key，保存 |
| 10.9–11.5 | 关菜单，回到首页布局（反向 FLIP） |
| 11.7–16.5 | 片尾：图标、蓝鲸搜索、三个特性、API 署名 |

## 改内容

- **文案 / 结果**：`render.py` 里的 `ROWS`（标题、站点、日期、两行摘要）
- **时间线**：`T` 字典，所有时间点都在那儿
- **配色**：顶部常量，与 `src/start.css` 一一对应
- **光标轨迹**：`cursor_state()` 里的 `keys`

## 编码参数

`-crf 16 -preset slow -tune animation -pix_fmt yuv420p -profile:v high`

- `yuv420p` 保证微信、Safari、手机相册都能直接播
- `-tune animation` 保大面积纯色渐变不出现色带
- `-movflags +faststart` 让网络播放可以边下边播

## 取舍

- **无音轨**。要加音乐，把音频文件丢给 ffmpeg 直接混：
  `ffmpeg -i out/bluewhale-search-promo.mp4 -i music.mp3 -c:v copy -c:a aac -shortest out/final.mp4`
- **界面是按设计参数重绘的近似**，不是屏幕录制。像素尺寸、圆角、字号、配色都对齐 `start.css`，但字形渲染（FreeType + 系统字体）和浏览器排版会有细微差别。
- 渲染时按 1440×810 的逻辑视口绘制再放大到 1080p，这样文字在手机上也看得清。
