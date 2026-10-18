"""DeepSeek 搜索 · 宣传片渲染器

逐帧绘制 1920×1080 @ 60fps，2 倍超采样后缩放，交给 ffmpeg 编码。
所有动效都是时间 t 的确定函数，没有随机、没有状态漂移，所以不会出现抖动。

用法：
    python render.py --preview 0.6 3.2 4.1 5.0 7.6 9.6 13.0
    python render.py --all
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

# ------------------------------------------------------------------ 基本参数
W, H = 1440, 810           # 逻辑视口（渲染时放大 1.5 倍到 1080p，手机上才看得清）
SS = 2                     # 超采样倍数（2880×1620 → 1920×1080）
FPS = 60
DURATION = 16.5
FRAMES_DIR = Path(__file__).parent / "build" / "frames"

FONT_DIR = Path("C:/Windows/Fonts")

# ------------------------------------------------------------------ 配色（与 start.css 对齐）
BG = (247, 247, 248)
SURFACE = (255, 255, 255)
SURFACE_2 = (241, 241, 243)
TEXT = (17, 19, 24)
TEXT_2 = (75, 82, 98)
TEXT_3 = (107, 114, 128)
ACCENT = (77, 107, 254)
ACCENT_SOFT = (233, 237, 255)
LINE = (237, 237, 238)
LINE_ON_BG = (230, 230, 232)

# ------------------------------------------------------------------ 布局（1x 像素）
FINDER_W, FINDER_H = 640, 58
FINDER_X = (W - FINDER_W) // 2
HOME_FINDER_TOP = 413
RESULT_FINDER_TOP = 104
CLOCK_TOP = 267
RESULTS_TOP = RESULT_FINDER_TOP + FINDER_H + 24   # 186
ROW_H = 120

# ------------------------------------------------------------------ 时间线
T = {
    "intro": (0.0, 1.0),
    "type": (2.20, 3.40),
    "enter": 3.45,
    "flip": (3.55, 3.90),
    "rows_in": 3.95,
    "rows_dur": 0.30,
    "row_stagger": 0.026,
    "more_click": 6.70,
    "append": 6.78,
    "gear_click": 8.70,
    "menu_in": (8.70, 9.00),
    "key_type": (9.15, 9.95),
    "save_click": 10.25,
    "menu_out": (10.85, 11.10),
    "home_flip": (11.10, 11.45),
    "outro_in": (11.70, 12.50),
    "outro_end": 16.2,
}

QUERY = "bilibili"


# ------------------------------------------------------------------ 缓动
def clamp(v, lo=0.0, hi=1.0):
    return max(lo, min(hi, v))


def progress(t, a, b):
    if b <= a:
        return 1.0 if t >= b else 0.0
    return clamp((t - a) / (b - a))


def ease_out_cubic(p):
    return 1 - (1 - p) ** 3


def ease_in_out_cubic(p):
    return 4 * p ** 3 if p < 0.5 else 1 - ((-2 * p + 2) ** 3) / 2


def cubic_bezier(p, x1, y1, x2, y2):
    """标准 CSS cubic-bezier 求值（牛顿迭代求参数）"""
    if p <= 0:
        return 0.0
    if p >= 1:
        return 1.0

    def bezier_x(s):
        return 3 * (1 - s) ** 2 * s * x1 + 3 * (1 - s) * s ** 2 * x2 + s ** 3

    def bezier_y(s):
        return 3 * (1 - s) ** 2 * s * y1 + 3 * (1 - s) * s ** 2 * y2 + s ** 3

    s = p
    for _ in range(6):
        dx = bezier_x(s) - p
        d = 3 * (1 - s) ** 2 * x1 + 6 * (1 - s) * s * (x2 - x1) + 3 * s ** 2 * (1 - x2)
        if abs(d) < 1e-6:
            break
        s = clamp(s - dx / d)
    return bezier_y(s)


def ease_flip(p):        # cubic-bezier(0.22, 1, 0.36, 1)
    return cubic_bezier(p, 0.22, 1.0, 0.36, 1.0)


def ease_soft(p):        # cubic-bezier(0.4, 0, 0.2, 1)
    return cubic_bezier(p, 0.4, 0.0, 0.2, 1.0)


# ------------------------------------------------------------------ 字体
FONT_CACHE: dict = {}


def is_cjk(ch: str) -> bool:
    code = ord(ch)
    return (
        0x2E80 <= code <= 0x9FFF
        or 0xF900 <= code <= 0xFAFF
        or 0xFF00 <= code <= 0xFFEF
        or 0x3000 <= code <= 0x303F
    )


def split_runs(text: str):
    runs = []
    cur = ""
    cur_cjk = None
    for ch in text:
        flag = is_cjk(ch)
        if cur_cjk is None or flag == cur_cjk:
            cur += ch
        else:
            if cur:
                runs.append((cur, cur_cjk))
            cur = ch
        cur_cjk = flag
    if cur:
        runs.append((cur, cur_cjk))
    return runs


def get_font(size: float, weight: int, cjk: bool) -> ImageFont.FreeTypeFont:
    key = (round(size, 2), weight, cjk)
    cached = FONT_CACHE.get(key)
    if cached:
        return cached
    px = max(1, int(round(size * SS)))
    if cjk:
        path = FONT_DIR / ("msyhbd.ttc" if weight >= 600 else "msyh.ttc")
    else:
        if weight >= 700:
            path = FONT_DIR / "segoeuib.ttf"
        elif weight >= 600:
            path = FONT_DIR / "seguisb.ttf"
        else:
            path = FONT_DIR / "segoeui.ttf"
    font = ImageFont.truetype(str(path), px)
    FONT_CACHE[key] = font
    return font


def measure(text: str, size: float, weight: int = 400, tracking: float = 0.0) -> float:
    """返回 1x 像素宽度"""
    total = 0.0
    for run, cjk in split_runs(text):
        f = get_font(size, weight, cjk)
        total += f.getlength(run) + tracking * SS * len(run)
    return total / SS


def draw_text(draw, text, x, baseline, size, weight, color, tracking=0.0):
    """baseline 为 1x 基线坐标；返回绘制结束的 x"""
    X = x * SS
    B = baseline * SS
    for run, cjk in split_runs(text):
        f = get_font(size, weight, cjk)
        draw.text((X, B), run, font=f, fill=color, anchor="ls")
        X += f.getlength(run) + tracking * SS * len(run)
    return X / SS


def text_width(text, size, weight=400, tracking=0.0):
    return measure(text, size, weight, tracking)


# ------------------------------------------------------------------ 绘制基元
def rr(draw, x, y, w, h, radius, fill=None, outline=None, width=1):
    draw.rounded_rectangle(
        [x * SS, y * SS, (x + w) * SS, (y + h) * SS],
        radius=radius * SS,
        fill=fill,
        outline=outline,
        width=max(1, int(width * SS)),
    )


SHADOW_CACHE: dict = {}


def shadow_sprite(w, h, radius, blur, alpha, spread=0):
    key = (round(w), round(h), round(radius), round(blur), round(alpha, 3))
    if key in SHADOW_CACHE:
        return SHADOW_CACHE[key]
    pad = int(blur * 2 + 8)
    sw = int(w * SS) + pad * 2
    sh = int(h * SS) + pad * 2
    layer = Image.new("L", (sw, sh), 0)
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle(
        [pad, pad, pad + int(w * SS), pad + int(h * SS)],
        radius=radius * SS,
        fill=255,
    )
    layer = layer.filter(ImageFilter.GaussianBlur(blur * SS))
    tint = Image.new("RGB", (sw, sh), (20, 24, 38))
    mask = layer.point(lambda v: int(v * alpha))
    sprite = (tint, mask, pad)
    SHADOW_CACHE[key] = sprite
    return sprite


def paste_shadow(canvas, x, y, w, h, radius, blur=14, alpha=0.10):
    tint, mask, pad = shadow_sprite(w, h, radius, blur, alpha)
    canvas.paste(tint, (int(x * SS) - pad, int(y * SS) - pad), mask)


# ------------------------------------------------------------------ 背景光晕
AURA = None


def aura_layer():
    global AURA
    if AURA is not None:
        return AURA
    import numpy as np

    w, h = W * SS, H * SS
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    cx, cy = w * 0.5, h * 0.30
    rx, ry = w * 0.52, h * 0.46
    d = np.sqrt(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2)
    fall = np.clip(1.0 - d, 0.0, 1.0) ** 2.1
    base = np.array(BG, dtype=np.float32)
    tint = np.array(ACCENT, dtype=np.float32)
    mix = (fall * 0.11)[..., None]
    out = base * (1 - mix) + tint * mix
    AURA = Image.fromarray(out.astype("uint8"), "RGB")
    return AURA


# ------------------------------------------------------------------ 内容
ROWS = [
    {
        "home": True,
        "title": "哔哩哔哩",
        "site": "哔哩哔哩",
        "date": "",
        "summary": "bilibili.com · 官方网站首页",
    },
    {
        "title": "关于 B 站，你需要知道的十件事",
        "site": "少数派",
        "date": "2026/10/17",
        "summary": "从弹幕文化到番剧版权，B 站这五年变化很大。我们和十二位老用户聊了聊，他们仍然觉得社区氛围是最珍贵的东西，只是它变贵了。",
    },
    {
        "title": "B 站 2026 年第二季度财报解读：广告收入首次超过游戏",
        "site": "36氪",
        "date": "2026/10/16",
        "summary": "财报显示广告业务同比增长 38%，大会员数量突破 3000 万，但经营现金流依旧承压，销售费用率也创下三年新高。",
    },
    {
        "title": "如何用 Search API 搭建 RAG 检索层",
        "site": "github.com",
        "date": "2026/10/15",
        "summary": "最小可用的检索层实现，包含分块、重排与引用回填的完整流程，代码约 200 行，可以直接跑在自己的服务上。",
    },
    {
        "title": "为什么 B 站用户自称「阿宅」？",
        "site": "知乎",
        "date": "2026/10/14",
        "summary": "这个问题的回答里有一份 2015 年的社区考古，记录了弹幕礼仪最初的样子，以及第一批用户为什么留下来。",
    },
    {
        "title": "B 站 UP 主生存现状调查：用爱发电还能撑多久",
        "site": "界面新闻",
        "date": "2026/10/13",
        "summary": "采访了 40 位中腰部创作者，只有 7 位能靠平台分成覆盖设备与剪辑成本，更多的人在等一个不确定的转机。",
    },
    {
        "title": "从 A 站到 B 站：二次元社区的二十年",
        "site": "澎湃新闻",
        "date": "2026/10/12",
        "summary": "一部中国二次元社区的迁徙史，从论坛到弹幕站，再到今天的短视频平台，也是一代人的互联网记忆。",
    },
    {
        "title": "弹幕到底是什么：一个交互设计视角",
        "site": "少数派",
        "date": "2026/10/11",
        "summary": "把时间轴上的评论叠在画面上，为什么这种设计能成立，又为什么十年过去仍然难以复制到其他内容形态。",
    },
    {
        "title": "B 站直播业务拆解",
        "site": "晚点 LatePost",
        "date": "2026/10/10",
        "summary": "虚拟主播贡献了近四成流水，但签约成本与内容审核压力同样在上升，平台正在把重心挪回游戏与电商。",
    },
    {
        "title": "bilibili 客户端更新日志 v7.42",
        "site": "哔哩哔哩",
        "date": "2026/10/09",
        "summary": "本次更新优化了弹幕渲染性能，修复了部分机型播放 HDR 视频偏色的问题，并新增了离线缓存管理入口。",
    },
]

PAGE_SIZE = 5


# ------------------------------------------------------------------ 时间轴状态
def flip_amount(t):
    """0 = 首页布局，1 = 结果布局；来回都用同一条曲线"""
    if t < T["flip"][0]:
        return 0.0
    if t < T["flip"][1]:
        return ease_flip(progress(t, *T["flip"]))
    if t < T["home_flip"][0]:
        return 1.0
    if t < T["home_flip"][1]:
        return 1 - ease_flip(progress(t, *T["home_flip"]))
    return 0.0


def state(t):
    s = {}

    # 页面整体
    s["intro"] = ease_out_cubic(progress(t, *T["intro"]))

    # 打字
    typed_n = 0
    if t >= T["type"][0]:
        p = progress(t, *T["type"])
        typed_n = int(round(len(QUERY) * p))
    s["typed"] = QUERY[:typed_n]
    s["typing"] = progress(t, *T["type"]) > 0 and typed_n < len(QUERY)

    # 回车 → 翻转
    s["flip"] = flip_amount(t)

    # 页面滚动：关键帧之间用缓动，避免速度突变
    scroll_keys = [
        (5.55, 0.0),
        (6.35, 240.0),
        (6.75, 240.0),
        (7.55, 480.0),
        (7.95, 480.0),
        (8.60, 0.0),
    ]
    scroll = scroll_keys[0][1]
    for i in range(len(scroll_keys) - 1):
        t0, v0 = scroll_keys[i]
        t1, v1 = scroll_keys[i + 1]
        if t0 <= t <= t1:
            scroll = v0 + (v1 - v0) * ease_in_out_cubic(progress(t, t0, t1))
            break
    else:
        if t > scroll_keys[-1][0]:
            scroll = scroll_keys[-1][1]
    s["scroll"] = scroll

    # 表格行
    s["row_reveal"] = {}
    for i in range(len(ROWS)):
        if i < PAGE_SIZE:
            start = T["rows_in"] + i * T["row_stagger"]
        else:
            start = T["append"] + (i - PAGE_SIZE) * 0.05
        s["row_reveal"][i] = ease_out_cubic(progress(t, start, start + T["rows_dur"]))

    # 菜单
    s["menu"] = ease_soft(progress(t, *T["menu_in"]))
    if t >= T["menu_out"][0]:
        s["menu"] = 1 - ease_soft(progress(t, *T["menu_out"]))
    s["menu"] = clamp(s["menu"])

    # 保存 Key
    kp = progress(t, *T["key_type"])
    n = int(round(6 * kp))
    s["key_dots"] = "•" * n
    s["saved"] = progress(t, T["save_click"], T["save_click"] + 0.25)

    # 光标
    s["cursor"] = cursor_state(t)

    # 结束
    s["outro"] = ease_soft(progress(t, *T["outro_in"]))

    return s


def cursor_state(t):
    """返回 (可见度, x, y, 按下进度)"""
    if t < 5.40:
        return (0.0, 0, 0, 0.0)

    keys = [
        (5.40, 900, 660),
        (6.20, 830, 700),
        (6.55, 720, 575),
        (6.88, 720, 575),
        (7.60, 800, 700),
        (8.30, 1200, 230),
        (8.70, 1395, 37),
        (9.05, 1180, 120),
        (9.90, 1330, 274),
        (10.25, 1374, 274),
        (10.60, 1330, 274),
        (11.00, 1000, 560),
    ]

    # 找到所在区间，用缓动插值
    x, y = keys[0][1], keys[0][2]
    for i in range(len(keys) - 1):
        t0, x0, y0 = keys[i]
        t1, x1, y1 = keys[i + 1]
        if t0 <= t <= t1:
            p = ease_soft(progress(t, t0, t1))
            x = x0 + (x1 - x0) * p
            y = y0 + (y1 - y0) * p
            break
    else:
        if t > keys[-1][0]:
            x, y = keys[-1][1], keys[-1][2]

    # 按下压缩：点击时刻前后 0.1s
    press = 0.0
    for ct in (T["more_click"], T["gear_click"], T["save_click"]):
        d = abs(t - ct)
        if d < 0.09:
            press = 1.0 - d / 0.09
            break

    vis = clamp(progress(t, 5.40, 5.75))
    return (vis, x, y, press)


# ------------------------------------------------------------------ 绘制：顶栏
def draw_gear(canvas, cx, cy, r, color):
    d = ImageDraw.Draw(canvas)
    c = (cx * SS, cy * SS)
    R = r * SS
    width = 1.6 * SS
    # 齿
    for i in range(8):
        a = math.pi * 2 * i / 8
        x0 = c[0] + math.cos(a) * R * 0.72
        y0 = c[1] + math.sin(a) * R * 0.72
        x1 = c[0] + math.cos(a) * R * 1.02
        y1 = c[1] + math.sin(a) * R * 1.02
        d.line([(x0, y0), (x1, y1)], fill=color, width=int(width * 2.2))
    # 环
    d.ellipse(
        [c[0] - R * 0.8, c[1] - R * 0.8, c[0] + R * 0.8, c[1] + R * 0.8],
        outline=color,
        width=int(width),
    )
    # 中心孔
    d.ellipse(
        [c[0] - R * 0.3, c[1] - R * 0.3, c[0] + R * 0.3, c[1] + R * 0.3],
        outline=color,
        width=int(width),
    )


def draw_topbar(canvas, s):
    # 左上角标记
    mark = Image.open(Path(__file__).resolve().parent.parent / "src" / "icons" / "mark64.png").convert("RGB")
    size = int(30 * SS)
    mark = mark.resize((size, size), Image.LANCZOS)
    canvas.paste(mark, (26 * SS, 18 * SS))

    # 齿轮
    pressed = s["cursor"][3] if s["cursor"][0] > 0 else 0
    gear_cx, gear_cy = W - 26 - 19, 18 + 19
    color = TEXT_2
    draw_gear(canvas, gear_cx, gear_cy, 10.5, color)


# ------------------------------------------------------------------ 绘制：搜索框
def draw_finder(canvas, s, y, text, caret_on, focus=True):
    paste_shadow(canvas, FINDER_X, y, FINDER_W, FINDER_H, 29, blur=16, alpha=0.085)
    d = ImageDraw.Draw(canvas)
    rr(d, FINDER_X, y, FINDER_W, FINDER_H, 29, fill=SURFACE, outline=LINE, width=1)

    # 放大镜
    icon_cx, icon_cy = FINDER_X + 30, y + 29
    r = 6.4
    d.ellipse(
        [(icon_cx - r) * SS, (icon_cy - r) * SS, (icon_cx + r) * SS, (icon_cy + r) * SS],
        outline=TEXT_3,
        width=int(1.7 * SS),
    )
    d.line(
        [(icon_cx + r * 0.7) * SS, (icon_cy + r * 0.7) * SS, (icon_cx + r * 1.9) * SS, (icon_cy + r * 1.9) * SS],
        fill=TEXT_3,
        width=int(1.7 * SS),
    )

    baseline = y + FINDER_H / 2 + 5.6
    if text:
        end_x = draw_text(d, text, FINDER_X + 58, baseline, 16, 400, TEXT, tracking=-0.08)
    else:
        end_x = draw_text(d, "搜索网页", FINDER_X + 58, baseline, 16, 400, TEXT_3)

    if caret_on and focus and text:
        cx = (end_x + 1.5) if text else (FINDER_X + 58)
        d.rectangle(
            [cx * SS, (baseline - 15) * SS, (cx + 1.6) * SS, (baseline + 3) * SS],
            fill=ACCENT,
        )

    # 右侧 Enter 提示
    if not text:
        kbd_w, kbd_h = 44, 22
        kx = FINDER_X + FINDER_W - 18 - kbd_w
        ky = y + (FINDER_H - kbd_h) / 2
        rr(d, kx, ky, kbd_w, kbd_h, 6, outline=LINE, width=1)
        draw_text(d, "Enter", kx + 8, ky + 15, 10.5, 400, TEXT_3, tracking=0.4)


# ------------------------------------------------------------------ 绘制：时钟
def draw_clock(canvas, s, fp, t=0.0):
    alpha = clamp(1 - fp)
    if alpha <= 0.01:
        return

    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    time_txt = "11:27" if t >= 1.55 else "11:26"
    tw = text_width(time_txt, 84, 500, tracking=-2.94)
    draw_text(d, time_txt, (W - tw) / 2, CLOCK_TOP + 84 * 0.80, 84, 500, TEXT, tracking=-2.94)

    date_txt = "2026年10月18日 星期日"
    dw = text_width(date_txt, 12.5, 400, tracking=0.75)
    draw_text(d, date_txt, (W - dw) / 2, CLOCK_TOP + 84 + 11 + 10, 12.5, 400, TEXT_3, tracking=0.75)

    if alpha >= 0.999:
        canvas.paste(layer, (0, 0), layer)
        return

    # 淡出时轻微上移缩小，让搜索框的位移是唯一的视觉焦点
    scale = 1 - 0.03 * fp
    nw, nh = int(layer.size[0] * scale), int(layer.size[1] * scale)
    layer = layer.resize((nw, nh), Image.LANCZOS)
    a = layer.split()[3].point(lambda v: int(v * alpha))
    layer.putalpha(a)
    canvas.paste(
        layer,
        (int((canvas.size[0] - nw) / 2), int((canvas.size[1] - nh) / 2 - 10 * SS * fp)),
        layer,
    )


# ------------------------------------------------------------------ 绘制：结果
def draw_results(canvas, s, scroll):
    d = ImageDraw.Draw(canvas)
    base = RESULTS_TOP - scroll

    head_alpha = s["row_reveal"][0]
    if head_alpha > 0.01:
        head = "50 条结果"
        draw_text(d, head, FINDER_X + 4, base - 12, 11.5, 400, TEXT_3, tracking=0.1)
        dot_x = FINDER_X + 4 + text_width(head, 11.5) + 8
        d.ellipse(
            [dot_x * SS, (base - 16) * SS, (dot_x + 3) * SS, (base - 13) * SS],
            fill=TEXT_3,
        )
        draw_text(d, "412 ms", dot_x + 11, base - 12, 11.5, 400, TEXT_3)

        right = "复制全部"
        rw = text_width(right, 11.5)
        draw_text(d, right, FINDER_X + FINDER_W - 4 - rw, base - 12, 11.5, 400, TEXT_3)

    for i, row in enumerate(ROWS):
        p = s["row_reveal"][i]
        if p <= 0.01:
            continue
        y = base + i * ROW_H + (1 - p) * 7
        draw_row(canvas, row, FINDER_X, y, p, i)

    # 阅读更多：位置跟着行淡入平滑下移，避免一格格跳
    effective = sum(s["row_reveal"].values())
    if effective >= PAGE_SIZE - 0.05:
        remaining = max(0, 50 - int(round(effective)))
        label = f"阅读更多 · 还有 {remaining} 条"
        bw = text_width(label, 12.5) + 48
        bx = FINDER_X + (FINDER_W - bw) / 2
        btn_y = base + effective * ROW_H + 20

        press = 0.0
        if abs(T["more_click"] - s.get("_t", 0)) < 0.09:
            press = 1 - abs(T["more_click"] - s.get("_t", 0)) / 0.09
        rr(d, bx, btn_y, bw, 38, 19, fill=SURFACE if press else None, outline=LINE, width=1)
        tw = text_width(label, 12.5)
        draw_text(d, label, bx + (bw - tw) / 2, btn_y + 24, 12.5, 400, TEXT_2)


def draw_row(canvas, row, x, y, alpha, index):
    d = ImageDraw.Draw(canvas)
    if index > 0:
        d.line(
            [x * SS, y * SS, (x + FINDER_W) * SS, y * SS],
            fill=LINE,
            width=max(1, int(SS)),
        )

    cy = y + 13
    meta_x = x + 4

    if row.get("home"):
        label = "官网"
        bw = text_width(label, 10.5, 600) + 12
        rr(d, meta_x, cy + 1, bw, 18, 5, fill=ACCENT_SOFT)
        draw_text(d, label, meta_x + 6, cy + 14.5, 10.5, 600, ACCENT)
        meta_x += bw + 7

    site_w = text_width(row["site"], 11.5)
    draw_text(d, row["site"], meta_x, cy + 14.5, 11.5, 400, TEXT_3)
    meta_x += site_w + 7

    if row["date"]:
        d.ellipse(
            [meta_x * SS, (cy + 8.5) * SS, (meta_x + 3) * SS, (cy + 11.5) * SS],
            fill=TEXT_3,
        )
        meta_x += 11
        draw_text(d, row["date"], meta_x, cy + 14.5, 11.5, 400, TEXT_3)

    # 标题
    ty = cy + 20 + 17
    draw_text(d, row["title"], x + 4, ty, 16, 600, TEXT, tracking=-0.2)

    # 摘要两行
    sy = ty + 23
    lines = wrap(row["summary"], FINDER_W - 8, 13.5)
    for li, line in enumerate(lines[:2]):
        draw_text(d, line, x + 4, sy + li * 22, 13.5, 400, TEXT_2)


NO_LINE_START = "。，、；：？！）】》」』”’,.;:?!)]}"


def wrap(text, max_w, size, weight=400):
    lines, cur = [], ""
    for ch in text:
        if text_width(cur + ch, size, weight) > max_w and cur:
            if ch in NO_LINE_START:
                # 收尾标点不另起一行，宁可让这一行多半个字
                lines.append(cur + ch)
                cur = ""
            else:
                lines.append(cur)
                cur = ch
        else:
            cur += ch
    if cur:
        lines.append(cur)
    return lines


def draw_menu(canvas, s):
    if s["menu"] <= 0.01:
        return

    mw, mx, my = 344, W - 24 - 344, 68
    # 内部布局
    pad_x, pad_y = 16, 14
    head_h = 26
    group1 = 10 + 32 + 32 + 10
    group2 = 10 + 16 + 34 + 9 + 26 + 10
    group3 = 10 + 26 + 10
    fine = 26
    mh = pad_y + head_h + group1 + group2 + group3 + fine + 8

    p = s["menu"]
    scale = 0.965 + 0.035 * p
    alpha = p

    layer = Image.new("RGBA", (int(mw * SS) + 200, int(mh * SS) + 200), (0, 0, 0, 0))
    off = 100
    d = ImageDraw.Draw(layer)

    rr(d, off / SS, off / SS, mw, mh, 20, fill=(255, 255, 255), outline=LINE, width=1)

    # 细分割线
    y = pad_y + head_h
    d.line(
        [(off + pad_x * SS), (off + y * SS), (off + (mw - pad_x) * SS), (off + y * SS)],
        fill=LINE,
        width=max(1, int(SS)),
    )

    draw_text(d, "设置", off / SS + pad_x, off / SS + pad_y + 15, 13, 600, TEXT)

    # 关闭钮
    cxx = off / SS + mw - pad_x - 9
    cyy = off / SS + pad_y + 8
    d.line([(cxx - 4) * SS, (cyy - 4) * SS, (cxx + 4) * SS, (cyy + 4) * SS], fill=TEXT_3, width=int(1.6 * SS))
    d.line([(cxx + 4) * SS, (cyy - 4) * SS, (cxx - 4) * SS, (cyy + 4) * SS], fill=TEXT_3, width=int(1.6 * SS))

    # 组 1
    gy = y + 10
    draw_text(d, "每页显示", off / SS + pad_x, off / SS + gy + 15, 13, 400, TEXT_2)
    sel_w, sel_h = 74, 26
    sx = off / SS + mw - pad_x - sel_w
    rr(d, sx, off / SS + gy + 3, sel_w, sel_h, 8, fill=SURFACE_2, outline=LINE, width=1)
    draw_text(d, "5 条", sx + 10, off / SS + gy + 21, 12.5, 400, TEXT)

    gy += 32
    draw_text(d, "附带网页正文", off / SS + pad_x, off / SS + gy + 15, 13, 400, TEXT_2)
    sw_x = off / SS + mw - pad_x - 40
    rr(d, sw_x, off / SS + gy + 4, 40, 24, 12, fill=(201, 201, 206))
    d.ellipse(
        [(sw_x + 3) * SS, (off / SS + gy + 7) * SS, (sw_x + 21) * SS, (off / SS + gy + 25) * SS],
        fill=(255, 255, 255),
    )

    # 组 2
    gy += 32 + 10
    d.line(
        [(off + pad_x * SS), (off + gy * SS), (off + (mw - pad_x) * SS), (off + gy * SS)],
        fill=LINE,
        width=max(1, int(SS)),
    )
    gy += 10
    draw_text(d, "API KEY", off / SS + pad_x, off / SS + gy + 10, 10.5, 600, TEXT_3, tracking=0.8)

    fy = gy + 16
    rr(d, off / SS + pad_x, off / SS + fy, mw - pad_x * 2, 34, 9, fill=SURFACE_2, outline=LINE, width=1)
    if s["key_dots"]:
        draw_text(d, s["key_dots"], off / SS + pad_x + 10, off / SS + fy + 22, 13, 400, TEXT)

    # 保存按钮
    by = fy + 34 + 9
    save_w = 52
    save_x = off / SS + mw - pad_x - save_w
    pressed = 1 - s["saved"] if s["saved"] > 0 else 0
    rr(d, save_x, off / SS + by, save_w, 26, 8, fill=ACCENT)
    draw_text(d, "保存", save_x + 13, off / SS + by + 18, 12, 600, (255, 255, 255))

    note = "已保存" if s["saved"] > 0.02 else "仅保存在本机"
    draw_text(d, note, off / SS + pad_x, off / SS + by + 18, 12, 400, ACCENT if s["saved"] > 0.02 else TEXT_3)

    # 组 3
    gy = by + 26 + 10
    d.line(
        [(off + pad_x * SS), (off + gy * SS), (off + (mw - pad_x) * SS), (off + gy * SS)],
        fill=LINE,
        width=max(1, int(SS)),
    )
    gy += 10
    draw_text(d, "本地缓存 3 条", off / SS + pad_x, off / SS + gy + 15, 12, 400, TEXT_3)
    cw = 40
    cx2 = off / SS + mw - pad_x - cw
    rr(d, cx2, off / SS + gy + 2, cw, 26, 8, fill=SURFACE_2, outline=LINE, width=1)
    draw_text(d, "清空", cx2 + 8, off / SS + gy + 19, 12, 400, TEXT_2)

    # 细字
    fp = "5 元 / 1000 次成功请求 · 每账号 5 QPS"
    fw = text_width(fp, 11)
    draw_text(d, fp, off / SS + (mw - fw) / 2, off / SS + mh - 14, 11, 400, TEXT_3)

    # 缩放 + 透明
    nw, nh = int(layer.size[0] * scale), int(layer.size[1] * scale)
    layer = layer.resize((nw, nh), Image.LANCZOS)
    if alpha < 0.999:
        a = layer.split()[3].point(lambda v: int(v * alpha))
        layer.putalpha(a)

    pos_x = int((mx - 100 / SS) * SS + (layer.size[0] - (mw * SS + 200)) / 2)
    pos_y = int((my - 100 / SS) * SS + (layer.size[1] - (mh * SS + 200)) / 2)
    paste_shadow(canvas, mx, my, mw, mh, 20, blur=26, alpha=0.16)
    canvas.paste(layer, (pos_x, pos_y), layer)


# ------------------------------------------------------------------ 绘制：光标
CURSOR_PTS = [
    (0, 0), (0, 17.5), (4.6, 13.2), (7.6, 20.2),
    (10.2, 19.1), (7.2, 12.3), (12.6, 12.1),
]
CURSOR_SCALE = 1.55


def draw_cursor(canvas, s):
    vis, x, y, press = s["cursor"]
    if vis <= 0:
        return

    scale = 1 - 0.12 * press
    pts = [(px * CURSOR_SCALE, py * CURSOR_SCALE) for px, py in CURSOR_PTS]
    w = max(p[0] for p in pts) + 4
    h = max(p[1] for p in pts) + 4

    layer = Image.new("RGBA", (int(w * SS) + 40, int(h * SS) + 40), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    off = 20

    poly = [(off + px * SS, off + py * SS) for px, py in pts]

    # 先画一圈深色，再填白，得到清晰的描边
    d.line(poly + [poly[0]], fill=(28, 30, 38, 255), width=int(3.2 * SS), joint="curve")
    d.polygon(poly, fill=(255, 255, 255, 255))

    if scale != 1:
        nw = int(layer.size[0] * scale)
        nh = int(layer.size[1] * scale)
        layer = layer.resize((nw, nh), Image.LANCZOS)
        off = int(off * scale)

    px = int(x * SS - off)
    py = int(y * SS - off)

    shadow = layer.split()[3].point(lambda v: int(v * 0.28))
    canvas.paste((0, 0, 0), (px + 2, py + 3), shadow)
    canvas.paste(layer, (px, py), layer)


# ------------------------------------------------------------------ 页面帧
def render_page(t, s):
    canvas = aura_layer().copy()

    fp = s["flip"]
    scroll = s["scroll"] * fp

    if fp > 0.2 and s["row_reveal"][0] > 0:
        draw_results(canvas, s, scroll)

    y = HOME_FINDER_TOP + (RESULT_FINDER_TOP - HOME_FINDER_TOP) * fp - scroll

    if fp < 0.97:
        draw_clock(canvas, s, fp, t)

    typing = s["typing"]
    caret_on = True if typing else (((t * 1.06) % 1.0) < 0.55)
    text = s["typed"] if fp < 0.5 else QUERY
    draw_finder(canvas, s, y, text, caret_on)

    draw_topbar(canvas, s)
    draw_menu(canvas, s)
    draw_cursor(canvas, s)
    return canvas


def render_outro(t):
    p = ease_soft(progress(t, *T["outro_in"]))
    settle = ease_out_cubic(progress(t, 11.95, 15.10))
    canvas = aura_layer().copy()
    d = ImageDraw.Draw(canvas)

    # 标记
    mark = Image.open(Path(__file__).resolve().parent.parent / "src" / "icons" / "icon128.png").convert("RGBA")
    size = int(116 * (1.055 - 0.055 * settle))
    mark = mark.resize((size * SS, size * SS), Image.LANCZOS)
    if p < 0.999:
        a = mark.split()[3].point(lambda v: int(v * p))
        mark.putalpha(a)
    mx = int((W / 2) * SS - mark.size[0] / 2)
    my = int((H * 0.360 - size / 2) * SS)
    canvas.paste(mark, (mx, my), mark)

    # 标题
    brand = "蓝鲸搜索"
    bw = text_width(brand, 50, 600, tracking=2.0)
    draw_text(d, brand, (W - bw) / 2, H * 0.492, 50, 600, TEXT, tracking=2.0)

    # 副标题
    sub = "搜索，就是新标签页"
    sw = text_width(sub, 18, 400, tracking=0.6)
    draw_text(d, sub, (W - sw) / 2, H * 0.545, 18, 400, TEXT_3, tracking=0.6)

    # 三个特性
    feats = "官网优先   ·   阅读更多   ·   一键引用"
    fw = text_width(feats, 13, 400, tracking=0.5)
    draw_text(d, feats, (W - fw) / 2, H * 0.605, 13, 400, TEXT_3, tracking=0.5)

    footer = "Chrome · Firefox · 由 DeepSeek 搜索 API 驱动"
    fw2 = text_width(footer, 12, 400, tracking=0.4)
    draw_text(d, footer, (W - fw2) / 2, H * 0.715, 12, 400, TEXT_3, tracking=0.4)

    return canvas


# ------------------------------------------------------------------ 合成
def render(t):
    s = state(t)
    s["_t"] = t
    page = render_page(t, s)

    intro = s["intro"]
    if intro < 0.999:
        blank = aura_layer().copy()
        page = Image.blend(blank, page, intro)

    if t < T["outro_in"][0]:
        return page

    outro = render_outro(t)
    p = ease_soft(progress(t, *T["outro_in"]))
    settle = ease_out_cubic(progress(t, 11.95, 15.10))
    if p >= 1:
        return outro

    # 页面淡出并轻微放大
    scale = 1 + 0.015 * p
    nw, nh = int(W * SS * scale), int(H * SS * scale)
    page_big = page.resize((nw, nh), Image.LANCZOS)
    ox = (nw - W * SS) // 2
    oy = (nh - H * SS) // 2
    page = page_big.crop((ox, oy, ox + W * SS, oy + H * SS))

    return Image.blend(page, outro, p)


# ------------------------------------------------------------------ 入口
def save(img, path):
    img.resize((1920, 1080), Image.LANCZOS).save(path, "PNG", optimize=False)


def main(argv):
    if "--preview" in argv:
        idx = argv.index("--preview")
        times = [float(v) for v in argv[idx + 1 :] if not v.startswith("--")]
        out_dir = Path(__file__).parent / "build" / "preview"
        out_dir.mkdir(parents=True, exist_ok=True)
        for tt in times:
            img = render(tt)
            path = out_dir / f"t{tt:05.2f}.png"
            save(img, path)
            print(f"{path.name}  ({tt}s)")
        return

    if "--one" in argv:
        idx = argv.index("--one")
        tt = float(argv[idx + 1])
        out = Path(__file__).parent / "build" / "one.png"
        out.parent.mkdir(parents=True, exist_ok=True)
        save(render(tt), out)
        print(out)
        return

    # 全量
    FRAMES_DIR.mkdir(parents=True, exist_ok=True)
    total = int(round(DURATION * FPS))
    import time as _time

    started = _time.time()
    for i in range(total):
        t = i / FPS
        save(render(t), FRAMES_DIR / f"{i:05d}.png")
        if i % 60 == 0:
            elapsed = _time.time() - started
            eta = elapsed / max(1, i) * (total - i) if i else 0
            print(f"[{i}/{total}] {elapsed:.1f}s elapsed, eta {eta:.0f}s", flush=True)
    print(f"done: {total} frames")


if __name__ == "__main__":
    main(sys.argv[1:])
