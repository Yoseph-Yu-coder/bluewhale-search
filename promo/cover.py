"""宣传片封面 · 4:3（1440×1080）。

4:3 比 16:9 窄，原来的左右分栏放不下，所以改成三段：
左上文字主张 → 右上整张立绘 → 底部横贯的搜索条与结果。

立绘是白底，靠把近白像素压成纯白融进白背景，不需要抠图，方边也看不出来。

    python cover.py
产物：out/cover.png（1440×1080）、out/cover-small.png（360×270，检查缩略辨识度）
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import render as R  # noqa: E402

# 逻辑画布 1080×810（4:3），2 倍超采样，再缩到 1440×1080
W, H = 1080, 810
SS = 2
OUT_W, OUT_H = 1440, 1080
OUT = HERE / "out"

ACCENT = (77, 107, 254)
INK = (17, 19, 24)
INK_SOFT = (60, 66, 80)
GRAY = (107, 114, 128)
GRAY_LIGHT = (150, 156, 168)

M = 64          # 页边距
BAR_W = W - M * 2
FIG = 500       # 立绘边长
FIG_X, FIG_Y = 530, 24


# ------------------------------------------------------------------ 背景
def background() -> Image.Image:
    """纯白底 + 左下角一抹蓝；光晕在立绘左边界之前收干净，避免方块露边"""
    w, h = W * SS, H * SS
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    base = np.full((h, w, 3), 255.0, dtype=np.float32)

    d = np.sqrt(((xx - w * 0.10) / (w * 0.62)) ** 2 + ((yy - h * 1.02) / (h * 0.50)) ** 2)
    glow = np.clip(1.0 - d, 0.0, 1.0) ** 2.0
    glow = glow * np.clip(((FIG_X - 16) / W - xx / w) / 0.10, 0.0, 1.0)

    out = base * (1 - glow[..., None] * 0.13) + np.array(ACCENT, dtype=np.float32) * (glow[..., None] * 0.13)
    return Image.fromarray(np.clip(out, 0, 255).astype("uint8"), "RGB")


# ------------------------------------------------------------------ 立绘
def figure(img: Image.Image) -> None:
    art = Image.open(HERE.parent / "assets" / "portrait.jpg").convert("RGB")

    # 近白压成纯白：JPEG 噪点消失，白底与背景完全同色
    arr = np.asarray(art).astype(np.float32)
    arr = np.where(arr >= 247, 255.0, arr)
    art = Image.fromarray(arr.astype("uint8"), "RGB")

    art = art.resize((FIG * SS, FIG * SS), Image.LANCZOS)
    img.paste(art, (int(FIG_X * SS), int(FIG_Y * SS)))


# ------------------------------------------------------------------ 文字
def headline(d: ImageDraw.ImageDraw) -> None:
    x = M
    y1 = 262
    size = 64

    end = R.draw_text(d, "搜", x, y1, size, 600, INK, tracking=0)
    R.draw_text(d, "bilibili", end + 16, y1, size, 600, ACCENT, tracking=-1.4)

    y2 = y1 + 78
    R.draw_text(d, "第一条就是", x, y2, size, 600, INK, tracking=0)
    seg = R.text_width("第一条就是", size, 600)
    R.draw_text(d, "官网", x + seg + 5, y2, size, 600, ACCENT, tracking=0)

    # 价格胶囊：全图唯一的高饱和实心色块
    api = "DeepSeek 搜索 API"
    R.draw_text(d, api, x, y2 + 62, 22, 400, INK_SOFT, tracking=0.3)

    aw = R.text_width(api, 22, 400, tracking=0.3)
    label = "5 元 / 1000 次"
    lw = R.text_width(label, 18, 600)
    px, py, ph = x + aw + 16, y2 + 62 - 25, 34
    R.rr(d, px, py, lw + 28, ph, ph / 2, fill=ACCENT)
    R.draw_text(d, label, px + 14, py + 24, 18, 600, (255, 255, 255))


def product(d: ImageDraw.ImageDraw, img: Image.Image) -> None:
    """底部横贯的搜索条 + 第一条结果：把「官网优先」变成可看的东西"""
    x, y, w, h = M, 542, BAR_W, 80

    R.paste_shadow(img, x, y, w, h, h / 2, blur=20, alpha=0.09)
    R.rr(d, x, y, w, h, h / 2, fill=R.SURFACE, outline=R.LINE, width=1)

    icx, icy, r = x + 38, y + h / 2, 8
    d.ellipse(
        [(icx - r) * SS, (icy - r) * SS, (icx + r) * SS, (icy + r) * SS],
        outline=GRAY,
        width=int(2 * SS),
    )
    d.line(
        [(icx + r * 0.7) * SS, (icy + r * 0.7) * SS, (icx + r * 1.95) * SS, (icy + r * 1.95) * SS],
        fill=GRAY,
        width=int(2 * SS),
    )
    R.draw_text(d, "bilibili", x + 68, y + h / 2 + 8, 23, 400, INK, tracking=-0.1)

    # 右端的 Enter 提示：与界面一致，也把这条长条配平
    kw, kh = 68, 32
    kx = x + w - 20 - kw
    ky = y + (h - kh) / 2
    R.rr(d, kx, ky, kw, kh, 8, outline=R.LINE, width=1)
    R.draw_text(d, "Enter", kx + 13, ky + 21, 14, 400, GRAY, tracking=0.4)

    # 结果行：徽标 + 域名
    ry = y + h + 42
    label = "官网"
    bw = R.text_width(label, 14, 600) + 18
    R.rr(d, x + 2, ry - 19, bw, 26, 6, fill=(233, 237, 255))
    R.draw_text(d, label, x + 2 + 9, ry, 14, 600, ACCENT)
    R.draw_text(d, "bilibili.com", x + 2 + bw + 14, ry, 15, 400, GRAY_LIGHT)

    R.draw_text(d, "哔哩哔哩", x + 2, ry + 52, 30, 600, INK, tracking=-0.3)


def brand(d: ImageDraw.ImageDraw, img: Image.Image) -> None:
    icon = Image.open(HERE.parent / "src" / "icons" / "mark64.png").convert("RGBA")
    size = 38
    icon = icon.resize((size * SS, size * SS), Image.LANCZOS)
    img.paste(icon, (M * SS, 54 * SS), icon)
    R.draw_text(d, "蓝鲸搜索", M + size + 13, 54 + 26, 21, 600, (52, 58, 72), tracking=0.4)


# ------------------------------------------------------------------ 组装
def build() -> Image.Image:
    img = background()
    d = ImageDraw.Draw(img)
    figure(img)
    headline(d)
    product(d, img)
    brand(d, img)
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    full = build().resize((OUT_W, OUT_H), Image.LANCZOS)
    full.save(OUT / "cover.png", "PNG", optimize=True)
    full.resize((360, 270), Image.LANCZOS).save(OUT / "cover-small.png", "PNG", optimize=True)
    print(f"out/cover.png  {OUT_W}×{OUT_H}")


if __name__ == "__main__":
    main()
