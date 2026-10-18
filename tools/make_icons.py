"""生成扩展图标与左上角标记。

源图：assets/portrait.jpg（1820×1820，白底立绘）。
原图右上是放大镜道具，裁切刻意避开它，只取人物头部/肩部。

小尺寸（≤48）用更紧的头像构图，让脸在 16–32px 还认得出；
大尺寸（96/128）保留肩部，构图更完整。
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "portrait.jpg"
OUT_DIR = ROOT / "src" / "icons"

# 1820×1820 坐标系下的正方形裁切框
CROP_WIDE = (590, 150, 1210, 770)   # 头 + 肩 + 胸前的蝴蝶结
CROP_TIGHT = (690, 260, 1110, 680)  # 只到头部，用在 48px 以下
SUPERSAMPLE = 8
CORNER_RATIO = 0.24


def crop_for(size: int) -> tuple[int, int, int, int]:
    return CROP_TIGHT if size <= 48 else CROP_WIDE


def rounded_tile(art: Image.Image, size: int, ss: int = SUPERSAMPLE) -> Image.Image:
    big = size * ss
    square = art.resize((big, big), Image.LANCZOS).convert("RGBA")

    radius = round(big * CORNER_RATIO)
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, big - 1, big - 1), radius=radius, fill=255)

    # 原图是白底，铺一层白再叠人物，圆角外保持透明
    canvas = Image.new("RGBA", (big, big), (255, 255, 255, 0))
    canvas.paste(Image.new("RGBA", (big, big), (255, 255, 255, 255)), (0, 0), mask)
    canvas.paste(square, (0, 0), mask)

    return canvas.resize((size, size), Image.LANCZOS)


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"找不到源图：{SRC}")

    source = Image.open(SRC).convert("RGB")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for size in (16, 32, 48, 96, 128):
        art = source.crop(crop_for(size))
        path = OUT_DIR / f"icon{size}.png"
        rounded_tile(art, size).save(path, "PNG", optimize=True)
        print(f"wrote {path.name} ({size}x{size})")

    # 页面左上角的标记：比 128 小、比 32 大，单独出，避免浏览器缩放发糊
    mark = rounded_tile(source.crop(CROP_TIGHT), 64)
    mark_path = OUT_DIR / "mark64.png"
    mark.save(mark_path, "PNG", optimize=True)
    print(f"wrote {mark_path.name} (64x64)")


if __name__ == "__main__":
    main()
