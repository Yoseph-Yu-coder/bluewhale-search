"""生成正方形头像（爱发电、GitHub、商店等平台用）。

圆形裁切由平台自己完成，所以这里输出**方形、无圆角**的图，
四角留一点呼吸感，套进圆形遮罩时脸不会被切。

    python make_avatar.py
产物：src/icons/avatar160.png、avatar320.png
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "portrait.jpg"
OUT = ROOT / "src" / "icons"

# 比图标用的紧裁再往外放一点，给圆形遮罩留边
CROP = (615, 135, 1255, 775)


def build(size: int) -> Image.Image:
    art = Image.open(SRC).convert("RGB").crop(CROP)
    return art.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (160, 320):
        path = OUT / f"avatar{size}.png"
        build(size).save(path, "PNG", optimize=True)
        print(f"wrote {path.name} ({size}×{size})")


if __name__ == "__main__":
    main()

